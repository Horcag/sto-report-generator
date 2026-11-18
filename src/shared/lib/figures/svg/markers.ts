import type { Arrowhead, ArrowheadSize, ArrowheadType } from 'docx/shapes';

import {
	multiplyMatrices,
	rotationMatrix,
	scaleMatrix,
	translationMatrix,
} from './transform';
import {
	Matrix2D,
	SvgComputedStyle,
	SvgIrElement,
	SvgMarkerDefinition,
	SvgPathEndpoint,
} from './types';

function arrowSizeFromStroke(
	marker: SvgMarkerDefinition,
	strokeWidthPx: number,
): ArrowheadSize {
	const span = Math.max(marker.markerWidth, marker.markerHeight);
	const pxSpan =
		marker.markerUnits === 'strokeWidth' ? span * strokeWidthPx : span;
	const ratio = pxSpan / Math.max(strokeWidthPx, 0.5);
	if (ratio <= 3.5) return 'small';
	if (ratio >= 8.5) return 'large';
	return 'medium';
}

/** Attempt to lower standard arrowhead markers into native editable Word DrawingML line endings. */
export function resolveNativeArrowhead(
	marker: SvgMarkerDefinition | undefined,
	strokeWidthPx: number,
): Arrowhead | undefined {
	if (!marker || marker.elements.length !== 1) return undefined;
	const single = marker.elements[0];
	let kind: ArrowheadType | undefined;
	if (single.kind === 'ellipse') {
		kind = 'oval';
	} else if (single.kind === 'path') {
		const fill = single.style.fillRaw.trim().toLowerCase();
		const cmds = single.d.trim().toUpperCase();
		if (fill === 'none') {
			if (/^[ML\s.,0-9+-]+$/u.test(cmds) && !cmds.includes('Z')) {
				kind = 'arrow';
			}
		} else if (cmds.includes('Z') && /^[MLZ\s.,0-9+-]+$/u.test(cmds)) {
			const coords = Array.from(
				cmds.matchAll(/[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/gu),
				m => Number(m[0]),
			);
			const pts: { x: number; y: number }[] = [];
			for (let i = 0; i + 1 < coords.length; i += 2) {
				pts.push({ x: coords[i], y: coords[i + 1] });
			}
			if (
				pts.length > 3 &&
				Math.hypot(
					pts[0].x - pts[pts.length - 1].x,
					pts[0].y - pts[pts.length - 1].y,
				) < 1e-4
			) {
				pts.pop();
			}
			if (pts.length === 3) {
				kind = 'triangle';
			} else if (pts.length === 4) {
				const crosses = pts.map((p0, i) => {
					const p1 = pts[(i + 1) % 4];
					const p2 = pts[(i + 2) % 4];
					return (
						(p1.x - p0.x) * (p2.y - p1.y) -
						(p1.y - p0.y) * (p2.x - p1.x)
					);
				});
				const isConvex =
					crosses.every(c => c > 0) || crosses.every(c => c < 0);
				kind = isConvex ? 'diamond' : 'stealth';
			}
		}
	}
	if (!kind) return undefined;
	return {
		type: kind,
		width: arrowSizeFromStroke(marker, strokeWidthPx),
		length: arrowSizeFromStroke(marker, strokeWidthPx),
	};
}

/** Expand non-standard or multi-shape SVG markers into explicit transformed child IR elements. */
export function expandCustomMarker(
	marker: SvgMarkerDefinition,
	endpoint: SvgPathEndpoint,
	isStart: boolean,
	strokeWidthPx: number,
	hostStyle: SvgComputedStyle,
): SvgIrElement[] {
	const scale =
		marker.markerUnits === 'strokeWidth' ? Math.max(strokeWidthPx, 0.5) : 1;
	const baseAngle =
		marker.orient === 'auto'
			? endpoint.angleDeg
			: marker.orient === 'auto-start-reverse'
				? isStart
					? endpoint.angleDeg + 180
					: endpoint.angleDeg
				: marker.orient;
	const transform: Matrix2D = multiplyMatrices(
		multiplyMatrices(
			translationMatrix(endpoint.point.x, endpoint.point.y),
			rotationMatrix(baseAngle),
		),
		scaleMatrix(scale, scale),
	);
	return marker.elements.map(child => ({
		...child,
		matrix: multiplyMatrices(transform, child.matrix),
		...(child.kind !== 'text'
			? {
					style: {
						...child.style,
						opacity: child.style.opacity * hostStyle.opacity,
					},
				}
			: {}),
	})) as SvgIrElement[];
}
