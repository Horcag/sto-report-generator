import fs from 'node:fs';

import { auditBibliography } from './bibliography-audit';
import { validateExtractedReferences } from './bibliography-reconciliation';
import { ParsedArgs } from './cli-args';

export function runBibliographyCommand(args: ParsedArgs): void {
	const reportDir = args.positionals[1];
	if (!reportDir)
		throw new Error('bibliography requires a report directory.');
	const extractedPath = args.options.get('extracted');
	if (
		extractedPath !== undefined &&
		(typeof extractedPath !== 'string' || !extractedPath.trim())
	)
		throw new Error(
			'--extracted requires a path to a JSON array of reference strings.',
		);
	const extracted =
		typeof extractedPath === 'string'
			? validateExtractedReferences(
					JSON.parse(fs.readFileSync(extractedPath, 'utf8')),
				)
			: undefined;
	const result = auditBibliography(
		reportDir,
		args.options.has('require-evidence'),
		extracted,
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
		if (result.reconciliation) {
			console.log(result.reconciliation.basis);
			for (const reference of result.reconciliation.references)
				console.log(
					`  Extracted ${reference.index}: ${reference.status}; candidates: ${reference.candidates.map(candidate => `${candidate.referenceNumber} @${candidate.key}`).join(', ') || 'none'}${reference.numberMismatch ? '; number mismatch' : ''}${reference.orderMismatch ? '; order mismatch' : ''}${reference.duplicateNumber ? '; duplicate number' : ''}`,
				);
			for (const entry of result.reconciliation.notObserved)
				console.log(
					`  Not observed in extracted strings: ${entry.referenceNumber} @${entry.key}`,
				);
		}
		if (result.reconciliation)
			console.log(
				result.reconciliation.passed
					? 'Extracted-reference reconciliation passed.'
					: 'Extracted-reference reconciliation requires review.',
			);
		for (const issue of result.issues)
			console.error(`${issue.severity}: ${issue.code}: ${issue.message}`);
		console.log(
			result.passed
				? 'Bibliography audit passed.'
				: 'Bibliography audit failed.',
		);
	}
	if (!result.passed || result.reconciliation?.passed === false)
		process.exitCode = 1;
}
