import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { stageWordcraftCommand } from '@/app/wordcraft-command';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sto-font-command-'));
try {
	const plain = [
		'run',
		'--file',
		'source.docx',
		'--cmd',
		'document.layout',
		'--print',
	];
	assert.equal(stageWordcraftCommand(plain), plain);
	const scripted = ['run', '--script', 'existing.json', '--print'];
	assert.equal(stageWordcraftCommand(scripted), scripted);
	const fontPath = 'C:\\Fonts with spaces\\шрифт.ttf';
	const args = [
		'run',
		'--file',
		'source.docx',
		'--cmd',
		`font.add=${JSON.stringify({ path: fontPath })}`,
		'--cmd',
		'references.updateFields',
		'--save',
		'result.pdf',
		'--print',
	];
	assert.throws(() => stageWordcraftCommand(args), /staging storage/);
	const command = stageWordcraftCommand(args, directory);
	assert.deepEqual(command, [
		'run',
		'--script',
		path.join(directory, 'command.json'),
		'--print',
	]);
	const script = JSON.parse(fs.readFileSync(command[2], 'utf8'));
	assert.deepEqual(script, {
		file: 'source.docx',
		commands: [
			{ command: 'font.add', params: { path: fontPath } },
			{ command: 'references.updateFields' },
		],
		save: ['result.pdf'],
	});
	assert.deepEqual(args.slice(-3), ['--save', 'result.pdf', '--print']);
	const large = Array.from({ length: 600 }, (_, index) => [
		'--cmd',
		`font.add=${JSON.stringify({ path: fontPath + index })}`,
	]).flat();
	const staged = stageWordcraftCommand(
		['run', '--file', 'source.docx', ...large],
		directory,
	);
	assert.equal(
		JSON.parse(fs.readFileSync(staged[2], 'utf8')).commands.length,
		600,
	);
	assert.ok(staged.join(' ').length < 500);
	assert.throws(
		() => stageWordcraftCommand([...args, '--unknown', 'x'], directory),
		/Unsupported/,
	);
	assert.throws(
		() => stageWordcraftCommand([...args, '--save'], directory),
		/requires a value/,
	);
	assert.throws(
		() =>
			stageWordcraftCommand(['run', '--cmd', 'font.add=bad'], directory),
		SyntaxError,
	);
	assert.throws(
		() =>
			stageWordcraftCommand(
				[
					'run',
					'--cmd',
					`font.add=${JSON.stringify({ data: 'x'.repeat(4 * 1024 * 1024) })}`,
				],
				directory,
			),
		/4 MiB/,
	);
	console.log(
		'Wordcraft command staging tests passed: structured paths, long Windows commands, limits and malformed arguments.',
	);
} finally {
	fs.rmSync(directory, { recursive: true, force: true });
}
