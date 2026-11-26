import { Point2D, SvgAbsolutePathCommand } from './types';

function pointOnEllipseArc(
	cx: number,
	cy: number,
	rx: number,
	ry: number,
	phi: number,
	theta: number,
): Point2D {
	const cosPhi = Math.cos(phi);
	const sinPhi = Math.sin(phi);
	const cosTheta = Math.cos(theta);
	const sinTheta = Math.sin(theta);
	return {
		x: cx + cosPhi * rx * cosTheta - sinPhi * ry * sinTheta,
		y: cy + sinPhi * rx * cosTheta + cosPhi * ry * sinTheta,
	};
}

function vectorAngle(ux: number, uy: number, vx: number, vy: number): number {
	const dot = ux * vx + uy * vy;
	const len = Math.hypot(ux, uy) * Math.hypot(vx, vy);
	if (len === 0) return 0;
	const clamped = Math.max(-1, Math.min(1, dot / len));
	const angle = Math.acos(clamped);
	return ux * vy - uy * vx < 0 ? -angle : angle;
}

/** Convert an SVG elliptical arc segment into exact quarter-turn cubic Bezier curves. */
export function arcToCubicCommands(
	from: Point2D,
	to: Point2D,
	rxInput: number,
	ryInput: number,
	rotationDeg: number,
	largeArcFlag: number,
	sweepFlag: number,
): SvgAbsolutePathCommand[] {
	if (rxInput === 0 || ryInput === 0) {
		return [{ type: 'L', x: to.x, y: to.y }];
	}
	if (from.x === to.x && from.y === to.y) return [];
	let rx = Math.abs(rxInput);
	let ry = Math.abs(ryInput);
	const phi = (rotationDeg * Math.PI) / 180;
	const cosPhi = Math.cos(phi);
	const sinPhi = Math.sin(phi);
	const dx2 = (from.x - to.x) / 2;
	const dy2 = (from.y - to.y) / 2;
	const x1p = cosPhi * dx2 + sinPhi * dy2;
	const y1p = -sinPhi * dx2 + cosPhi * dy2;
	const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
	if (lambda > 1) {
		const scale = Math.sqrt(lambda);
		rx *= scale;
		ry *= scale;
	}
	const rx2 = rx * rx;
	const ry2 = ry * ry;
	const x1p2 = x1p * x1p;
	const y1p2 = y1p * y1p;
	const num = Math.max(0, rx2 * ry2 - rx2 * y1p2 - ry2 * x1p2);
	const den = rx2 * y1p2 + ry2 * x1p2;
	const sign = largeArcFlag === sweepFlag ? -1 : 1;
	const factor = den === 0 ? 0 : sign * Math.sqrt(num / den);
	const cxp = factor * ((rx * y1p) / ry);
	const cyp = factor * (-(ry * x1p) / rx);
	const cx = cosPhi * cxp - sinPhi * cyp + (from.x + to.x) / 2;
	const cy = sinPhi * cxp + cosPhi * cyp + (from.y + to.y) / 2;
	const ux = (x1p - cxp) / rx;
	const uy = (y1p - cyp) / ry;
	const vx = (-x1p - cxp) / rx;
	const vy = (-y1p - cyp) / ry;
	const startAngle = vectorAngle(1, 0, ux, uy);
	let deltaAngle = vectorAngle(ux, uy, vx, vy);
	if (!sweepFlag && deltaAngle > 0) deltaAngle -= 2 * Math.PI;
	if (sweepFlag && deltaAngle < 0) deltaAngle += 2 * Math.PI;
	const segments = Math.max(
		1,
		Math.ceil(Math.abs(deltaAngle) / (Math.PI / 2)),
	);
	const step = deltaAngle / segments;
	const handle = (4 / 3) * Math.tan(step / 4);
	const result: SvgAbsolutePathCommand[] = [];
	const derivative = (theta: number): Point2D => ({
		x: -cosPhi * rx * Math.sin(theta) - sinPhi * ry * Math.cos(theta),
		y: -sinPhi * rx * Math.sin(theta) + cosPhi * ry * Math.cos(theta),
	});
	for (let i = 0; i < segments; i++) {
		const t1 = startAngle + i * step;
		const t2 = t1 + step;
		const p1 = pointOnEllipseArc(cx, cy, rx, ry, phi, t1);
		const p2 =
			i === segments - 1
				? to
				: pointOnEllipseArc(cx, cy, rx, ry, phi, t2);
		const d1 = derivative(t1);
		const d2 = derivative(t2);
		result.push({
			type: 'C',
			x1: p1.x + handle * d1.x,
			y1: p1.y + handle * d1.y,
			x2: p2.x - handle * d2.x,
			y2: p2.y - handle * d2.y,
			x: p2.x,
			y: p2.y,
		});
	}
	return result;
}
