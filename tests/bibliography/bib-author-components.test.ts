import assert from 'node:assert/strict';

import { formatBibItem } from '../../src/features/markdown-parser/lib/utils/bib-formatter';

// Lecture bibliography templates, pp. 14–17 and 24–26.
for (const [author, expected] of [
	['Iwana, Brian Kenji', 'Iwana, B. K. Study / B. K. Iwana.'],
	['Brian Kenji Iwana', 'Brian Kenji Iwana. Study / Brian Kenji Iwana.'],
	['Iwana, B.K.', 'Iwana, B. K. Study / B. K. Iwana.'],
	['Иванов, Иван Иванович', 'Иванов, И. И. Study / И. И. Иванов.'],
	['{Council of Others}', 'Study / Council of Others.'],
	['{{Research Council}}', 'Study / Research Council.'],
	[
		'de la Cruz, Jr, Juan Carlos',
		'de la Cruz, J. C., Jr. Study / J. C. de la Cruz, Jr.',
	],
	[
		'Ludwig van Beethoven',
		'Ludwig van Beethoven. Study / Ludwig van Beethoven.',
	],
	['van Beethoven, Ludwig', 'van Beethoven, L. Study / L. van Beethoven.'],
	['Smith, Anne-Marie', 'Smith, A.-M. Study / A.-M. Smith.'],
	[
		'{Research and Development Council}',
		'Study / Research and Development Council.',
	],
	[
		'{Research and Development Council} and Iwana, Brian Kenji',
		'Study / Research and Development Council, B. K. Iwana.',
	],
] as const) {
	assert.equal(
		formatBibItem({
			citationKey: 'author-name',
			entryType: 'book',
			entryTags: { title: 'Study', author, langid: 'english' },
		}),
		expected,
	);
}
for (const entryType of ['book', 'article', 'inproceedings', 'incollection']) {
	for (const count of [4, 5]) {
		const author = [
			'One, Alice',
			'Two, Bob',
			'Three, Carol',
			'Four, Dan',
			'Five, Eve',
		]
			.slice(0, count)
			.join(' and ');
		assert.equal(
			formatBibItem({
				citationKey: `authors-${count}`,
				entryType,
				entryTags: { title: 'Study', author, langid: 'english' },
			}),
			`Study / A. One, B. Two, C. Three${count === 4 ? ', D. Four' : ' [et al.]'}.`,
		);
	}
}
for (const entryType of ['article', 'inproceedings', 'incollection']) {
	assert.equal(
		formatBibItem({
			citationKey: 'component-doi',
			entryType,
			entryTags: {
				title: 'Study',
				...(entryType === 'article'
					? { journal: 'Journal' }
					: { booktitle: 'Proceedings' }),
				doi: 'doi: 10.1234/study',
				isbn: '123',
				bibliographicnote: 'Note',
			},
		}),
		'Study. – DOI: 10.1234/study // ' +
			(entryType === 'article' ? 'Journal' : 'Proceedings') +
			'. – Note. – ISBN 123.',
	);
}
assert.equal(
	formatBibItem({
		citationKey: 'book-doi',
		entryType: 'book',
		entryTags: { title: 'Study', doi: 'https://doi.org/10.1234/book' },
	}),
	'Study. – DOI 10.1234/book.',
);

console.log('Bibliography author/component regression tests passed.');
