import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

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

console.log('CI configuration tests passed.');
