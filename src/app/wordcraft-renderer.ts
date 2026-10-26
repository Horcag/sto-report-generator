import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { stageWordcraftCommand } from './wordcraft-command';
import { prepareWordcraftTocForImport } from './wordcraft-fields';
import { selectWordcraftFontFiles } from './wordcraft-font-files';
import {
	preflightWordcraftFonts,
	wordcraftFontCommands,
	type WordcraftFontReport,
} from './wordcraft-fonts';
import {
	normalizeWordcraftTables,
	readWordcraftLayout,
	type WordcraftTableReport,
} from './wordcraft-layout';
import { prepareWordcraftDocx } from './wordcraft-statistics';

export interface WordcraftRenderOptions {
	inputDocx: string;
	outputPdf?: string;
	executable?: string;
	timeoutMs?: number;
	fontFiles?: string[];
	strictFonts?: boolean;
}

export interface WordcraftRenderResult {
	outputPdf: string;
	manifestPath: string;
	warnings: string[];
	pageCount: number;
	version: string;
	fonts: WordcraftFontReport;
	tables: WordcraftTableReport;
}

const TESTED_VERSION = '0.11.0';
const EXPERIMENTAL_WARNING =
	'Experimental Wordcraft rendering; Microsoft Word acceptance has not been performed.';

function hashFile(filename: string): string {
	return createHash('sha256').update(fs.readFileSync(filename)).digest('hex');
}

function rejectSymlink(filename: string): void {
	try {
		if (fs.lstatSync(filename).isSymbolicLink()) {
			throw new Error(
				`Wordcraft paths must not be symbolic links: ${filename}`,
			);
		}
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
	}
}

function validateDestination(filename: string, input: string): void {
	rejectSymlink(filename);
	if (filename === input)
		throw new Error('Wordcraft output aliases the input DOCX.');
	if (fs.existsSync(filename)) {
		const target = fs.statSync(filename);
		const source = fs.statSync(input);
		if (
			!target.isFile() ||
			(target.dev === source.dev && target.ino === source.ino)
		) {
			throw new Error(
				`Invalid Wordcraft output destination: ${filename}`,
			);
		}
	}
}

/** Render a staged DOCX copy; the original DOCX is never passed to the CLI. */
export function createWordcraftPdf(
	options: WordcraftRenderOptions,
): WordcraftRenderResult {
	const startedAt = Date.now();
	const timeoutMs = options.timeoutMs ?? 300_000;
	if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
		throw new Error('Wordcraft timeoutMs must be a positive integer.');
	}
	const inputDocx = path.resolve(options.inputDocx);
	rejectSymlink(inputDocx);
	if (
		!fs.existsSync(inputDocx) ||
		!fs.statSync(inputDocx).isFile() ||
		path.extname(inputDocx).toLowerCase() !== '.docx'
	) {
		throw new Error(`Expected an existing DOCX file: ${inputDocx}`);
	}
	const outputPdf = path.resolve(
		options.outputPdf ?? inputDocx.replace(/\.docx$/i, '.wordcraft.pdf'),
	);
	if (path.extname(outputPdf).toLowerCase() !== '.pdf') {
		throw new Error('Wordcraft output must use the .pdf extension.');
	}
	const manifestPath = outputPdf.replace(/\.pdf$/i, '.json');
	validateDestination(outputPdf, inputDocx);
	validateDestination(manifestPath, inputDocx);
	const executable =
		options.executable ?? process.env.WORDCRAFT_CLI ?? 'wordcraft-cli';
	const remainingBudget = (): number => {
		const remaining = timeoutMs - (Date.now() - startedAt);
		if (remaining <= 0) throw new Error('Wordcraft rendering timed out.');
		return remaining;
	};
	const version = readWordcraftVersion(executable, remainingBudget());
	wordcraftFontCommands(options.fontFiles); // Validate all explicitly supplied paths before staging.
	let fontFiles: string[] = [];
	let fontCommands: string[] = [];
	const sourceHash = hashFile(inputDocx);
	fs.mkdirSync(path.dirname(outputPdf), { recursive: true });
	const temporaryDir = fs.mkdtempSync(
		path.join(path.dirname(outputPdf), '.sto-wordcraft-'),
	);
	const invoke = (args: string[]): string =>
		runWordcraft(
			executable,
			stageWordcraftCommand(args, temporaryDir),
			remainingBudget(),
		);
	try {
		const warnings = new Set([EXPERIMENTAL_WARNING]);
		const prepared = path.join(temporaryDir, 'prepared.docx');
		const updated = path.join(temporaryDir, 'updated.docx');
		const stagedPdf = path.join(temporaryDir, 'rendered.pdf');
		let pageCount = 1;
		let converged = false;
		let fonts: WordcraftFontReport | undefined;
		let tables: WordcraftTableReport = {
			splits: 0,
			verifiedTables: 0,
			warnings: [],
		};
		for (let pass = 0; pass < 3; pass += 1) {
			for (const warning of prepareWordcraftDocx(
				inputDocx,
				prepared,
				pageCount,
				remainingBudget(),
			).warnings)
				warnings.add(warning);
			if (prepareWordcraftTocForImport(prepared)) {
				warnings.add(
					'Wordcraft TOC compatibility: rebuilt the semantic TOC control in staging to preserve field-result boundaries; source DOCX unchanged.',
				);
			}
			if (!fonts) {
				const catalog = (): string =>
					invoke([
						'run',
						'--file',
						prepared,
						...fontCommands,
						'--cmd',
						'font.list={"all":true}',
						'--print',
					]);
				fonts = preflightWordcraftFonts(prepared, catalog());
				if (options.fontFiles?.length && fonts.missingFamilies.length) {
					const selected = selectWordcraftFontFiles(
						options.fontFiles,
						fonts.missingFamilies,
					);
					fontFiles = selected.files;
					fontCommands = wordcraftFontCommands(fontFiles);
					fonts = preflightWordcraftFonts(prepared, catalog());
					fonts.loadedFiles = selected.files.map(file => ({
						path: file,
						sha256: selected.fileSha256[file],
					}));
					fonts.selectionWarnings = selected.warnings;
					if (fonts.missingFamilies.length)
						for (const warning of selected.warnings)
							warnings.add(warning);
				}
				for (const warning of fonts.warnings) warnings.add(warning);
				if (
					options.strictFonts &&
					(fonts.missingFamilies.length ||
						fonts.unverifiedRequirements.length)
				)
					throw new Error(
						`Wordcraft font requirements are not verified: ${[...fonts.missingFamilies, ...fonts.unverifiedRequirements].join('; ')}. Supply --font-dir with licensed font files and explicit supported font settings.`,
					);
			}
			fs.rmSync(updated, { force: true });
			fs.rmSync(stagedPdf, { force: true });
			invoke([
				'run',
				'--file',
				prepared,
				...fontCommands,
				'--cmd',
				'references.updateFields',
				'--save',
				updated,
			]);
			rejectSymlink(updated);
			if (!fs.existsSync(updated) || !fs.statSync(updated).isFile())
				throw new Error('Wordcraft did not save the updated DOCX.');
			tables = normalizeWordcraftTables({
				invoke,
				docx: updated,
				fontFiles,
				temporaryDir,
			});
			for (const warning of tables.warnings) warnings.add(warning);
			const countPages = (): number =>
				fontCommands.length
					? readWordcraftLayout(invoke, updated, fontFiles)
					: readPageCount(invoke(['info', updated]));
			const before = countPages();
			if (fontCommands.length)
				invoke([
					'run',
					'--file',
					updated,
					...fontCommands,
					'--save',
					stagedPdf,
				]);
			else invoke(['convert', updated, stagedPdf]);
			validatePdf(stagedPdf);
			const after = countPages();
			if (before !== after)
				throw new Error(
					`Wordcraft page count changed during export (${before} -> ${after}).`,
				);
			if (after === pageCount) {
				converged = true;
				break;
			}
			pageCount = after;
		}
		if (!fonts) throw new Error('Wordcraft font preflight did not run.');
		if (!converged)
			throw new Error(
				'Wordcraft page count did not converge after 3 passes.',
			);
		for (const font of fonts.loadedFiles ?? []) {
			if (hashFile(font.path) !== font.sha256)
				throw new Error(
					'A loaded font file changed during Wordcraft rendering.',
				);
		}
		if (hashFile(inputDocx) !== sourceHash)
			throw new Error('Source DOCX changed during Wordcraft rendering.');
		const result: WordcraftRenderResult = {
			outputPdf,
			manifestPath,
			warnings: [...warnings],
			pageCount,
			version,
			fonts,
			tables,
		};
		const stagedManifest = path.join(temporaryDir, 'manifest.json');
		fs.writeFileSync(
			stagedManifest,
			`${JSON.stringify(
				{
					...result,
					renderer: 'wordcraft',
					experimental: true,
					wordAccepted: false,
					pdfPageCountVerified: false,
					pageCountSource: fontCommands.length
						? 'wordcraft-document-layout'
						: 'wordcraft-info',
					inputDocx,
					sourceSha256: sourceHash,
					pdfSha256: hashFile(stagedPdf),
				},
				null,
				2,
			)}\n`,
		);
		validateDestination(outputPdf, inputDocx);
		validateDestination(manifestPath, inputDocx);
		publishOutputs(stagedPdf, outputPdf, stagedManifest, manifestPath);
		return result;
	} finally {
		fs.rmSync(temporaryDir, { recursive: true, force: true });
	}
}

function readPageCount(output: string): number {
	let info: { pages?: unknown };
	try {
		info = JSON.parse(output) as { pages?: unknown };
	} catch {
		throw new Error('Wordcraft info returned invalid JSON.');
	}
	if (
		!info ||
		!Number.isSafeInteger(info.pages) ||
		(info.pages as number) < 1
	) {
		throw new Error('Wordcraft info returned an invalid page count.');
	}
	return info.pages as number;
}

function validatePdf(filename: string): void {
	rejectSymlink(filename);
	if (
		!fs.existsSync(filename) ||
		!fs.statSync(filename).isFile() ||
		fs.statSync(filename).size <= 5 ||
		fs.readFileSync(filename).subarray(0, 5).toString('ascii') !== '%PDF-'
	) {
		throw new Error(
			'Wordcraft did not produce a nonempty file with a PDF signature.',
		);
	}
}

function publishOutputs(
	stagedPdf: string,
	outputPdf: string,
	stagedManifest: string,
	manifestPath: string,
): void {
	const previousManifest = fs.existsSync(manifestPath)
		? fs.readFileSync(manifestPath)
		: undefined;
	fs.renameSync(stagedManifest, manifestPath);
	try {
		fs.renameSync(stagedPdf, outputPdf);
	} catch (error) {
		if (previousManifest) fs.writeFileSync(manifestPath, previousManifest);
		else fs.rmSync(manifestPath, { force: true });
		throw error;
	}
}

function runWordcraft(
	executable: string,
	args: string[],
	timeout: number,
): string {
	const result = spawnSync(executable, args, {
		encoding: 'utf8',
		shell: false,
		timeout,
		killSignal: 'SIGKILL',
		maxBuffer: 4 * 1024 * 1024,
	});
	if (result.error || result.status !== 0) {
		const reason = (result.error?.message || result.stderr || result.stdout)
			.trim()
			.slice(0, 1000);
		throw new Error(`Wordcraft ${args[0]} failed: ${reason}`);
	}
	return result.stdout.trim();
}

export function readWordcraftVersion(
	executable = process.env.WORDCRAFT_CLI ?? 'wordcraft-cli',
	timeoutMs = 2000,
): string {
	if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0)
		throw new Error('Wordcraft timeoutMs must be a positive integer.');
	const output = runWordcraft(executable, ['--version'], timeoutMs);
	const version = output.match(/\b\d+\.\d+\.\d+(?:[-+][\w.-]+)?\b/)?.[0];
	if (version !== TESTED_VERSION)
		throw new Error(
			`Untested Wordcraft version ${output || '(empty)'}; expected ${TESTED_VERSION}.`,
		);
	return version;
}
