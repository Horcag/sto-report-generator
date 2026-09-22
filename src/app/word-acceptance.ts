import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
	DEFAULT_STO_STYLE_PRESET,
	getStoStylePresetDisplayNames,
	isStoStylePreset,
	StoStylePreset,
} from '@/shared/config';

export const WORD_ACCEPTANCE_REQUEST_SCHEMA_VERSION = 2;
export const WORD_ACCEPTANCE_STAGE_TIMEOUT_MS = 120_000;
export const WORD_ACCEPTANCE_OVERALL_TIMEOUT_MS = 300_000;

export interface WordAcceptanceOptions {
	inputDocx: string;
	acceptedDocx?: string;
	pdf?: string;
	manifest?: string;
	diagnostics?: string;
	stylePreset?: StoStylePreset;
}

export interface WordAcceptanceExpectedStyle {
	styleId: string;
	displayName: string;
}

export interface WordAcceptanceRequest {
	schemaVersion: 2;
	runId: string;
	startedAt: string;
	inputDocx: string;
	acceptedDocx: string;
	pdf: string;
	manifest: string;
	diagnostics: string;
	requiredFont: string;
	stylePreset: StoStylePreset;
	expectedStyles: WordAcceptanceExpectedStyle[];
	runnerPidPath: string;
	wordPidPath: string;
	wordPidsBeforePath: string;
}

export type WordAcceptanceHostKind = 'windows' | 'wsl';

export interface WordAcceptancePlan {
	hostKind: WordAcceptanceHostKind;
	command: string;
	args: string[];
	request: WordAcceptanceRequest;
	requestJsonPath: string;
	scriptPath: string;
	diagnosticsPath: string;
}

interface CreatePlanEnvironment {
	hostKind: WordAcceptanceHostKind;
	toHostPath: (absolutePath: string) => string;
	requestJsonPath?: string;
	scriptPath?: string;
	runId?: string;
	startedAt?: string;
}

interface WordAcceptanceDiagnostics {
	schemaVersion?: number;
	runId?: string;
	status?: string;
	stage?: string;
	updatedAt?: string;
	message?: string;
	[key: string]: unknown;
}

interface CleanupResult {
	ok: boolean;
	details: string;
}

function resolveDefaultOutputPath(
	inputDocx: string,
	explicitPath: string | undefined,
	suffix: string,
): string {
	if (explicitPath) return path.resolve(explicitPath);
	const parsed = path.parse(inputDocx);
	return path.join(parsed.dir, `${parsed.name}${suffix}`);
}

function resolveDiagnosticsPath(
	manifest: string,
	explicitPath: string | undefined,
): string {
	if (explicitPath) return path.resolve(explicitPath);
	const parsed = path.parse(manifest);
	return path.join(parsed.dir, `${parsed.name}.diagnostics.json`);
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
	if (process.platform === 'win32') return 'windows';
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
	if (result.error) throw result.error;
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
	const diagnostics = resolveDiagnosticsPath(manifest, options.diagnostics);
	const stylePreset = options.stylePreset ?? DEFAULT_STO_STYLE_PRESET;
	if (!isStoStylePreset(stylePreset)) {
		throw new Error(
			'Supported style presets for Word acceptance: samara-template-2022, default.',
		);
	}
	assertDifferentPaths(inputDocx, acceptedDocx);

	const scriptPath = path.resolve(
		environment.scriptPath ?? 'scripts/word_acceptance.ps1',
	);
	const requestJsonPath = path.resolve(
		environment.requestJsonPath ?? createRequestJsonPath(),
	);
	const runtimeDirectory = path.dirname(requestJsonPath);
	const hostPath = environment.toHostPath;
	const request: WordAcceptanceRequest = {
		schemaVersion: WORD_ACCEPTANCE_REQUEST_SCHEMA_VERSION,
		runId: environment.runId ?? randomUUID(),
		startedAt: environment.startedAt ?? new Date().toISOString(),
		inputDocx: hostPath(inputDocx),
		acceptedDocx: hostPath(acceptedDocx),
		pdf: hostPath(pdf),
		manifest: hostPath(manifest),
		diagnostics: hostPath(diagnostics),
		requiredFont: 'Times New Roman',
		stylePreset,
		expectedStyles: getExpectedStyles(stylePreset),
		runnerPidPath: hostPath(path.join(runtimeDirectory, 'runner.pid')),
		wordPidPath: hostPath(path.join(runtimeDirectory, 'word.pid')),
		wordPidsBeforePath: hostPath(
			path.join(runtimeDirectory, 'word-pids-before.json'),
		),
	};
	const command = 'powershell.exe';
	const args = [
		'-NoProfile',
		'-ExecutionPolicy',
		'Bypass',
		'-File',
		hostPath(scriptPath),
		'-RequestJson',
		hostPath(requestJsonPath),
	];

	return {
		hostKind: environment.hostKind,
		command,
		args,
		request,
		requestJsonPath,
		scriptPath,
		diagnosticsPath: diagnostics,
	};
}

function readDiagnostics(pathname: string): WordAcceptanceDiagnostics | null {
	try {
		return JSON.parse(
			fs.readFileSync(pathname, 'utf8'),
		) as WordAcceptanceDiagnostics;
	} catch {
		return null;
	}
}

function writeDiagnostics(
	pathname: string,
	value: WordAcceptanceDiagnostics,
): void {
	fs.mkdirSync(path.dirname(pathname), { recursive: true });
	const temporaryPath = `${pathname}.tmp-${process.pid}`;
	fs.writeFileSync(
		temporaryPath,
		`${JSON.stringify(value, null, 2)}\n`,
		'utf8',
	);
	fs.renameSync(temporaryPath, pathname);
}

function stopOwnedWordAcceptanceProcesses(
	plan: WordAcceptancePlan,
): CleanupResult {
	const cleanup = spawnSync(
		plan.command,
		[
			'-NoProfile',
			'-ExecutionPolicy',
			'Bypass',
			'-File',
			toHostPath(
				plan.hostKind,
				path.join(
					path.dirname(plan.scriptPath),
					'stop_word_acceptance.ps1',
				),
			),
			'-RequestJson',
			toHostPath(plan.hostKind, plan.requestJsonPath),
		],
		{
			encoding: 'utf8',
			shell: false,
			timeout: 15_000,
			windowsHide: true,
		},
	);
	return {
		ok: !cleanup.error && cleanup.status === 0,
		details: [cleanup.stdout, cleanup.stderr, cleanup.error?.message]
			.filter(Boolean)
			.join('\n')
			.trim(),
	};
}

function formatDiagnostics(
	diagnostics: WordAcceptanceDiagnostics | null,
): string {
	if (!diagnostics) return '';
	const details = [
		diagnostics.stage ? `last stage: ${diagnostics.stage}` : '',
		diagnostics.message ? `detail: ${diagnostics.message}` : '',
	].filter(Boolean);
	return details.length > 0 ? details.join('; ') : '';
}

export async function runWordAcceptance(
	options: WordAcceptanceOptions,
): Promise<void> {
	if (!fs.existsSync(options.inputDocx)) {
		throw new Error(`DOCX file not found: ${options.inputDocx}`);
	}
	const hostKind = detectWordAcceptanceHost();
	const plan = createWordAcceptancePlan(options, {
		hostKind,
		toHostPath: absolutePath => toHostPath(hostKind, absolutePath),
	});
	fs.mkdirSync(path.dirname(plan.requestJsonPath), { recursive: true });
	fs.writeFileSync(
		plan.requestJsonPath,
		`${JSON.stringify(plan.request, null, 2)}\n`,
		'utf8',
	);

	let preserveRuntimeDirectory = false;
	try {
		const child = spawn(plan.command, plan.args, {
			cwd: process.cwd(),
			windowsHide: true,
			shell: false,
			stdio: ['ignore', 'pipe', 'pipe'],
		});
		let stdout = '';
		let stderr = '';
		child.stdout.setEncoding('utf8');
		child.stderr.setEncoding('utf8');
		child.stdout.on('data', chunk => {
			stdout += chunk;
		});
		child.stderr.on('data', chunk => {
			stderr += chunk;
		});

		const startedAt = Date.now();
		let lastProgressAt = startedAt;
		let lastUpdatedAt = '';
		let timeoutReason = '';
		const timeoutPromise = new Promise<'timeout'>(resolve => {
			const timer = setInterval(() => {
				const diagnostics = readDiagnostics(plan.diagnosticsPath);
				if (
					diagnostics?.updatedAt &&
					diagnostics.updatedAt !== lastUpdatedAt
				) {
					lastUpdatedAt = diagnostics.updatedAt;
					lastProgressAt = Date.now();
				}
				const now = Date.now();
				if (now - startedAt > WORD_ACCEPTANCE_OVERALL_TIMEOUT_MS) {
					timeoutReason = `overall timeout after ${WORD_ACCEPTANCE_OVERALL_TIMEOUT_MS / 1000} seconds`;
					clearInterval(timer);
					resolve('timeout');
				} else if (
					now - lastProgressAt >
					WORD_ACCEPTANCE_STAGE_TIMEOUT_MS
				) {
					timeoutReason = `stage timeout after ${WORD_ACCEPTANCE_STAGE_TIMEOUT_MS / 1000} seconds without progress`;
					clearInterval(timer);
					resolve('timeout');
				}
			}, 1_000);
			child.once('exit', () => clearInterval(timer));
			child.once('error', () => clearInterval(timer));
		});
		const exitPromise = new Promise<
			| {
					kind: 'exit';
					code: number | null;
					signal: NodeJS.Signals | null;
			  }
			| { kind: 'error'; error: Error }
		>(resolve => {
			child.once('exit', (code, signal) =>
				resolve({ kind: 'exit', code, signal }),
			);
			child.once('error', error => resolve({ kind: 'error', error }));
		});
		const outcome = await Promise.race([exitPromise, timeoutPromise]);

		if (outcome === 'timeout') {
			const beforeCleanup = readDiagnostics(plan.diagnosticsPath);
			const cleanup = stopOwnedWordAcceptanceProcesses(plan);
			preserveRuntimeDirectory = !cleanup.ok;
			writeDiagnostics(plan.diagnosticsPath, {
				...(beforeCleanup ?? {}),
				schemaVersion: 1,
				runId: plan.request.runId,
				status: 'timed_out',
				stage: beforeCleanup?.stage ?? 'unknown',
				updatedAt: new Date().toISOString(),
				message: timeoutReason,
				cleanup:
					cleanup.details || (cleanup.ok ? 'completed' : 'failed'),
			});
			throw new Error(
				[
					`Word acceptance stopped: ${timeoutReason}.`,
					formatDiagnostics(beforeCleanup),
					`Diagnostics: ${plan.diagnosticsPath}`,
					cleanup.details,
				]
					.filter(Boolean)
					.join('\n'),
			);
		}
		if (outcome.kind === 'error') throw outcome.error;
		if (outcome.code !== 0) {
			const cleanup = stopOwnedWordAcceptanceProcesses(plan);
			preserveRuntimeDirectory = !cleanup.ok;
			const diagnostics = readDiagnostics(plan.diagnosticsPath);
			throw new Error(
				[
					stderr.trim() || stdout.trim() || 'Word acceptance failed.',
					formatDiagnostics(diagnostics),
					`Diagnostics: ${plan.diagnosticsPath}`,
					cleanup.details,
				]
					.filter(Boolean)
					.join('\n'),
			);
		}
		if (stdout.trim()) console.log(stdout.trim());
	} finally {
		if (!preserveRuntimeDirectory) {
			fs.rmSync(path.dirname(plan.requestJsonPath), {
				recursive: true,
				force: true,
			});
		}
	}
}
