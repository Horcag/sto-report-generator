const assert = require('node:assert/strict');
const { test } = require('node:test');
const { validateRelease } = require('../check_release_version.cjs');

const metadata = { version: '1.1.0' };
const lock = { version: '1.1.0', packages: { '': { version: '1.1.0' } } };
const changelog = '# Changelog\n\n## 1.1.0\n';

test('accepts matching stable release metadata and tag', () => {
	assert.equal(validateRelease(metadata, lock, changelog, 'v1.1.0'), '1.1.0');
});
test('allows metadata validation before a tag exists', () => {
	assert.equal(validateRelease(metadata, lock, changelog), '1.1.0');
});
test('rejects a tag for another release', () => {
	assert.throws(
		() => validateRelease(metadata, lock, changelog, 'v1.0.0'),
		/Release tag/,
	);
});
test('rejects invalid, prerelease and zero-prefixed versions', () => {
	for (const version of ['1.1', '1.1.0-rc.1', '01.1.0', '1.1.0+build']) {
		assert.throws(
			() => validateRelease({ version }, lock, changelog),
			/MAJOR.MINOR.PATCH/,
		);
	}
});
test('rejects both lockfile version mismatches', () => {
	assert.throws(
		() =>
			validateRelease(metadata, { ...lock, version: '1.0.0' }, changelog),
		/versions differ/,
	);
	assert.throws(
		() => validateRelease(metadata, { ...lock, packages: {} }, changelog),
		/versions differ/,
	);
});
test('requires the exact changelog heading', () => {
	for (const content of ['## 1.1.00', '## 1.1.0 planned', 'text 1.1.0']) {
		assert.throws(
			() => validateRelease(metadata, lock, content),
			/release heading/,
		);
	}
});

test('rejects an older package version even when its changelog entry exists', () => {
	assert.throws(
		() => validateRelease(metadata, lock, '## 1.2.0\n\n## 1.1.0\n'),
		/release heading/,
	);
});
