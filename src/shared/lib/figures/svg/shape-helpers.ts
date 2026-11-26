import {
	Arrowhead,
	IShapeGroupChildOptions,
	ShapeFill,
	ShapeLine,
} from 'docx/shapes';

import { parseSvgPaint, resolvePaintOpacity } from './color';
import { expandCustomMarker, resolveNativeArrowhead } from './markers';
import { resolveStrokeDash } from './style';
import {
	Point2D,
	RectBounds,
	SvgAbsolutePathCommand,
	SvgComputedStyle,
	SvgIrElement,
	SvgMarkerDefinition,
	SvgPathEndpoint,
} from './types';

export function toShapeFill(style: SvgComputedStyle): ShapeFill {
	const paint = resolvePaintOpacity(
		parseSvgPaint(style.fillRaw, style.colorHex),
		style.opacity * style.fillOpacity,
	);
	if (!paint) return 'none';
	return paint.transparency !== undefined
		? { color: paint.hex, transparency: paint.transparency }
		: paint.hex;
}

export function toShapeLine(
	style: SvgComputedStyle,
	scaleAvg: number,
	arrows?: { startArrow?: Arrowhead; endArrow?: Arrowhead },
): ShapeLine {
	if (style.strokeWidth <= 0) return 'none';
	const paint = resolvePaintOpacity(
		parseSvgPaint(style.strokeRaw, style.colorHex),
		style.opacity * style.strokeOpacity,
	);
	if (!paint) return 'none';
	const widthPt = Math.max(0.25, style.strokeWidth * scaleAvg * 0.75);
	const dash = resolveStrokeDash(style.strokeDasharray, style.strokeWidth);
	return {
		color: paint.hex,
		width: widthPt,
		...(paint.transparency !== undefined
			? { transparency: paint.transparency }
			: {}),
		...(dash ? { dash } : {}),
		cap: style.strokeLinecap,
		join: style.strokeLinejoin,
		...(arrows?.startArrow ? { startArrow: arrows.startArrow } : {}),
		...(arrows?.endArrow ? { endArrow: arrows.endArrow } : {}),
	};
}

export function roundedRectPath(
	x: number,
	y: number,
	w: number,
	h: number,
	rx: number,
	ry: number,
): string {
	const rX = Math.min(rx, w / 2);
	const rY = Math.min(ry, h / 2);
	return [
		`M ${x + rX} ${y}`,
		`L ${x + w - rX} ${y}`,
		`A ${rX} ${rY} 0 0 1 ${x + w} ${y + rY}`,
		`L ${x + w} ${y + h - rY}`,
		`A ${rX} ${rY} 0 0 1 ${x + w - rX} ${y + h}`,
		`L ${x + rX} ${y + h}`,
		`A ${rX} ${rY} 0 0 1 ${x} ${y + h - rY}`,
		`L ${x} ${y + rY}`,
		`A ${rX} ${rY} 0 0 1 ${x + rX} ${y}`,
		'Z',
	].join(' ');
}

export function ellipsePath(
	cx: number,
	cy: number,
	rx: number,
	ry: number,
): string {
	return [
		`M ${cx - rx} ${cy}`,
		`A ${rx} ${ry} 0 1 0 ${cx + rx} ${cy}`,
		`A ${rx} ${ry} 0 1 0 ${cx - rx} ${cy}`,
		'Z',
	].join(' ');
}

export function boundsOfCommands(
	commands: readonly SvgAbsolutePathCommand[],
): RectBounds {
	const points: Point2D[] = [];
	for (const cmd of commands) {
		if (cmd.type === 'Z') continue;
		points.push({ x: cmd.x, y: cmd.y });
		if (cmd.type === 'C') {
			points.push({ x: cmd.x1, y: cmd.y1 }, { x: cmd.x2, y: cmd.y2 });
		} else if (cmd.type === 'Q') {
			points.push({ x: cmd.x1, y: cmd.y1 });
		}
	}
	return {
		left: Math.min(...points.map(p => p.x)),
		top: Math.min(...points.map(p => p.y)),
		right: Math.max(...points.map(p => p.x)),
		bottom: Math.max(...points.map(p => p.y)),
	};
}

export function lineShapeFromPoints(
	p1: Point2D,
	p2: Point2D,
	line: ShapeLine,
): IShapeGroupChildOptions {
	const left = Math.min(p1.x, p2.x);
	const top = Math.min(p1.y, p2.y);
	const width = Math.abs(p2.x - p1.x);
	const height = Math.abs(p2.y - p1.y);
	const flip = {
		...(p2.x < p1.x ? { horizontal: true } : {}),
		...(p2.y < p1.y ? { vertical: true } : {}),
	};
	return {
		type: 'line',
		transformation: {
			offset: { left, top },
			width,
			height,
			...(Object.keys(flip).length ? { flip } : {}),
		},
		line,
	};
}

export function resolveLineMarkers(
	elementStyle: SvgComputedStyle,
	markers: Map<string, SvgMarkerDefinition>,
	endpoints: {
		start?: SvgPathEndpoint;
		mids: SvgPathEndpoint[];
		end?: SvgPathEndpoint;
	},
	canUseNativeArrows: boolean,
): {
	startArrow?: Arrowhead;
	endArrow?: Arrowhead;
	extraShapes: SvgIrElement[];
} {
	const extraShapes: SvgIrElement[] = [];
	let startArrow: Arrowhead | undefined;
	let endArrow: Arrowhead | undefined;

	if (elementStyle.markerStart && endpoints.start) {
		const def = markers.get(elementStyle.markerStart);
		if (def) {
			const native = canUseNativeArrows
				? resolveNativeArrowhead(def, elementStyle.strokeWidth)
				: undefined;
			if (native) startArrow = native;
			else {
				extraShapes.push(
					...expandCustomMarker(
						def,
						endpoints.start,
						true,
						elementStyle.strokeWidth,
						elementStyle,
					),
				);
			}
		}
	}
	if (elementStyle.markerEnd && endpoints.end) {
		const def = markers.get(elementStyle.markerEnd);
		if (def) {
			const native = canUseNativeArrows
				? resolveNativeArrowhead(def, elementStyle.strokeWidth)
				: undefined;
			if (native) endArrow = native;
			else {
				extraShapes.push(
					...expandCustomMarker(
						def,
						endpoints.end,
						false,
						elementStyle.strokeWidth,
						elementStyle,
					),
				);
			}
		}
	}
	if (elementStyle.markerMid) {
		const def = markers.get(elementStyle.markerMid);
		if (def) {
			for (const mid of endpoints.mids) {
				extraShapes.push(
					...expandCustomMarker(
						def,
						mid,
						false,
						elementStyle.strokeWidth,
						elementStyle,
					),
				);
			}
		}
	}
	return { startArrow, endArrow, extraShapes };
}
