const assert = require('node:assert/strict');
const { test } = require('node:test');

const { validateAuditReports } = require('../check_security_audit.cjs');

const cleanReport = {
	metadata: { vulnerabilities: { total: 0 } },
	vulnerabilities: {},
};

const picomatchReport = {
	metadata: { vulnerabilities: { high: 1, total: 1 } },
	vulnerabilities: {
		cspell: {
			name: 'cspell',
			severity: 'high',
			via: ['cspell-lib'],
			fixAvailable: {
				name: 'cspell',
				version: '8.19.0',
				isSemVerMajor: true,
			},
		},
		picomatch: {
			name: 'picomatch',
			severity: 'high',
			via: [
				{
					source: 1247710,
					name: 'picomatch',
					url: 'https://github.com/advisories/GHSA-fc5q-39xc-vjpf',
					severity: 'high',
					range: '<=4.0.7',
				},
			],
			fixAvailable: {
				name: 'steiger',
				version: '0.5.4',
				isSemVerMajor: true,
			},
		},
	},
};

test('passes when both production and full reports are clean', () => {
	assert.deepEqual(validateAuditReports(cleanReport, cleanReport), []);
});

test('allows only documented unpatched dev-only advisory when production is clean', () => {
	assert.deepEqual(validateAuditReports(cleanReport, picomatchReport), [
		'picomatch (https://github.com/advisories/GHSA-fc5q-39xc-vjpf, range <=4.0.7)',
	]);
});

test('rejects any production vulnerability even for waived advisory', () => {
	assert.throws(
		() => validateAuditReports(picomatchReport, picomatchReport),
		/Production dependency vulnerabilities detected/,
	);
});

test('rejects any other advisory in devDependencies', () => {
	const otherDevReport = {
		metadata: { vulnerabilities: { moderate: 1, total: 1 } },
		vulnerabilities: {
			other: {
				name: 'other',
				severity: 'moderate',
				via: [
					{
						name: 'other',
						url: 'https://github.com/advisories/GHSA-0000-0000-0000',
						severity: 'moderate',
					},
				],
			},
		},
	};
	assert.throws(
		() => validateAuditReports(cleanReport, otherDevReport),
		/Disallowed npm audit advisory/,
	);
});

test('rejects once a non-breaking patch for waived package is published', () => {
	const patchedPicomatch = structuredClone(picomatchReport);
	patchedPicomatch.vulnerabilities.picomatch.fixAvailable = {
		name: 'picomatch',
		version: '4.0.8',
		isSemVerMajor: false,
	};
	assert.throws(
		() => validateAuditReports(cleanReport, patchedPicomatch),
		/Upstream fix available for picomatch/,
	);
});
