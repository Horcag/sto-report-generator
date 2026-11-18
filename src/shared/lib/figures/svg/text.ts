import { AlignmentType, Paragraph, TextRun } from 'docx';
import { IShapeGroupChildOptions, ShapeTextDirection } from 'docx/shapes';

import {
	applyMatrix,
	decomposeOrthogonalMatrix,
	multiplyMatrices,
} from './transform';
import { Matrix2D, Point2D, SvgTextGroup } from './types';

function resolveVerticalShift(
	dominantBaseline: string,
	fontPx: number,
): number {
	switch (dominantBaseline) {
		case 'middle':
		case 'central':
			return 0;
		case 'hanging':
		case 'text-before-edge':
			return fontPx * 0.48;
		case 'text-after-edge':
		case 'ideographic':
			return -fontPx * 0.42;
		default:
			return -fontPx * 0.34;
	}
}

function clampSpanAround(
	center: number,
	desiredHalf: number,
	limit: number,
): { start: number; size: number } {
	const half = Math.max(2, Math.min(desiredHalf, center, limit - center));
	return {
		start: Math.max(0, center - half),
		size: Math.min(limit, half * 2),
	};
}

/** Compile an SVG `<text>` group into a Word DrawingML transparent textbox shape (`DiagramText`). */
export function compileTextElement(
	group: SvgTextGroup,
	viewportMatrix: Matrix2D,
	targetW: number,
	targetH: number,
): IShapeGroupChildOptions {
	const full = multiplyMatrices(viewportMatrix, group.matrix);
	const ortho = decomposeOrthogonalMatrix(full);
	if (!ortho) {
		throw new Error('Non-orthogonal <text> transform is not supported.');
	}
	const scale = (ortho.scaleX + ortho.scaleY) / 2;
	const anchorPoint = applyMatrix(full, { x: group.x, y: group.y });
	const maxFontPx = Math.max(
		...group.spans.map(span => span.fontSizePx * scale),
	);
	const boxHeight = Math.max(10, maxFontPx * 1.35);
	const verticalShift = resolveVerticalShift(
		group.dominantBaseline,
		maxFontPx,
	);
	const centerY = anchorPoint.y + verticalShift;
	const rotNorm = ((ortho.rotationDeg % 360) + 360) % 360;
	const isVerticalUp = Math.abs(rotNorm - 270) <= 0.1;
	const isVerticalDown = Math.abs(rotNorm - 90) <= 0.1;
	const rotated = Math.abs(rotNorm) > 0.01 && rotNorm < 359.99;

	let left: number;
	let width: number;
	let top: number;
	let height = boxHeight;
	let alignment: (typeof AlignmentType)[keyof typeof AlignmentType];
	let direction: ShapeTextDirection = 'horizontal';
	let shapeRotation: number | undefined;

	if (!rotated) {
		if (group.textAnchor === 'middle') {
			const span = clampSpanAround(anchorPoint.x, targetW, targetW);
			left = span.start;
			width = span.size;
			alignment = AlignmentType.CENTER;
		} else if (group.textAnchor === 'end') {
			width = Math.max(4, Math.min(targetW, anchorPoint.x));
			left = Math.max(0, anchorPoint.x - width);
			alignment = AlignmentType.RIGHT;
		} else {
			left = Math.max(0, Math.min(targetW - 4, anchorPoint.x));
			width = Math.max(4, targetW - left);
			alignment = AlignmentType.LEFT;
		}
		top = Math.max(
			0,
			Math.min(targetH - boxHeight, centerY - boxHeight / 2),
		);
	} else if (isVerticalUp || isVerticalDown) {
		const angleRad = (ortho.rotationDeg * Math.PI) / 180;
		const centerX = anchorPoint.x - Math.sin(angleRad) * verticalShift;
		direction = isVerticalUp ? 'bottomToTop' : 'topToBottom';
		width = boxHeight;
		left = Math.max(0, Math.min(targetW - width, centerX - width / 2));
		if (group.textAnchor === 'middle') {
			const span = clampSpanAround(anchorPoint.y, targetH, targetH);
			top = span.start;
			height = span.size;
			alignment = AlignmentType.CENTER;
		} else if (
			(isVerticalUp && group.textAnchor === 'start') ||
			(isVerticalDown && group.textAnchor === 'end')
		) {
			height = Math.max(4, Math.min(targetH, anchorPoint.y));
			top = Math.max(0, anchorPoint.y - height);
			alignment = isVerticalUp ? AlignmentType.LEFT : AlignmentType.RIGHT;
		} else {
			top = Math.max(0, Math.min(targetH - 4, anchorPoint.y));
			height = Math.max(4, targetH - top);
			alignment = isVerticalUp ? AlignmentType.RIGHT : AlignmentType.LEFT;
		}
	} else {
		const angleRad = (ortho.rotationDeg * Math.PI) / 180;
		const estTextW = Math.max(
			20,
			group.spans.reduce(
				(sum, span) =>
					sum + span.text.length * span.fontSizePx * scale * 0.6,
				0,
			),
		);
		const centerPt: Point2D =
			group.textAnchor === 'middle'
				? {
						x: anchorPoint.x - Math.sin(angleRad) * verticalShift,
						y: anchorPoint.y + Math.cos(angleRad) * verticalShift,
					}
				: {
						x:
							anchorPoint.x +
							Math.cos(angleRad) *
								(group.textAnchor === 'end'
									? -estTextW / 2
									: estTextW / 2),
						y:
							anchorPoint.y +
							Math.sin(angleRad) *
								(group.textAnchor === 'end'
									? -estTextW / 2
									: estTextW / 2),
					};
		const spanX = clampSpanAround(centerPt.x, estTextW / 2, targetW);
		left = spanX.start;
		width = spanX.size;
		top = Math.max(
			0,
			Math.min(targetH - boxHeight, centerPt.y - boxHeight / 2),
		);
		alignment =
			group.textAnchor === 'end'
				? AlignmentType.RIGHT
				: group.textAnchor === 'middle'
					? AlignmentType.CENTER
					: AlignmentType.LEFT;
		shapeRotation = ortho.rotationDeg;
	}

	const runs = group.spans.map(span => {
		const fontPt = Math.max(4, (span.fontSizePx * scale * 72) / 96);
		return new TextRun({
			text: span.text,
			font: span.fontFamily,
			size: Math.round(fontPt * 2),
			color: span.colorHex,
			bold: span.bold,
			italics: span.italic,
		});
	});

	return {
		type: 'rectangle',
		transformation: {
			offset: { left, top },
			width,
			height,
			...(shapeRotation !== undefined ? { rotation: shapeRotation } : {}),
		},
		fill: 'none',
		line: 'none',
		textOptions: {
			verticalAlignment: 'center',
			wrap: true,
			...(direction !== 'horizontal' ? { direction } : {}),
			margins: { top: 0, right: 0, bottom: 0, left: 0 },
		},
		children: [
			new Paragraph({
				style: 'DiagramText',
				alignment,
				indent: { left: 0, right: 0, firstLine: 0 },
				spacing: { before: 0, after: 0, line: 240, lineRule: 'auto' },
				children: runs,
			}),
		],
	};
}
