import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { JSDOM } from 'jsdom';

import { renderFigureInspector } from '@/app/figure-inspector-html';
import { parseMarkdownToDocx } from '@/features/markdown-parser';
import { planFigure, type FigureSettings } from '@/shared/lib/figures';
import { runSourcePreflight } from '@/shared/lib/source-preflight';

import { png } from './planning_fixtures';

async function run(): Promise<void> {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sto-svg-baselines-'));
	try {
		fs.writeFileSync(path.join(root, 'diagram.png'), png(1200, 600));
		const settings: FigureSettings = { defaults: {}, figures: {} };
		const svg = (body: string, attributes = '') =>
			`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="600" ${attributes}>${body}</svg>`;
		const text = (attributes = '') =>
			`<text x="40" y="80" font-size="36" ${attributes}>Label</text>`;
		const write = (source: string) =>
			fs.writeFileSync(path.join(root, 'diagram.svg'), source);
		const plan = () => planFigure(root, 'diagram.svg', 'diagram', settings);
		const risky = [
			svg(text('dominant-baseline="text-before-edge"')),
			svg(text('alignment-baseline="middle"')),
			svg(`<g dominant-baseline="central">${text()}</g>`),
			svg(text(), 'dominant-baseline="hanging"'),
			svg(text('style="dominant-baseline: text-before-edge !important"')),
			svg(`<g style="alignment-baseline: text-top">${text()}</g>`),
			svg(`<style>text { dominant-baseline: middle }</style>${text()}`),
			svg(
				'<text font-size="36"><tspan alignment-baseline="text-bottom">Label</tspan></text>',
			),
			svg(
				'<text font-size="36"><textPath href="#path" dominant-baseline="central">Label</textPath></text>',
			),
			svg(text('alignment-baseline="auto"')),
			svg(text('dominant-baseline="inherit"')),
		];
		for (const source of risky) {
			write(source);
			const issue = plan().issues.find(
				item => item.code === 'svg-baseline-compatibility',
			);
			assert.ok(issue, `Missing baseline warning: ${source}`);
			assert.equal(issue.severity, 'warn');
			assert.match(issue.message, /baseline.*Word/);
			assert.equal(
				fs.readFileSync(path.join(root, 'diagram.svg'), 'utf8'),
				source,
			);
		}
		for (const source of [
			svg(text()),
			svg(text('dominant-baseline="auto"')),
			svg(
				text(
					'dominant-baseline="alphabetic" alignment-baseline="baseline"',
				),
			),
			svg(text('alignment-baseline="alphabetic"')),
			svg(text('style="--dominant-baseline: middle; fill: black"')),
			svg(
				text(
					'style="dominant-baseline: auto ! important; alignment-baseline: alphabetic !IMPORTANT"',
				),
			),
			svg(
				`<style>/* dominant-baseline: middle */ text { fill: black }</style>${text()}`,
			),
			svg(
				`<rect dominant-baseline="middle" width="10" height="10"/>${text()}`,
			),
			svg('<rect dominant-baseline="middle" width="10" height="10"/>'),
		]) {
			write(source);
			assert.ok(
				!plan().issues.some(
					item => item.code === 'svg-baseline-compatibility',
				),
				source,
			);
		}
		write(risky[0]);
		const measured = plan();
		assert.ok(
			measured.minTextPt! > 9,
			'Large measured text still needs layout diagnostics',
		);
		assert.ok(!measured.issues.some(item => item.code === 'small-text'));
		const strict = { defaults: { quality: 'error' as const }, figures: {} };
		assert.equal(
			planFigure(root, 'diagram.svg', 'diagram', strict).issues.find(
				item => item.code === 'svg-baseline-compatibility',
			)?.severity,
			'error',
		);
		const markdown =
			'![Label](diagram.svg)\n\nРисунок 1 – Label (@fig:diagram)\n';
		await assert.rejects(
			() =>
				parseMarkdownToDocx(
					markdown,
					{},
					{ sourceDir: root, figureSettings: strict },
				),
			/baseline.*Word/,
		);
		fs.writeFileSync(path.join(root, '00.md'), markdown);
		fs.writeFileSync(
			path.join(root, 'figures.json'),
			JSON.stringify(strict),
		);
		assert.ok(
			runSourcePreflight(root).issues.some(
				item =>
					item.code === 'figure-svg-baseline-compatibility' &&
					item.severity === 'error',
			),
		);
		const html = renderFigureInspector(
			[
				{
					plan: measured,
					caption: 'Label',
					module: '00.md',
					occurrence: 1,
					dataUri: `data:image/svg+xml;base64,${Buffer.from(risky[0]).toString('base64')}`,
				},
			],
			settings,
		);
		const dom = new JSDOM(html, { runScripts: 'dangerously' });
		try {
			const document = dom.window.document;
			const diagnostics = () =>
				document.getElementById('diagnostics')!.textContent!;
			assert.match(diagnostics(), /baseline.*Word/);
			const width = document.getElementById(
				'widthMm',
			) as HTMLInputElement;
			width.value = '100';
			width.dispatchEvent(new dom.window.Event('input'));
			assert.match(
				diagnostics(),
				/baseline.*Word/,
				'Changing width cannot clear a source compatibility risk',
			);
		} finally {
			dom.window.close();
		}
		console.log(
			'SVG baseline compatibility: 11 risky forms, 9 default/nontext forms, preserved source, independent font size, strict parser/preflight and live inspector passed.',
		);
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
	}
}

run().catch(error => {
	console.error(error);
	process.exitCode = 1;
});
