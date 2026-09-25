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
	['inproceedings', 'editor'],
	['incollection', 'number'],
	['book', 'journal'],
	['standard', 'langid'],
	['patent', 'publisher'],
	['thesis', 'editor'],
	['phdthesis', 'journal'],
	['mastersthesis', 'issue'],
	['inonline', 'publisher'],
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

console.log('Bibliography field contract tests passed.');
