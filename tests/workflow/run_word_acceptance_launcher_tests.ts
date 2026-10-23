import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mock } from 'node:test';
import AdmZip from 'adm-zip';

import {
	detectWordAcceptanceHost,
	runWordAcceptance,
} from '@/app/word-acceptance';

import { testBackgroundOnlyLifecycle } from './word_acceptance_background_only_test';

interface Scenario {
	backgroundSucceeds?: boolean;
	cleanupFails?: boolean;
	cleanupFailsAfterAcceptance?: boolean;
	corruptAcceptedText?: boolean;
	malformedManifest?: boolean;
	missingManifest?: boolean;
	unexpectedManifest?: boolean;
	exportFails?: boolean;
	hungAtStage?: string;
	deterministicTableFailure?: boolean;
	largeDocument?: boolean;
	boldInput?: boolean;
	platform?: NodeJS.Platform;
	release?: string;
}
interface Invocation {
	cleanup: boolean;
	requestPath: string;
	visible: boolean;
	hidden: boolean;
	timeout?: number;
}
function withFakeWord(
	scenario: Scenario,
	test: (input: string, calls: Invocation[]) => void,
): void {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sto-word-test-'));
	const input = path.join(root, 'input.docx');
	const fixture = new AdmZip();
	fixture.addFile(
		'word/document.xml',
		Buffer.from(
			`<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r>${scenario.boldInput ? '<w:rPr><w:b/></w:rPr>' : ''}<w:t>Документ для проверки сохранения текста</w:t></w:r></w:p></w:body></w:document>`,
		),
	);
	fixture.addFile(
		'word/styles.xml',
		Buffer.from(
			'<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:styleId="Normal"><w:name w:val="Normal"/></w:style></w:styles>',
		),
	);
	fixture.writeZip(input);
	const calls: Invocation[] = [];
	const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
	Object.defineProperty(process, 'platform', {
		value:
			scenario.platform ??
			(process.platform === 'win32' ? 'win32' : 'linux'),
	});
	mock.method(os, 'release', () => scenario.release ?? 'test-microsoft-wsl');
	mock.method(
		childProcess,
		'spawnSync',
		(
			command: string,
			args: string[],
			options?: {
				env?: NodeJS.ProcessEnv;
				timeout?: number;
				windowsHide?: boolean;
			},
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
			if (command === 'uv') {
				assert.deepEqual(args.slice(0, 4), [
					'run',
					'python',
					'-m',
					'scripts.sto_post_build.acceptance_statistics',
				]);
				assert.equal(args[4], input);
				return {
					...result,
					stdout: JSON.stringify({
						figures: 1,
						tables: scenario.largeDocument ? 14 : 1,
						sources: 1,
						appendices: 0,
						replacements: {
							'{{FIGURES}}': '1 рисунок',
							'{{TABLES}}': '1 таблица',
							'{{SOURCES}}': '1 источник',
							'{{APPENDICES}}': '0 приложений',
						},
					}),
				};
			}
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
				hidden: options?.windowsHide === true,
				timeout: options?.timeout,
			});
			if (cleanup)
				return {
					...result,
					status:
						scenario.cleanupFails ||
						(scenario.cleanupFailsAfterAcceptance &&
							calls.some(call => call.visible))
							? 1
							: 0,
				};
			const request = JSON.parse(fs.readFileSync(requestPath, 'utf8'));
			assert.deepEqual(request.statisticCounts, {
				figures: 1,
				tables: scenario.largeDocument ? 14 : 1,
				sources: 1,
				appendices: 0,
			});
			if (
				(request.interactionMode === 'background' &&
					!scenario.backgroundSucceeds) ||
				scenario.exportFails
			) {
				return {
					...result,
					status: 1,
					stdout: scenario.hungAtStage
						? `Word acceptance stage: ${scenario.hungAtStage}.`
						: '',
					stderr: scenario.deterministicTableFailure
						? "Word acceptance failed: Table 'Table 4' spans pages 12-14."
						: 'simulated export failure',
				};
			}
			if (!scenario.missingManifest)
				fs.writeFileSync(
					request.manifest,
					scenario.malformedManifest
						? '{malformed manifest'
						: JSON.stringify({
								status: scenario.unexpectedManifest
									? 'unexpected'
									: 'pendingCleanup',
								execution: {},
							}),
				);
			fs.copyFileSync(input, input.replace(/\.docx$/, '.accepted.docx'));
			if (scenario.corruptAcceptedText) {
				const accepted = new AdmZip(
					input.replace(/\.docx$/, '.accepted.docx'),
				);
				accepted.updateFile(
					'word/document.xml',
					Buffer.from(
						accepted
							.readAsText('word/document.xml')
							.replace(
								'Документ для проверки сохранения текста',
								'Повреждённый текст',
							),
					),
				);
				accepted.writeZip(input.replace(/\.docx$/, '.accepted.docx'));
			}
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
		assert.equal(calls[0].timeout, 45_000);
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
function testIntegrityFailurePersistsVerifiedCleanup(): void {
	withFakeWord({ corruptAcceptedText: true }, (inputDocx, calls) => {
		assert.throws(
			() => runWordAcceptance({ inputDocx }),
			/changed or reordered document text/,
		);
		const manifest = JSON.parse(
			fs.readFileSync(
				inputDocx.replace(/\.docx$/, '.acceptance.json'),
				'utf8',
			),
		);
		assert.equal(manifest.status, 'failed');
		assert.equal(manifest.failure.stage, 'contentIntegrity');
		assert.equal(manifest.execution.processCleanupVerified, true);
		assert.deepEqual(
			calls.map(call => call.cleanup),
			[false, true, false, true],
		);
		assert.equal(fs.existsSync(calls[0].requestPath), false);
	});
}
function testCleanupFailureAfterAcceptanceStaysUnverified(): void {
	withFakeWord({ cleanupFailsAfterAcceptance: true }, (inputDocx, calls) => {
		assert.throws(
			() => runWordAcceptance({ inputDocx }),
			/cleanup could not prove/,
		);
		const manifest = JSON.parse(
			fs.readFileSync(
				inputDocx.replace(/\.docx$/, '.acceptance.json'),
				'utf8',
			),
		);
		assert.equal(manifest.status, 'pendingCleanup');
		assert.notEqual(manifest.execution.processCleanupVerified, true);
		assert.equal(fs.existsSync(calls[0].requestPath), true);
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
		assert.equal(fs.existsSync(calls[0].requestPath), false);
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
	withFakeWord(
		{ exportFails: true, hungAtStage: 'update-toc' },
		(inputDocx, calls) => {
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
			assert.equal(manifest.execution.processCleanupVerified, true);
			assert.equal(manifest.capabilityChecks.exportedPdf, false);
			assert.equal(manifest.lastWordStage, 'update-toc');
			assert.equal(manifest.failure.stage, 'update-toc');
		},
	);
}
function testDeterministicFailureDoesNotRetry(): void {
	withFakeWord({ deterministicTableFailure: true }, (inputDocx, calls) => {
		assert.throws(
			() => runWordAcceptance({ inputDocx }),
			/rejected the document/,
		);
		assert.deepEqual(
			calls.map(call => call.cleanup),
			[false, true],
		);
		const manifest = JSON.parse(
			fs.readFileSync(
				inputDocx.replace(/\.docx$/, '.acceptance.json'),
				'utf8',
			),
		);
		assert.equal(manifest.status, 'failed');
		assert.equal(manifest.execution.processCleanupVerified, true);
		assert.deepEqual(manifest.execution.attemptedModes, ['background']);
		assert.equal(manifest.failure.interactiveAttempt, null);
	});
}
function testLargeDocumentGetsEnoughBackgroundTime(): void {
	withFakeWord(
		{ largeDocument: true, deterministicTableFailure: true },
		(inputDocx, calls) => {
			assert.throws(() => runWordAcceptance({ inputDocx }));
			assert.equal(calls[0].timeout, 180_000);
			assert.deepEqual(
				calls.map(call => call.cleanup),
				[false, true],
			);
		},
	);
}

function testBoldInputRejectedBeforeWord(): void {
	withFakeWord({ boldInput: true }, (inputDocx, calls) => {
		assert.throws(
			() => runWordAcceptance({ inputDocx }),
			/Ordinary body text, including referat fields, must not be bold/,
		);
		assert.deepEqual(calls, []);
	});
}

function testHostDetection(): void {
	const hosts = [
		{ platform: 'win32', release: '10.0', expected: 'windows' },
		{
			platform: 'linux',
			release: '6.6-microsoft-standard',
			expected: 'wsl',
		},
		{ platform: 'linux', release: '6.6-wsl', expected: 'wsl' },
		{ platform: 'linux', release: '6.6-generic', expected: null },
		{ platform: 'darwin', release: '24.0', expected: null },
	] as const;
	for (const host of hosts) {
		withFakeWord(host, (inputDocx, calls) => {
			if (host.expected) {
				assert.equal(detectWordAcceptanceHost(), host.expected);
			} else {
				assert.throws(
					() => detectWordAcceptanceHost(),
					/Word acceptance requires WSL/,
				);
				assert.throws(
					() => runWordAcceptance({ inputDocx }),
					/Word acceptance requires WSL/,
				);
			}
			assert.deepEqual(calls, [], `${host.platform}/${host.release}`);
		});
	}
}

function testMissingInputRejectedBeforeWord(): void {
	withFakeWord({}, (inputDocx, calls) => {
		assert.throws(
			() => runWordAcceptance({ inputDocx: `${inputDocx}.missing` }),
			/DOCX file not found/,
		);
		assert.deepEqual(calls, []);
	});
}

function testUnsupportedStyleRejectedBeforeWord(): void {
	withFakeWord({}, (inputDocx, calls) => {
		assert.throws(
			() =>
				runWordAcceptance({
					inputDocx,
					stylePreset: 'unsupported' as never,
				}),
			/Supported style presets for Word acceptance/,
		);
		assert.deepEqual(calls, []);
	});
}

testSuccessfulAcceptance();
testIntegrityFailurePersistsVerifiedCleanup();
testCleanupFailureAfterAcceptanceStaysUnverified();
testUnverifiedCleanup();
testMalformedManifest();
testBothAttemptsFail();
testBackgroundOnlyLifecycle(withFakeWord);
testDeterministicFailureDoesNotRetry();
testLargeDocumentGetsEnoughBackgroundTime();
testBoldInputRejectedBeforeWord();
testHostDetection();
testMissingInputRejectedBeforeWord();
testUnsupportedStyleRejectedBeforeWord();
console.log('Word acceptance launcher tests passed.');
