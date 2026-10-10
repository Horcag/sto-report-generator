import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import {
	collectFigureOccurrences,
	loadFigureSettings,
	planFigure,
	validateFigureSettings,
	type FigurePlan,
	type FigureSettings,
} from '@/shared/lib/figures';
import { resolveReportConfig } from '@/shared/lib/report-config';

import { renderFigureInspector } from './figure-inspector-html';

export interface InspectedFigure {
	plan: FigurePlan;
	caption: string;
	module: string;
	occurrence: number;
	dataUri: string;
}

function sourceDirectory(reportDir: string): string {
	const { config, diagnostics } = resolveReportConfig(reportDir);
	const errors = diagnostics.filter(item => item.severity === 'error');
	if (errors.length)
		throw new Error(errors.map(item => item.message).join('\n'));
	return path.resolve(reportDir, config.sourceDir);
}

function reportOccurrences(sourceDir: string) {
	const modules = fs
		.readdirSync(sourceDir)
		.filter(
			name => name.endsWith('.md') && name.toLowerCase() !== 'readme.md',
		)
		.sort((a, b) => a.localeCompare(b));
	return collectFigureOccurrences(
		modules.map(file => ({
			file,
			content: fs.readFileSync(path.join(sourceDir, file), 'utf8'),
		})),
	);
}

export function inspectReportFigures(reportDir: string): {
	sourceDir: string;
	settings: FigureSettings;
	figures: InspectedFigure[];
} {
	const sourceDir = sourceDirectory(reportDir);
	const settings = loadFigureSettings(sourceDir);
	const figures: InspectedFigure[] = [];
	const occurrences = reportOccurrences(sourceDir);
	for (const {
		id,
		asset,
		caption,
		file: module,
		occurrence,
	} of occurrences) {
		const plan = planFigure(sourceDir, asset, id, settings);
		const mime =
			plan.type === 'svg'
				? 'image/svg+xml'
				: `image/${plan.type === 'jpg' ? 'jpeg' : plan.type}`;
		figures.push({
			plan,
			caption,
			module,
			occurrence,
			dataUri: `data:${mime};base64,${fs.readFileSync(plan.sourcePath).toString('base64')}`,
		});
	}
	return { sourceDir, settings, figures };
}

/** Validate before replacing the sidecar; leave the original untouched on failure. */
export function updateFigureSettings(
	reportDir: string,
	id: string,
	rawSpec: unknown,
): FigureSettings {
	const sourceDir = sourceDirectory(reportDir);
	const settings = loadFigureSettings(sourceDir);
	const updated = validateFigureSettings({
		defaults: settings.defaults,
		figures: { ...settings.figures, [id]: rawSpec },
	});
	const matches = reportOccurrences(sourceDir).filter(
		figure => figure.id === id,
	);
	if (!matches.length)
		throw new Error(`Figure ID not found in report: ${id}`);
	for (const figure of matches)
		planFigure(sourceDir, figure.asset, id, updated);
	return saveFigureSettings(sourceDir, updated);
}

export function importFigureSettings(
	reportDir: string,
	rawSettings: unknown,
): FigureSettings {
	const updated = validateFigureSettings(rawSettings);
	const sourceDir = sourceDirectory(reportDir);
	const figures = reportOccurrences(sourceDir);
	const ids = new Set(figures.map(figure => figure.id));
	for (const id of Object.keys(updated.figures))
		if (!ids.has(id))
			throw new Error(`Figure ID not found in report: ${id}`);
	for (const figure of figures)
		planFigure(sourceDir, figure.asset, figure.id, updated);
	return saveFigureSettings(sourceDir, updated);
}

function saveFigureSettings(
	sourceDir: string,
	updated: FigureSettings,
): FigureSettings {
	const filename = path.join(sourceDir, 'figures.json');
	const temporary = path.join(sourceDir, `.figures-${randomUUID()}.tmp`);
	try {
		fs.writeFileSync(temporary, `${JSON.stringify(updated, null, 2)}\n`, {
			flag: 'wx',
		});
		fs.renameSync(temporary, filename);
	} finally {
		fs.rmSync(temporary, { force: true });
	}
	const readback = loadFigureSettings(sourceDir);
	if (JSON.stringify(readback) !== JSON.stringify(updated))
		throw new Error(
			'Figure settings readback differs from requested update',
		);
	return readback;
}

export function createFigurePreview(
	reportDir: string,
	outputHTML: string,
): string {
	const { figures, settings } = inspectReportFigures(reportDir);
	const outputPath = path.resolve(outputHTML);
	fs.mkdirSync(path.dirname(outputPath), { recursive: true });
	fs.writeFileSync(
		outputPath,
		renderFigureInspector(figures, settings),
		'utf8',
	);
	return outputPath;
}

export function runFigureInspector(options: {
	reportDir: string;
	outputPath?: string;
	mode?: 'inspect' | 'preview';
	json?: boolean;
}) {
	if (options.mode === 'preview' || options.outputPath)
		return {
			outputPath: createFigurePreview(
				options.reportDir,
				options.outputPath ??
					path.join(options.reportDir, 'build', 'figures.html'),
			),
		};
	const { figures, settings } = inspectReportFigures(options.reportDir);
	return {
		settings,
		figures: figures.map(({ plan, caption, module, occurrence }) => ({
			...plan,
			caption,
			module,
			occurrence,
		})),
	};
}
