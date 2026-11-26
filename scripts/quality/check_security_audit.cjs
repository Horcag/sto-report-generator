const { spawnSync } = require('node:child_process');

const UNPATCHED_DEV_ADVISORIES = {
	'https://github.com/advisories/GHSA-fc5q-39xc-vjpf': {
		packageName: 'picomatch',
	},
};

function runNpmAuditJson(extraArgs) {
	const npmExecPath = process.env.npm_execpath;
	const command = npmExecPath ? process.execPath : 'npm';
	const args = npmExecPath
		? [npmExecPath, 'audit', '--audit-level=low', '--json', ...extraArgs]
		: ['audit', '--audit-level=low', '--json', ...extraArgs];
	const result = spawnSync(command, args, {
		encoding: 'utf8',
		shell: !npmExecPath && process.platform === 'win32',
		maxBuffer: 10 * 1024 * 1024,
	});
	if (result.error) {
		throw result.error;
	}
	let parsed;
	try {
		parsed = JSON.parse(result.stdout || '{}');
	} catch (error) {
		throw new Error(
			`Failed to parse npm audit JSON (${extraArgs.join(' ') || 'default'}): ${error.message}\n${result.stderr}`,
			{ cause: error },
		);
	}
	if (parsed.error) {
		throw new Error(
			`npm audit error: ${parsed.error.summary || JSON.stringify(parsed.error)}`,
		);
	}
	if (!parsed.vulnerabilities || typeof parsed.vulnerabilities !== 'object') {
		throw new Error(
			`Unexpected npm audit JSON output (exit ${result.status}): ${result.stderr || result.stdout}`,
		);
	}
	return { status: result.status, report: parsed };
}

function validateAuditReports(prodReport, fullReport) {
	const prodEntries = Object.keys(prodReport?.vulnerabilities || {});
	const prodTotal = Number(prodReport?.metadata?.vulnerabilities?.total ?? 0);
	if (prodEntries.length > 0 || prodTotal > 0) {
		throw new Error(
			`Production dependency vulnerabilities detected (${prodEntries.join(', ') || prodTotal}).`,
		);
	}

	const vulnerabilities = fullReport?.vulnerabilities || {};
	const entries = Object.entries(vulnerabilities);
	if (entries.length === 0) {
		return [];
	}

	const waived = [];
	let directAdvisoryCount = 0;

	for (const [pkgName, vuln] of entries) {
		for (const via of vuln.via || []) {
			if (!via || typeof via !== 'object') {
				continue;
			}
			directAdvisoryCount += 1;
			const allowed = UNPATCHED_DEV_ADVISORIES[via.url];
			if (!allowed || allowed.packageName !== (via.name || pkgName)) {
				throw new Error(
					`Disallowed npm audit advisory: ${via.name || pkgName} (${via.severity || 'unknown'}) - ${via.url || via.title || 'no advisory URL'}`,
				);
			}
			if (
				vuln.fixAvailable &&
				typeof vuln.fixAvailable === 'object' &&
				vuln.fixAvailable.name === allowed.packageName &&
				!vuln.fixAvailable.isSemVerMajor
			) {
				throw new Error(
					`Upstream fix available for ${allowed.packageName} (${vuln.fixAvailable.version}); upgrade dependency and remove temporary dev waiver for ${via.url}.`,
				);
			}
			waived.push(
				`${allowed.packageName} (${via.url}, range ${via.range})`,
			);
		}
	}

	if (directAdvisoryCount === 0) {
		throw new Error(
			`Unexpected npm audit report with ${entries.length} vulnerability entries and no direct advisory objects.`,
		);
	}

	return waived;
}

if (require.main === module) {
	try {
		const prod = runNpmAuditJson(['--omit=dev']);
		const full = runNpmAuditJson([]);
		const waived = validateAuditReports(prod.report, full.report);
		if (prod.status !== 0) {
			throw new Error(
				`Production npm audit exited with status ${prod.status}.`,
			);
		}
		if (waived.length === 0) {
			console.log('Security audit passed: 0 vulnerabilities.');
		} else {
			console.log(
				`Security audit passed (0 production vulnerabilities; waived upstream-unpatched dev-only advisories: ${waived.join('; ')}).`,
			);
		}
	} catch (error) {
		console.error(error.message);
		process.exitCode = 1;
	}
}

module.exports = { UNPATCHED_DEV_ADVISORIES, validateAuditReports };
