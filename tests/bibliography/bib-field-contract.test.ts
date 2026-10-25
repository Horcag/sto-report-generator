import assert from 'node:assert/strict';

import { formatBibItem } from '../../src/features/markdown-parser/lib/utils/bib-formatter';

for (const entryType of ['article', 'inproceedings', 'incollection']) {
	assert.equal(
		formatBibItem({
			citationKey: `${entryType}-publication-note`,
			entryType,
			entryTags: {
				title: 'Раздел исследования',
				...(entryType === 'article'
					? { journal: 'Журнал' }
					: { booktitle: 'Сборник' }),
				year: '2025',
				pages: '12-18',
				note: 'Дополнительное примечание',
			},
		}),
		`Раздел исследования // ${entryType === 'article' ? 'Журнал' : 'Сборник'}. – 2025. – С. 12-18. – Дополнительное примечание.`,
	);
}

for (const [entryType, field] of [
	['article', 'type'],
	['inproceedings', 'country'],
	['incollection', 'number'],
	['book', 'journal'],
	['standard', 'langid'],
	['patent', 'publisher'],
	['thesis', 'editor'],
	['phdthesis', 'journal'],
	['mastersthesis', 'issue'],
	['inonline', 'editor'],
	['report', 'address'],
	['techreport', 'note'],
	['online', 'institution'],
	['misc', 'date'],
	['book', 'entrysubtype'],
] as const) {
	assert.throws(
		() =>
			formatBibItem({
				citationKey: `unrendered-${entryType}-${field}`,
				entryType,
				entryTags: {
					title: 'Источник',
					...(entryType === 'online' || entryType === 'inonline'
						? { url: 'https://example.org/item' }
						: {}),
					[field]: 'значение',
				},
			}),
		new RegExp(
			`@unrendered-${entryType}-${field}.*cannot render fields: ${field}`,
		),
	);
}

for (const entrysubtype of ['online', 'electronic']) {
	const item = {
		citationKey: `misc-${entrysubtype}`,
		entryType: 'misc',
		entryTags: { title: 'Сетевой ресурс', entrysubtype },
	};
	assert.throws(() => formatBibItem(item), /requires url/);
	assert.match(
		formatBibItem({
			...item,
			entryTags: { ...item.entryTags, url: 'https://example.org/item' },
		}),
		/URL: https:\/\/example\.org\/item/,
	);
}

assert.throws(
	() =>
		formatBibItem({
			citationKey: 'misc-unknown-subtype',
			entryType: 'misc',
			entryTags: { title: 'Источник', entrysubtype: 'print' },
		}),
	/unsupported entrysubtype/,
);

assert.equal(
	formatBibItem({
		citationKey: 'conference-container-fields',
		entryType: 'inproceedings',
		entryTags: {
			title: 'Study',
			booktitle: 'Proceedings',
			langid: 'english',
			editor: 'Smith, Jane',
			volume: '206',
			series: 'Research Series',
			seriesnumber: '3',
			pages: '10--15',
			eid: '42',
			year: '2023',
		},
	}),
	'Study // Proceedings / ed. by J. Smith. – 2023. – Vol. 206. – P. 10-15. – Article 42. – (Research Series ; 3).',
);
for (const entryType of ['article', 'inproceedings', 'incollection']) {
	assert.equal(
		formatBibItem({
			citationKey: 'article-number',
			entryType,
			entryTags: { title: 'Study', articleno: 'e123', langid: 'english' },
		}),
		'Study. – Article e123.',
	);
	assert.throws(
		() =>
			formatBibItem({
				citationKey: 'conflicting-article-number',
				entryType,
				entryTags: { title: 'Study', eid: '1', articleno: '2' },
			}),
		/conflicting alias fields: eid, articleno/,
	);
}
for (const entryType of ['online', 'misc', 'report', 'techreport']) {
	assert.equal(
		formatBibItem({
			citationKey: 'source-version',
			entryType,
			entryTags: {
				title: 'Study',
				version: '3.1',
				langid: 'english',
				...(entryType === 'online'
					? { url: 'https://example.org/version/3.1' }
					: {}),
			},
		}),
		`Study. – Version 3.1.${entryType === 'online' ? ' – URL: https://example.org/version/3.1.' : ''}`,
	);
}
for (const field of ['eprint', 'archiveprefix', 'primaryclass']) {
	assert.throws(
		() =>
			formatBibItem({
				citationKey: 'archive-metadata',
				entryType: 'misc',
				entryTags: { title: 'Study', [field]: 'value' },
			}),
		/bibliographicnote.*url/,
	);
}
assert.equal(
	formatBibItem({
		citationKey: 'site-component-doi',
		entryType: 'inonline',
		entryTags: {
			title: 'Page',
			website: 'Site',
			doi: '10.1234/page',
			url: 'https://example.org/page',
		},
	}),
	'Page. – DOI: 10.1234/page // Site : [сайт]. – URL: https://example.org/page.',
);

assert.equal(
	formatBibItem({
		citationKey: 'thesis-full-responsibility',
		entryType: 'thesis',
		entryTags: {
			title: 'Исследование',
			author: 'Иванов, Иван Иванович',
			responsibility: 'Иванов Иван Иванович ; науч. рук. П. П. Петров',
			type: 'специальность 01.01.01 : диссертация',
			institution: 'Университет',
			address: 'Самара',
			year: '2025',
			pages: '100',
			bibliographicnote: 'Место защиты: Университет',
		},
	}),
	'Иванов, И. И. Исследование : специальность 01.01.01 : диссертация / Иванов Иван Иванович ; науч. рук. П. П. Петров ; Университет. – Самара, 2025. – 100 с. – Место защиты: Университет.',
);

assert.equal(
	formatBibItem({
		citationKey: 'site-container-responsibility',
		entryType: 'inonline',
		entryTags: {
			title: 'Страница',
			website: 'Сайт',
			websiteresponsibility: 'Университет',
			url: 'https://example.org/page',
		},
	}),
	'Страница // Сайт : [сайт] / Университет. – URL: https://example.org/page.',
);

for (const placeField of ['address', 'location']) {
	assert.equal(
		formatBibItem({
			citationKey: 'site-publication-place',
			entryType: 'inonline',
			entryTags: {
				title: 'Страница',
				website: 'Сайт',
				websiteresponsibility: 'Университет',
				[placeField]: 'Самара',
				publisher: 'Издательство',
				year: '2025',
				url: 'https://example.org/page',
			},
		}),
		'Страница // Сайт : [сайт] / Университет. – Самара : Издательство, 2025. – URL: https://example.org/page.',
	);
}
assert.throws(
	() =>
		formatBibItem({
			citationKey: 'site-conflicting-place',
			entryType: 'inonline',
			entryTags: {
				title: 'Страница',
				website: 'Сайт',
				address: 'Самара',
				location: 'Москва',
				url: 'https://example.org/page',
			},
		}),
	/conflicting alias fields: address, location/,
);
for (const entryType of ['online', 'inonline', 'misc']) {
	for (const [year, expected] of [
		['1999–', '1999 – .'],
		['1999–2020', '1999–2020.'],
	] as const) {
		assert.equal(
			formatBibItem({
				citationKey: 'continuing-site',
				entryType,
				entryTags: {
					title: 'Сайт',
					...(entryType === 'inonline' ? { website: 'Портал' } : {}),
					year,
					url: 'https://example.org',
				},
			}),
			`Сайт${entryType === 'inonline' ? ' // Портал : [сайт]' : ''}. – ${expected} – URL: https://example.org.`,
		);
	}
}

console.log('Bibliography field contract tests passed.');

for (const [year, expected] of [
	['1999--', '1999 – .'],
	['1999--2020', '1999–2020.'],
]) {
	assert.ok(
		formatBibItem({
			entryType: 'online',
			citationKey: 'double-year',
			entryTags: { title: 'Сайт', url: 'https://example.org', year },
		}).includes(expected),
	);
}
