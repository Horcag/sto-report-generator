import { Matrix2D, Point2D, RectBounds } from './types';

export const IDENTITY_MATRIX: Matrix2D = [1, 0, 0, 1, 0, 0];

export function multiplyMatrices(left: Matrix2D, right: Matrix2D): Matrix2D {
	return [
		left[0] * right[0] + left[2] * right[1],
		left[1] * right[0] + left[3] * right[1],
		left[0] * right[2] + left[2] * right[3],
		left[1] * right[2] + left[3] * right[3],
		left[0] * right[4] + left[2] * right[5] + left[4],
		left[1] * right[4] + left[3] * right[5] + left[5],
	];
}

export function applyMatrix(matrix: Matrix2D, point: Point2D): Point2D {
	return {
		x: matrix[0] * point.x + matrix[2] * point.y + matrix[4],
		y: matrix[1] * point.x + matrix[3] * point.y + matrix[5],
	};
}

export function translationMatrix(tx: number, ty: number): Matrix2D {
	return [1, 0, 0, 1, tx, ty];
}

export function scaleMatrix(sx: number, sy: number): Matrix2D {
	return [sx, 0, 0, sy, 0, 0];
}

export function rotationMatrix(angleDeg: number, cx = 0, cy = 0): Matrix2D {
	const radians = (angleDeg * Math.PI) / 180;
	const cos = Math.cos(radians);
	const sin = Math.sin(radians);
	const base: Matrix2D = [cos, sin, -sin, cos, 0, 0];
	if (cx === 0 && cy === 0) return base;
	return multiplyMatrices(
		multiplyMatrices(translationMatrix(cx, cy), base),
		translationMatrix(-cx, -cy),
	);
}

/** Parse an SVG transform attribute (`matrix`, `translate`, `scale`, `rotate`, `skewX`, `skewY`) into a composite 2D affine matrix. */
export function parseSvgTransform(raw: string | null | undefined): Matrix2D {
	if (!raw || !raw.trim()) return IDENTITY_MATRIX;
	let current = IDENTITY_MATRIX;
	const commandPattern = /([a-zA-Z]+)\s*\(([^)]*)\)/gu;
	let matchedLength = 0;
	for (const match of raw.matchAll(commandPattern)) {
		const name = match[1].toLowerCase();
		const args = match[2]
			.trim()
			.split(/[\s,]+/u)
			.filter(Boolean)
			.map(Number);
		if (args.some(value => !Number.isFinite(value))) {
			throw new Error(
				`Invalid numeric argument in SVG transform: ${raw}`,
			);
		}
		matchedLength += match[0].length;
		let step: Matrix2D;
		switch (name) {
			case 'matrix':
				if (args.length !== 6) {
					throw new Error(`Invalid SVG matrix() transform: ${raw}`);
				}
				step = [args[0], args[1], args[2], args[3], args[4], args[5]];
				break;
			case 'translate':
				if (args.length < 1 || args.length > 2) {
					throw new Error(
						`Invalid SVG translate() transform: ${raw}`,
					);
				}
				step = translationMatrix(args[0], args[1] ?? 0);
				break;
			case 'scale':
				if (args.length < 1 || args.length > 2) {
					throw new Error(`Invalid SVG scale() transform: ${raw}`);
				}
				step = scaleMatrix(args[0], args[1] ?? args[0]);
				break;
			case 'rotate':
				if (args.length !== 1 && args.length !== 3) {
					throw new Error(`Invalid SVG rotate() transform: ${raw}`);
				}
				step = rotationMatrix(args[0], args[1] ?? 0, args[2] ?? 0);
				break;
			case 'skewx':
				if (args.length !== 1) {
					throw new Error(`Invalid SVG skewX() transform: ${raw}`);
				}
				step = [1, 0, Math.tan((args[0] * Math.PI) / 180), 1, 0, 0];
				break;
			case 'skewy':
				if (args.length !== 1) {
					throw new Error(`Invalid SVG skewY() transform: ${raw}`);
				}
				step = [1, Math.tan((args[0] * Math.PI) / 180), 0, 1, 0, 0];
				break;
			default:
				throw new Error(
					`Unsupported SVG transform "${match[1]}" in "${raw}".`,
				);
		}
		current = multiplyMatrices(current, step);
	}
	if (matchedLength === 0 && raw.trim().length > 0) {
		throw new Error(`Invalid SVG transform attribute: ${raw}`);
	}
	return current;
}

export interface RigidDecomposition {
	rotationDeg: number;
	scaleX: number;
	scaleY: number;
	flipX: boolean;
	flipY: boolean;
}

/**
 * Decompose an affine matrix if it represents rotation + axis scaling without shear
 * (returns null if skewed so shapes fall back cleanly to baked Bezier custom paths).
 */
export function decomposeOrthogonalMatrix(
	matrix: Matrix2D,
): RigidDecomposition | null {
	const [a, b, c, d] = matrix;
	const dot = a * c + b * d;
	const normX = Math.hypot(a, b);
	const normY = Math.hypot(c, d);
	if (normX < 1e-9 || normY < 1e-9) return null;
	if (Math.abs(dot) / (normX * normY) > 1e-4) return null;
	const det = a * d - b * c;
	const flipX = det < 0;
	const effectiveA = flipX ? -a : a;
	const effectiveB = flipX ? -b : b;
	const angle = (Math.atan2(effectiveB, effectiveA) * 180) / Math.PI;
	const normalizedDeg = ((angle % 360) + 360) % 360;
	return {
		rotationDeg: normalizedDeg,
		scaleX: normX,
		scaleY: normY,
		flipX,
		flipY: false,
	};
}

/** Transform axis-aligned rectangle corners into an axis-aligned bounding box. */
export function transformBounds(
	bounds: RectBounds,
	matrix: Matrix2D,
): RectBounds {
	const corners = [
		applyMatrix(matrix, { x: bounds.left, y: bounds.top }),
		applyMatrix(matrix, { x: bounds.right, y: bounds.top }),
		applyMatrix(matrix, { x: bounds.right, y: bounds.bottom }),
		applyMatrix(matrix, { x: bounds.left, y: bounds.bottom }),
	];
	return {
		left: Math.min(...corners.map(point => point.x)),
		top: Math.min(...corners.map(point => point.y)),
		right: Math.max(...corners.map(point => point.x)),
		bottom: Math.max(...corners.map(point => point.y)),
	};
}
