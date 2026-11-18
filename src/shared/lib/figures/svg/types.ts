import type {
	CustomLineDash,
	LineDash,
	ShapeLineCap,
	ShapeLineJoin,
} from 'docx/shapes';

export type Matrix2D = readonly [
	number,
	number,
	number,
	number,
	number,
	number,
];

export interface Point2D {
	x: number;
	y: number;
}

export interface RectBounds {
	left: number;
	top: number;
	right: number;
	bottom: number;
}

export interface SvgRgba {
	hex: string;
	alpha: number;
}

export interface SvgComputedStyle {
	fillRaw: string;
	fillOpacity: number;
	fillRule: 'nonzero' | 'evenodd';
	strokeRaw: string;
	strokeWidth: number;
	strokeOpacity: number;
	strokeDasharray: string;
	strokeLinecap: ShapeLineCap;
	strokeLinejoin: ShapeLineJoin;
	opacity: number;
	colorHex: string;
	fontFamily: string;
	fontSizePx: number;
	bold: boolean;
	italic: boolean;
	textAnchor: 'start' | 'middle' | 'end';
	dominantBaseline: string;
	markerStart?: string;
	markerEnd?: string;
	markerMid?: string;
	display: string;
	visibility: string;
}

export type SvgStrokeDash = LineDash | CustomLineDash;

export type SvgAbsolutePathCommand =
	| { type: 'M'; x: number; y: number }
	| { type: 'L'; x: number; y: number }
	| {
			type: 'C';
			x1: number;
			y1: number;
			x2: number;
			y2: number;
			x: number;
			y: number;
	  }
	| { type: 'Q'; x1: number; y1: number; x: number; y: number }
	| { type: 'Z' };

export interface SvgPathEndpoint {
	point: Point2D;
	angleDeg: number;
}

export interface SvgTextSpan {
	text: string;
	x: number;
	y: number;
	fontFamily: string;
	fontSizePx: number;
	bold: boolean;
	italic: boolean;
	colorHex: string;
	transparency: number;
	textAnchor: 'start' | 'middle' | 'end';
	dominantBaseline: string;
}

export interface SvgTextGroup {
	kind: 'text';
	spans: SvgTextSpan[];
	x: number;
	y: number;
	textAnchor: 'start' | 'middle' | 'end';
	dominantBaseline: string;
	matrix: Matrix2D;
}

export type SvgIrElement =
	| {
			kind: 'rect';
			x: number;
			y: number;
			width: number;
			height: number;
			rx: number;
			ry: number;
			matrix: Matrix2D;
			style: SvgComputedStyle;
	  }
	| {
			kind: 'ellipse';
			cx: number;
			cy: number;
			rx: number;
			ry: number;
			matrix: Matrix2D;
			style: SvgComputedStyle;
	  }
	| {
			kind: 'line';
			x1: number;
			y1: number;
			x2: number;
			y2: number;
			matrix: Matrix2D;
			style: SvgComputedStyle;
	  }
	| {
			kind: 'path';
			d: string;
			matrix: Matrix2D;
			style: SvgComputedStyle;
	  }
	| SvgTextGroup;

export interface SvgMarkerDefinition {
	id: string;
	refX: number;
	refY: number;
	markerWidth: number;
	markerHeight: number;
	orient: 'auto' | 'auto-start-reverse' | number;
	markerUnits: 'strokeWidth' | 'userSpaceOnUse';
	viewBox: RectBounds | null;
	elements: SvgIrElement[];
}

export interface SvgParsedDocument {
	viewBox: RectBounds;
	elements: SvgIrElement[];
	markers: Map<string, SvgMarkerDefinition>;
	fontSizesPx: number[];
}
