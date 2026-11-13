import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { resolveReportConfig } from '@/shared/lib/report-config';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sto-word-quality-'));
const config = path.join(root, 'report.config.json');
const tsx = require.resolve('tsx/cli');
try {
	fs.writeFileSync(
		config,
		JSON.stringify({
			renderer: 'word',
			postBuild: { pdfImageQuality: 'print', exportPdf: false },
		}),
	);
	assert.equal(
		resolveReportConfig(root).config.postBuild.pdfImageQuality,
		'print',
	);
	assert.equal(resolveReportConfig(root).config.postBuild.exportPdf, false);
	assert.equal(
		resolveReportConfig(root, { pdfImageQuality: 'screen' }).config
			.postBuild.pdfImageQuality,
		'screen',
	);
	assert.equal(
		resolveReportConfig(root, { pdfImageQuality: 'original' }).config
			.postBuild.pdfImageQuality,
		'original',
	);
	assert.throws(
		() => resolveReportConfig(root, { pdfImageQuality: 'invalid' }),
		/must be original, print or screen/,
	);
	for (const renderer of ['portable', 'wordcraft']) {
		fs.writeFileSync(config, JSON.stringify({ renderer }));
		assert.equal(
			resolveReportConfig(root).config.postBuild.pdfImageQuality,
			undefined,
		);
		for (const command of ['generate', 'audit']) {
			const result = spawnSync(
				process.execPath,
				[
					tsx,
					'src/index.ts',
					command,
					root,
					'--renderer',
					renderer,
					'--pdf-image-quality',
					'print',
				],
				{ encoding: 'utf8', timeout: 60_000 },
			);
			assert.notEqual(result.status, 0);
			assert.match(
				result.stderr,
				/--pdf-image-quality requires renderer word/,
			);
		}
	}
	assert.ok(!fs.existsSync(path.join(root, 'build')));
	console.log(
		'Word PDF quality config/CLI precedence, no-PDF policy and non-Word rejection passed.',
	);
} finally {
	fs.rmSync(root, { recursive: true, force: true });
}
