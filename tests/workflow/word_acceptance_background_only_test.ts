import assert from 'node:assert/strict';
import fs from 'node:fs';

import { runWordAcceptance } from '@/app/word-acceptance';

interface BackgroundScenario {
	backgroundSucceeds?: boolean;
	cleanupFails?: boolean;
	hungAtStage?: string;
	malformedManifest?: boolean;
	missingManifest?: boolean;
	unexpectedManifest?: boolean;
	corruptAcceptedText?: boolean;
}
interface Invocation {
	cleanup: boolean;
	requestPath: string;
	visible: boolean;
	hidden: boolean;
	timeout?: number;
}
type FakeWord = (
	scenario: BackgroundScenario,
	test: (input: string, calls: Invocation[]) => void,
) => void;

export function testBackgroundOnlyLifecycle(withFakeWord: FakeWord): void {
	for (const outcome of ['success', 'failure', 'cleanup'] as const) {
		withFakeWord(
			{
				backgroundSucceeds: outcome === 'success',
				cleanupFails: outcome === 'cleanup',
				hungAtStage: 'update-toc',
			},
			(inputDocx, calls) => {
				const run = () =>
					runWordAcceptance({ inputDocx, backgroundOnly: true });
				if (outcome === 'success') run();
				else
					assert.throws(
						run,
						outcome === 'failure'
							? /background-only acceptance failed; interactive fallback is disabled/
							: /cleanup could not prove/,
					);
				assert.deepEqual(
					calls.map(call => call.cleanup),
					[false, true],
				);
				assert.ok(calls.every(call => call.hidden && !call.visible));
				assert.equal(calls[0].timeout, 180_000);
				assert.equal(
					fs.existsSync(calls[0].requestPath),
					outcome === 'cleanup',
				);
				const manifest = JSON.parse(
					fs.readFileSync(
						inputDocx.replace(/\.docx$/, '.acceptance.json'),
						'utf8',
					),
				);
				assert.equal(
					manifest.status,
					outcome === 'success' ? 'accepted' : 'failed',
				);
				assert.equal(
					manifest.execution.requestedMode,
					'background-only',
				);
				assert.equal(
					manifest.execution.processCleanupVerified,
					outcome !== 'cleanup',
				);
				if (outcome !== 'success') {
					assert.equal(
						manifest.execution.attemptedModes.join(','),
						'background',
					);
					assert.equal(manifest.failure.interactiveAttempt, null);
					assert.equal(manifest.lastWordStage, 'update-toc');
				}
			},
		);
	}

	for (const scenario of [
		{ malformedManifest: true },
		{ missingManifest: true },
		{ unexpectedManifest: true },
		{ corruptAcceptedText: true },
	]) {
		withFakeWord(
			{ backgroundSucceeds: true, ...scenario },
			(inputDocx, calls) => {
				assert.throws(() =>
					runWordAcceptance({ inputDocx, backgroundOnly: true }),
				);
				assert.deepEqual(
					calls.map(call => call.cleanup),
					[false, true],
				);
				assert.equal(fs.existsSync(calls[0].requestPath), false);
				const manifest = JSON.parse(
					fs.readFileSync(
						inputDocx.replace(/\.docx$/, '.acceptance.json'),
						'utf8',
					),
				);
				assert.equal(manifest.status, 'failed');
				assert.equal(
					manifest.execution.requestedMode,
					'background-only',
				);
				assert.equal(manifest.execution.processCleanupVerified, true);
				if (scenario.corruptAcceptedText) {
					assert.equal(manifest.failure.stage, 'contentIntegrity');
					assert.ok(manifest.figureChecks);
					assert.match(
						manifest.failure.message,
						/changed or reordered document text/,
					);
				} else {
					assert.deepEqual(manifest.execution.attemptedModes, [
						'background',
					]);
					assert.equal(manifest.failure.interactiveAttempt, null);
				}
			},
		);
	}
}
