import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export function prepareWordcraftDocx(
	source: string,
	destination: string,
	pages: number,
	timeoutMs = 30_000,
): { warnings: string[] } {
	const root = path.resolve(__dirname, '..', '..');
	const python = path.join(
		root,
		'.venv',
		process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python',
	);
	if (!fs.existsSync(python)) {
		throw new Error(
			'Wordcraft statistic preparation requires the project Python environment. Run uv sync in the installed generator directory.',
		);
	}
	const result = spawnSync(
		python,
		[
			'-m',
			'scripts.sto_post_build.wordcraft_statistics',
			path.resolve(source),
			path.resolve(destination),
			String(pages),
		],
		{
			cwd: root,
			env: {
				...process.env,
				TMPDIR: path.dirname(path.resolve(destination)),
				TEMP: path.dirname(path.resolve(destination)),
				TMP: path.dirname(path.resolve(destination)),
			},
			encoding: 'utf8',
			shell: false,
			timeout: timeoutMs,
			killSignal: 'SIGKILL',
			maxBuffer: 1024 * 1024,
		},
	);
	if (result.error || result.status !== 0) {
		throw new Error(
			`Wordcraft statistic preparation failed: ${result.error?.message ?? result.stderr ?? result.stdout}`,
		);
	}
	return JSON.parse(result.stdout) as { warnings: string[] };
}
