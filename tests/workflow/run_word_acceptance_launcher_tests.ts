import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
	detectWordAcceptanceHost,
	runWordAcceptance,
} from '@/app/word-acceptance';

interface FakePowerShellEnvironment {
	root: string;
	logPath: string;
}

function isWslWordHost(): boolean {
	try {
		return detectWordAcceptanceHost() === 'wsl';
	} catch {
		return false;
	}
}

function createFakePowerShell(): FakePowerShellEnvironment {
	const root = mkdtempSync(path.join(os.tmpdir(), 'sto-word-launcher-test-'));
	const binDirectory = path.join(root, 'bin');
	const logPath = path.join(root, 'powershell.log');
	const executable = path.join(binDirectory, 'powershell.exe');
	mkdirSync(binDirectory);
	writeFileSync(
		executable,
		`#!/bin/sh
printf '%s|%s\\n' "$*" "\${WINDOWS_CONSOLE_VISIBLE:-}" >> "$WORD_ACCEPTANCE_TEST_LOG"
case "$*" in
  *stop_word_acceptance.ps1*) exit "\${WORD_ACCEPTANCE_TEST_CLEANUP_STATUS:-0}" ;;
  *word_acceptance.ps1*)
    if [ "$WINDOWS_CONSOLE_VISIBLE" = "1" ]; then
      for request do :; done
      request_local="$(wslpath -u "$request")"
      manifest_host="$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).manifest)' "$request_local")"
      manifest_local="$(wslpath -u "$manifest_host")"
      if [ "$WORD_ACCEPTANCE_TEST_MALFORMED_MANIFEST" = "1" ]; then
        printf '%s' '{malformed manifest' > "$manifest_local"
      else
        printf '%s' '{"status":"pendingCleanup","execution":{}}' > "$manifest_local"
      fi
      exit 0
    fi
    exit 1
    ;;
esac
exit 2
`,
		'utf8',
	);
	chmodSync(executable, 0o755);
	return { root, logPath };
}

function hostRequestPath(logPath: string): string {
	const cleanupLine = readFileSync(logPath, 'utf8')
		.split('\n')
		.find(line => line.includes('stop_word_acceptance.ps1'));
	assert.ok(cleanupLine, 'the cleanup verifier must be invoked');
	const match = cleanupLine.match(/-RequestJson\s+([^|\s]+)/);
	assert.ok(match, 'cleanup invocation must include its request receipt');
	const conversion = spawnSync('wslpath', ['-u', match[1]], {
		encoding: 'utf8',
	});
	assert.equal(conversion.status, 0, conversion.stderr);
	return conversion.stdout.trim();
}

function isAcceptanceAttempt(line: string): boolean {
	return (
		line.includes('word_acceptance.ps1') &&
		!line.includes('stop_word_acceptance.ps1')
	);
}

function withFakePowerShell(
	cleanupStatus: string,
	malformedManifest: boolean,
	test: (environment: FakePowerShellEnvironment) => void,
): void {
	const environment = createFakePowerShell();
	const previousPath = process.env.PATH;
	const previousLogPath = process.env.WORD_ACCEPTANCE_TEST_LOG;
	const previousCleanupStatus =
		process.env.WORD_ACCEPTANCE_TEST_CLEANUP_STATUS;
	const previousMalformedManifest =
		process.env.WORD_ACCEPTANCE_TEST_MALFORMED_MANIFEST;
	process.env.PATH = `${path.join(environment.root, 'bin')}${path.delimiter}${previousPath ?? ''}`;
	process.env.WORD_ACCEPTANCE_TEST_LOG = environment.logPath;
	process.env.WORD_ACCEPTANCE_TEST_CLEANUP_STATUS = cleanupStatus;
	if (malformedManifest) {
		process.env.WORD_ACCEPTANCE_TEST_MALFORMED_MANIFEST = '1';
	} else {
		delete process.env.WORD_ACCEPTANCE_TEST_MALFORMED_MANIFEST;
	}
	try {
		test(environment);
	} finally {
		if (previousPath === undefined) delete process.env.PATH;
		else process.env.PATH = previousPath;
		if (previousLogPath === undefined)
			delete process.env.WORD_ACCEPTANCE_TEST_LOG;
		else process.env.WORD_ACCEPTANCE_TEST_LOG = previousLogPath;
		if (previousCleanupStatus === undefined) {
			delete process.env.WORD_ACCEPTANCE_TEST_CLEANUP_STATUS;
		} else {
			process.env.WORD_ACCEPTANCE_TEST_CLEANUP_STATUS =
				previousCleanupStatus;
		}
		if (previousMalformedManifest === undefined) {
			delete process.env.WORD_ACCEPTANCE_TEST_MALFORMED_MANIFEST;
		} else {
			process.env.WORD_ACCEPTANCE_TEST_MALFORMED_MANIFEST =
				previousMalformedManifest;
		}
		rmSync(environment.root, { recursive: true, force: true });
	}
}

function testSuccessfulAcceptanceCleansItsReceipt(): void {
	withFakePowerShell('0', false, environment => {
		const inputDocx = path.join(environment.root, 'input.docx');
		writeFileSync(inputDocx, 'not a real docx', 'utf8');

		runWordAcceptance({ inputDocx });

		const manifest = JSON.parse(
			readFileSync(
				inputDocx.replace(/\.docx$/, '.acceptance.json'),
				'utf8',
			),
		);
		assert.equal(manifest.status, 'accepted');
		assert.equal(manifest.execution.processCleanupVerified, true);

		const lines = readFileSync(environment.logPath, 'utf8').split('\n');
		assert.equal(lines.filter(isAcceptanceAttempt).length, 2);
		assert.equal(
			lines.filter(line => line.includes('stop_word_acceptance.ps1'))
				.length,
			2,
			'every completed attempt must use the cleanup verifier',
		);
		assert.match(
			lines.find(
				line => isAcceptanceAttempt(line) && line.endsWith('|1'),
			) ?? '',
			/word_acceptance\.ps1/,
		);
		assert.equal(
			existsSync(path.dirname(hostRequestPath(environment.logPath))),
			false,
		);
	});
}

function testUnverifiedCleanupRetainsReceiptAndPreventsRetry(): void {
	withFakePowerShell('1', false, environment => {
		const inputDocx = path.join(environment.root, 'input.docx');
		writeFileSync(inputDocx, 'not a real docx', 'utf8');

		assert.throws(
			() => runWordAcceptance({ inputDocx }),
			/cleanup could not prove that its owned processes exited/,
		);

		const lines = readFileSync(environment.logPath, 'utf8').split('\n');
		assert.equal(lines.filter(isAcceptanceAttempt).length, 1);
		assert.equal(
			lines.filter(line => line.includes('stop_word_acceptance.ps1'))
				.length,
			1,
		);
		assert.equal(existsSync(hostRequestPath(environment.logPath)), true);
	});
}

function testMalformedSuccessfulManifestRetainsReceipt(): void {
	withFakePowerShell('0', true, environment => {
		const inputDocx = path.join(environment.root, 'input.docx');
		const manifestPath = inputDocx.replace(/\.docx$/, '.acceptance.json');
		writeFileSync(inputDocx, 'not a real docx', 'utf8');

		assert.throws(() => runWordAcceptance({ inputDocx }), SyntaxError);

		const lines = readFileSync(environment.logPath, 'utf8').split('\n');
		assert.equal(
			lines.filter(isAcceptanceAttempt).length,
			2,
			'a malformed successful manifest must not trigger another attempt',
		);
		assert.equal(
			lines.filter(line => line.includes('stop_word_acceptance.ps1'))
				.length,
			2,
		);
		assert.equal(existsSync(hostRequestPath(environment.logPath)), true);
		assert.doesNotMatch(readFileSync(manifestPath, 'utf8'), /accepted/);
	});
}

function main(): void {
	if (!isWslWordHost()) {
		console.log(
			'Word acceptance launcher tests skipped: WSL host required.',
		);
		return;
	}
	testSuccessfulAcceptanceCleansItsReceipt();
	testUnverifiedCleanupRetainsReceiptAndPreventsRetry();
	testMalformedSuccessfulManifestRetainsReceipt();
	console.log('Word acceptance launcher tests passed.');
}

main();
