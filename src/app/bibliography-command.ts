import { auditBibliography } from './bibliography-audit';
import { ParsedArgs } from './cli-args';

export function runBibliographyCommand(args: ParsedArgs): void {
	const reportDir = args.positionals[1];
	if (!reportDir)
		throw new Error('bibliography requires a report directory.');
	const result = auditBibliography(
		reportDir,
		args.options.has('require-evidence'),
	);
	if (args.options.has('json')) {
		console.log(JSON.stringify(result, null, 2));
	} else {
		console.log(
			`Bibliography: ${result.citationOrder.length} cited sources.`,
		);
		for (const entry of result.entries) {
			console.log(`@${entry.key} (${entry.type}) ${entry.entryHash}`);
			for (const query of entry.searchQueries)
				console.log(`  Search: ${query}`);
		}
		for (const issue of result.issues)
			console.error(`${issue.severity}: ${issue.code}: ${issue.message}`);
		console.log(
			result.passed
				? 'Bibliography audit passed.'
				: 'Bibliography audit failed.',
		);
	}
	if (!result.passed) process.exitCode = 1;
}
