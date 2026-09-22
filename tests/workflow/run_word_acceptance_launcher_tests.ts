import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mock } from 'node:test';

import { runWordAcceptance } from '@/app/word-acceptance';

interface Scenario {
	cleanupFails?: boolean;
	malformedManifest?: boolean;
	exportFails?: boolean;
}

interface Invocation {
	cleanup: boolean;
	requestPath: string;
	visible: boolean;
}

function withFakeWord(
	scenario: Scenario,
	test: (input: string, calls: Invocation[]) => void,
): void {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sto-word-test-'));
	const input = path.join(root, 'input.docx');
	fs.writeFileSync(input, 'fixture');
	const calls: Invocation[] = [];
	const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
	if (process.platform !== 'win32') {
		Object.defineProperty(process, 'platform', { value: 'linux' });
		mock.method(os, 'release', () => 'test-microsoft-wsl');
	}
	mock.method(
		childProcess,
		'spawnSync',
		(
			command: string,
			args: string[],
			options?: { env?: NodeJS.ProcessEnv },
		) => {
			const result = {
				pid: 0,
				output: [],
				stdout: '',
				stderr: '',
				status: 0,
				signal: null,
			};
			if (command === 'wslpath') return { ...result, stdout: args[1] };
			assert.equal(command, 'powershell.exe');
			const requestPath = args[args.indexOf('-RequestJson') + 1];
			assert.ok(requestPath, 'every launch must have a request receipt');
			const cleanup = args.some(arg =>
				arg.endsWith('stop_word_acceptance.ps1'),
			);
			calls.push({
				cleanup,
				requestPath,
				visible: options?.env?.WINDOWS_CONSOLE_VISIBLE === '1',
			});
			if (cleanup)
				return { ...result, status: scenario.cleanupFails ? 1 : 0 };
			const request = JSON.parse(fs.readFileSync(requestPath, 'utf8'));
			if (
				request.interactionMode === 'background' ||
				scenario.exportFails
			) {
				return {
					...result,
					status: 1,
					stderr: 'simulated export failure',
				};
			}
			fs.writeFileSync(
				request.manifest,
				scenario.malformedManifest
					? '{malformed manifest'
					: JSON.stringify({
							status: 'pendingCleanup',
							execution: {},
						}),
			);
			return result;
		},
	);
	try {
		test(input, calls);
	} finally {
		mock.restoreAll();
		Object.defineProperty(process, 'platform', platform);
		for (const receipt of new Set(
			calls.map(call => path.dirname(call.requestPath)),
		)) {
			fs.rmSync(receipt, { recursive: true, force: true });
		}
		fs.rmSync(root, { recursive: true, force: true });
	}
}

function testSuccessfulAcceptance(): void {
	withFakeWord({}, (inputDocx, calls) => {
		runWordAcceptance({ inputDocx });
		const manifest = JSON.parse(
			fs.readFileSync(
				inputDocx.replace(/\.docx$/, '.acceptance.json'),
				'utf8',
			),
		);
		assert.equal(manifest.status, 'accepted');
		assert.equal(manifest.execution.processCleanupVerified, true);
		assert.deepEqual(
			calls.map(call => call.cleanup),
			[false, true, false, true],
		);
		assert.equal(
			calls[2].visible,
			true,
			'interactive retry must request a visible console',
		);
		assert.equal(fs.existsSync(calls[0].requestPath), false);
		assert.equal(
			fs.existsSync(
				inputDocx.replace(/\.docx$/, '.acceptance.json.pending'),
			),
			false,
		);
	});
}

function testUnverifiedCleanup(): void {
	withFakeWord({ cleanupFails: true }, (inputDocx, calls) => {
		assert.throws(
			() => runWordAcceptance({ inputDocx }),
			/cleanup could not prove/,
		);
		assert.deepEqual(
			calls.map(call => call.cleanup),
			[false, true],
			'unverified cleanup must prevent retry',
		);
		assert.equal(fs.existsSync(calls[0].requestPath), true);
		assert.equal(
			fs.existsSync(inputDocx.replace(/\.docx$/, '.acceptance.json')),
			false,
		);
	});
}

function testMalformedManifest(): void {
	withFakeWord({ malformedManifest: true }, (inputDocx, calls) => {
		assert.throws(() => runWordAcceptance({ inputDocx }), SyntaxError);
		assert.deepEqual(
			calls.map(call => call.cleanup),
			[false, true, false, true],
		);
		assert.equal(fs.existsSync(calls[0].requestPath), true);
		assert.doesNotMatch(
			fs.readFileSync(
				inputDocx.replace(/\.docx$/, '.acceptance.json'),
				'utf8',
			),
			/accepted/,
		);
	});
}

function testBothAttemptsFail(): void {
	withFakeWord({ exportFails: true }, (inputDocx, calls) => {
		assert.throws(
			() => runWordAcceptance({ inputDocx }),
			/failed in both background and interactive modes/,
		);
		assert.deepEqual(
			calls.map(call => call.cleanup),
			[false, true, false, true],
		);
		assert.equal(fs.existsSync(calls[0].requestPath), false);
		const manifest = JSON.parse(
			fs.readFileSync(
				inputDocx.replace(/\.docx$/, '.acceptance.json'),
				'utf8',
			),
		);
		assert.equal(manifest.status, 'failed');
		assert.equal(manifest.capabilityChecks.exportedPdf, false);
	});
}

testSuccessfulAcceptance();
testUnverifiedCleanup();
testMalformedManifest();
testBothAttemptsFail();
console.log('Word acceptance launcher tests passed.');
