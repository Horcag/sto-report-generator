import { spawnSync } from 'node:child_process';
import path from 'node:path';

interface AcceptanceStatistics {
	figures: number;
	tables: number;
	sources: number;
	replacements: Record<string, string>;
}

export function readAcceptanceStatistics(
	inputDocx: string,
): AcceptanceStatistics {
	const result = spawnSync(
		'uv',
		[
			'run',
			'python',
			'-m',
			'scripts.sto_post_build.acceptance_statistics',
			path.resolve(inputDocx),
		],
		{
			cwd: path.resolve(__dirname, '..', '..'),
			encoding: 'utf8',
			shell: false,
		},
	);
	if (result.error) throw result.error;
	if (result.status !== 0) {
		throw new Error(
			result.stderr || result.stdout || 'DOCX statistic counting failed.',
		);
	}
	return JSON.parse(result.stdout) as AcceptanceStatistics;
}
