import fs from 'node:fs';
import path from 'node:path';

/** Font paths travel as JSON, avoiding the Windows command-line length limit. */
export function stageWordcraftCommand(
	args: string[],
	directory?: string,
): string[] {
	if (
		args[0] !== 'run' ||
		args.includes('--script') ||
		!args.some(arg => arg.startsWith('font.add='))
	)
		return args;
	if (!directory)
		throw new Error('Wordcraft font commands require staging storage.');
	const script: {
		file?: string;
		commands: { command: string; params?: unknown }[];
		save?: string[];
	} = { commands: [] };
	let print = false;
	for (let index = 1; index < args.length; index++) {
		const option = args[index];
		if (option === '--print') {
			print = true;
			continue;
		}
		const value = args[++index];
		if (value === undefined)
			throw new Error(`Wordcraft ${option} requires a value.`);
		if (option === '--file') script.file = value;
		else if (option === '--save') (script.save ??= []).push(value);
		else if (option === '--cmd') {
			const separator = value.indexOf('=');
			script.commands.push(
				separator < 0
					? { command: value }
					: {
							command: value.slice(0, separator),
							params: JSON.parse(
								value.slice(separator + 1),
							) as unknown,
						},
			);
		} else
			throw new Error(`Unsupported staged Wordcraft option: ${option}`);
	}
	const content = JSON.stringify(script);
	if (Buffer.byteLength(content) > 4 * 1024 * 1024)
		throw new Error('Wordcraft font script exceeds the 4 MiB CLI limit.');
	const filename = path.join(directory, 'command.json');
	fs.writeFileSync(filename, content);
	return ['run', '--script', filename, ...(print ? ['--print'] : [])];
}
