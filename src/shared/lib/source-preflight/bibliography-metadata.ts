import path from 'node:path';

import { BibEntrySource, getNormalizedTagValue } from './bibtex-source';
import { SourcePreflightIssue } from './types';
import { issue } from './utils';

function validIsbn(value: string): boolean {
	const text = value.replace(/[\s-]/g, '').toUpperCase();
	if (/^\d{9}[\dX]$/.test(text)) {
		return (
			[...text].reduce(
				(sum, char, index) =>
					sum + (char === 'X' ? 10 : Number(char)) * (10 - index),
				0,
			) %
				11 ===
			0
		);
	}
	return (
		/^(978|979)\d{10}$/.test(text) &&
		[...text].reduce(
			(sum, char, index) => sum + Number(char) * (index % 2 ? 3 : 1),
			0,
		) %
			10 ===
			0
	);
}

function validIssn(value: string): boolean {
	const text = value.replace(/[\s-]/g, '').toUpperCase();
	return (
		/^\d{7}[\dX]$/.test(text) &&
		[...text].reduce(
			(sum, char, index) =>
				sum + (char === 'X' ? 10 : Number(char)) * (8 - index),
			0,
		) %
			11 ===
			0
	);
}

export function normalizeDoi(value: string): string {
	return value
		.trim()
		.replace(/^(?:https?:\/\/(?:dx\.)?doi\.org\/|doi\s*:\s*)/i, '')
		.toLowerCase();
}

export function validateBibliographyMetadata(
	bibPath: string,
	entries: readonly BibEntrySource[],
	issues: SourcePreflightIssue[],
): void {
	const doiOwners = new Map<string, string>();
	for (const entry of entries) {
		const add = (
			code: string,
			message: string,
			severity: 'error' | 'warning' = 'error',
		) =>
			issues.push(
				issue(
					`bibliography-${code}`,
					`@${entry.key}: ${message}`,
					path.basename(bibPath),
					entry.line,
					severity,
				),
			);
		const doi = getNormalizedTagValue(entry, 'doi');
		const isbn = getNormalizedTagValue(entry, 'isbn');
		if (isbn && !validIsbn(isbn))
			add(
				'isbn-invalid',
				'ISBN has an invalid length, prefix, or check digit. Recheck the publication, including edition and format.',
			);
		const issn = getNormalizedTagValue(entry, 'issn');
		if (issn && !validIssn(issn))
			add('issn-invalid', 'ISSN has an invalid length or check digit.');
		const year = getNormalizedTagValue(entry, 'year');
		const period = year?.match(/^(\d{4})\s*(?:--|[-–])\s*(\d{4})?$/);
		const continuingSite =
			['online', 'inonline', 'misc'].includes(entry.entryType) &&
			period &&
			(!period[2] || Number(period[1]) <= Number(period[2]));
		if (year && !/^\d{4}$/.test(year) && !continuingSite)
			add(
				'year-invalid',
				'year must contain the four-digit publication year. Only online/inonline/misc resources may use a continuing YYYY– or YYYY–YYYY period; put versions and other dates in their own fields.',
			);
		if (/\band\s+others\s*$/i.test(entry.tags.author ?? ''))
			add(
				'authors-truncated',
				'supply the full source author list so the formatter can apply the correct heading and four/five-author rule.',
				'warning',
			);
		if (doi) {
			const normalized = normalizeDoi(doi);
			if (
				!/^10\.\d{4,9}\/\S+$/i.test(normalized) ||
				/[\u200b-\u200f\ufeff]/.test(doi)
			) {
				add(
					'doi-invalid-syntax',
					'DOI must contain a registrant and suffix, e.g. 10.1234/example, without whitespace or invisible characters.',
				);
			}
			const owner = doiOwners.get(normalized);
			if (owner)
				add(
					'duplicate-doi',
					`same DOI as @${owner}; check whether these are duplicate citations or distinct versions.`,
				);
			else doiOwners.set(normalized, entry.key);
		}
		const url = getNormalizedTagValue(entry, 'url');
		const urlDoi = url?.match(/^https?:\/\/(?:dx\.)?doi\.org\/(.+)$/i)?.[1];
		if (doi && urlDoi && normalizeDoi(urlDoi) !== normalizeDoi(doi)) {
			add(
				'doi-url-mismatch',
				'doi and the DOI in url identify different resources.',
			);
		}
		const pages = getNormalizedTagValue(entry, 'pages');
		const range = pages?.match(/^(\d+)\s*(?:--|[-–])\s*(\d+)$/);
		if (range && Number(range[1]) > Number(range[2]))
			add('pages-reversed', 'page range ends before it starts.');
		if (
			['online', 'misc'].includes(entry.entryType) &&
			/(?:\bproceedings\b|\bpp\.\s*\d|\bvol\.\s*\d|\bjournal\b)/i.test(
				getNormalizedTagValue(entry, 'note') ?? '',
			)
		) {
			add(
				'container-in-note',
				'publication metadata appears in note; verify the cited version and use journal/booktitle/volume/pages in a supported article or component type where appropriate.',
				'warning',
			);
		}
	}
}
