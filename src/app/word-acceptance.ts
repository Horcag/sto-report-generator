import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
	DEFAULT_STO_STYLE_PRESET,
	getStoStylePresetDisplayNames,
	isStoStylePreset,
	StoStylePreset,
} from '@/shared/config';

import { assertNoOrdinaryBodyBold } from './word-acceptance-bold';
import { stopOwnedWordAcceptanceProcesses } from './word-acceptance-cleanup';
import { writeWordAcceptanceFailureManifest } from './word-acceptance-evidence';
import { verifyAcceptedDocxIntegrity } from './word-acceptance-integrity';
import {
	readAcceptanceStatistics,
	StatisticCounts,
} from './word-acceptance-statistics';

const PACKAGE_ROOT = path.resolve(__dirname, '..', '..');
export const WORD_ACCEPTANCE_REQUEST_SCHEMA_VERSION = 1;
export const WORD_ACCEPTANCE_TIMEOUT_MS = 600_000;
export const WORD_ACCEPTANCE_BACKGROUND_TIMEOUT_MS = 45_000;
export const WORD_ACCEPTANCE_LARGE_BACKGROUND_TIMEOUT_MS = 180_000;
export type WordAcceptanceInteractionMode = 'background' | 'interactive';

export interface WordAcceptanceOptions {
	inputDocx: string;
	acceptedDocx?: string;
	pdf?: string;
	manifest?: string;
	stylePreset?: StoStylePreset;
	backgroundOnly?: boolean;
}
export interface WordAcceptanceExpectedStyle {
	styleId: string;
	displayName: string;
}
export interface WordAcceptanceRequest {
	schemaVersion: 1;
	inputDocx: string;
	acceptedDocx: string;
	pdf: string;
	manifest: string;
	requiredFont: string;
	stylePreset: StoStylePreset;
	expectedStyles: WordAcceptanceExpectedStyle[];
	runnerPidPath: string;
	wordPidPath: string;
	printerStatePath: string;
	interactionMode: WordAcceptanceInteractionMode;
	attemptedModes: WordAcceptanceInteractionMode[];
	statisticReplacements: Record<string, string>;
	statisticCounts: StatisticCounts;
	pageWordForms: [string, string, string];
}
export type WordAcceptanceHostKind = 'windows' | 'wsl';
export interface WordAcceptancePlan {
	hostKind: WordAcceptanceHostKind;
	command: string;
	args: string[];
	request: WordAcceptanceRequest;
	requestJsonPath: string;
	scriptPath: string;
	localInputDocx: string;
	localAcceptedDocx: string;
	localPdf: string;
	localManifest: string;
	backgroundOnly: boolean;
}

interface CreatePlanEnvironment {
	hostKind: WordAcceptanceHostKind;
	toHostPath: (absolutePath: string) => string;
	requestJsonPath?: string;
	scriptPath?: string;
}

function resolveDefaultOutputPath(
	inputDocx: string,
	explicitPath: string | undefined,
	suffix: string,
): string {
	if (explicitPath) {
		return path.resolve(explicitPath);
	}
	const parsed = path.parse(inputDocx);
	return path.join(parsed.dir, `${parsed.name}${suffix}`);
}

function assertDifferentPaths(inputDocx: string, acceptedDocx: string): void {
	if (path.resolve(inputDocx) === path.resolve(acceptedDocx)) {
		throw new Error(
			'Word acceptance writes a separate accepted DOCX. Choose an output path different from the source DOCX.',
		);
	}
}

function getExpectedStyles(
	stylePreset: StoStylePreset,
): WordAcceptanceExpectedStyle[] {
	return Object.entries(getStoStylePresetDisplayNames(stylePreset)).map(
		([styleId, displayName]) => ({ styleId, displayName }),
	);
}

export function detectWordAcceptanceHost(): WordAcceptanceHostKind {
	if (process.platform === 'win32') {
		return 'windows';
	}
	if (
		process.platform === 'linux' &&
		(os.release().toLowerCase().includes('microsoft') ||
			os.release().toLowerCase().includes('wsl'))
	) {
		return 'wsl';
	}
	throw new Error(
		'Word acceptance requires WSL with Windows PowerShell and Microsoft Word, or native Windows with Microsoft Word. Portable Linux/macOS generation is not authoritative pagination; run this command on a Windows Word host.',
	);
}

function convertWslPathToWindows(absolutePath: string): string {
	const result = spawnSync('wslpath', ['-w', absolutePath], {
		encoding: 'utf8',
		shell: false,
	});
	if (result.error) {
		throw result.error;
	}
	if (result.status !== 0) {
		throw new Error(
			`wslpath failed for ${absolutePath}: ${result.stderr || result.stdout}`,
		);
	}
	return result.stdout.trim();
}

function toHostPath(
	hostKind: WordAcceptanceHostKind,
	absolutePath: string,
): string {
	return hostKind === 'wsl'
		? convertWslPathToWindows(absolutePath)
		: absolutePath;
}

function createRequestJsonPath(): string {
	const tempDir = fs.mkdtempSync(
		path.join(os.tmpdir(), 'sto-word-acceptance-'),
	);
	return path.join(tempDir, 'request.json');
}

export function createWordAcceptancePlan(
	options: WordAcceptanceOptions,
	environment: CreatePlanEnvironment,
): WordAcceptancePlan {
	const inputDocx = path.resolve(options.inputDocx);
	const acceptedDocx = resolveDefaultOutputPath(
		inputDocx,
		options.acceptedDocx,
		'.accepted.docx',
	);
	const pdf = resolveDefaultOutputPath(
		inputDocx,
		options.pdf,
		'.accepted.pdf',
	);
	const manifest = resolveDefaultOutputPath(
		inputDocx,
		options.manifest,
		'.acceptance.json',
	);
	const stylePreset = options.stylePreset ?? DEFAULT_STO_STYLE_PRESET;
	if (!isStoStylePreset(stylePreset)) {
		throw new Error(
			'Supported style presets for Word acceptance: samara-template-2022, default.',
		);
	}
	assertDifferentPaths(inputDocx, acceptedDocx);

	const scriptPath = path.resolve(
		environment.scriptPath ??
			path.join(PACKAGE_ROOT, 'scripts/word_acceptance.ps1'),
	);
	const requestJsonPath = path.resolve(
		environment.requestJsonPath ?? createRequestJsonPath(),
	);
	const request: WordAcceptanceRequest = {
		schemaVersion: WORD_ACCEPTANCE_REQUEST_SCHEMA_VERSION,
		inputDocx: environment.toHostPath(inputDocx),
		acceptedDocx: environment.toHostPath(acceptedDocx),
		pdf: environment.toHostPath(pdf),
		manifest: environment.toHostPath(manifest),
		requiredFont: 'Times New Roman',
		stylePreset,
		expectedStyles: getExpectedStyles(stylePreset),
		runnerPidPath: environment.toHostPath(
			path.join(path.dirname(requestJsonPath), 'runner.pid'),
		),
		wordPidPath: environment.toHostPath(
			path.join(path.dirname(requestJsonPath), 'word.pid'),
		),
		printerStatePath: environment.toHostPath(
			path.join(path.dirname(requestJsonPath), 'printer-state.txt'),
		),
		interactionMode: 'background',
		attemptedModes: ['background'],
		statisticReplacements: {},
		statisticCounts: { figures: 0, tables: 0, sources: 0, appendices: 0 },
		pageWordForms: ['страницу', 'страницы', 'страниц'],
	};
	const command =
		environment.hostKind === 'wsl' ? 'powershell.exe' : 'powershell.exe';
	const args = [
		'-NoProfile',
		'-ExecutionPolicy',
		'Bypass',
		'-File',
		environment.toHostPath(scriptPath),
		'-RequestJson',
		environment.toHostPath(requestJsonPath),
	];

	return {
		hostKind: environment.hostKind,
		command,
		args,
		request,
		requestJsonPath,
		scriptPath,
		localInputDocx: inputDocx,
		localAcceptedDocx: acceptedDocx,
		localPdf: pdf,
		localManifest: manifest,
		backgroundOnly: options.backgroundOnly ?? false,
	};
}

export function runWordAcceptance(options: WordAcceptanceOptions): void {
	if (!fs.existsSync(options.inputDocx)) {
		throw new Error(`DOCX file not found: ${options.inputDocx}`);
	}
	assertNoOrdinaryBodyBold(options.inputDocx);
	const hostKind = detectWordAcceptanceHost();
	const plan = createWordAcceptancePlan(options, {
		hostKind,
		toHostPath: absolutePath => toHostPath(hostKind, absolutePath),
	});
	const statistics = readAcceptanceStatistics(options.inputDocx);
	// Large reports and background-only runs need time for native layout,
	// save/reopen, PDF export, final verification, and Word quit.
	const backgroundTimeout =
		plan.backgroundOnly || statistics.tables >= 10
			? WORD_ACCEPTANCE_LARGE_BACKGROUND_TIMEOUT_MS
			: WORD_ACCEPTANCE_BACKGROUND_TIMEOUT_MS;
	plan.request.statisticReplacements = statistics.replacements;
	plan.request.statisticCounts = {
		figures: statistics.figures,
		tables: statistics.tables,
		sources: statistics.sources,
		appendices: statistics.appendices,
	};
	fs.mkdirSync(path.dirname(plan.requestJsonPath), { recursive: true });
	let cleanupVerified = false;

	try {
		writeWordAcceptanceRequest(plan);
		let backgroundFailure: string | null;
		try {
			backgroundFailure = runWordAcceptanceAttempt(
				plan,
				backgroundTimeout,
				() => {
					cleanupVerified = true;
				},
			);
		} catch (error) {
			if (plan.backgroundOnly) {
				writeWordAcceptanceFailureManifest(
					plan,
					error instanceof Error ? error.message : String(error),
					null,
					cleanupVerified,
					true,
				);
			}
			throw error;
		}
		if (!backgroundFailure) return;
		if (isDeterministicDocumentFailure(backgroundFailure)) {
			writeWordAcceptanceFailureManifest(plan, backgroundFailure, null);
			throw new Error(
				`Word desktop acceptance rejected the document.\n${backgroundFailure}`,
			);
		}

		if (plan.backgroundOnly) {
			writeWordAcceptanceFailureManifest(plan, backgroundFailure, null);
			throw new Error(
				`Word background-only acceptance failed; interactive fallback is disabled.\n${backgroundFailure}`,
			);
		}

		console.warn(
			`Background Word automation was not usable; retrying interactively.\n${backgroundFailure}`,
		);
		plan.request.interactionMode = 'interactive';
		plan.request.attemptedModes.push('interactive');
		cleanupVerified = false;
		writeWordAcceptanceRequest(plan);
		const interactiveFailure = runWordAcceptanceAttempt(
			plan,
			WORD_ACCEPTANCE_TIMEOUT_MS,
			() => {
				cleanupVerified = true;
			},
		);
		if (interactiveFailure) {
			writeWordAcceptanceFailureManifest(
				plan,
				backgroundFailure,
				interactiveFailure,
			);
			throw new Error(
				`Word desktop acceptance failed in both background and interactive modes.\nBackground attempt:\n${backgroundFailure}\nInteractive attempt:\n${interactiveFailure}`,
			);
		}
	} finally {
		if (cleanupVerified) {
			fs.rmSync(path.dirname(plan.requestJsonPath), {
				recursive: true,
				force: true,
			});
		}
	}
}

function isDeterministicDocumentFailure(evidence: string): boolean {
	return /Word acceptance failed: (?:Table .+ spans pages \d+-\d+\.|Required Word styles are missing:)/s.test(
		evidence,
	);
}

function writeWordAcceptanceRequest(plan: WordAcceptancePlan): void {
	fs.writeFileSync(
		plan.requestJsonPath,
		`${JSON.stringify(plan.request, null, 2)}\n`,
		'utf8',
	);
}

function runWordAcceptanceAttempt(
	plan: WordAcceptancePlan,
	timeout: number,
	onCleanupVerified: () => void,
): string | null {
	const result = spawnSync(plan.command, plan.args, {
		cwd: process.cwd(),
		encoding: 'utf8',
		shell: false,
		timeout,
		windowsHide: plan.request.interactionMode === 'background',
		env:
			plan.request.interactionMode === 'interactive'
				? { ...process.env, WINDOWS_CONSOLE_VISIBLE: '1' }
				: process.env,
	});

	let cleanupDetails: string;
	try {
		cleanupDetails = stopOwnedWordAcceptanceProcesses(plan, toHostPath);
	} catch (error) {
		throw new Error(
			[
				error instanceof Error ? error.message : String(error),
				result.stdout,
				result.stderr,
			]
				.filter(Boolean)
				.join('\n'),
			{ cause: error },
		);
	}
	onCleanupVerified();
	if (!result.error && result.status === 0) {
		const manifest = JSON.parse(
			fs.readFileSync(plan.localManifest, 'utf8'),
		);
		if (manifest.status !== 'pendingCleanup') {
			throw new Error(
				'Word acceptance did not produce a pending acceptance manifest.',
			);
		}
		manifest.execution.processCleanupVerified = true;
		if (plan.backgroundOnly) {
			manifest.execution.requestedMode = 'background-only';
		}
		verifyAcceptedDocxIntegrity(
			plan.localInputDocx,
			plan.localAcceptedDocx,
			plan.localManifest,
			manifest,
		);
		assertNoOrdinaryBodyBold(plan.localAcceptedDocx);
		manifest.status = 'accepted';
		const pendingPath = `${plan.localManifest}.pending`;
		fs.writeFileSync(
			pendingPath,
			`${JSON.stringify(manifest, null, 2)}\n`,
			'utf8',
		);
		fs.renameSync(pendingPath, plan.localManifest);
		if (result.stdout.trim()) console.log(result.stdout.trim());
		return null;
	}
	if (
		result.error &&
		'code' in result.error &&
		result.error.code === 'ETIMEDOUT'
	) {
		return [
			`Word ${plan.request.interactionMode} attempt exceeded ${timeout / 1000} seconds.`,
			result.stdout,
			result.stderr,
			cleanupDetails,
		]
			.filter(Boolean)
			.join('\n');
	}
	return [
		result.error?.message,
		result.stdout,
		result.stderr,
		!result.stdout && !result.stderr ? 'Word acceptance failed.' : null,
		cleanupDetails,
	]
		.filter(Boolean)
		.join('\n');
}
