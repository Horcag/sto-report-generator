import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { JSDOM, VirtualConsole } from 'jsdom';

import { runFigureCommand } from '@/app/figure-command';
import {
	createFigurePreview,
	importFigureSettings,
	inspectReportFigures,
	updateFigureSettings,
} from '@/app/figure-inspector';
import { collectFigureOccurrences } from '@/shared/lib/figures';

const report = fs.mkdtempSync(path.join(os.tmpdir(), 'figure-inspector-'));
try {
	const source = path.join(report, 'source');
	fs.mkdirSync(source);
	fs.writeFileSync(
		path.join(report, 'report.config.json'),
		JSON.stringify({ sourceDir: 'source' }),
	);
	fs.writeFileSync(
		path.join(source, 'pixel.png'),
		Buffer.from(
			'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgYGAAAAAEAAH2FzhVAAAAAElFTkSuQmCC',
			'base64',
		),
	);
	fs.writeFileSync(
		path.join(source, '10_body.md'),
		'![original](pixel.png)\n\nРисунок 1 – </script><script>window.compromised=true</script> (@fig:sample)\n\n![same asset](pixel.png)\n\n```md\n![not a figure](missing.png)\n```\n',
	);
	const split = collectFigureOccurrences([
		{ file: 'a.md', content: '![a](pixel.png)' },
		{
			file: 'b.md',
			content: 'Рисунок 1 – Split (@fig:split)\n\n![b](pixel.png)',
		},
	]);
	assert.deepEqual(
		split.map(item => [item.id, item.file]),
		[
			['split', 'a.md'],
			['figure-2', 'b.md'],
		],
		'Module boundaries preserve captions and ownership',
	);
	assert.throws(
		() =>
			collectFigureOccurrences([
				{
					file: 'x.md',
					content:
						'![a](pixel.png) ![b](pixel.png)\n\nРисунок 1 – Ambiguous (@fig:bad)',
				},
			]),
		/ambiguous/,
	);
	const imageBefore = fs.readFileSync(path.join(source, 'pixel.png'));
	const result = inspectReportFigures(report);
	assert.equal(
		result.figures.length,
		2,
		'Both real occurrences must be inspected; fenced Markdown is excluded',
	);
	assert.deepEqual(
		result.figures.map(figure => figure.plan.id),
		['sample', 'figure-2'],
	);
	assert.match(result.figures[0].dataUri, /^data:image\/png;base64,/);
	assert.equal(result.sourceDir, source);
	updateFigureSettings(report, 'sample', {
		widthMm: 50,
		textSizePx: 0.1,
		crop: { left: 10, right: 0, top: 0, bottom: 0 },
	});
	const filename = path.join(source, 'figures.json');
	const original = fs.readFileSync(filename, 'utf8');
	assert.deepEqual(
		fs.readFileSync(path.join(source, 'pixel.png')),
		imageBefore,
		'Settings never rewrite the image',
	);
	assert.equal(
		JSON.parse(original).figures.sample.widthMm,
		50,
		'Validated update must roundtrip',
	);
	assert.throws(
		() => updateFigureSettings(report, 'sample', { widthMm: 200 }),
		/exceeds/,
	);
	assert.throws(
		() =>
			updateFigureSettings(report, 'sample', {
				crop: { left: 60, right: 60, top: 0, bottom: 0 },
			}),
		/crop/,
	);
	assert.throws(
		() => updateFigureSettings(report, 'absent', { widthMm: 50 }),
		/not found/,
	);
	assert.equal(
		fs.readFileSync(filename, 'utf8'),
		original,
		'Invalid edits leave the original bytes untouched',
	);
	assert.equal(
		fs.readdirSync(source).some(name => name.endsWith('.tmp')),
		false,
	);
	const output = createFigurePreview(
		report,
		path.join(report, 'preview.html'),
	);
	const html = fs.readFileSync(output, 'utf8');
	assert.match(html, /data:image\/png;base64,/);
	assert.doesNotMatch(html, /<script>window.compromised/);
	const errors: unknown[] = [];
	const virtualConsole = new VirtualConsole();
	virtualConsole.on('jsdomError', error => errors.push(error));
	const dom = new JSDOM(html, {
		runScripts: 'dangerously',
		virtualConsole,
	});
	try {
		assert.deepEqual(errors, [], 'Generated inspector script must execute');
		assert.equal(
			dom.window.compromised,
			undefined,
			'Caption is inert data',
		);
		const document = dom.window.document;
		assert.equal(document.querySelectorAll('#selection option').length, 2);
		const width = document.getElementById('widthMm') as HTMLInputElement;
		Object.defineProperty(
			document.getElementById('placed')!.parentElement,
			'clientWidth',
			{ value: 420, configurable: true },
		);
		width.value = '60';
		width.dispatchEvent(new dom.window.Event('input'));
		assert.match(
			document.getElementById('diagnostics')!.textContent!,
			/60\.0 ×/,
		);
		assert.equal(
			(document.getElementById('placed') as HTMLElement).style.width,
			'120px',
		);
		Object.defineProperty(
			document.getElementById('placed')!.parentElement,
			'clientWidth',
			{ value: 210 },
		);
		dom.window.dispatchEvent(new dom.window.Event('resize'));
		assert.equal(
			(document.getElementById('placed') as HTMLElement).style.width,
			'60px',
			'Page preview rescales with the viewport while preserving physical size',
		);
		width.value = '200';
		width.dispatchEvent(new dom.window.Event('input'));
		assert.equal(
			(document.getElementById('download') as HTMLButtonElement).disabled,
			true,
		);
		const selection = document.getElementById(
			'selection',
		) as HTMLSelectElement;
		selection.value = '1';
		selection.dispatchEvent(new dom.window.Event('change'));
		assert.match(
			document.getElementById('diagnostics')!.textContent!,
			/неизвестно/,
		);
	} finally {
		dom.window.close();
	}
	const saved = JSON.parse(original);
	assert.throws(
		() => importFigureSettings(report, { figures: { missing: {} } }),
		/not found/,
	);
	fs.writeFileSync(filename, '{');
	importFigureSettings(report, saved);
	assert.equal(inspectReportFigures(report).figures[0].plan.widthMm, 50);
	const missingOverride = JSON.parse(original);
	missingOverride.figures.sample.source = 'missing.png';
	fs.writeFileSync(filename, JSON.stringify(missingOverride));
	updateFigureSettings(report, 'sample', { widthMm: 55 });
	assert.equal(inspectReportFigures(report).figures[0].plan.widthMm, 55);
	const messages: string[] = [];
	const originalLog = console.log;
	console.log = value => messages.push(String(value));
	try {
		const invoke = (
			action: string,
			options: Record<string, string | boolean> = {},
		) =>
			runFigureCommand({
				positionals: ['figures', action, report],
				options: new Map(Object.entries(options)),
			});
		invoke('inspect', { json: true });
		assert.match(messages.at(-1)!, /"figures"/);
		invoke('preview', { output: path.join(report, 'cli-preview.html') });
		assert.ok(fs.existsSync(path.join(report, 'cli-preview.html')));
		invoke('set', { id: 'sample', spec: '{"widthMm":70}' });
		assert.equal(inspectReportFigures(report).figures[0].plan.widthMm, 70);
		const imported = path.join(report, 'import.json');
		fs.writeFileSync(imported, original);
		invoke('set', { settings: imported });
		assert.equal(inspectReportFigures(report).figures[0].plan.widthMm, 50);
		assert.throws(() => invoke('set'), /requires --id/);
		assert.throws(() => invoke('unknown'), /inspect\|preview\|set/);
		assert.throws(
			() => invoke('set', { id: 'sample', spec: '{' }),
			SyntaxError,
		);
	} finally {
		console.log = originalLog;
	}
	console.log(
		'Figure inspector: real assets, occurrence IDs, safe labels, live controls and atomic settings passed.',
	);
} finally {
	fs.rmSync(report, { recursive: true, force: true });
}
