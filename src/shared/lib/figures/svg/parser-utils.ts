import { FigureCrop } from '../types';
import { parseSvgLength } from './style';
import { RectBounds } from './types';

export function parseNumberList(raw: string | null): number[] {
	if (!raw) return [];
	return raw
		.trim()
		.split(/[\s,]+/u)
		.filter(Boolean)
		.map(Number);
}

export function parseViewBox(raw: string | null): RectBounds | null {
	if (!raw) return null;
	const nums = parseNumberList(raw);
	if (
		nums.length !== 4 ||
		nums.some(value => !Number.isFinite(value)) ||
		nums[2] <= 0 ||
		nums[3] <= 0
	) {
		throw new Error(`Invalid SVG viewBox="${raw}".`);
	}
	return {
		left: nums[0],
		top: nums[1],
		right: nums[0] + nums[2],
		bottom: nums[1] + nums[3],
	};
}

export function resolveRootViewBox(root: Element): RectBounds {
	const viewBox = parseViewBox(root.getAttribute('viewBox'));
	if (viewBox) return viewBox;
	const widthAttr = root.getAttribute('width');
	const heightAttr = root.getAttribute('height');
	const width = parseSvgLength(widthAttr, 0);
	const height = parseSvgLength(heightAttr, 0);
	if (
		!Number.isFinite(width) ||
		!Number.isFinite(height) ||
		width <= 0 ||
		height <= 0
	) {
		throw new Error(
			'SVG root must define a valid viewBox or positive width and height for svgMode: "shapes".',
		);
	}
	return { left: 0, top: 0, right: width, bottom: height };
}

export function applyCropToViewBox(
	viewBox: RectBounds,
	crop?: FigureCrop,
): RectBounds {
	if (!crop) return viewBox;
	const width = viewBox.right - viewBox.left;
	const height = viewBox.bottom - viewBox.top;
	return {
		left: viewBox.left + (width * crop.left) / 100,
		top: viewBox.top + (height * crop.top) / 100,
		right: viewBox.right - (width * crop.right) / 100,
		bottom: viewBox.bottom - (height * crop.bottom) / 100,
	};
}

export function resolvePointsAttr(raw: string | null): number[] {
	const numbers = parseNumberList(raw);
	if (
		numbers.length < 4 ||
		numbers.length % 2 !== 0 ||
		numbers.some(v => !Number.isFinite(v))
	) {
		throw new Error(`Invalid SVG points attribute "${raw ?? ''}".`);
	}
	return numbers;
}

export function pointsToPath(points: number[], close: boolean): string {
	const segments: string[] = [];
	for (let i = 0; i < points.length; i += 2) {
		segments.push(`${i === 0 ? 'M' : 'L'} ${points[i]} ${points[i + 1]}`);
	}
	return close ? `${segments.join(' ')} Z` : segments.join(' ');
}

export function resolveHrefId(element: Element): string | null {
	const href =
		element.getAttribute('href') ??
		element.getAttribute('xlink:href') ??
		element.getAttributeNS('http://www.w3.org/1999/xlink', 'href');
	if (!href) return null;
	if (!href.startsWith('#') || href.length < 2) {
		throw new Error(
			`Unsupported external SVG <use href="${href}"> reference in svgMode: "shapes".`,
		);
	}
	return href.slice(1);
}
