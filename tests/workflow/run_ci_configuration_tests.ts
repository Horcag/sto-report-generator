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
assert.match(
	portableWorkflow,
	/github\.event_name != 'pull_request' \|\| github\.event\.pull_request\.head\.repo\.full_name == github\.repository/,
	'fork pull requests must not receive repository secrets',
);

assert.match(nativeWordWorkflow, /^\s{4}push:\s*$/m);
assert.match(nativeWordWorkflow, /^\s{8}branches:\s*\[master\]\s*$/m);
assert.match(nativeWordWorkflow, /^\s{4}workflow_dispatch:\s*$/m);
assert.doesNotMatch(nativeWordWorkflow, /^\s{4}pull_request(?:_target)?:\s*$/m);
assert.match(
	nativeWordWorkflow,
	/^\s{8}runs-on:\s*\[self-hosted, windows, word\]\s*$/m,
	'native Word acceptance must remain isolated from untrusted pull requests',
);
assert.match(
	nativeWordWorkflow,
	/- name: Run native Word acceptance\s+timeout-minutes: 7/m,
	'the workflow timeout must leave time for the five-minute acceptance watchdog to clean up',
);

console.log('CI configuration tests passed.');
