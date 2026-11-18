import {
	Point2D,
	RectBounds,
	SvgAbsolutePathCommand,
	SvgPathEndpoint,
} from './types';

interface SubpathPart {
	commands: SvgAbsolutePathCommand[];
	bounds: RectBounds;
	closed: boolean;
	area: number;
	vertices: Point2D[];
}

function measureSubpath(commands: SvgAbsolutePathCommand[]): SubpathPart {
	const points: Point2D[] = [];
	const vertices: Point2D[] = [];
	let closed = false;
	for (const cmd of commands) {
		if (cmd.type === 'Z') {
			closed = true;
			continue;
		}
		const end = { x: cmd.x, y: cmd.y };
		points.push(end);
		vertices.push(end);
		if (cmd.type === 'C') {
			points.push({ x: cmd.x1, y: cmd.y1 }, { x: cmd.x2, y: cmd.y2 });
		} else if (cmd.type === 'Q') {
			points.push({ x: cmd.x1, y: cmd.y1 });
		}
	}
	let area = 0;
	for (let i = 0; i < vertices.length; i++) {
		const a = vertices[i];
		const b = vertices[(i + 1) % vertices.length];
		area += a.x * b.y - b.x * a.y;
	}
	return {
		commands,
		closed,
		area: area / 2,
		vertices,
		bounds: {
			left: Math.min(...points.map(p => p.x)),
			top: Math.min(...points.map(p => p.y)),
			right: Math.max(...points.map(p => p.x)),
			bottom: Math.max(...points.map(p => p.y)),
		},
	};
}

function pointInsidePolygon(point: Point2D, poly: Point2D[]): boolean {
	let inside = false;
	for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
		const xi = poly[i].x;
		const yi = poly[i].y;
		const xj = poly[j].x;
		const yj = poly[j].y;
		if (
			yi > point.y !== yj > point.y &&
			point.x < ((xj - xi) * (point.y - yi)) / (yj - yi) + xi
		) {
			inside = !inside;
		}
	}
	return inside;
}

/** Group transformed path subpaths safely, preserving nonzero nested shapes as separate contours. */
export function groupSubpathsForCustomShapes(
	commands: readonly SvgAbsolutePathCommand[],
	fillRule: 'nonzero' | 'evenodd',
): SvgAbsolutePathCommand[][] {
	const parts: SvgAbsolutePathCommand[][] = [];
	for (const cmd of commands) {
		if (cmd.type === 'M') parts.push([cmd]);
		else if (parts.length > 0) parts[parts.length - 1].push(cmd);
	}
	if (parts.length <= 1) return parts;
	const measured = parts.map(measureSubpath);
	if (fillRule === 'evenodd') {
		return [commands as SvgAbsolutePathCommand[]];
	}
	const hasSameWindingNested = measured.some(
		(part, i) =>
			part.closed &&
			part.vertices.length > 0 &&
			measured.some(
				(other, j) =>
					i !== j &&
					other.closed &&
					part.area * other.area > 0 &&
					pointInsidePolygon(part.vertices[0], other.vertices),
			),
	);
	return hasSameWindingNested
		? parts
		: [commands as SvgAbsolutePathCommand[]];
}

export function serializePathCommands(
	commands: readonly SvgAbsolutePathCommand[],
): string {
	const fmt = (value: number) => Number(value.toFixed(4));
	return commands
		.map(cmd => {
			switch (cmd.type) {
				case 'M':
					return `M ${fmt(cmd.x)} ${fmt(cmd.y)}`;
				case 'L':
					return `L ${fmt(cmd.x)} ${fmt(cmd.y)}`;
				case 'C':
					return `C ${fmt(cmd.x1)} ${fmt(cmd.y1)} ${fmt(cmd.x2)} ${fmt(cmd.y2)} ${fmt(cmd.x)} ${fmt(cmd.y)}`;
				case 'Q':
					return `Q ${fmt(cmd.x1)} ${fmt(cmd.y1)} ${fmt(cmd.x)} ${fmt(cmd.y)}`;
				case 'Z':
					return 'Z';
			}
		})
		.join(' ');
}

/** Extract start, mid-vertex, and end points with forward tangent angles (degrees) for `<marker>` placement. */
export function extractPathMarkerAnchors(
	commands: readonly SvgAbsolutePathCommand[],
): { start?: SvgPathEndpoint; mids: SvgPathEndpoint[]; end?: SvgPathEndpoint } {
	const segments: {
		from: Point2D;
		to: Point2D;
		angleStart: number;
		angleEnd: number;
	}[] = [];
	let current: Point2D | null = null;
	let subStart: Point2D | null = null;
	const deg = (dx: number, dy: number) =>
		(Math.atan2(dy, dx) * 180) / Math.PI;

	for (const cmd of commands) {
		if (cmd.type === 'M') {
			current = { x: cmd.x, y: cmd.y };
			subStart = current;
			continue;
		}
		if (!current) continue;
		if (cmd.type === 'Z') {
			if (
				subStart &&
				(current.x !== subStart.x || current.y !== subStart.y)
			) {
				const ang = deg(subStart.x - current.x, subStart.y - current.y);
				segments.push({
					from: current,
					to: subStart,
					angleStart: ang,
					angleEnd: ang,
				});
			}
			current = subStart;
			continue;
		}
		const to = { x: cmd.x, y: cmd.y };
		if (cmd.type === 'L') {
			const ang = deg(to.x - current.x, to.y - current.y);
			segments.push({
				from: current,
				to,
				angleStart: ang,
				angleEnd: ang,
			});
		} else if (cmd.type === 'C') {
			const a1 =
				cmd.x1 !== current.x || cmd.y1 !== current.y
					? deg(cmd.x1 - current.x, cmd.y1 - current.y)
					: deg(to.x - current.x, to.y - current.y);
			const a2 =
				to.x !== cmd.x2 || to.y !== cmd.y2
					? deg(to.x - cmd.x2, to.y - cmd.y2)
					: deg(to.x - current.x, to.y - current.y);
			segments.push({ from: current, to, angleStart: a1, angleEnd: a2 });
		} else if (cmd.type === 'Q') {
			const a1 =
				cmd.x1 !== current.x || cmd.y1 !== current.y
					? deg(cmd.x1 - current.x, cmd.y1 - current.y)
					: deg(to.x - current.x, to.y - current.y);
			const a2 =
				to.x !== cmd.x1 || to.y !== cmd.y1
					? deg(to.x - cmd.x1, to.y - cmd.y1)
					: deg(to.x - current.x, to.y - current.y);
			segments.push({ from: current, to, angleStart: a1, angleEnd: a2 });
		}
		current = to;
	}
	if (segments.length === 0) return { mids: [] };
	const mids: SvgPathEndpoint[] = [];
	for (let i = 1; i < segments.length; i++) {
		mids.push({
			point: segments[i].from,
			angleDeg: (segments[i - 1].angleEnd + segments[i].angleStart) / 2,
		});
	}
	return {
		start: { point: segments[0].from, angleDeg: segments[0].angleStart },
		mids,
		end: {
			point: segments[segments.length - 1].to,
			angleDeg: segments[segments.length - 1].angleEnd,
		},
	};
}
