import { arcToCubicCommands } from './path-arc';
import { applyMatrix } from './transform';
import { Matrix2D, Point2D, SvgAbsolutePathCommand } from './types';

export {
	extractPathMarkerAnchors,
	groupSubpathsForCustomShapes,
	serializePathCommands,
} from './path-subpaths';

const NUMBER_RE = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/u;
const ARGUMENT_COUNT: Readonly<Record<string, number>> = {
	m: 2,
	l: 2,
	h: 1,
	v: 1,
	c: 6,
	s: 4,
	q: 4,
	t: 2,
	a: 7,
	z: 0,
};

/** Parse SVG path data into normalized absolute `M/L/C/Q/Z` commands, transformed by `matrix`. */
export function parseAndTransformPath(
	d: string,
	matrix: Matrix2D,
): SvgAbsolutePathCommand[] {
	const rawCommands: SvgAbsolutePathCommand[] = [];
	let index = 0;
	let commandChar = '';
	let current: Point2D = { x: 0, y: 0 };
	let start: Point2D = { x: 0, y: 0 };
	let lastControl: Point2D | null = null;
	let lastCmd = '';

	const skip = (): void => {
		while (index < d.length && /[\s,]/u.test(d[index])) index++;
	};
	const readNumber = (): number => {
		skip();
		const match = NUMBER_RE.exec(d.slice(index));
		if (!match) {
			throw new Error(`Invalid SVG path data "${d}" near ${index}.`);
		}
		index += match[0].length;
		return Number(match[0]);
	};
	const readFlag = (): number => {
		skip();
		const ch = d[index];
		if (ch !== '0' && ch !== '1') {
			throw new Error(`Invalid SVG arc flag "${d}" near ${index}.`);
		}
		index++;
		return Number(ch);
	};

	skip();
	while (index < d.length) {
		const ch = d[index];
		if (/[a-zA-Z]/u.test(ch)) {
			if (ARGUMENT_COUNT[ch.toLowerCase()] === undefined) {
				throw new Error(`Unsupported SVG path command "${ch}".`);
			}
			commandChar = ch;
			index++;
			skip();
			if (commandChar.toLowerCase() === 'z') {
				rawCommands.push({ type: 'Z' });
				current = start;
				lastControl = null;
				lastCmd = 'z';
				skip();
				continue;
			}
		} else if (!commandChar) {
			throw new Error(`SVG path data must start with a command: "${d}".`);
		}

		const rel = commandChar === commandChar.toLowerCase();
		const lower = commandChar.toLowerCase();
		const relPt = (x: number, y: number): Point2D =>
			rel ? { x: current.x + x, y: current.y + y } : { x, y };

		if (lower === 'm') {
			const pt = relPt(readNumber(), readNumber());
			rawCommands.push({ type: 'M', x: pt.x, y: pt.y });
			current = pt;
			start = pt;
			lastControl = null;
			lastCmd = 'm';
			commandChar = rel ? 'l' : 'L';
		} else if (lower === 'l') {
			const pt = relPt(readNumber(), readNumber());
			rawCommands.push({ type: 'L', x: pt.x, y: pt.y });
			current = pt;
			lastControl = null;
			lastCmd = 'l';
		} else if (lower === 'h') {
			const x = readNumber() + (rel ? current.x : 0);
			current = { x, y: current.y };
			rawCommands.push({ type: 'L', x: current.x, y: current.y });
			lastControl = null;
			lastCmd = 'h';
		} else if (lower === 'v') {
			const y = readNumber() + (rel ? current.y : 0);
			current = { x: current.x, y };
			rawCommands.push({ type: 'L', x: current.x, y: current.y });
			lastControl = null;
			lastCmd = 'v';
		} else if (lower === 'c') {
			const c1 = relPt(readNumber(), readNumber());
			const c2 = relPt(readNumber(), readNumber());
			const to = relPt(readNumber(), readNumber());
			rawCommands.push({
				type: 'C',
				x1: c1.x,
				y1: c1.y,
				x2: c2.x,
				y2: c2.y,
				x: to.x,
				y: to.y,
			});
			current = to;
			lastControl = c2;
			lastCmd = 'c';
		} else if (lower === 's') {
			const c1: Point2D =
				lastCmd === 'c' || lastCmd === 's'
					? {
							x: 2 * current.x - (lastControl?.x ?? current.x),
							y: 2 * current.y - (lastControl?.y ?? current.y),
						}
					: current;
			const c2 = relPt(readNumber(), readNumber());
			const to = relPt(readNumber(), readNumber());
			rawCommands.push({
				type: 'C',
				x1: c1.x,
				y1: c1.y,
				x2: c2.x,
				y2: c2.y,
				x: to.x,
				y: to.y,
			});
			current = to;
			lastControl = c2;
			lastCmd = 's';
		} else if (lower === 'q') {
			const c1 = relPt(readNumber(), readNumber());
			const to = relPt(readNumber(), readNumber());
			rawCommands.push({
				type: 'Q',
				x1: c1.x,
				y1: c1.y,
				x: to.x,
				y: to.y,
			});
			current = to;
			lastControl = c1;
			lastCmd = 'q';
		} else if (lower === 't') {
			const c1: Point2D =
				lastCmd === 'q' || lastCmd === 't'
					? {
							x: 2 * current.x - (lastControl?.x ?? current.x),
							y: 2 * current.y - (lastControl?.y ?? current.y),
						}
					: current;
			const to = relPt(readNumber(), readNumber());
			rawCommands.push({
				type: 'Q',
				x1: c1.x,
				y1: c1.y,
				x: to.x,
				y: to.y,
			});
			current = to;
			lastControl = c1;
			lastCmd = 't';
		} else if (lower === 'a') {
			const rx = readNumber();
			const ry = readNumber();
			const rot = readNumber();
			const large = readFlag();
			const sweep = readFlag();
			const to = relPt(readNumber(), readNumber());
			rawCommands.push(
				...arcToCubicCommands(current, to, rx, ry, rot, large, sweep),
			);
			current = to;
			lastControl = null;
			lastCmd = 'a';
		}
		skip();
	}

	return rawCommands.map(cmd => {
		if (cmd.type === 'Z') return cmd;
		if (cmd.type === 'C') {
			const p1 = applyMatrix(matrix, { x: cmd.x1, y: cmd.y1 });
			const p2 = applyMatrix(matrix, { x: cmd.x2, y: cmd.y2 });
			const end = applyMatrix(matrix, { x: cmd.x, y: cmd.y });
			return {
				type: 'C',
				x1: p1.x,
				y1: p1.y,
				x2: p2.x,
				y2: p2.y,
				x: end.x,
				y: end.y,
			};
		}
		if (cmd.type === 'Q') {
			const p1 = applyMatrix(matrix, { x: cmd.x1, y: cmd.y1 });
			const end = applyMatrix(matrix, { x: cmd.x, y: cmd.y });
			return { type: 'Q', x1: p1.x, y1: p1.y, x: end.x, y: end.y };
		}
		const pt = applyMatrix(matrix, { x: cmd.x, y: cmd.y });
		return { type: cmd.type, x: pt.x, y: pt.y };
	});
}
