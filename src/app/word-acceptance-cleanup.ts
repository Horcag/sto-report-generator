import { spawnSync } from 'node:child_process';
import path from 'node:path';

import type {
	WordAcceptanceHostKind,
	WordAcceptancePlan,
} from './word-acceptance';

const PACKAGE_ROOT = path.resolve(__dirname, '..', '..');

export function stopOwnedWordAcceptanceProcesses(
	plan: WordAcceptancePlan,
	toHostPath: (kind: WordAcceptanceHostKind, absolutePath: string) => string,
): string {
	const cleanup = spawnSync(
		plan.command,
		[
			'-NoProfile',
			'-ExecutionPolicy',
			'Bypass',
			'-File',
			toHostPath(
				plan.hostKind,
				path.join(PACKAGE_ROOT, 'scripts/stop_word_acceptance.ps1'),
			),
			'-RequestJson',
			toHostPath(plan.hostKind, plan.requestJsonPath),
		],
		{ encoding: 'utf8', shell: false, timeout: 45_000, windowsHide: true },
	);
	const details = [cleanup.stdout, cleanup.stderr]
		.filter(Boolean)
		.join('\n')
		.trim();
	if (cleanup.error || cleanup.status !== 0) {
		throw new Error(
			`Word acceptance cleanup could not prove that its owned processes exited.${details ? `\n${details}` : ''}`,
		);
	}
	return details;
}
