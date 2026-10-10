import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { Document, ImageRun, Packer, Paragraph } from 'docx';

import { buildReport } from '@/app/builder';
import { applyFigureDocumentPolicy } from '@/shared/lib/docx';
import { FigurePlan } from '@/shared/lib/figures';
import { runSourcePreflight } from '@/shared/lib/source-preflight';

const pixel = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC',
	'base64',
);

async function packed(name: string): Promise<Buffer> {
	return Packer.toBuffer(
		new Document({
			sections: [
				{
					children: [
						new Paragraph({
							children: [
								new ImageRun({
									data: pixel,
									type: 'png',
									transformation: { width: 96, height: 96 },
									altText: {
										name,
										title: '',
										description: 'Original description',
									},
								}),
							],
						}),
					],
				},
			],
		}),
	);
}

async function main(): Promise<void> {
	const input = await packed('sto-figure:crop');
	const plan: FigurePlan = {
		id: 'crop',
		asset: 'source.png',
		sourcePath: 'source.png',
		sourceHash: '',
		type: 'png',
		intrinsicPx: { width: 1, height: 1 },
		widthMm: 25.4,
		heightMm: 25.4,
		crop: { left: 25, right: 10, top: 0, bottom: 5 },
		effectiveDpi: { x: 1, y: 1 },
		issues: [],
	};
	const result = applyFigureDocumentPolicy(input, [plan]);
	const before = new AdmZip(input);
	const after = new AdmZip(result);
	for (const part of ['word/settings.xml', 'word/document.xml'])
		assert.equal(
			after.readAsText(part).match(/^<\?xml[^?]*\?>/u)?.[0],
			before.readAsText(part).match(/^<\?xml[^?]*\?>/u)?.[0],
		);
	assert.match(
		after.readAsText('word/settings.xml'),
		/doNotAutoCompressPictures[^>]*w:val="true"/,
	);
	assert.match(
		after.readAsText('word/document.xml'),
		/<a:srcRect[^>]*l="25000"[^>]*r="10000"[^>]*t="0"[^>]*b="5000"/,
	);
	assert.match(after.readAsText('word/document.xml'), /Original description/);
	for (const entry of before
		.getEntries()
		.filter(item => item.entryName.startsWith('word/media/')))
		assert.deepEqual(
			after.getEntry(entry.entryName)!.getData(),
			entry.getData(),
		);
	assert.deepEqual(applyFigureDocumentPolicy(result, [plan]), result);
	assert.throws(
		() => applyFigureDocumentPolicy(input, []),
		/Missing or duplicate/,
	);
	assert.throws(
		() => applyFigureDocumentPolicy(input, [plan, plan]),
		/do not match/,
	);
	assert.throws(
		() => applyFigureDocumentPolicy(new AdmZip().toBuffer(), []),
		/requires DOCX/,
	);
	const unmanaged = await packed('unmanaged');
	assert.equal(
		new AdmZip(applyFigureDocumentPolicy(unmanaged, [])).readAsText(
			'word/document.xml',
		),
		new AdmZip(unmanaged).readAsText('word/document.xml'),
	);

	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sto-figure-builder-'));
	try {
		fs.writeFileSync(path.join(root, 'source.png'), pixel);
		fs.writeFileSync(
			path.join(root, 'report.config.json'),
			JSON.stringify({
				profile: 'lab',
				document: {
					requiredStructuralHeadings: [],
					requireSources: false,
				},
			}),
		);
		fs.writeFileSync(
			path.join(root, '00.md'),
			'---\ntitle: Figure quality\n---\n\n![Pixel](source.png)\n\nРисунок 1 – Pixel (@fig:pixel)\n',
		);
		fs.writeFileSync(
			path.join(root, 'figures.json'),
			JSON.stringify({
				figures: { pixel: { widthMm: 10, textSizePx: 1 } },
				defaults: { quality: 'error' },
			}),
		);
		const failed = runSourcePreflight(root);
		assert.ok(
			failed.issues.some(
				item =>
					item.code === 'figure-low-dpi' && item.severity === 'error',
			),
		);
		fs.writeFileSync(
			path.join(root, 'figures.json'),
			'{"defaults":{"quality":"warn"}}',
		);
		const docx = path.join(root, 'build', 'report.docx');
		await buildReport(root, docx);
		const generated = new AdmZip(docx);
		assert.match(
			generated.readAsText('word/settings.xml'),
			/doNotAutoCompressPictures/,
		);
		assert.match(
			generated.readAsText('word/document.xml'),
			/sto-figure:pixel/,
		);
		const manifest = JSON.parse(
			fs.readFileSync(
				path.join(root, 'build', 'report.figures.json'),
				'utf8',
			),
		);
		assert.equal(manifest.figures.length, 1);
		assert.equal(manifest.figures[0].id, 'pixel');
		fs.writeFileSync(path.join(root, 'figures.json'), '{');
		assert.ok(
			runSourcePreflight(root).issues.some(
				item => item.code === 'figure-plan-invalid',
			),
		);
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
	}
	console.log(
		'Figure document policy: compression, crop, media preservation, builder and preflight cases passed.',
	);
}

main().catch(error => {
	console.error(error);
	process.exit(1);
});
