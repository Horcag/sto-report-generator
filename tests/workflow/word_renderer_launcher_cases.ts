import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { createWordRenderJob } from '@/app/word-renderer';

type FakeWord = (
	scenario: {
		sourceDrivenRenderer?: boolean;
		deterministicQualityFailure?: boolean;
		rendererQuality?: string;
		backgroundSucceeds?: boolean;
		exportFails?: boolean;
		cleanupFails?: boolean;
	},
	test: (
		input: string,
		calls: { cleanup: boolean; timeout?: number }[],
	) => void,
) => void;

export function testSourceDrivenRendererLauncher(withFakeWord: FakeWord): void {
	for (const outcome of [
		'success',
		'failure',
		'cleanup',
		'quality',
	] as const) {
		withFakeWord(
			{
				sourceDrivenRenderer: true,
				backgroundSucceeds: true,
				exportFails: outcome === 'failure' || outcome === 'quality',
				deterministicQualityFailure: outcome === 'quality',
				rendererQuality: 'print',
				cleanupFails: outcome === 'cleanup',
			},
			(input, calls) => {
				const outputDocx = path.join(path.dirname(input), 'final.docx');
				const job = createWordRenderJob({
					outputDocx,
					sourceDir: path.dirname(input),
					exportPdf: true,
					stylePreset: 'default',
					pdfImageQuality: 'print',
				});
				fs.copyFileSync(input, job.inputDocx);
				if (outcome === 'success') {
					job.render();
					const result = job.publish();
					const manifest = JSON.parse(
						fs.readFileSync(result.manifest, 'utf8'),
					);
					assert.equal(manifest.postBuild.formula_replacements, 2);
					assert.equal(manifest.acceptedDocx.path, outputDocx);
					assert.equal(
						manifest.execution.processCleanupVerified,
						true,
					);
				} else {
					assert.throws(
						() => job.render(),
						outcome === 'cleanup'
							? /cleanup could not prove/
							: outcome === 'quality'
								? /rejected the document/
								: /failed in both/,
					);
					assert.ok(!fs.existsSync(outputDocx));
				}
				if (outcome === 'quality')
					assert.equal(calls.filter(call => !call.cleanup).length, 1);
				job.close();
				assert.equal(
					fs.existsSync(`${outputDocx}.word.lock`),
					outcome === 'cleanup',
				);
				assert.equal(
					fs.existsSync(path.dirname(job.inputDocx)),
					outcome === 'cleanup',
				);
				assert.equal(
					calls[0].timeout,
					600_000,
					'full native post-build must not inherit a 45 second deadline',
				);
			},
		);
	}
}
