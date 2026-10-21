import fs from 'node:fs';
import path from 'node:path';

import { wordcraftFontCommands } from './wordcraft-fonts';
import {
	applyWordcraftTableSplit,
	ensureWordcraftTablePageStart,
	inventoryWordcraftTables,
	type WordcraftParagraphProbe,
} from './wordcraft-tables';

type Invoke = (args: string[]) => string;
interface CaretLayout {
	page: number;
	x: number;
	y: number;
	h: number;
}
interface Layout {
	pages: unknown[];
	caret: CaretLayout | null;
}
interface ProbeResult extends WordcraftParagraphProbe {
	page: number;
}

function readCommandResults(output: string, command: string): unknown[] {
	return output.split(/\r?\n/).flatMap(line => {
		const prefix = `${command}: `;
		if (!line.startsWith(prefix)) return [];
		try {
			return [JSON.parse(line.slice(prefix.length)) as unknown];
		} catch {
			throw new Error(`Wordcraft ${command} returned invalid JSON.`);
		}
	});
}

function parseLayout(value: unknown): Layout {
	const layout = value as Layout;
	if (!layout || !Array.isArray(layout.pages) || !layout.pages.length)
		throw new Error(
			'Wordcraft document.layout returned no physical pages.',
		);
	return layout;
}

export function readWordcraftLayout(
	invoke: Invoke,
	docx: string,
	fontFiles: string[] = [],
): number {
	const results = readCommandResults(
		invoke([
			'run',
			'--file',
			docx,
			...wordcraftFontCommands(fontFiles),
			'--cmd',
			'document.layout',
			'--print',
		]),
		'document.layout',
	);
	if (results.length !== 1)
		throw new Error('Wordcraft must return exactly one layout result.');
	return parseLayout(results[0]).pages.length;
}

function probeParagraphs(
	invoke: Invoke,
	docx: string,
	probes: WordcraftParagraphProbe[],
	fontFiles: string[],
	temporaryDir: string,
): ProbeResult[] {
	if (probes.length > 20_000)
		throw new Error(
			'Wordcraft table layout exceeds the 20000-position safety limit.',
		);
	const results: ProbeResult[] = [];
	// Each layout response repeats all page summaries. Bound both script and output size.
	for (let offset = 0; offset < probes.length; offset += 32) {
		const batch = probes.slice(offset, offset + 32);
		const script = {
			file: docx,
			commands: [
				...fontFiles.map(filename => ({
					command: 'font.add',
					params: { path: path.resolve(filename) },
				})),
				...batch.flatMap(probe => [
					{
						command: 'caret.set',
						params: {
							pos: {
								story: 'body',
								path: probe.path,
								off: probe.edge === 'end' ? 2_147_483_647 : 0,
							},
						},
					},
					{ command: 'document.layout' },
				]),
			],
		};
		const scriptPath = path.join(temporaryDir, 'table-probes.json');
		const content = JSON.stringify(script);
		if (Buffer.byteLength(content) > 4 * 1024 * 1024)
			throw new Error(
				'Wordcraft table probe script exceeds the CLI input limit.',
			);
		fs.writeFileSync(scriptPath, content);
		const output = invoke(['run', '--script', scriptPath, '--print']);
		const carets = readCommandResults(output, 'caret.set') as {
			focus?: { story?: string; path?: number[] };
		}[];
		const layouts = readCommandResults(output, 'document.layout');
		if (carets.length !== batch.length || layouts.length !== batch.length)
			throw new Error(
				'Wordcraft did not execute every requested table position probe.',
			);
		for (let index = 0; index < batch.length; index++) {
			const probe = batch[index];
			const focus = carets[index]?.focus;
			if (
				focus?.story !== 'body' ||
				JSON.stringify(focus.path) !== JSON.stringify(probe.path)
			)
				throw new Error(
					'Wordcraft redirected a table position; refusing an ambiguous split.',
				);
			const layout = parseLayout(layouts[index]);
			const caret = layout.caret;
			if (
				!caret ||
				!Number.isSafeInteger(caret.page) ||
				caret.page < 0 ||
				caret.page >= layout.pages.length ||
				![caret.x, caret.y, caret.h].every(Number.isFinite)
			)
				throw new Error(
					'Wordcraft did not expose a valid table position on a physical page.',
				);
			results.push({ ...probe, page: caret.page });
		}
	}
	return results;
}

export interface WordcraftTableReport {
	splits: number;
	verifiedTables: number;
	warnings: string[];
}

/** Recompute actual row pages after every split; never guess a fixed row count. */
export function normalizeWordcraftTables(options: {
	invoke: Invoke;
	docx: string;
	fontFiles?: string[];
	temporaryDir: string;
}): WordcraftTableReport {
	const { invoke, docx, temporaryDir } = options;
	const fontFiles = options.fontFiles ?? [];
	const report: WordcraftTableReport = {
		splits: 0,
		verifiedTables: 0,
		warnings: [],
	};
	const warnings = new Set<string>();
	for (let attempt = 0; attempt <= 64; attempt++) {
		const inventory = inventoryWordcraftTables(docx);
		for (const warning of inventory.warnings) warnings.add(warning);
		let changed = false;
		for (const table of inventory.tables) {
			const probes = probeParagraphs(
				invoke,
				docx,
				[
					...table.probes,
					{ path: [table.captionBlock], row: -1, edge: 'start' },
					{ path: [table.captionBlock], row: -1, edge: 'end' },
				],
				fontFiles,
				temporaryDir,
			);
			const spans = Array.from({ length: table.rowCount }, () => ({
				first: Infinity,
				last: -1,
			}));
			for (const probe of probes.filter(value => value.row >= 0)) {
				spans[probe.row].first = Math.min(
					spans[probe.row].first,
					probe.page,
				);
				spans[probe.row].last = Math.max(
					spans[probe.row].last,
					probe.page,
				);
			}
			if (
				spans.some(
					span =>
						!Number.isFinite(span.first) || span.last < span.first,
				)
			)
				throw new Error(
					`Wordcraft table ${table.number}: some rows have no verified layout.`,
				);
			if (table.rowCount <= table.headerRows)
				throw new Error(
					`Wordcraft table ${table.number} contains no body rows.`,
				);
			const firstPage = spans[0].first;
			const captionPages = probes
				.filter(probe => probe.row === -1)
				.map(probe => probe.page);
			const separateCaption =
				captionPages.some(page => page !== firstPage) ||
				spans[table.headerRows].first !== firstPage;
			if (separateCaption) {
				if (
					attempt === 64 ||
					!ensureWordcraftTablePageStart(docx, {
						tableBlock: table.tableBlock,
						expectedRowCount: table.rowCount,
						expectedTableSha256: table.tableSha256,
					})
				)
					throw new Error(
						`Wordcraft table ${table.number}: caption, header and first row cannot share a page.`,
					);
				const refreshed = path.join(temporaryDir, 'table-fields.docx');
				invoke([
					'run',
					'--file',
					docx,
					...wordcraftFontCommands(fontFiles),
					'--cmd',
					'references.updateFields',
					'--save',
					refreshed,
				]);
				if (!fs.existsSync(refreshed))
					throw new Error(
						'Wordcraft did not save table field updates.',
					);
				fs.renameSync(refreshed, docx);
				changed = true;
				break;
			}
			let cut = spans.findIndex(
				(span, row) =>
					row >= table.headerRows &&
					(span.first !== firstPage || span.last !== firstPage),
			);
			if (cut < 0) continue;
			while (cut > table.headerRows && !table.safeSplitRows.includes(cut))
				cut--;
			if (cut <= table.headerRows)
				throw new Error(
					`Wordcraft table ${table.number}: a row or merged group cannot fit a page; shorten it or split its content.`,
				);
			if (attempt === 64)
				throw new Error(
					'Wordcraft table pagination did not converge after 64 splits.',
				);
			applyWordcraftTableSplit(docx, {
				tableBlock: table.tableBlock,
				splitBeforeRow: cut,
				expectedRowCount: table.rowCount,
				expectedTableSha256: table.tableSha256,
			});
			const refreshed = path.join(temporaryDir, 'table-fields.docx');
			invoke([
				'run',
				'--file',
				docx,
				...wordcraftFontCommands(fontFiles),
				'--cmd',
				'references.updateFields',
				'--save',
				refreshed,
			]);
			if (!fs.existsSync(refreshed))
				throw new Error('Wordcraft did not save table field updates.');
			fs.renameSync(refreshed, docx);
			report.splits++;
			changed = true;
			break;
		}
		if (!changed) {
			report.verifiedTables = inventory.tables.length;
			report.warnings = [...warnings];
			return report;
		}
	}
	throw new Error('Wordcraft table pagination did not converge.');
}
