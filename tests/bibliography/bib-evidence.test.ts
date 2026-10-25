import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { auditBibliography } from '@/app/bibliography-audit';
import { runSourcePreflight } from '@/shared/lib/source-preflight';
import {
	bibliographyEntryHash,
	BibliographyEvidence,
	validateBibliographyEvidence,
} from '@/shared/lib/source-preflight/bibliography-evidence';
import { validateBibliographyMetadata } from '@/shared/lib/source-preflight/bibliography-metadata';
import { BibEntrySource } from '@/shared/lib/source-preflight/bibtex-source';
import { SourcePreflightIssue } from '@/shared/lib/source-preflight/types';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sto-bib-evidence-'));
const bibPath = path.join(root, 'references.bib');
const manifestPath = path.join(root, 'bibliography-evidence.json');
const entry: BibEntrySource = {
	entryType: 'article',
	key: 'paper',
	line: 1,
	tags: {
		author: 'Smith, Jane',
		title: 'A verified source',
		journal: 'Journal',
		year: '2020',
		pages: '10--19',
		doi: '10.1234/paper',
		langid: 'english',
	},
};
const review = (): BibliographyEvidence => ({
	version: 1,
	entries: {
		paper: {
			entryHash: bibliographyEntryHash(entry),
			checkedAt: '2020-01-01',
			status: 'verified',
			doiStatus: 'verified',
			sources: [
				{
					url: 'https://publisher.example/paper',
					locator: 'Publisher article metadata and DOI record',
					fields: Object.keys(entry.tags),
				},
			],
		},
	},
});
let cases = 0;
function evidenceCodes(
	value: unknown,
	entries = [entry],
	required = true,
): string[] {
	if (value === undefined) fs.rmSync(manifestPath, { force: true });
	else fs.writeFileSync(manifestPath, JSON.stringify(value));
	const issues: SourcePreflightIssue[] = [];
	validateBibliographyEvidence(bibPath, entries, issues, required);
	cases++;
	return issues.map(issue => issue.code);
}
function metadataCodes(entries: BibEntrySource[]): string[] {
	const issues: SourcePreflightIssue[] = [];
	validateBibliographyMetadata(bibPath, entries, issues);
	cases++;
	return issues.map(issue => issue.code);
}
function expectEvidence(
	code: string,
	mutate: (value: BibliographyEvidence) => void,
) {
	const value = review();
	mutate(value);
	assert.ok(
		evidenceCodes(value).includes(`bibliography-evidence-${code}`),
		code,
	);
}

try {
	assert.deepEqual(evidenceCodes(undefined, [entry], false), []);
	assert.ok(
		evidenceCodes(undefined).includes('bibliography-evidence-missing'),
	);
	assert.deepEqual(evidenceCodes(review()), []);
	assert.deepEqual(evidenceCodes(undefined, []), []);
	assert.ok(
		evidenceCodes({ version: 2, entries: {} }).includes(
			'bibliography-evidence-invalid',
		),
	);
	assert.ok(evidenceCodes(null).includes('bibliography-evidence-invalid'));
	expectEvidence('unreviewed', value => {
		delete value.entries.paper;
	});
	expectEvidence('unresolved', value => {
		value.entries.paper.status = 'needs-review';
	});
	expectEvidence('stale', value => {
		value.entries.paper.entryHash = 'old';
	});
	expectEvidence('date', value => {
		value.entries.paper.checkedAt = '2020-02-30';
	});
	expectEvidence('date', value => {
		value.entries.paper.checkedAt = '2999-01-01';
	});
	expectEvidence('sources', value => {
		value.entries.paper.sources = [];
	});
	expectEvidence('sources', value => {
		value.entries.paper.sources[0].url = 'javascript:alert(1)';
	});
	expectEvidence('sources', value => {
		value.entries.paper.sources[0].url =
			'https://user:secret@publisher.example/paper';
	});
	expectEvidence('sources', value => {
		value.entries.paper.sources[0].locator = 'ok';
	});
	expectEvidence('sources', value => {
		value.entries.paper.sources[0].fields = [];
	});
	expectEvidence('fields', value => {
		value.entries.paper.sources[0].fields = ['title'];
	});
	expectEvidence('doi', value => {
		value.entries.paper.doiStatus = 'not-found';
	});
	const noDoi = { ...entry, tags: { ...entry.tags, doi: undefined } };
	const absent = review();
	absent.entries.paper.entryHash = bibliographyEntryHash(noDoi);
	absent.entries.paper.doiStatus = 'not-found';
	absent.entries.paper.doiReason =
		'Publisher catalog and original article have no DOI.';
	assert.deepEqual(evidenceCodes(absent, [noDoi]), []);
	delete absent.entries.paper.doiReason;
	assert.ok(
		evidenceCodes(absent, [noDoi]).includes('bibliography-evidence-doi'),
	);
	assert.notEqual(
		bibliographyEntryHash(entry),
		bibliographyEntryHash({ ...entry, key: 'renamed' }),
	);
	assert.notEqual(
		bibliographyEntryHash(entry),
		bibliographyEntryHash({ ...entry, entryType: 'online' }),
	);
	assert.equal(
		bibliographyEntryHash(entry),
		bibliographyEntryHash({
			...entry,
			line: 70,
			tags: Object.fromEntries(Object.entries(entry.tags).reverse()),
		}),
	);
	assert.ok(
		evidenceCodes(review(), [
			{ ...entry, tags: { ...entry.tags, pages: '20--29' } },
		]).includes('bibliography-evidence-stale'),
	);
	fs.writeFileSync(manifestPath, '{broken');
	const invalidIssues: SourcePreflightIssue[] = [];
	validateBibliographyEvidence(bibPath, [entry], invalidIssues);
	assert.equal(invalidIssues[0].code, 'bibliography-evidence-invalid');
	cases++;
	assert.deepEqual(metadataCodes([entry]), []);
	assert.deepEqual(
		metadataCodes([
			{ ...entry, entryType: 'online', tags: { year: '1999 –' } },
		]),
		[],
	);
	assert.deepEqual(
		metadataCodes([
			{ ...entry, entryType: 'inonline', tags: { year: '1999–2020' } },
		]),
		[],
	);
	assert.ok(
		metadataCodes([
			{ ...entry, entryType: 'online', tags: { year: '2020–1999' } },
		]).includes('bibliography-year-invalid'),
	);
	assert.ok(
		metadataCodes([{ ...entry, tags: { year: '1999–2020' } }]).includes(
			'bibliography-year-invalid',
		),
	);
	assert.deepEqual(
		metadataCodes([
			{
				...entry,
				tags: { isbn: '978-0-306-40615-7', issn: '2049-3630' },
			},
		]),
		[],
	);
	assert.deepEqual(
		metadataCodes([
			{ ...entry, tags: { isbn: '0-306-40615-2', issn: '2434-561X' } },
		]),
		[],
	);
	assert.ok(
		metadataCodes([
			{ ...entry, tags: { isbn: '978-0-306-40615-8' } },
		]).includes('bibliography-isbn-invalid'),
	);
	assert.ok(
		metadataCodes([{ ...entry, tags: { issn: '2049-3631' } }]).includes(
			'bibliography-issn-invalid',
		),
	);
	assert.ok(
		metadataCodes([{ ...entry, tags: { year: '2020a' } }]).includes(
			'bibliography-year-invalid',
		),
	);
	assert.ok(
		metadataCodes([
			{ ...entry, tags: { author: 'Smith, J. and others' } },
		]).includes('bibliography-authors-truncated'),
	);
	assert.ok(
		metadataCodes([{ ...entry, tags: { doi: '10.invalid' } }]).includes(
			'bibliography-doi-invalid-syntax',
		),
	);
	assert.ok(
		metadataCodes([{ ...entry, tags: { doi: '10.1234/a b' } }]).includes(
			'bibliography-doi-invalid-syntax',
		),
	);
	assert.ok(
		metadataCodes([
			{ ...entry, tags: { doi: '10.1234/a\u200bb' } },
		]).includes('bibliography-doi-invalid-syntax'),
	);
	assert.ok(
		metadataCodes([
			entry,
			{
				...entry,
				key: 'duplicate',
				tags: { doi: 'https://doi.org/10.1234/PAPER' },
			},
		]).includes('bibliography-duplicate-doi'),
	);
	assert.ok(
		metadataCodes([
			{
				...entry,
				tags: { doi: '10.1234/a', url: 'https://doi.org/10.1234/b' },
			},
		]).includes('bibliography-doi-url-mismatch'),
	);
	assert.ok(
		metadataCodes([{ ...entry, tags: { pages: '99--1' } }]).includes(
			'bibliography-pages-reversed',
		),
	);
	assert.ok(
		metadataCodes([
			{
				...entry,
				entryType: 'online',
				tags: { note: 'Proceedings of a conference, vol. 10, pp. 2-5' },
			},
		]).includes('bibliography-container-in-note'),
	);
	assert.deepEqual(
		metadataCodes([
			{
				...entry,
				entryType: 'online',
				tags: {
					title: 'Dataset release',
					note: 'Version frozen for reproducibility',
				},
			},
		]),
		[],
	);
	fs.writeFileSync(
		bibPath,
		'@article{paper,author={Smith, Jane},title={A verified source},journal={Journal},year={2020},pages={10--19},doi={10.1234/paper},langid={english}}',
	);
	fs.writeFileSync(
		path.join(root, '00_metadata.md'),
		'---\nbibliography: references.bib\nbibliographyEvidence: required\n---\n',
	);
	fs.writeFileSync(path.join(root, '03_intro.md'), 'Источник [@paper].\n');
	fs.rmSync(manifestPath);
	assert.ok(
		runSourcePreflight(root).issues.some(
			issue => issue.code === 'bibliography-evidence-missing',
		),
	);
	cases++;
	fs.writeFileSync(manifestPath, JSON.stringify(review()));
	const result = auditBibliography(root, true);
	assert.equal(result.passed, true);
	assert.deepEqual(result.citationOrder, ['paper']);
	assert.equal(result.entries[0].entryHash, bibliographyEntryHash(entry));
	assert.ok(result.entries[0].searchQueries[0].includes('A verified source'));
	cases++;
	const tsx = require.resolve('tsx/cli');
	fs.writeFileSync(
		path.join(root, '03_intro.md'),
		'| Source | Value |\n|---|---|\n| [@paper] | control |\n',
	);
	assert.deepEqual(auditBibliography(root, true).citationOrder, ['paper']);
	cases++;
	const cli = (...args: string[]) =>
		spawnSync(
			process.execPath,
			[tsx, 'src/index.ts', 'bibliography', root, '--json', ...args],
			{ encoding: 'utf8' },
		);
	const success = cli('--require-evidence');
	assert.equal(success.status, 0, success.stderr);
	assert.equal(JSON.parse(success.stdout).entries.length, 1);
	cases++;
	fs.rmSync(manifestPath);
	const failure = cli('--require-evidence');
	assert.equal(failure.status, 1);
	assert.ok(
		JSON.parse(failure.stdout).issues.some(
			(issue: SourcePreflightIssue) =>
				issue.code === 'bibliography-evidence-missing',
		),
	);
	cases++;
	for (const entryType of ['article', 'inproceedings', 'incollection']) {
		fs.rmSync(manifestPath, { force: true });
		fs.writeFileSync(
			path.join(root, '00_metadata.md'),
			'---\nbibliography: references.bib\n---\n',
		);
		fs.writeFileSync(
			bibPath,
			`@${entryType}{paper,author={Smith, Jane},title={A verified source},${entryType === 'article' ? 'journal={Journal}' : 'booktitle={Collection},address={City}'},year={2020},eid={e12345}}`,
		);
		const issues = runSourcePreflight(root).issues;
		assert.ok(
			!issues.some(
				issue => issue.code === 'bibliography-required-field-missing',
			),
			JSON.stringify(issues),
		);
		cases++;
	}
	console.log(
		`PASS bibliography evidence: ${cases} validation scenarios, CLI success/failure and source-preflight integration.`,
	);
} finally {
	fs.rmSync(root, { recursive: true, force: true });
}
