import { JSDOM } from 'jsdom';

import { FigureCrop } from '../types';
import {
	applyCropToViewBox,
	parseViewBox,
	pointsToPath,
	resolveHrefId,
	resolvePointsAttr,
	resolveRootViewBox,
} from './parser-utils';
import {
	collectCssRules,
	DEFAULT_SVG_STYLE,
	parseSvgLength,
	resolveElementStyle,
} from './style';
import { collectTextGroups } from './text-parser';
import {
	IDENTITY_MATRIX,
	multiplyMatrices,
	parseSvgTransform,
	scaleMatrix,
	translationMatrix,
} from './transform';
import {
	Matrix2D,
	SvgComputedStyle,
	SvgIrElement,
	SvgMarkerDefinition,
	SvgParsedDocument,
} from './types';

export { resolveRootViewBox } from './parser-utils';

const UNSUPPORTED_ELEMENTS = new Set([
	'foreignobject',
	'image',
	'mask',
	'filter',
	'lineargradient',
	'radialgradient',
	'pattern',
	'textpath',
	'script',
	'switch',
	'animate',
	'animatetransform',
	'animatemotion',
	'set',
]);

const SKIPPED_CONTAINERS = new Set([
	'defs',
	'style',
	'marker',
	'clippath',
	'title',
	'desc',
	'metadata',
]);

/** Parse and validate an SVG document into resolution-independent IR elements ready for `ShapeGroupRun` compilation. */
export function parseSvgDocument(
	svgXml: string,
	crop?: FigureCrop,
): SvgParsedDocument {
	const dom = new JSDOM(svgXml, { contentType: 'image/svg+xml' });
	try {
		const root = dom.window.document.documentElement;
		if (root.localName.toLowerCase() !== 'svg') {
			throw new Error('Invalid SVG root element.');
		}
		const viewBox = applyCropToViewBox(resolveRootViewBox(root), crop);
		const vbWidth = viewBox.right - viewBox.left;
		const vbHeight = viewBox.bottom - viewBox.top;
		const rules = collectCssRules(root);
		const idMap = new Map<string, Element>();
		for (const el of root.querySelectorAll('[id]')) {
			const id = el.getAttribute('id');
			if (id && !idMap.has(id)) idMap.set(id, el);
		}
		const clipPaths = new Map<string, Element>();
		for (const cp of root.querySelectorAll('clipPath[id]')) {
			const id = cp.getAttribute('id');
			if (id) clipPaths.set(id, cp);
		}

		const elements: SvgIrElement[] = [];
		const fontSizesPx: number[] = [];
		const markers = new Map<string, SvgMarkerDefinition>();

		const validateClipAttr = (el: Element): void => {
			const clipAttr = el.getAttribute('clip-path') ?? '';
			const match = /^url\(\s*#([^)\s]+)\s*\)$/iu.exec(clipAttr.trim());
			if (!match) return;
			const cp = clipPaths.get(match[1]);
			const children = cp ? Array.from(cp.children) : [];
			const onlyRect =
				children.length === 1 &&
				children[0].localName.toLowerCase() === 'rect';
			if (!onlyRect) {
				throw new Error(
					`Unsupported non-rectangular SVG <clipPath id="${match[1]}"> in svgMode: "shapes". Use svgMode: "image".`,
				);
			}
		};

		const walkElement = (
			el: Element,
			parentMatrix: Matrix2D,
			parentStyle: SvgComputedStyle,
			useStack: Set<string>,
			out: SvgIrElement[],
			collectFonts: boolean,
		): void => {
			const tag = el.localName.toLowerCase();
			if (SKIPPED_CONTAINERS.has(tag)) return;
			if (UNSUPPORTED_ELEMENTS.has(tag)) {
				throw new Error(
					`Unsupported SVG element <${el.localName}> in svgMode: "shapes". Remove it or set svgMode: "image".`,
				);
			}
			validateClipAttr(el);
			const style = resolveElementStyle(el, parentStyle, rules);
			if (style.display === 'none') return;
			const localMatrix = parseSvgTransform(el.getAttribute('transform'));
			let matrix = multiplyMatrices(parentMatrix, localMatrix);
			const em = style.fontSizePx;

			if (tag === 'svg') {
				const nx = parseSvgLength(el.getAttribute('x'), 0, em, vbWidth);
				const ny = parseSvgLength(
					el.getAttribute('y'),
					0,
					em,
					vbHeight,
				);
				const nw = parseSvgLength(
					el.getAttribute('width'),
					vbWidth,
					em,
					vbWidth,
				);
				const nh = parseSvgLength(
					el.getAttribute('height'),
					vbHeight,
					em,
					vbHeight,
				);
				const innerVb = parseViewBox(el.getAttribute('viewBox'));
				if (innerVb) {
					const sx = nw / (innerVb.right - innerVb.left);
					const sy = nh / (innerVb.bottom - innerVb.top);
					matrix = multiplyMatrices(matrix, [
						sx,
						0,
						0,
						sy,
						nx - innerVb.left * sx,
						ny - innerVb.top * sy,
					]);
				} else if (nx !== 0 || ny !== 0) {
					matrix = multiplyMatrices(
						matrix,
						translationMatrix(nx, ny),
					);
				}
				for (const child of Array.from(el.children)) {
					walkElement(
						child,
						matrix,
						style,
						useStack,
						out,
						collectFonts,
					);
				}
				return;
			}

			if (tag === 'g' || tag === 'a') {
				for (const child of Array.from(el.children)) {
					walkElement(
						child,
						matrix,
						style,
						useStack,
						out,
						collectFonts,
					);
				}
				return;
			}

			if (tag === 'use') {
				const refId = resolveHrefId(el);
				if (!refId) return;
				if (useStack.has(refId) || useStack.size >= 64) {
					throw new Error(
						`Cyclic or deep SVG <use href="#${refId}"> detected.`,
					);
				}
				const target = idMap.get(refId);
				if (!target) {
					throw new Error(`Missing SVG <use> target #${refId}.`);
				}
				const ux = parseSvgLength(el.getAttribute('x'), 0, em, vbWidth);
				const uy = parseSvgLength(
					el.getAttribute('y'),
					0,
					em,
					vbHeight,
				);
				const nextMatrix =
					ux !== 0 || uy !== 0
						? multiplyMatrices(matrix, translationMatrix(ux, uy))
						: matrix;
				const nextStack = new Set(useStack);
				nextStack.add(refId);
				walkElement(
					target,
					nextMatrix,
					style,
					nextStack,
					out,
					collectFonts,
				);
				return;
			}

			if (style.visibility === 'hidden') return;

			if (tag === 'rect') {
				const w = parseSvgLength(
					el.getAttribute('width'),
					0,
					em,
					vbWidth,
				);
				const h = parseSvgLength(
					el.getAttribute('height'),
					0,
					em,
					vbHeight,
				);
				if (w <= 0 || h <= 0) return;
				const x = parseSvgLength(el.getAttribute('x'), 0, em, vbWidth);
				const y = parseSvgLength(el.getAttribute('y'), 0, em, vbHeight);
				const rawRx = el.getAttribute('rx');
				const rawRy = el.getAttribute('ry');
				let rx = rawRx ? parseSvgLength(rawRx, 0, em, vbWidth) : 0;
				let ry = rawRy ? parseSvgLength(rawRy, 0, em, vbHeight) : 0;
				if (rawRx && !rawRy) ry = rx;
				if (rawRy && !rawRx) rx = ry;
				out.push({
					kind: 'rect',
					x,
					y,
					width: w,
					height: h,
					rx: Math.min(Math.max(0, rx), w / 2),
					ry: Math.min(Math.max(0, ry), h / 2),
					matrix,
					style,
				});
				return;
			}

			if (tag === 'circle' || tag === 'ellipse') {
				const cx = parseSvgLength(
					el.getAttribute('cx'),
					0,
					em,
					vbWidth,
				);
				const cy = parseSvgLength(
					el.getAttribute('cy'),
					0,
					em,
					vbHeight,
				);
				const rx =
					tag === 'circle'
						? parseSvgLength(
								el.getAttribute('r'),
								0,
								em,
								Math.hypot(vbWidth, vbHeight) / Math.SQRT2,
							)
						: parseSvgLength(el.getAttribute('rx'), 0, em, vbWidth);
				const ry =
					tag === 'circle'
						? rx
						: parseSvgLength(
								el.getAttribute('ry'),
								0,
								em,
								vbHeight,
							);
				if (rx <= 0 || ry <= 0) return;
				out.push({ kind: 'ellipse', cx, cy, rx, ry, matrix, style });
				return;
			}

			if (tag === 'line') {
				const x1 = parseSvgLength(
					el.getAttribute('x1'),
					0,
					em,
					vbWidth,
				);
				const y1 = parseSvgLength(
					el.getAttribute('y1'),
					0,
					em,
					vbHeight,
				);
				const x2 = parseSvgLength(
					el.getAttribute('x2'),
					0,
					em,
					vbWidth,
				);
				const y2 = parseSvgLength(
					el.getAttribute('y2'),
					0,
					em,
					vbHeight,
				);
				out.push({ kind: 'line', x1, y1, x2, y2, matrix, style });
				return;
			}

			if (tag === 'polyline' || tag === 'polygon') {
				const pts = resolvePointsAttr(el.getAttribute('points'));
				out.push({
					kind: 'path',
					d: pointsToPath(pts, tag === 'polygon'),
					matrix,
					style,
				});
				return;
			}

			if (tag === 'path') {
				const d = el.getAttribute('d')?.trim() ?? '';
				if (!d) return;
				out.push({ kind: 'path', d, matrix, style });
				return;
			}

			if (tag === 'text') {
				const collected = collectTextGroups(
					el,
					style,
					matrix,
					rules,
					viewBox,
				);
				out.push(...collected.groups);
				if (collectFonts) fontSizesPx.push(...collected.fontSizesPx);
				return;
			}

			throw new Error(
				`Unsupported SVG element <${el.localName}> in svgMode: "shapes".`,
			);
		};

		const rootStyle = resolveElementStyle(root, DEFAULT_SVG_STYLE, rules);
		for (const markerEl of root.querySelectorAll('marker[id]')) {
			const id = markerEl.getAttribute('id');
			if (!id) continue;
			const markerViewBox = parseViewBox(
				markerEl.getAttribute('viewBox'),
			);
			const markerW = parseSvgLength(
				markerEl.getAttribute('markerWidth'),
				3,
			);
			const markerH = parseSvgLength(
				markerEl.getAttribute('markerHeight'),
				3,
			);
			const refX = parseSvgLength(markerEl.getAttribute('refX'), 0);
			const refY = parseSvgLength(markerEl.getAttribute('refY'), 0);
			const orientAttr = (markerEl.getAttribute('orient') ?? '0').trim();
			const orient: SvgMarkerDefinition['orient'] =
				orientAttr === 'auto' || orientAttr === 'auto-start-reverse'
					? orientAttr
					: Number.parseFloat(orientAttr) || 0;
			const markerUnits =
				markerEl.getAttribute('markerUnits') === 'userSpaceOnUse'
					? 'userSpaceOnUse'
					: 'strokeWidth';
			const markerElements: SvgIrElement[] = [];
			let baseMatrix = IDENTITY_MATRIX;
			if (markerViewBox) {
				const sx = markerW / (markerViewBox.right - markerViewBox.left);
				const sy = markerH / (markerViewBox.bottom - markerViewBox.top);
				baseMatrix = multiplyMatrices(
					scaleMatrix(sx, sy),
					translationMatrix(-refX, -refY),
				);
			} else {
				baseMatrix = translationMatrix(-refX, -refY);
			}
			const markerStyle = resolveElementStyle(markerEl, rootStyle, rules);
			for (const child of Array.from(markerEl.children)) {
				walkElement(
					child,
					baseMatrix,
					markerStyle,
					new Set(),
					markerElements,
					false,
				);
			}
			markers.set(id, {
				id,
				refX,
				refY,
				markerWidth: markerW,
				markerHeight: markerH,
				orient,
				markerUnits,
				viewBox: markerViewBox,
				elements: markerElements,
			});
		}

		for (const child of Array.from(root.children)) {
			walkElement(
				child,
				IDENTITY_MATRIX,
				rootStyle,
				new Set(),
				elements,
				true,
			);
		}
		if (elements.length === 0) {
			throw new Error(
				'SVG contains no visible shapes or text to compile.',
			);
		}
		return { viewBox, elements, markers, fontSizesPx };
	} finally {
		dom.window.close();
	}
}
