import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import AdmZip from 'adm-zip';

import { buildReport } from '@/app/builder';
import { assertPreservedParagraphOrder } from '@/app/word-acceptance-integrity';
import {
	compileSvgToShapeGroup,
	planFigure,
	validateFigureSettings,
} from '@/shared/lib/figures';
import { validateSTO } from '@/shared/lib/sto-validator';

const COMPLEX_DIAGRAM_SVG = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="480" height="260" viewBox="0 0 480 260">
  <defs>
    <style>.box { fill: #eef4fb; stroke: #1f4e78; stroke-width: 2; } .lbl { font-family: "Times New Roman"; font-size: 16px; fill: #111111; }</style>
    <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
      <path d="M 0 1 L 10 5 L 0 9 z" fill="#1f4e78"/>
    </marker>
    <marker id="diamond" viewBox="0 0 12 12" refX="6" refY="6" markerWidth="8" markerHeight="8" orient="auto">
      <path d="M 0 6 L 6 0 L 12 6 L 6 12 Z" fill="#1f4e78"/>
    </marker>
    <circle id="nodePin" cx="0" cy="0" r="4" fill="#1f4e78"/>
  </defs>
  <rect class="box" x="40" y="30" width="130" height="54" rx="8" ry="8"/>
  <ellipse cx="340" cy="57" rx="68" ry="28" fill="#ffffff" stroke="#1f4e78" stroke-width="2" transform="rotate(-15 340 57)"/>
  <line x1="170" y1="57" x2="270" y2="57" stroke="#1f4e78" stroke-width="2" marker-end="url(#arrow)"/>
  <polyline points="105,84 105,150 270,150" fill="none" stroke="#333333" stroke-width="2" stroke-dasharray="6 3"/>
  <polygon points="340,115 415,150 340,185 265,150" fill="#fff7e6" stroke="#b26a00" stroke-width="2"/>
  <path d="M 105 180 C 140 230 220 230 250 180 S 330 190 360 220" fill="none" stroke="#2c7a7b" stroke-width="2" marker-start="url(#diamond)"/>
  <path d="M 40 215 H 90 V 235" fill="none" stroke="#555555" stroke-width="1.5"/>
  <use href="#nodePin" x="170" y="57"/>
  <text class="lbl" x="105" y="57" text-anchor="middle" dominant-baseline="middle">Блок <tspan font-weight="bold">ввода</tspan></text>
  <text class="lbl" x="340" y="57" text-anchor="middle" dominant-baseline="central">Фильтр α</text>
  <text class="lbl" x="340" y="150" text-anchor="middle" dominant-baseline="middle">Проверка ≥ 0</text>
  <text class="lbl" x="18" y="130" text-anchor="middle" transform="rotate(-90 18 130)">Ось Y (Гц)</text>
</svg>`;

const ONE_PIXEL_PNG = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC',
	'base64',
);

async function run(): Promise<void> {
	const validated = validateFigureSettings({
		defaults: { svgMode: 'shapes', minTextPt: 8 },
		figures: { fig1: { svgMode: 'image' }, fig2: { svgMode: 'shapes' } },
	});
	assert.equal(validated.defaults.svgMode, 'shapes');
	assert.throws(
		() =>
			validateFigureSettings({
				defaults: { svgMode: 'vector' },
				figures: {},
			}),
		/Invalid figure svgMode/,
	);

	const runTest = compileSvgToShapeGroup({
		svgXml: COMPLEX_DIAGRAM_SVG,
		figureId: 'complex',
		widthMm: 120,
		heightMm: 65,
		title: 'Title',
		description: 'Схема',
	});
	assert.ok(runTest);

	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sto-svg-shapes-'));
	try {
		fs.mkdirSync(path.join(root, 'images'), { recursive: true });
		fs.writeFileSync(
			path.join(root, 'images', 'diagram.svg'),
			COMPLEX_DIAGRAM_SVG,
		);
		fs.writeFileSync(path.join(root, 'images', 'pixel.png'), ONE_PIXEL_PNG);
		fs.writeFileSync(
			path.join(root, 'images', 'bad.svg'),
			'<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><foreignObject width="10" height="10"/></svg>',
		);
		fs.writeFileSync(
			path.join(root, 'images', 'empty.svg'),
			'<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect x="10" y="10" width="80" height="80" fill="#eee"/></svg>',
		);

		const shapesPlan = planFigure(
			root,
			'images/diagram.svg',
			'diagram',
			validateFigureSettings({
				defaults: { svgMode: 'shapes', minTextPt: 8 },
				figures: {},
			}),
		);
		assert.equal(shapesPlan.svgMode, 'shapes');
		assert.equal(shapesPlan.fallbackPath, undefined);
		assert.equal(
			shapesPlan.issues.some(i => i.code === 'low-dpi'),
			false,
		);
		assert.equal(
			shapesPlan.issues.some(
				i => i.code === 'svg-baseline-compatibility',
			),
			false,
		);
		assert.ok(shapesPlan.minTextPt && shapesPlan.minTextPt > 9);

		const emptyPlan = planFigure(
			root,
			'images/empty.svg',
			'empty',
			validateFigureSettings({
				defaults: { svgMode: 'shapes' },
				figures: {},
			}),
		);
		assert.ok(emptyPlan.issues.some(i => i.code === 'unknown-text-size'));

		const inheritedRasterPlan = planFigure(
			root,
			'images/pixel.png',
			'pixel',
			validateFigureSettings({
				defaults: { svgMode: 'shapes' },
				figures: {},
			}),
		);
		assert.equal(inheritedRasterPlan.type, 'png');
		assert.equal(inheritedRasterPlan.svgMode, undefined);

		assert.throws(
			() =>
				planFigure(
					root,
					'images/pixel.png',
					'pixel',
					validateFigureSettings({
						defaults: {},
						figures: { pixel: { svgMode: 'shapes' } },
					}),
				),
			/only supported for SVG/,
		);
		assert.throws(
			() =>
				planFigure(
					root,
					'images/bad.svg',
					'bad',
					validateFigureSettings({
						defaults: { svgMode: 'shapes' },
						figures: {},
					}),
				),
			/Unsupported SVG element/,
		);

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
			path.join(root, 'figures.json'),
			JSON.stringify({ defaults: { svgMode: 'shapes', minTextPt: 8 } }),
		);
		fs.writeFileSync(
			path.join(root, '00.md'),
			'---\ntitle: Векторные схемы\n---\n\n# Архитектура системы\n\nНа рисунке 1 показана схема.\n\n![Схема](images/diagram.svg)\n\nРисунок 1 – Схема обработки (@fig:diagram)\n',
		);

		const docxPath = path.join(root, 'build', 'report.docx');
		await buildReport(root, docxPath);
		const zip = new AdmZip(docxPath);
		const docXml = zip.readAsText('word/document.xml');
		const stylesXml = zip.readAsText('word/styles.xml');
		assert.match(docXml, /<wpg:wgp\b/u);
		assert.match(docXml, /<wps:txbx\b/u);
		assert.match(docXml, /<w:pStyle w:val="DiagramText"/u);
		assert.match(docXml, /<a:headEnd\b[^>]*type="diamond"/u);
		assert.match(docXml, /<a:tailEnd\b[^>]*type="triangle"/u);
		assert.match(
			docXml,
			/<wps:bodyPr\b[^>]*vert="vert270"[^>]*wrap="square"/u,
		);
		assert.match(docXml, /<a:chOff x="0" y="0"\/>/u);
		assert.match(docXml, /Блок /u);
		assert.match(docXml, /Фильтр α/u);
		assert.doesNotMatch(docXml, /<pic:pic\b/u);
		assert.match(stylesXml, /w:styleId="DiagramText"/u);
		assert.doesNotMatch(
			stylesXml.match(
				/<w:style\b[^>]*w:styleId="DiagramText"[\s\S]*?<\/w:style>/u,
			)?.[0] ?? '',
			/<w:basedOn w:val="Normal"/u,
		);

		const unpackDir = path.join(root, 'unpacked');
		zip.extractAllTo(unpackDir, true);
		const failedChecks = validateSTO(unpackDir).filter(r => !r.passed);
		assert.deepEqual(failedChecks, []);
		assert.doesNotThrow(() =>
			assertPreservedParagraphOrder(docXml, docXml),
		);

		console.log('SVG to Word native ShapeGroupRun tests passed.');
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
	}
}

run().catch(error => {
	console.error(error);
	process.exit(1);
});
