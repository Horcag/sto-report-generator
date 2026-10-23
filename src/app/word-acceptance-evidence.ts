import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import type { WordAcceptancePlan } from './word-acceptance';

export function getFileEvidence(filePath: string): {
	exists: boolean;
	path: string;
	sha256?: string;
	sizeBytes?: number;
} {
	if (!fs.existsSync(filePath)) return { exists: false, path: filePath };
	const bytes = fs.readFileSync(filePath);
	return {
		exists: true,
		path: filePath,
		sha256: createHash('sha256').update(bytes).digest('hex'),
		sizeBytes: bytes.length,
	};
}

export function writeWordAcceptanceFailureManifest(
	plan: WordAcceptancePlan,
	backgroundFailure: string,
	interactiveFailure: string | null,
	cleanupVerified = true,
	preserveContentIntegrityFailure = false,
): void {
	if (preserveContentIntegrityFailure && cleanupVerified) {
		try {
			const existing = JSON.parse(
				fs.readFileSync(plan.localManifest, 'utf8'),
			);
			if (
				existing.status === 'failed' &&
				existing.failure?.stage === 'contentIntegrity'
			) {
				existing.execution.requestedMode = 'background-only';
				existing.execution.processCleanupVerified = cleanupVerified;
				fs.writeFileSync(
					plan.localManifest,
					`${JSON.stringify(existing, null, 2)}\n`,
					'utf8',
				);
				return;
			}
		} catch {
			// Missing or malformed receipts are replaced with a readable failure.
		}
	}
	const evidence = `${backgroundFailure}\n${interactiveFailure ?? ''}`;
	const lastStage =
		[
			...(interactiveFailure ?? '').matchAll(
				/Word acceptance stage: ([a-z-]+)\./g,
			),
		].at(-1)?.[1] ??
		[
			...backgroundFailure.matchAll(
				/Word acceptance stage: ([a-z-]+)\./g,
			),
		].at(-1)?.[1] ??
		null;
	const pageMatches = [
		...evidence.matchAll(/DOCX saved with (\d+) pages\./g),
	];
	const lastPageMatch = pageMatches.at(-1);
	const pageCount = lastPageMatch ? Number(lastPageMatch[1]) : null;
	const acceptedDocx = getFileEvidence(plan.localAcceptedDocx);
	const pdf = getFileEvidence(plan.localPdf);
	const manifest = {
		schemaVersion: plan.request.schemaVersion,
		renderer: 'word-desktop-interactive',
		status: 'failed',
		execution: {
			requestedMode: plan.backgroundOnly ? 'background-only' : 'auto',
			completedMode: null,
			attemptedModes: plan.request.attemptedModes,
			processCleanupVerified: cleanupVerified,
		},
		capabilityChecks: {
			openedDocx: evidence.includes('staged DOCX opened.'),
			updatedFieldsAndToc: evidence.includes(
				'fields, TOC, and pagination updated.',
			),
			repaginated: evidence.includes(
				'fields, TOC, and pagination updated.',
			),
			savedAcceptedDocx: acceptedDocx.exists,
			exportedPdf: pdf.exists,
			reopenedAcceptedDocx: false,
			stablePageCount: false,
		},
		officeLicenseDiagnostic: {
			status: 'warning',
			message: evidence.includes('---NOTIFICATIONS---, 0xC004F009')
				? 'Microsoft Word reported ---NOTIFICATIONS---, 0xC004F009; capability verification continued.'
				: 'The Office licensing diagnostic did not block capability verification.',
		},
		printer: {
			restoredSystemDefault: evidence.includes(
				'Restored and verified Windows default printer:',
			),
		},
		pageCountBeforeFailure: pageCount,
		lastWordStage: lastStage,
		acceptedDocx,
		pdf,
		failure: {
			stage:
				pageCount !== null && !pdf.exists
					? 'exportPdf'
					: (lastStage ?? 'wordDesktopAcceptance'),
			backgroundAttempt: backgroundFailure,
			interactiveAttempt: interactiveFailure,
		},
	};
	fs.mkdirSync(path.dirname(plan.localManifest), { recursive: true });
	fs.writeFileSync(
		plan.localManifest,
		`${JSON.stringify(manifest, null, 2)}\n`,
		'utf8',
	);
}
