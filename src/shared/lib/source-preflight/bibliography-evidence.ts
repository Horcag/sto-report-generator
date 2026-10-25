import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { isFutureDate, parseIsoDate } from './bibliography-date';
import { BibEntrySource } from './bibtex-source';
import { SourcePreflightIssue } from './types';
import { issue } from './utils';

export const BIBLIOGRAPHY_EVIDENCE_FILE = 'bibliography-evidence.json';

export interface BibliographyEvidenceSource {
	url: string;
	locator: string;
	fields: string[];
}

export interface BibliographyEvidenceEntry {
	entryHash: string;
	checkedAt: string;
	status: 'verified' | 'needs-review';
	sources: BibliographyEvidenceSource[];
	doiStatus: 'verified' | 'not-found' | 'not-applicable';
	doiReason?: string;
}

export interface BibliographyEvidence {
	version: 1;
	entries: Record<string, BibliographyEvidenceEntry>;
}

/** Bind a review to parsed metadata, independent of field order and whitespace. */
export function bibliographyEntryHash(entry: BibEntrySource): string {
	const tags = Object.entries(entry.tags)
		.filter(([, value]) => Boolean(value?.trim()))
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([key, value]) => [key.toLowerCase(), value!.trim()]);
	return createHash('sha256')
		.update(
			JSON.stringify([entry.entryType.toLowerCase(), entry.key, tags]),
		)
		.digest('hex');
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isHttpUrl(value: unknown): value is string {
	if (typeof value !== 'string') return false;
	try {
		const url = new URL(value);
		return (
			['https:', 'http:'].includes(url.protocol) &&
			!url.username &&
			!url.password
		);
	} catch {
		return false;
	}
}

export function validateBibliographyEvidence(
	bibPath: string,
	entries: readonly BibEntrySource[],
	issues: SourcePreflightIssue[],
	required = false,
): void {
	if (entries.length === 0) return;
	const evidencePath = path.join(
		path.dirname(bibPath),
		BIBLIOGRAPHY_EVIDENCE_FILE,
	);
	const fail = (code: string, message: string) =>
		issues.push(
			issue(
				`bibliography-evidence-${code}`,
				message,
				BIBLIOGRAPHY_EVIDENCE_FILE,
			),
		);
	if (!fs.existsSync(evidencePath)) {
		if (required)
			fail(
				'missing',
				'Bibliography evidence is required. Verify each cited source and save bibliography-evidence.json.',
			);
		return;
	}
	let manifest: unknown;
	try {
		manifest = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
	} catch {
		fail('invalid', 'Bibliography evidence must be valid JSON.');
		return;
	}
	if (
		!isRecord(manifest) ||
		manifest.version !== 1 ||
		!isRecord(manifest.entries)
	) {
		fail(
			'invalid',
			'Bibliography evidence requires version: 1 and an entries object.',
		);
		return;
	}
	for (const entry of entries) {
		const review = Object.hasOwn(manifest.entries, entry.key)
			? manifest.entries[entry.key]
			: undefined;
		if (!isRecord(review)) {
			fail('unreviewed', `Cited @${entry.key} has no source review.`);
			continue;
		}
		if (review.entryHash !== bibliographyEntryHash(entry)) {
			fail(
				'stale',
				`Metadata for @${entry.key} changed after review. Verify the changed fields before updating its hash.`,
			);
		}
		if (review.status !== 'verified')
			fail(
				'unresolved',
				`Cited @${entry.key} still needs source review.`,
			);
		if (
			typeof review.checkedAt !== 'string' ||
			!parseIsoDate(review.checkedAt) ||
			isFutureDate(review.checkedAt)
		) {
			fail(
				'date',
				`Review of @${entry.key} needs a real, non-future checkedAt date (YYYY-MM-DD).`,
			);
		}
		const covered = new Set<string>();
		if (!Array.isArray(review.sources) || review.sources.length === 0) {
			fail(
				'sources',
				`Review of @${entry.key} needs source URLs and locators.`,
			);
		} else {
			for (const source of review.sources) {
				if (
					!isRecord(source) ||
					!isHttpUrl(source.url) ||
					typeof source.locator !== 'string' ||
					source.locator.trim().length < 10 ||
					!Array.isArray(source.fields) ||
					!source.fields.length ||
					!source.fields.every(
						field =>
							typeof field === 'string' && Boolean(field.trim()),
					)
				) {
					fail(
						'sources',
						`Review of @${entry.key} has an invalid source, locator, or field list.`,
					);
					continue;
				}
				for (const field of source.fields) covered.add(field);
			}
		}
		const missing = Object.entries(entry.tags)
			.filter(
				([field, value]) =>
					value?.trim() && field !== 'langid' && !covered.has(field),
			)
			.map(([field]) => field);
		if (missing.length)
			fail(
				'fields',
				`Review of @${entry.key} does not identify evidence for: ${missing.join(', ')}.`,
			);
		const hasDoi = Boolean(entry.tags.doi?.trim());
		if (
			hasDoi
				? review.doiStatus !== 'verified'
				: !['not-found', 'not-applicable'].includes(
						String(review.doiStatus),
					)
		) {
			fail(
				'doi',
				`Review of @${entry.key} needs a DOI finding consistent with the cited version.`,
			);
		}
		if (
			!hasDoi &&
			(typeof review.doiReason !== 'string' ||
				review.doiReason.trim().length < 10)
		) {
			fail(
				'doi',
				`Explain which source was checked for a DOI of @${entry.key}, or why DOI is inapplicable.`,
			);
		}
	}
}
