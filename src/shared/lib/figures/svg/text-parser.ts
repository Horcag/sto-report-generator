import { parseSvgPaint, resolvePaintOpacity } from './color';
import { CssStyleRule, parseSvgLength, resolveElementStyle } from './style';
import { decomposeOrthogonalMatrix } from './transform';
import {
	Matrix2D,
	RectBounds,
	SvgComputedStyle,
	SvgTextGroup,
	SvgTextSpan,
} from './types';

interface TextCursor {
	x: number;
	y: number;
	groups: SvgTextGroup[];
}

function flushSpanIntoGroup(
	cursor: TextCursor,
	span: SvgTextSpan,
	matrix: Matrix2D,
	explicitNewLine: boolean,
): void {
	const last = cursor.groups.at(-1);
	if (
		!explicitNewLine &&
		last &&
		last.textAnchor === span.textAnchor &&
		last.dominantBaseline === span.dominantBaseline
	) {
		last.spans.push(span);
		return;
	}
	cursor.groups.push({
		kind: 'text',
		spans: [span],
		x: span.x,
		y: span.y,
		textAnchor: span.textAnchor,
		dominantBaseline: span.dominantBaseline,
		matrix,
	});
}

/** Collect SVG `<text>` and `<tspan>` runs into positioned text groups with resolved styles and font sizes. */
export function collectTextGroups(
	textElement: Element,
	style: SvgComputedStyle,
	matrix: Matrix2D,
	rules: readonly CssStyleRule[],
	viewBox: RectBounds,
): { groups: SvgTextGroup[]; fontSizesPx: number[] } {
	const ortho = decomposeOrthogonalMatrix(matrix);
	if (!ortho || ortho.flipX) {
		throw new Error(
			'Unsupported skewed or mirrored <text> transform in svgMode: "shapes". Use svgMode: "image" or non-skewed transforms.',
		);
	}
	const vbW = viewBox.right - viewBox.left;
	const vbH = viewBox.bottom - viewBox.top;
	const startX = parseSvgLength(
		textElement.getAttribute('x'),
		0,
		style.fontSizePx,
		vbW,
	);
	const startY = parseSvgLength(
		textElement.getAttribute('y'),
		0,
		style.fontSizePx,
		vbH,
	);
	const cursor: TextCursor = { x: startX, y: startY, groups: [] };
	const fontSizesPx: number[] = [];

	const walkTextNode = (
		node: Element,
		nodeStyle: SvgComputedStyle,
		isRoot: boolean,
	): void => {
		const rawX = isRoot ? null : node.getAttribute('x');
		const rawY = isRoot ? null : node.getAttribute('y');
		const dxAttr = node.getAttribute('dx');
		const dyAttr = node.getAttribute('dy');
		if (dxAttr) {
			cursor.x += parseSvgLength(dxAttr, 0, nodeStyle.fontSizePx, vbW);
		}
		if (dyAttr) {
			cursor.y += parseSvgLength(dyAttr, 0, nodeStyle.fontSizePx, vbH);
		}
		if (rawX !== null) {
			cursor.x = parseSvgLength(
				rawX,
				cursor.x,
				nodeStyle.fontSizePx,
				vbW,
			);
		}
		if (rawY !== null) {
			cursor.y = parseSvgLength(
				rawY,
				cursor.y,
				nodeStyle.fontSizePx,
				vbH,
			);
		}
		let forceNewLine = Boolean(rawX !== null || rawY !== null || dyAttr);
		if (isRoot && (dxAttr || dyAttr)) {
			forceNewLine = true;
		}
		const paint = resolvePaintOpacity(
			parseSvgPaint(nodeStyle.fillRaw, nodeStyle.colorHex),
			nodeStyle.opacity * nodeStyle.fillOpacity,
		);
		for (const child of Array.from(node.childNodes)) {
			if (child.nodeType === 3 || child.nodeType === 4) {
				const rawText = child.textContent ?? '';
				const normalized = rawText.replace(/\s+/gu, ' ');
				if (!normalized.trim()) continue;
				if (
					nodeStyle.display !== 'none' &&
					nodeStyle.visibility !== 'hidden' &&
					paint
				) {
					fontSizesPx.push(nodeStyle.fontSizePx * ortho.scaleY);
					flushSpanIntoGroup(
						cursor,
						{
							text: normalized,
							x: cursor.x,
							y: cursor.y,
							fontFamily: nodeStyle.fontFamily,
							fontSizePx: nodeStyle.fontSizePx,
							bold: nodeStyle.bold,
							italic: nodeStyle.italic,
							colorHex: paint.hex,
							transparency: paint.transparency ?? 0,
							textAnchor: nodeStyle.textAnchor,
							dominantBaseline: nodeStyle.dominantBaseline,
						},
						matrix,
						forceNewLine,
					);
					forceNewLine = false;
				}
			} else if (child.nodeType === 1) {
				const childEl = child as Element;
				const local = childEl.localName.toLowerCase();
				if (local === 'textpath') {
					throw new Error(
						'Unsupported SVG <textPath> element in svgMode: "shapes". Convert text on path or use svgMode: "image".',
					);
				}
				if (local !== 'tspan') {
					throw new Error(
						`Unsupported child <${childEl.localName}> inside SVG <text> in svgMode: "shapes".`,
					);
				}
				const spanStyle = resolveElementStyle(
					childEl,
					nodeStyle,
					rules,
				);
				walkTextNode(childEl, spanStyle, false);
			}
		}
	};

	walkTextNode(textElement, style, true);
	return { groups: cursor.groups, fontSizesPx };
}
