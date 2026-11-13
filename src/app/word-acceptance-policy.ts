import type { WordAcceptancePlan } from './word-acceptance';
import { writeWordAcceptanceFailureManifest } from './word-acceptance-evidence';

export function wordTimeoutMilliseconds(
	seconds: number | undefined,
): number | undefined {
	if (seconds === undefined) return undefined;
	if (!Number.isInteger(seconds) || seconds < 30 || seconds > 3600) {
		throw new Error(
			'Word timeout must be an integer from 30 to 3600 seconds.',
		);
	}
	return seconds * 1000;
}

export function assertFullWordBudget(
	plan: WordAcceptancePlan,
	failure: string,
): void {
	if (
		!plan.request.postBuildSourceDir ||
		!/Word background attempt exceeded \d+ seconds/.test(failure)
	)
		return;
	writeWordAcceptanceFailureManifest(plan, failure, null);
	throw new Error(
		`Full Word renderer exhausted its time budget; native post-build was not repeated interactively. Choose an explicit bounded budget with --word-timeout-seconds.\n${failure}`,
	);
}

export function isDeterministicDocumentFailure(evidence: string): boolean {
	if (
		/Word renderer deterministic failure \[(?:pdf-image-quality|preparation)\]|Formula replacement aborted:|Cannot uniquely restore the referat page template/.test(
			evidence,
		)
	)
		return true;
	return /Word acceptance failed: (?:Table .+ spans pages \d+-\d+\.|Required Word styles are missing:)/s.test(
		evidence,
	);
}
