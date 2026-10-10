import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import imageSize from 'image-size';
import { JSDOM } from 'jsdom';

import { validatePng } from './png';
import {
	resolveFigurePath,
	validateFigureId,
	validateFigureSettings,
} from './settings';
import { FigurePlan, FigureSettings } from './types';

const hash = (data: Buffer): string =>
	createHash('sha256').update(data).digest('hex');

function svgFontSize(data: Buffer): number | undefined {
	const dom = new JSDOM(data.toString('utf8'), {
		contentType: 'image/svg+xml',
	});
	try {
		const root = dom.window.document.documentElement;
		if (root.localName !== 'svg') throw new Error('Invalid SVG root');
		// Estimate text nodes only; CSS, transforms and reuse require rendering.
		if (
			root.querySelector('style, use, foreignObject, svg') ||
			root.querySelector('[style], [transform]') ||
			root.hasAttribute('style') ||
			root.hasAttribute('transform')
		)
			return undefined;
		const texts = [...root.querySelectorAll('text, tspan')].filter(node =>
			node.textContent?.trim(),
		);
		if (!texts.length) return undefined;
		const sizes: number[] = [];
		for (const node of texts) {
			let parent: Element | null = node;
			let raw: string | null = null;
			while (parent && !raw) {
				raw = parent.getAttribute('font-size');
				parent = parent.parentElement;
			}
			if (!raw || !/^\d+(?:\.\d+)?(?:px)?$/u.test(raw)) return undefined;
			const size = Number.parseFloat(raw);
			if (!Number.isFinite(size) || size <= 0) return undefined;
			sizes.push(size);
		}
		const viewBox = root
			.getAttribute('viewBox')
			?.trim()
			.split(/[\s,]+/u)
			.map(Number);
		if (
			viewBox &&
			(viewBox.length !== 4 ||
				viewBox.some(value => !Number.isFinite(value)) ||
				viewBox[2] <= 0 ||
				viewBox[3] <= 0)
		)
			return undefined;
		const dimensions = imageSize(data);
		if (viewBox) {
			const sx = dimensions.width! / viewBox[2];
			const sy = dimensions.height! / viewBox[3];
			if (Math.abs(sx - sy) > 0.0001) return undefined;
			return Math.min(...sizes) * sy;
		}
		return Math.min(...sizes);
	} finally {
		dom.window.close();
	}
}

export function planFigure(
	sourceDir: string,
	asset: string,
	id: string,
	rawSettings: FigureSettings,
): FigurePlan {
	validateFigureId(id);
	const settings = validateFigureSettings(rawSettings);
	const spec = Object.hasOwn(settings.figures, id)
		? settings.figures[id]
		: {};
	const sourcePath = resolveFigurePath(
		sourceDir,
		spec.source ?? asset,
		spec.source === undefined,
	);
	const data = fs.readFileSync(sourcePath);
	const extension = path
		.extname(sourcePath)
		.slice(1)
		.toLowerCase()
		.replace('jpeg', 'jpg');
	if (extension === 'png') validatePng(data);
	const dimensions = imageSize(data);
	const detected = dimensions.type?.replace('jpeg', 'jpg');
	if (
		!['png', 'jpg', 'gif', 'bmp', 'svg'].includes(extension) ||
		extension !== detected
	)
		throw new Error(`Unsupported or mismatched figure format: ${asset}`);
	if (
		!dimensions.width ||
		!dimensions.height ||
		!Number.isFinite(dimensions.width) ||
		!Number.isFinite(dimensions.height) ||
		dimensions.width <= 0 ||
		dimensions.height <= 0
	)
		throw new Error(`Invalid figure dimensions: ${asset}`);
	const crop = spec.crop ?? { left: 0, right: 0, top: 0, bottom: 0 };
	const visibleWidth =
		dimensions.width * (1 - (crop.left + crop.right) / 100);
	const visibleHeight =
		dimensions.height * (1 - (crop.top + crop.bottom) / 100);
	const maxWidth = settings.defaults.maxWidthMm ?? 140;
	const maxHeight = Math.min(
		spec.maxHeightMm ?? Infinity,
		settings.defaults.maxHeightMm ?? 230,
	);
	let widthMm =
		spec.widthMm ??
		Math.min(
			maxWidth,
			(visibleWidth * 25.4) / 96,
			(maxHeight * visibleWidth) / visibleHeight,
		);
	let heightMm = (widthMm * visibleHeight) / visibleWidth;
	if (widthMm > maxWidth + 1e-8 || heightMm > maxHeight + 1e-8)
		throw new Error(
			`Figure ${id} explicit width exceeds maximum width or height`,
		);
	// SVG defaults can use available page width without raster enlargement.
	if (!spec.widthMm && extension === 'svg') {
		widthMm = Math.min(
			maxWidth,
			(maxHeight * visibleWidth) / visibleHeight,
		);
		heightMm = (widthMm * visibleHeight) / visibleWidth;
	}
	const plan: FigurePlan = {
		id,
		asset: spec.source ?? asset,
		sourcePath,
		sourceHash: hash(data),
		type: extension as FigurePlan['type'],
		intrinsicPx: { width: dimensions.width, height: dimensions.height },
		widthMm,
		heightMm,
		crop,
		effectiveDpi: {
			x: (visibleWidth * 25.4) / widthMm,
			y: (visibleHeight * 25.4) / heightMm,
		},
		issues: [],
	};
	if (extension === 'svg') {
		const fallback =
			spec.fallback ??
			path
				.relative(fs.realpathSync(sourceDir), sourcePath)
				.replaceAll('\\', '/')
				.replace(/\.svg$/iu, '.png');
		plan.fallbackPath = resolveFigurePath(sourceDir, fallback);
		const png = fs.readFileSync(plan.fallbackPath);
		validatePng(png);
		const fallbackDimensions = imageSize(png);
		if (
			fallbackDimensions.type !== 'png' ||
			!fallbackDimensions.width ||
			!fallbackDimensions.height
		)
			throw new Error('Invalid PNG fallback dimensions');
		if (
			Math.abs(
				fallbackDimensions.width / fallbackDimensions.height -
					dimensions.width / dimensions.height,
			) > 0.01
		)
			throw new Error('SVG fallback aspect ratio differs from source');
		plan.fallbackHash = hash(png);
		plan.effectiveDpi = {
			x:
				(fallbackDimensions.width *
					(1 - (crop.left + crop.right) / 100) *
					25.4) /
				widthMm,
			y:
				(fallbackDimensions.height *
					(1 - (crop.top + crop.bottom) / 100) *
					25.4) /
				heightMm,
		};
	}
	const severity = settings.defaults.quality ?? 'warn';
	const issue = (code: string, message: string): void => {
		plan.issues.push({
			code,
			severity,
			message: `Figure ${id}: ${message}`,
		});
	};
	if (Object.values(crop).some(value => value > 0))
		issue(
			'crop-content-unverified',
			'crop geometry is valid; retention of text and diagram elements requires visual review',
		);
	if (
		Math.min(plan.effectiveDpi.x, plan.effectiveDpi.y) <
		(settings.defaults.minDpi ?? 150)
	)
		issue(
			'low-dpi',
			`effective resolution ${Math.min(plan.effectiveDpi.x, plan.effectiveDpi.y).toFixed(1)} DPI is below ${settings.defaults.minDpi ?? 150}`,
		);
	const fontPx = extension === 'svg' ? svgFontSize(data) : spec.textSizePx;
	if (fontPx === undefined)
		issue('unknown-text-size', 'smallest text size cannot be established');
	else {
		plan.minTextPt = (((fontPx * heightMm) / visibleHeight) * 72) / 25.4;
		if (plan.minTextPt < (settings.defaults.minTextPt ?? 9))
			issue(
				'small-text',
				`smallest text ${plan.minTextPt.toFixed(1)} pt is below ${settings.defaults.minTextPt ?? 9} pt`,
			);
	}
	return plan;
}
