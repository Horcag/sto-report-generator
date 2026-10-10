import fs from 'node:fs';
import path from 'node:path';

import { FigureSettings } from './types';

function record(value: unknown, label: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value))
		throw new Error(`Invalid figure ${label}: expected object`);
	return value as Record<string, unknown>;
}

/** Config paths are strictly report-relative; legacy Markdown lookup stays scoped. */
export function resolveFigurePath(
	sourceDir: string,
	asset: string,
	allowLegacyMarkdown = false,
): string {
	if (
		!asset ||
		/[\\:]/u.test(asset) ||
		(!allowLegacyMarkdown &&
			(path.isAbsolute(asset) || /(?:^|\/)\.\.(?:\/|$)/u.test(asset)))
	)
		throw new Error(`Figure path must be report-relative: ${asset}`);
	const root = fs.realpathSync(sourceDir);
	const primary = path.resolve(root, asset);
	let selected = primary;
	if (
		allowLegacyMarkdown &&
		!path.isAbsolute(asset) &&
		!fs.existsSync(primary)
	) {
		const prefix = `${path.basename(root)}/`;
		const stripped = asset.startsWith(prefix)
			? path.resolve(root, asset.slice(prefix.length))
			: undefined;
		selected =
			stripped && fs.existsSync(stripped)
				? stripped
				: path.resolve(process.cwd(), asset);
	}
	const candidate = fs.realpathSync(selected);
	const relative = path.relative(root, candidate);
	if (
		!relative ||
		relative === '..' ||
		relative.startsWith(`..${path.sep}`) ||
		path.isAbsolute(relative)
	)
		throw new Error(`Figure path escapes report directory: ${asset}`);
	return candidate;
}

export function validateFigureId(id: string): void {
	if (
		!/^[a-zA-Z0-9_-]+$/u.test(id) ||
		['__proto__', 'constructor', 'prototype'].includes(id)
	)
		throw new Error(`Invalid or reserved figure ID: ${id}`);
}

export function validateFigureSettings(value: unknown): FigureSettings {
	const root = record(value, 'settings');
	for (const key of Object.keys(root))
		if (!['defaults', 'figures'].includes(key))
			throw new Error(`Unknown figure setting: ${key}`);
	const defaults = record(root.defaults ?? {}, 'defaults');
	const figures = record(root.figures ?? {}, 'figures');
	const positive = (value: unknown, key: string): void => {
		if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0)
			throw new Error(
				`Invalid figure ${key}: expected positive finite number`,
			);
	};
	for (const [key, value] of Object.entries(defaults)) {
		if (key === 'quality') {
			if (value !== 'warn' && value !== 'error')
				throw new Error('Invalid figure quality');
		} else if (
			['maxWidthMm', 'maxHeightMm', 'minDpi', 'minTextPt'].includes(key)
		)
			positive(value, key);
		else throw new Error(`Unknown figure default: ${key}`);
	}
	if (
		(defaults.maxWidthMm as number | undefined) !== undefined &&
		(defaults.maxWidthMm as number) > 140
	)
		throw new Error('Figure maximum width cannot exceed 140 mm');
	if (
		(defaults.maxHeightMm as number | undefined) !== undefined &&
		(defaults.maxHeightMm as number) > 230
	)
		throw new Error('Figure maximum height cannot exceed 230 mm');
	for (const [id, rawSpec] of Object.entries(figures)) {
		validateFigureId(id);
		const spec = record(rawSpec, id);
		for (const [key, value] of Object.entries(spec)) {
			if (['widthMm', 'maxHeightMm', 'textSizePx'].includes(key))
				positive(value, key);
			else if (key === 'source' || key === 'fallback') {
				if (
					typeof value !== 'string' ||
					!value ||
					path.isAbsolute(value) ||
					/[\\:]|(?:^|\/)\.\.(?:\/|$)/u.test(value)
				)
					throw new Error(`Invalid report-relative figure ${key}`);
			} else if (key === 'crop') {
				const crop = record(value, 'crop');
				if (
					Object.keys(crop).length !== 4 ||
					!['left', 'right', 'top', 'bottom'].every(
						side =>
							typeof crop[side] === 'number' &&
							Number.isFinite(crop[side]) &&
							(crop[side] as number) >= 0 &&
							(crop[side] as number) <= 100,
					)
				)
					throw new Error('Invalid figure crop percentages');
				if (
					(crop.left as number) + (crop.right as number) >= 100 ||
					(crop.top as number) + (crop.bottom as number) >= 100
				)
					throw new Error(
						'Figure crop must retain positive width and height',
					);
			} else throw new Error(`Unknown figure property: ${key}`);
		}
	}
	return { defaults, figures } as FigureSettings;
}

export function loadFigureSettings(sourceDir: string): FigureSettings {
	const filename = path.join(sourceDir, 'figures.json');
	return validateFigureSettings(
		fs.existsSync(filename)
			? JSON.parse(fs.readFileSync(filename, 'utf8'))
			: {},
	);
}
