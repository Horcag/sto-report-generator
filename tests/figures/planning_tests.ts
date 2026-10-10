import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { Document, Packer } from 'docx';

import { parseMarkdownToDocx } from '@/features/markdown-parser';
import {
	FigurePlan,
	loadFigureSettings,
	planFigure,
	validateFigureSettings,
} from '@/shared/lib/figures';
import { validateFigureAssetPath } from '@/shared/lib/figures/settings';

import { png } from './planning_fixtures';
import { runPngValidationTests } from './planning_png_tests';

export async function runFigurePlanningTests(): Promise<void> {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sto-figure-planning-'));
	try {
		fs.writeFileSync(path.join(root, 'wide.png'), png(1200, 600));
		fs.writeFileSync(path.join(root, 'tall.png'), png(100, 2000));
		const defaults = loadFigureSettings(root);
		const windowsRoot = String.raw`C:\Users\example\report`;
		assert.doesNotThrow(() =>
			validateFigureAssetPath(
				String.raw`C:\Users\example\report\legacy.png`,
				true,
				windowsRoot,
				path.win32,
			),
		);
		assert.doesNotThrow(() =>
			validateFigureAssetPath(
				'c:/Users/example/report/legacy.png',
				true,
				windowsRoot,
				path.win32,
			),
		);
		for (const invalid of [
			String.raw`D:\report\legacy.png`,
			'https://example.org/image.png',
			String.raw`images\legacy.png`,
			String.raw`C:\report\image.png:stream`,
			String.raw`\report\legacy.png`,
			'/Users/example/report/legacy.png',
			'//server/share/report/legacy.png',
		])
			assert.throws(
				() =>
					validateFigureAssetPath(
						invalid,
						true,
						windowsRoot,
						path.win32,
					),
				/report-relative|escapes report directory/,
			);
		assert.throws(
			() =>
				validateFigureAssetPath(
					String.raw`C:\Users\example\report\legacy.png`,
					false,
					windowsRoot,
					path.win32,
				),
			/report-relative/,
		);
		assert.throws(
			() =>
				validateFigureAssetPath(
					String.raw`C:\Users\example\report\legacy.png`,
					true,
					'/report',
					path.posix,
				),
			/report-relative/,
		);

		const legacyRoot = path.join(root, 'report');
		fs.mkdirSync(path.join(legacyRoot, 'report'), { recursive: true });
		fs.writeFileSync(path.join(legacyRoot, 'legacy.png'), png(100, 50));
		fs.writeFileSync(
			path.join(legacyRoot, 'report', 'legacy.png'),
			png(200, 100),
		);
		fs.writeFileSync(path.join(root, 'outside.png'), png(300, 150));
		const previousCwd = process.cwd();
		try {
			process.chdir(root);
			assert.equal(
				planFigure(legacyRoot, 'report/legacy.png', 'direct', defaults)
					.intrinsicPx.width,
				200,
			);
			fs.unlinkSync(path.join(legacyRoot, 'report', 'legacy.png'));
			const copiedRoot = path.join(root, 'copied', 'report');
			fs.mkdirSync(copiedRoot, { recursive: true });
			fs.writeFileSync(
				path.join(copiedRoot, 'legacy.png'),
				png(400, 200),
			);
			assert.equal(
				planFigure(copiedRoot, 'report/legacy.png', 'copied', defaults)
					.intrinsicPx.width,
				400,
			);
			process.chdir(path.dirname(root));
			assert.equal(
				planFigure(
					legacyRoot,
					`${path.basename(root)}/report/legacy.png`,
					'cwd-fallback',
					defaults,
				).intrinsicPx.width,
				100,
			);
			process.chdir(root);

			assert.equal(
				planFigure(legacyRoot, 'report/legacy.png', 'legacy', defaults)
					.intrinsicPx.width,
				100,
			);
			assert.throws(
				() =>
					planFigure(legacyRoot, 'outside.png', 'outside', defaults),
				/escapes report directory/,
			);
			assert.equal(
				planFigure(
					legacyRoot,
					path.join(legacyRoot, 'legacy.png'),
					'absolute',
					defaults,
				).intrinsicPx.width,
				100,
			);
			assert.throws(
				() =>
					planFigure(
						legacyRoot,
						path.join(root, 'outside.png'),
						'outside',
						defaults,
					),
				/escapes report directory/,
			);
			assert.throws(
				() =>
					planFigure(legacyRoot, 'missing.png', 'configured', {
						defaults: {},
						figures: {
							configured: { source: 'report/legacy.png' },
						},
					}),
				/ENOENT/,
			);
			assert.equal(
				planFigure(legacyRoot, 'missing.png', 'repair', {
					defaults: {},
					figures: { repair: { source: 'legacy.png' } },
				}).intrinsicPx.width,
				100,
			);
			fs.writeFileSync(
				path.join(legacyRoot, 'vector.svg'),
				'<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50"><text font-size="20">Legacy</text></svg>',
			);
			fs.writeFileSync(path.join(legacyRoot, 'vector.png'), png(100, 50));
			assert.ok(
				planFigure(
					legacyRoot,
					'report/vector.svg',
					'legacy-vector',
					defaults,
				).fallbackHash,
			);
		} finally {
			process.chdir(previousCwd);
		}
		runPngValidationTests(root, defaults);
		const cropped = planFigure(root, 'wide.png', 'crop', {
			defaults: {},
			figures: {
				crop: {
					widthMm: 100,
					crop: { left: 25, right: 25, top: 0, bottom: 0 },
					textSizePx: 30,
				},
			},
		});
		assert.equal(cropped.widthMm, 100);
		assert.equal(cropped.heightMm, 100);
		assert.equal(cropped.effectiveDpi.x, 152.4);
		assert.equal(cropped.effectiveDpi.y, 152.4);
		assert.ok(
			Math.abs(cropped.minTextPt! - (((30 * 100) / 600) * 72) / 25.4) <
				1e-10,
		);
		assert.throws(
			() =>
				validateFigureSettings({
					defaults: {},
					figures: {
						crop: {
							crop: { left: 50, right: 50, top: 0, bottom: 0 },
						},
					},
				}),
			/retain positive/,
		);
		assert.throws(
			() =>
				validateFigureSettings({
					defaults: { minDpi: '150' },
					figures: {},
				}),
			/positive finite/,
		);
		assert.throws(
			() =>
				validateFigureSettings({
					defaults: {},
					figures: { crop: { source: '../outside.png' } },
				}),
			/report-relative/,
		);
		const tinyText = planFigure(root, 'wide.png', 'small', {
			defaults: {},
			figures: { small: { widthMm: 50, textSizePx: 8 } },
		});
		assert.ok(tinyText.effectiveDpi.x > 600);
		assert.ok(tinyText.issues.some(issue => issue.code === 'small-text'));
		assert.ok(!tinyText.issues.some(issue => issue.code === 'low-dpi'));
		const tall = planFigure(root, 'tall.png', 'tall', defaults);
		assert.equal(tall.heightMm, 230);
		assert.equal(tall.widthMm, 11.5);
		assert.throws(
			() =>
				planFigure(root, 'tall.png', 'tall', {
					defaults: {},
					figures: { tall: { widthMm: 100 } },
				}),
			/maximum width or height/,
		);
		fs.writeFileSync(
			path.join(root, 'vector.svg'),
			'<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="600"><g font-size="30"><text x="0" y="50">Hello</text></g></svg>',
		);
		assert.throws(
			() => planFigure(root, 'vector.svg', 'vector', defaults),
			/ENOENT/,
		);
		fs.writeFileSync(
			path.join(root, 'vector.png'),
			fs.readFileSync(path.join(root, 'vector.svg')),
		);
		assert.throws(
			() => planFigure(root, 'vector.svg', 'vector', defaults),
			/real PNG/,
		);
		fs.writeFileSync(path.join(root, 'vector.png'), png(1200, 600));
		const vector = planFigure(root, 'vector.svg', 'vector', defaults);
		assert.ok(vector.fallbackHash);
		assert.ok(vector.minTextPt! > 9);
		fs.writeFileSync(
			path.join(root, 'vector.svg'),
			'<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="600"><style>text{font-size:30px}</style><text>Hello</text></svg>',
		);
		assert.ok(
			planFigure(root, 'vector.svg', 'vector', defaults).issues.some(
				issue => issue.code === 'unknown-text-size',
			),
		);
		fs.writeFileSync(
			path.join(root, 'vector.svg'),
			'<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="600" viewBox="0 0 600 300"><path d="M0 0 L10 10"/><g font-size="15"><text x="0" y="30">Arrow label</text></g></svg>',
		);
		const inherited = planFigure(root, 'vector.svg', 'vector', defaults);
		assert.ok(
			Math.abs(
				inherited.minTextPt! -
					(((30 * inherited.heightMm) / 600) * 72) / 25.4,
			) < 1e-10,
		);
		fs.writeFileSync(path.join(root, 'vector.png'), png(100, 100));
		assert.throws(
			() => planFigure(root, 'vector.svg', 'vector', defaults),
			/aspect ratio/,
		);
		fs.writeFileSync(path.join(root, 'vector.png'), png(1200, 600));
		const corrupt = png(1200, 600);
		corrupt[41] ^= 1;
		fs.writeFileSync(path.join(root, 'corrupt.png'), corrupt);
		assert.throws(
			() => planFigure(root, 'corrupt.png', 'bad', defaults),
			/checksum/,
		);
		fs.writeFileSync(path.join(root, 'small.png'), png(100, 50));
		const replaced = planFigure(root, 'wide.png', 'replacement', {
			defaults: {},
			figures: { replacement: { source: 'small.png' } },
		});
		assert.equal(replaced.asset, 'small.png');
		assert.equal(replaced.intrinsicPx.width, 100);
		await assert.rejects(
			() =>
				parseMarkdownToDocx(
					'![Tiny](wide.png)',
					{},
					{
						sourceDir: root,
						figureSettings: {
							defaults: { quality: 'error' },
							figures: {
								'figure-1': { widthMm: 50, textSizePx: 8 },
							},
						},
					},
				),
			/smallest text/,
		);
		fs.writeFileSync(
			path.join(root, 'nested.svg'),
			'<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="600"><svg width="120" height="60" viewBox="0 0 1200 600"><text font-size="30">Nested text</text></svg></svg>',
		);
		fs.writeFileSync(path.join(root, 'nested.png'), png(1200, 600));
		const nested = planFigure(root, 'nested.svg', 'nested', defaults);
		assert.equal(nested.minTextPt, undefined);
		assert.ok(
			nested.issues.some(issue => issue.code === 'unknown-text-size'),
		);
		fs.mkdirSync(path.join(root, 'images'));
		fs.copyFileSync(
			path.join(root, 'vector.svg'),
			path.join(root, 'images', 'vector.svg'),
		);
		fs.copyFileSync(
			path.join(root, 'vector.png'),
			path.join(root, 'images', 'vector.png'),
		);
		assert.equal(
			planFigure(root, 'images/vector.svg', 'nested-fallback', defaults)
				.fallbackPath,
			path.join(fs.realpathSync(root), 'images', 'vector.png'),
		);
		assert.throws(
			() =>
				planFigure(root, 'images/vector.svg', 'explicit-fallback', {
					defaults: {},
					figures: {
						'explicit-fallback': {
							fallback: String.raw`images\vector.png`,
						},
					},
				}),
			/report-relative/,
		);
		const plans: FigurePlan[] = [];
		const children = await parseMarkdownToDocx(
			'![Description](wide.png)\n\nРисунок 1 – First (@fig:first)\n\n![Second](wide.png)\n\nРисунок 2 – Second (@fig:second)',
			{},
			{
				sourceDir: root,
				figurePlans: plans,
				figureSettings: {
					defaults: {},
					figures: {
						first: { widthMm: 100 },
						second: { widthMm: 70 },
					},
				},
			},
		);
		assert.deepEqual(
			plans.map(plan => [plan.id, plan.widthMm]),
			[
				['first', 100],
				['second', 70],
			],
		);
		assert.equal(plans[0].sourceHash, plans[1].sourceHash);
		const packed = await Packer.toBuffer(
			new Document({ sections: [{ children }] }),
		);
		assert.ok(packed.length > 0);
		const documentXml = new AdmZip(packed).readAsText('word/document.xml');
		assert.match(documentXml, /name="sto-figure:first"/u);
		assert.match(documentXml, /name="sto-figure:second"/u);
		assert.match(documentXml, /descr="Description"/u);
		assert.match(documentXml, /cx="3600000"/u);
		assert.match(documentXml, /cx="2520000"/u);
		await assert.rejects(
			() =>
				parseMarkdownToDocx(
					'![A](wide.png)\n\nРисунок 1 – A (@fig:same)\n\n![B](wide.png)\n\nРисунок 2 – B (@fig:same)',
					{},
					{ sourceDir: root },
				),
			/Duplicate figure occurrence ID/,
		);
		fs.writeFileSync(path.join(root, 'small.png'), png(100, 50));
		const natural = planFigure(root, 'small.png', 'natural', defaults);
		assert.equal(natural.widthMm, (100 * 25.4) / 96);
		assert.throws(
			() =>
				validateFigureSettings({
					defaults: { maxWidthMm: 141 },
					figures: {},
				}),
			/cannot exceed/,
		);
		assert.ok(
			cropped.issues.some(
				issue => issue.code === 'crop-content-unverified',
			),
		);
		console.log(
			'Figure planning: PNG palette/chunk ordering, reserved IDs, nested SVG unknown text, crop DPI, tiny text, tall fit, fallback and occurrence checks passed',
		);
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
	}
}

if (require.main === module)
	runFigurePlanningTests().catch(error => {
		console.error(error);
		process.exitCode = 1;
	});
