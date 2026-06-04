import {
	formatSourcePreflightIssue,
	runSourcePreflight,
} from '@/shared/lib/source-preflight';

/**
 * Regression tests for STO report source quality.
 * Usage: npx tsx tests/source-preflight/regression_checks.ts <reports_dir>
 */
function main(): void {
	const reportsDir = process.argv[2];
	if (!reportsDir) {
		console.error(
			'Usage: npx tsx tests/source-preflight/regression_checks.ts <reports_dir>',
		);
		process.exit(1);
	}

	const result = runSourcePreflight(reportsDir);
	if (!result.passed) {
		console.error('\nRegression Tests Failed:');
		for (const item of result.issues) {
			console.error(formatSourcePreflightIssue(item));
		}
		process.exit(1);
	}

	console.log('All regression tests passed. No source STO violations found.');
}

main();
