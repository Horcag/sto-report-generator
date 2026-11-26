import fs from 'node:fs';
import { IShapeGroupChildOptions, ShapeGroupRun } from 'docx/shapes';

import { FigureCrop } from '../types';
import { parseSvgDocument } from './parser';
import {
	extractPathMarkerAnchors,
	groupSubpathsForCustomShapes,
	parseAndTransformPath,
	serializePathCommands,
} from './path';
import {
	boundsOfCommands,
	ellipsePath,
	lineShapeFromPoints,
	resolveLineMarkers,
	roundedRectPath,
	toShapeFill,
	toShapeLine,
} from './shape-helpers';
import { compileTextElement } from './text';
import {
	applyMatrix,
	decomposeOrthogonalMatrix,
	multiplyMatrices,
} from './transform';
import {
	Matrix2D,
	Point2D,
	RectBounds,
	SvgIrElement,
	SvgMarkerDefinition,
} from './types';

const PIXELS_PER_MM = 96 / 25.4;

export interface CompileSvgOptions {
	sourcePath?: string;
	svgXml?: string;
	figureId: string;
	widthMm: number;
	heightMm: number;
	crop?: FigureCrop;
	title?: string;
	description?: string;
}

function compileIrElement(
	el: SvgIrElement,
	viewportMatrix: Matrix2D,
	markers: Map<string, SvgMarkerDefinition>,
	targetW: number,
	targetH: number,
): IShapeGroupChildOptions[] {
	if (el.kind === 'text') {
		return [compileTextElement(el, viewportMatrix, targetW, targetH)];
	}

	const fullMatrix = multiplyMatrices(viewportMatrix, el.matrix);
	const ortho = decomposeOrthogonalMatrix(fullMatrix);
	const avgScale = ortho
		? (ortho.scaleX + ortho.scaleY) / 2
		: (Math.hypot(fullMatrix[0], fullMatrix[1]) +
				Math.hypot(fullMatrix[2], fullMatrix[3])) /
			2;

	if (el.kind === 'line') {
		const p1 = applyMatrix(fullMatrix, { x: el.x1, y: el.y1 });
		const p2 = applyMatrix(fullMatrix, { x: el.x2, y: el.y2 });
		const ang = (Math.atan2(p2.y - p1.y, p2.x - p1.x) * 180) / Math.PI;
		const markerResolution = resolveLineMarkers(
			el.style,
			markers,
			{
				start: { point: { x: el.x1, y: el.y1 }, angleDeg: ang },
				mids: [],
				end: { point: { x: el.x2, y: el.y2 }, angleDeg: ang },
			},
			true,
		);
		const line = toShapeLine(el.style, avgScale, markerResolution);
		return [
			lineShapeFromPoints(p1, p2, line),
			...markerResolution.extraShapes.flatMap(extra =>
				compileIrElement(
					extra,
					viewportMatrix,
					markers,
					targetW,
					targetH,
				),
			),
		];
	}

	if (el.kind === 'rect') {
		const uniformRadius = Math.abs(el.rx - el.ry) <= 0.01;
		if (ortho && !ortho.flipX && uniformRadius) {
			const w = el.width * ortho.scaleX;
			const h = el.height * ortho.scaleY;
			const center = applyMatrix(fullMatrix, {
				x: el.x + el.width / 2,
				y: el.y + el.height / 2,
			});
			const offset = { left: center.x - w / 2, top: center.y - h / 2 };
			const fill = toShapeFill(el.style);
			const line = toShapeLine(el.style, avgScale);
			const rotOpt =
				Math.abs(ortho.rotationDeg) > 0.01
					? { rotation: ortho.rotationDeg }
					: {};
			if (el.rx > 0) {
				const minSide = Math.min(w, h);
				const radiusPct = Math.min(
					50,
					((el.rx * ortho.scaleX) / Math.max(minSide, 0.001)) * 100,
				);
				return [
					{
						type: 'roundedRectangle',
						adjustments: { cornerRadius: radiusPct },
						transformation: {
							offset,
							width: w,
							height: h,
							...rotOpt,
						},
						fill,
						line,
					},
				];
			}
			return [
				{
					type: 'rectangle',
					transformation: { offset, width: w, height: h, ...rotOpt },
					fill,
					line,
				},
			];
		}
		const pathData =
			el.rx > 0 || el.ry > 0
				? roundedRectPath(el.x, el.y, el.width, el.height, el.rx, el.ry)
				: `M ${el.x} ${el.y} L ${el.x + el.width} ${el.y} L ${el.x + el.width} ${el.y + el.height} L ${el.x} ${el.y + el.height} Z`;
		return compileIrElement(
			{ kind: 'path', d: pathData, matrix: el.matrix, style: el.style },
			viewportMatrix,
			markers,
			targetW,
			targetH,
		);
	}

	if (el.kind === 'ellipse') {
		if (ortho && !ortho.flipX) {
			const center = applyMatrix(fullMatrix, { x: el.cx, y: el.cy });
			const w = el.rx * 2 * ortho.scaleX;
			const h = el.ry * 2 * ortho.scaleY;
			return [
				{
					type: 'ellipse',
					transformation: {
						offset: {
							left: center.x - w / 2,
							top: center.y - h / 2,
						},
						width: w,
						height: h,
						...(Math.abs(ortho.rotationDeg) > 0.01
							? { rotation: ortho.rotationDeg }
							: {}),
					},
					fill: toShapeFill(el.style),
					line: toShapeLine(el.style, avgScale),
				},
			];
		}
		return compileIrElement(
			{
				kind: 'path',
				d: ellipsePath(el.cx, el.cy, el.rx, el.ry),
				matrix: el.matrix,
				style: el.style,
			},
			viewportMatrix,
			markers,
			targetW,
			targetH,
		);
	}

	const svgCommands = parseAndTransformPath(el.d, el.matrix);
	const endpoints = extractPathMarkerAnchors(svgCommands);
	const transformed = parseAndTransformPath(el.d, fullMatrix);
	const contours = groupSubpathsForCustomShapes(
		transformed,
		el.style.fillRule,
	);
	const fill = toShapeFill(el.style);
	const results: IShapeGroupChildOptions[] = [];

	const markerInfo = resolveLineMarkers(
		el.style,
		markers,
		endpoints,
		contours.length === 1,
	);
	const line = toShapeLine(
		el.style,
		avgScale,
		contours.length === 1 ? markerInfo : undefined,
	);

	for (const contour of contours) {
		const isSingleLine =
			contour.length === 2 &&
			contour[0].type === 'M' &&
			contour[1].type === 'L' &&
			fill === 'none';
		if (isSingleLine) {
			const m = contour[0] as { type: 'M'; x: number; y: number };
			const l = contour[1] as { type: 'L'; x: number; y: number };
			results.push(
				lineShapeFromPoints(
					{ x: m.x, y: m.y },
					{ x: l.x, y: l.y },
					line,
				),
			);
			continue;
		}
		const box = boundsOfCommands(contour);
		const bw = box.right - box.left;
		const bh = box.bottom - box.top;
		if (bw <= 0 || bh <= 0) {
			let prev: Point2D | null = null;
			for (const cmd of contour) {
				if (cmd.type === 'M') {
					prev = { x: cmd.x, y: cmd.y };
				} else if (cmd.type === 'L' && prev) {
					results.push(
						lineShapeFromPoints(prev, { x: cmd.x, y: cmd.y }, line),
					);
					prev = { x: cmd.x, y: cmd.y };
				}
			}
			continue;
		}
		results.push({
			type: 'custom',
			path: serializePathCommands(contour),
			transformation: {
				offset: { left: box.left, top: box.top },
				width: bw,
				height: bh,
			},
			fill,
			line,
		});
	}

	for (const extra of markerInfo.extraShapes) {
		results.push(
			...compileIrElement(
				extra,
				viewportMatrix,
				markers,
				targetW,
				targetH,
			),
		);
	}
	return results;
}

/** Parse SVG and extract structural dimensions and transformed font sizes for planning checks. */
export function inspectSvgForShapes(
	svgXml: string,
	crop?: FigureCrop,
): { viewBox: RectBounds; fontSizesPx: number[] } {
	const parsed = parseSvgDocument(svgXml, crop);
	return { viewBox: parsed.viewBox, fontSizesPx: parsed.fontSizesPx };
}

/** Compile an SVG diagram into an editable native Word `ShapeGroupRun` (`wpg:wgp` + `wps:txbx`). */
export function compileSvgToShapeGroup(
	options: CompileSvgOptions,
): ShapeGroupRun {
	const svgXml =
		options.svgXml ??
		(options.sourcePath ? fs.readFileSync(options.sourcePath, 'utf8') : '');
	const parsed = parseSvgDocument(svgXml, options.crop);
	const targetW = options.widthMm * PIXELS_PER_MM;
	const targetH = options.heightMm * PIXELS_PER_MM;
	const vbW = parsed.viewBox.right - parsed.viewBox.left;
	const vbH = parsed.viewBox.bottom - parsed.viewBox.top;
	const sx = targetW / vbW;
	const sy = targetH / vbH;
	const viewportMatrix: Matrix2D = [
		sx,
		0,
		0,
		sy,
		-parsed.viewBox.left * sx,
		-parsed.viewBox.top * sy,
	];

	const children: IShapeGroupChildOptions[] = [
		{
			type: 'rectangle',
			transformation: {
				offset: { left: 0, top: 0 },
				width: targetW,
				height: targetH,
			},
			fill: 'none',
			line: 'none',
		},
		...parsed.elements.flatMap(el =>
			compileIrElement(
				el,
				viewportMatrix,
				parsed.markers,
				targetW,
				targetH,
			),
		),
	];

	return new ShapeGroupRun({
		altText: {
			name: `sto-figure:${options.figureId}`,
			title: options.title ?? '',
			description: options.description || options.figureId,
		},
		transformation: { width: targetW, height: targetH },
		children,
	});
}
