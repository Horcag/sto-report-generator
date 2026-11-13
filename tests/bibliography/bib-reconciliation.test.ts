import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { auditBibliography } from '@/app/bibliography-audit';
import {
	BibliographyLookupEntry,
	bibliographySearchQueries,
} from '@/app/bibliography-lookup';
import {
	reconcileBibliography,
	validateExtractedReferences,
} from '@/app/bibliography-reconciliation';

const paper: BibliographyLookupEntry = {
	key: 'paper',
	type: 'article',
	fields: {
		title: 'Distinctive study of synthetic rivers',
		doi: '10.1234/rivers',
	},
};
const dataset: BibliographyLookupEntry = {
	key: 'data',
	type: 'online',
	fields: {
		title: 'Synthetic river observations archive',
		type: 'набор данных',
		url: 'https://data.example/record/river',
	},
};
const inventory = [paper, dataset];
const strings = [
	'1 Distinctive study of synthetic rivers. DOI: 10.1234/rivers.',
	'2 Synthetic river observations archive. https://data.example/record/river',
];
const compare = (texts: string[], entries = inventory) =>
	reconcileBibliography(entries, texts);
assert.equal(compare(strings).passed, true);
assert.deepEqual(compare(strings).references[0].matchedBy, [
	'title',
	'identifier',
]);
assert.equal(
	compare([
		'Distinctive study of synthetic rivers',
		'Synthetic river observations archive',
	]).passed,
	true,
);
assert.equal(compare([strings.join(' ')]).references[0].status, 'merged');
const mergedConflict = compare([
	`${strings[0]} ${strings[1].replace('https://data.example/record/river', 'https://typo.example/record/river')}`,
]);
assert.equal(mergedConflict.references[0].status, 'merged');
assert.equal(mergedConflict.references[0].identifierConflict, true);
assert.deepEqual(
	mergedConflict.references[0].candidates.map(candidate => candidate.key),
	['paper', 'data'],
);
assert.equal(compare([strings[0], strings[0]]).references[0].status, 'split');
assert.equal(compare([strings[0], strings[0]]).references[1].status, 'split');
assert.equal(
	compare([strings[0], strings[0]]).references[0].duplicateNumber,
	true,
);
assert.deepEqual(compare([strings[0]]).notObserved, [
	{ key: 'data', referenceNumber: 2 },
]);
assert.equal(
	compare(['1 Unknown institutional page']).references[0].status,
	'number-only',
);
assert.equal(
	compare(['Unknown institutional page']).references[0].status,
	'unmatched',
);
assert.equal(
	compare(['1 Distinctive study of synthetic rivers. 10.1234/wrong'])
		.references[0].status,
	'identifier-conflict',
);
assert.equal(compare([...strings].reverse()).references[0].orderMismatch, true);
assert.equal(
	compare([strings[0].replace(/^1/, '2'), strings[1]]).references[0]
		.numberMismatch,
	true,
);
const homonym = {
	...paper,
	key: 'other',
	fields: { ...paper.fields, doi: '10.1234/other' },
};
assert.equal(
	compare(['Distinctive study of synthetic rivers'], [paper, homonym])
		.references[0].status,
	'ambiguous',
);
assert.equal(
	compare([strings[0]], [paper, homonym]).references[0].status,
	'matched',
);
assert.deepEqual(
	compare([strings[0]], [paper, homonym]).references[0].candidates,
	[{ key: 'paper', referenceNumber: 1 }],
);
assert.equal(
	compare(['10.1234/rivers'], [paper, { ...paper, key: 'duplicate' }])
		.references[0].status,
	'ambiguous',
);
assert.equal(
	compare(['https://data.example/record/RIVER'], [dataset]).references[0]
		.status,
	'unmatched',
);
assert.equal(
	compare(['https://DATA.EXAMPLE/record/river'], [dataset]).references[0]
		.status,
	'matched',
);
const extendedTitle = {
	...paper,
	key: 'extended',
	fields: { title: `${paper.fields.title} and coastal flows` },
};
assert.deepEqual(
	compare([extendedTitle.fields.title], [paper, extendedTitle]).references[0]
		.candidates,
	[{ key: 'extended', referenceNumber: 2 }],
);
assert.equal(
	compare(
		[`${paper.fields.title}. ${extendedTitle.fields.title}`],
		[paper, extendedTitle],
	).references[0].status,
	'merged',
);
const preprint = {
	key: 'preprint',
	type: 'techreport',
	fields: {
		title: 'Versioned synthetic model comparison',
		archiveprefix: 'arXiv',
		eprint: '2401.12345v2',
		url: 'https://arxiv.org/abs/2401.12345v2',
	},
};
assert.equal(
	compare(['https://arxiv.org/abs/2401.12345v2'], [preprint]).passed,
	true,
);
assert.equal(
	compare(
		['Versioned synthetic model comparison. arXiv:2401.12345v1'],
		[preprint],
	).references[0].status,
	'identifier-conflict',
);
const shortTitle = {
	key: 'calibration',
	type: 'online',
	fields: {
		title: 'Probability calibration',
		url: 'https://docs.example/calibration.html',
	},
};
const shortRow =
	'1 Probability calibration / Example developers. – URL: https://typo.example/calibration.html';
const shortResult = compare([shortRow], [shortTitle]);
assert.equal(shortResult.references[0].status, 'identifier-conflict');
assert.deepEqual(shortResult.notObserved, []);
assert.deepEqual(shortResult.references[0].candidates, [
	{ key: 'calibration', referenceNumber: 1 },
]);
assert.equal(
	compare(['1 Probability calibration / Example developers.'], [shortTitle])
		.references[0].status,
	'matched',
);
assert.equal(
	compare(
		[
			'[1] Probability calibration [Электронный ресурс] / Example developers.',
		],
		[shortTitle],
	).references[0].status,
	'matched',
);
assert.equal(
	compare(['Probability calibration / Example developers.'], [shortTitle])
		.references[0].status,
	'unmatched',
);
assert.equal(
	compare(
		[
			'1 An unrelated discussion of Probability calibration / Example developers.',
		],
		[shortTitle],
	).references[0].status,
	'number-only',
);
assert.equal(
	compare(
		['1 Probability calibration without heading delimiter'],
		[shortTitle],
	).references[0].status,
	'number-only',
);
assert.equal(
	compare(['2 Probability calibration / Example developers.'], [shortTitle])
		.references[0].status,
	'unmatched',
);
assert.equal(
	compare(
		[
			'1 Probability calibration / Developers.',
			'1 Probability calibration / Developers.',
		],
		[shortTitle],
	).references[0].status,
	'number-only',
);
assert.equal(
	compare(
		['1 Probability calibration / Developers.'],
		[
			shortTitle,
			{
				...shortTitle,
				key: 'homonym',
				fields: {
					...shortTitle.fields,
					url: 'https://other.example/page',
				},
			},
		],
	).references[0].status,
	'ambiguous',
);
assert.equal(
	compare(
		['1 Probability calibration / Developers. https://other.example/page'],
		[
			shortTitle,
			{
				...shortTitle,
				key: 'homonym',
				fields: {
					...shortTitle.fields,
					url: 'https://other.example/page',
				},
			},
		],
	).references[0].numberMismatch,
	true,
);
const versionedData = {
	...dataset,
	fields: {
		title: dataset.fields.title,
		url: dataset.fields.url,
		version: '2.4',
	},
};
assert.ok(
	bibliographySearchQueries(versionedData).some(query =>
		query.includes('version 2.4'),
	),
);
assert.ok(
	!bibliographySearchQueries(preprint).some(query =>
		query.includes('government'),
	),
);
assert.ok(
	!bibliographySearchQueries(shortTitle).some(query =>
		query.includes('government'),
	),
);
assert.ok(
	bibliographySearchQueries(shortTitle).some(
		query =>
			query.includes('site:docs.example') &&
			query.includes('documentation'),
	),
);
assert.ok(
	bibliographySearchQueries({
		key: 'gov',
		type: 'online',
		fields: {
			title: 'Official observations',
			url: 'https://data.gov/observations',
		},
	}).some(query => query.includes('government publication')),
);

for (const value of [null, {}, [''], [12], ['valid', null]])
	assert.throws(() => validateExtractedReferences(value), /JSON array/);
assert.deepEqual(validateExtractedReferences([]), []);
assert.ok(
	bibliographySearchQueries(paper).includes('https://doi.org/10.1234/rivers'),
);
assert.ok(
	bibliographySearchQueries(paper).some(query =>
		query.includes('Crossref DataCite'),
	),
);
assert.ok(
	bibliographySearchQueries(dataset).some(query =>
		query.includes('dataset repository version'),
	),
);
assert.ok(
	!bibliographySearchQueries(dataset).some(query =>
		query.includes('Crossref'),
	),
);
assert.ok(
	bibliographySearchQueries(preprint).includes(
		'https://arxiv.org/abs/2401.12345v2',
	),
);
assert.ok(
	bibliographySearchQueries({
		key: 'gov',
		type: 'online',
		fields: {
			title: 'Public institutional statistics',
			organization: 'Statistics office',
		},
	}).some(query => query.includes('Statistics office official website')),
);

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sto-bib-reconcile-'));
try {
	fs.writeFileSync(
		path.join(root, '00_metadata.md'),
		'---\nbibliography: references.bib\n---\n',
	);
	fs.writeFileSync(path.join(root, '03_intro.md'), 'A source [@paper].\n');
	fs.writeFileSync(
		path.join(root, 'references.bib'),
		'@article{paper,author={Smith, Jane},title={Distinctive study of synthetic rivers},journal={Synthetic Journal},year={2020},pages={1--5},doi={10.1234/rivers},langid={english}}',
	);
	assert.equal('reconciliation' in auditBibliography(root), false);
	assert.equal(
		auditBibliography(root, false, [strings[0]]).reconciliation?.passed,
		true,
	);
	const input = path.join(root, 'extracted.json');
	const cli = (...args: string[]) =>
		spawnSync(
			process.execPath,
			[
				require.resolve('tsx/cli'),
				'src/index.ts',
				'bibliography',
				root,
				...args,
			],
			{ encoding: 'utf8' },
		);
	fs.writeFileSync(input, JSON.stringify([strings[0]]));
	const success = cli('--extracted', input, '--json');
	assert.equal(success.status, 0, success.stderr);
	assert.equal(JSON.parse(success.stdout).reconciliation.passed, true);
	fs.writeFileSync(input, JSON.stringify(['Unmatched external reference']));
	const failure = cli('--extracted', input, '--json');
	assert.equal(failure.status, 1);
	assert.equal(
		JSON.parse(failure.stdout).passed,
		true,
		'Source audit remains separate from reconciliation',
	);
	assert.equal(
		JSON.parse(failure.stdout).reconciliation.references[0].status,
		'unmatched',
	);
	assert.ok(cli('--extracted', input).stdout.includes('requires review'));
	fs.writeFileSync(input, JSON.stringify({ references: [] }));
	assert.equal(cli('--extracted', input).status, 1);
	assert.match(cli('--extracted').stderr, /requires a path/);
	fs.writeFileSync(input, '{invalid');
	assert.equal(cli('--extracted', input).status, 1);
	console.log(
		'PASS bibliography reconciliation: matching, merged/split, ambiguous identifiers, title homonyms, order, input validation, type-aware lookup and CLI integration.',
	);
} finally {
	fs.rmSync(root, { recursive: true, force: true });
}
