import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
	WORD_ACCEPTANCE_LARGE_BACKGROUND_TIMEOUT_MS,
	WORD_ACCEPTANCE_TIMEOUT_MS,
} from '@/app/word-acceptance';

const portableWorkflow = readFileSync(
	path.resolve('.github', 'workflows', 'ci.yml'),
	'utf8',
);
const nativeWordWorkflow = readFileSync(
	path.resolve('.github', 'workflows', 'native-word-acceptance.yml'),
	'utf8',
);

assert.match(portableWorkflow, /^\s{4}push:\s*$/m);
assert.match(portableWorkflow, /^\s{4}pull_request:\s*$/m);
assert.match(
	portableWorkflow,
	/^\s{4}group: .*github\.event_name.*github\.event\.pull_request\.head\.repo\.full_name.*github\.event\.pull_request\.head\.ref/m,
	'push and pull_request runs must use distinct concurrency groups',
);
assert.doesNotMatch(
	portableWorkflow,
	/\$\{\{\s*secrets\./,
	'portable CI must not access repository secrets',
);

assert.match(nativeWordWorkflow, /^\s{4}workflow_dispatch:\s*$/m);
assert.doesNotMatch(
	nativeWordWorkflow,
	/^\s{4}push:\s*$/m,
	'native Word acceptance must remain manual-only',
);
assert.doesNotMatch(nativeWordWorkflow, /^\s{4}pull_request(?:_target)?:\s*$/m);
assert.match(
	nativeWordWorkflow,
	/^\s{8}runs-on:\s*\[self-hosted, windows, word\]\s*$/m,
	'native Word acceptance must remain isolated from untrusted pull requests',
);
assert.doesNotMatch(
	nativeWordWorkflow,
	/check_word_license\.ps1/,
	'license diagnostics must not block native Word capability acceptance',
);
assert.match(nativeWordWorkflow, /\$manifest\.status -ne 'accepted'/);
assert.match(
	nativeWordWorkflow,
	/\$manifest\.execution\.processCleanupVerified/,
);

const acceptanceTimeout = nativeWordWorkflow.match(
	/- name: Run native Word acceptance\s+timeout-minutes: (\d+)/,
);
assert.ok(acceptanceTimeout, 'native Word acceptance needs a bounded step');
// Both attempts need their own 45-second cleanup, with time left for receipts.
assert.ok(
	Number(acceptanceTimeout[1]) * 60_000 >
		WORD_ACCEPTANCE_LARGE_BACKGROUND_TIMEOUT_MS +
			WORD_ACCEPTANCE_TIMEOUT_MS +
			120_000,
	'the CI step must allow both Word attempts and process cleanup to finish',
);
const jobTimeout = nativeWordWorkflow.match(/^ {8}timeout-minutes: (\d+)$/m);
assert.ok(jobTimeout, 'native Word acceptance needs a bounded job');
assert.ok(
	Number(jobTimeout[1]) >= Number(acceptanceTimeout[1]) + 5,
	'the job must also allow dependency installation and example generation',
);

console.log('CI configuration tests passed.');
