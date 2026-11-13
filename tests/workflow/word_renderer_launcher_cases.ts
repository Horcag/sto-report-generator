import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { createWordRenderJob } from '@/app/word-renderer';

type FakeWord = (
	scenario: {
		sourceDrivenRenderer?: boolean;
		timeoutAfterNative?: boolean;
		deterministicQualityFailure?: boolean;
		rendererQuality?: string;
		backgroundSucceeds?: boolean;
		exportFails?: boolean;
		cleanupFails?: boolean;
		cleanupFailsAfterAcceptance?: boolean;
	},
	test: (
		input: string,
		calls: { cleanup: boolean; timeout?: number; requestPath: string }[],
	) => void,
) => void;

export function testSourceDrivenRendererLauncher(withFakeWord: FakeWord): void {
	for (const outcome of [
		'success',
		'failure',
		'cleanup',
		'interactive-cleanup',
		'quality',
		'budget',
		'override',
	] as const) {
		withFakeWord(
			{
				sourceDrivenRenderer: true,
				backgroundSucceeds: outcome !== 'interactive-cleanup',
				exportFails: [
					'failure',
					'quality',
					'budget',
					'override',
				].includes(outcome),
				timeoutAfterNative: outcome === 'budget',
				deterministicQualityFailure: outcome === 'quality',
				rendererQuality: 'print',
				cleanupFails: outcome === 'cleanup',
				cleanupFailsAfterAcceptance: outcome === 'interactive-cleanup',
			},
			(input, calls) => {
				const outputDocx = path.join(path.dirname(input), 'final.docx');
				const job = createWordRenderJob({
					outputDocx,
					sourceDir: path.dirname(input),
					exportPdf: true,
					stylePreset: 'default',
					pdfImageQuality: 'print',
					wordTimeoutSeconds: ['budget', 'override'].includes(outcome)
						? 1200
						: undefined,
				});
				fs.copyFileSync(input, job.inputDocx);
				fs.writeFileSync(
					path.join(
						path.dirname(job.inputDocx),
						'input.figures.json',
					),
					'{"schemaVersion":1,"figures":[]}',
				);
				if (outcome === 'success') {
					job.render();
					const result = job.publish();
					const manifest = JSON.parse(
						fs.readFileSync(result.manifest, 'utf8'),
					);
					assert.equal(manifest.postBuild.formula_replacements, 2);
					assert.equal(manifest.execution.attemptTimeoutSeconds, 600);
					assert.equal(manifest.acceptedDocx.path, outputDocx);
					assert.equal(
						manifest.execution.processCleanupVerified,
						true,
					);
				} else {
					assert.throws(
						() => job.render(),
						['cleanup', 'interactive-cleanup'].includes(outcome)
							? /cleanup could not prove/
							: outcome === 'budget'
								? /exhausted its time budget/
								: outcome === 'quality'
									? /rejected the document/
									: /failed in both/,
					);
					assert.ok(!fs.existsSync(outputDocx));
				}
				if (outcome === 'quality' || outcome === 'budget')
					assert.equal(calls.filter(call => !call.cleanup).length, 1);
				if (outcome === 'budget') {
					const failed = JSON.parse(
						fs.readFileSync(
							path.join(
								path.dirname(job.inputDocx),
								'acceptance.json',
							),
							'utf8',
						),
					);
					assert.equal(failed.execution.attemptTimeoutSeconds, 1200);
					assert.equal(failed.execution.processCleanupVerified, true);
				}
				if (outcome === 'override') {
					assert.equal(calls.filter(call => !call.cleanup).length, 2);
					assert.ok(
						calls
							.filter(call => !call.cleanup)
							.every(call => call.timeout === 1_200_000),
					);
				}
				const journal = calls[0].requestPath;
				assert.equal(
					path.dirname(path.dirname(journal)),
					path.dirname(job.inputDocx),
				);
				assert.equal(
					fs.existsSync(journal),
					['cleanup', 'interactive-cleanup'].includes(outcome),
				);
				if (['cleanup', 'interactive-cleanup'].includes(outcome)) {
					const failed = JSON.parse(
						fs.readFileSync(
							path.join(
								path.dirname(job.inputDocx),
								'acceptance.json',
							),
							'utf8',
						),
					);
					assert.equal(failed.status, 'failed');
					assert.equal(
						failed.execution.processCleanupVerified,
						false,
					);
					const request = JSON.parse(
						fs.readFileSync(journal, 'utf8'),
					);
					assert.equal(
						path.dirname(request.wordPidPath),
						path.dirname(journal),
					);
					assert.equal(
						path.dirname(request.runnerPidPath),
						path.dirname(journal),
					);
				}
				job.close();
				assert.equal(
					fs.existsSync(`${outputDocx}.word.lock`),
					['cleanup', 'interactive-cleanup'].includes(outcome),
				);
				assert.equal(
					fs.existsSync(path.dirname(job.inputDocx)),
					['cleanup', 'interactive-cleanup'].includes(outcome),
				);
				assert.equal(
					calls[0].timeout,
					['budget', 'override'].includes(outcome)
						? 1_200_000
						: 600_000,
					'full native post-build must not inherit a 45 second deadline',
				);
			},
		);
	}
}

export function timeoutSpawnResult(enabled?: boolean): {
	error?: Error & { code: string };
} {
	return enabled
		? {
				error: Object.assign(new Error('mock deadline'), {
					code: 'ETIMEDOUT',
				}),
			}
		: {};
}
