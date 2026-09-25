import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import './bib-field-contract.test';

import { loadBibliography } from '../../src/features/markdown-parser/lib/parser/bibliography-loader';
import { formatBibItem } from '../../src/features/markdown-parser/lib/utils/bib-formatter';

// ГОСТ Р 7.0.100-2018, 5.2–5.3: only explicit source fields are rendered.
assert.equal(
	formatBibItem({
		citationKey: 'title-edition',
		entryType: 'book',
		entryTags: {
			title: 'Методы анализа',
			paralleltitle: 'Methods of Analysis',
			subtitle: 'учебное пособие',
			edition: '3-е изд.',
			paralleledition: '3rd ed.',
			editionresponsibility: 'переработал И. И. Иванов',
			editionaddition: 'испр. и доп.',
			year: '2024',
		},
	}),
	'Методы анализа = Methods of Analysis : учебное пособие. – 3-е изд. = 3rd ed. / переработал И. И. Иванов, испр. и доп. – 2024.',
);

assert.equal(
	formatBibItem({
		citationKey: 'physical-book',
		entryType: 'book',
		entryTags: {
			title: 'Атлас',
			pages: '224',
			physicaldetails: 'цв. ил., карты',
			dimensions: '30 см',
			accompanyingmaterial: '1 CD-ROM',
			series: 'Научная библиотека',
			bibliographicnote: 'Библиогр.: с. 210–220',
			isbn: '978-5-00000-001-2',
			contenttype: 'Текст (визуальный)',
			mediatype: 'непосредственный',
		},
	}),
	'Атлас. – 224 с. : цв. ил., карты ; 30 см + 1 CD-ROM. – (Научная библиотека). – Библиогр.: с. 210–220. – ISBN 978-5-00000-001-2. – Текст (визуальный) : непосредственный.',
);

assert.equal(
	formatBibItem({
		citationKey: 'electronic-extent',
		entryType: 'book',
		entryTags: {
			title: 'Данные',
			extent: '1 CD-ROM (55 Мбит)',
			physicaldetails: 'цв., зв.',
			dimensions: '12 см',
			contenttype: 'Электронные данные',
			mediatype: 'электронные',
		},
	}),
	'Данные. – 1 CD-ROM (55 Мбит) : цв., зв. ; 12 см. – Электронные данные : электронные.',
);

assert.equal(
	formatBibItem({
		citationKey: 'parallel-article',
		entryType: 'article',
		entryTags: {
			title: 'Эксперимент',
			paralleltitle: 'Experiment',
			subtitle: 'результаты',
			journal: 'Журнал',
			year: '2025',
			pages: '11-20',
		},
	}),
	'Эксперимент = Experiment : результаты // Журнал. – 2025. – С. 11-20.',
);

for (const entryType of ['report', 'techreport']) {
	assert.equal(
		formatBibItem({
			citationKey: `physical-${entryType}`,
			entryType,
			entryTags: {
				title: 'Отчёт об исследовании',
				year: '2025',
				extent: '2 т.',
				physicaldetails: 'ил.',
				dimensions: '30 см',
				accompanyingmaterial: '1 карта',
			},
		}),
		'Отчёт об исследовании. – 2025. – 2 т. : ил. ; 30 см + 1 карта.',
	);
}

assert.equal(
	formatBibItem({
		citationKey: 'explicit-series-number',
		entryType: 'book',
		entryTags: {
			title: 'Монография',
			series: 'Научная библиотека',
			seriesnumber: 'вып. 5',
		},
	}),
	'Монография. – (Научная библиотека ; вып. 5).',
);
assert.throws(
	() =>
		formatBibItem({
			citationKey: 'orphan-series-number',
			entryType: 'book',
			entryTags: { title: 'Монография', seriesnumber: 'вып. 5' },
		}),
	/@orphan-series-number: seriesnumber requires series/,
);
assert.throws(
	() =>
		formatBibItem({
			citationKey: 'orphan-book-number',
			entryType: 'book',
			entryTags: { title: 'Монография', number: 'вып. 7' },
		}),
	/@orphan-book-number: number requires series/,
);

for (const entryType of ['online', 'inonline']) {
	assert.throws(
		() =>
			formatBibItem({
				citationKey: `missing-url-${entryType}`,
				entryType,
				entryTags: { title: 'Сетевой ресурс' },
			}),
		new RegExp(`@missing-url-${entryType}.*requires url`),
	);
}
for (const field of [
	'urldate',
	'updated',
	'republication',
	'publicationdate',
	'access',
	'accessmode',
	'availability',
]) {
	assert.throws(
		() =>
			formatBibItem({
				citationKey: `orphan-${field}`,
				entryType: 'misc',
				entryTags: { title: 'Источник', [field]: 'значение' },
			}),
		new RegExp(`@orphan-${field}.*requires url.*${field}`),
	);
}
assert.throws(
	() =>
		formatBibItem({
			citationKey: 'duplicate-access',
			entryType: 'online',
			entryTags: {
				title: 'Сетевой ресурс',
				url: 'https://example.org/item',
				accessmode: 'по подписке',
				availability: 'свободный',
			},
		}),
	/@duplicate-access has conflicting alias fields: accessmode, availability/,
);

for (const [entryType, fields] of [
	['book', { howpublished: 'учебник', type: 'монография' }],
	['book', { address: 'Самара', location: 'Москва' }],
	['book', { series: 'Серия', seriesnumber: '1', number: '2' }],
	['article', { number: '1', issue: '2' }],
	['thesis', { institution: 'Университет А', school: 'Университет Б' }],
	['inonline', { website: 'Сайт А', booktitle: 'Сайт Б' }],
	['incollection', { publisher: 'Издатель А', organization: 'Издатель Б' }],
	['online', { journal: 'Журнал А', website: 'Сайт Б' }],
] as const) {
	assert.throws(
		() =>
			formatBibItem({
				citationKey: `aliases-${entryType}`,
				entryType,
				entryTags: {
					title: 'Источник',
					...(entryType === 'online' || entryType === 'inonline'
						? { url: 'https://example.org/item' }
						: {}),
					...fields,
				},
			}),
		new RegExp(`@aliases-${entryType} has conflicting alias fields`),
	);
}
assert.equal(
	formatBibItem({
		citationKey: 'same-place-alias',
		entryType: 'book',
		entryTags: {
			title: 'Монография',
			address: 'Самара',
			location: 'Самара',
		},
	}),
	'Монография. – Самара.',
);
assert.equal(
	formatBibItem({
		citationKey: 'same-series-number-alias',
		entryType: 'book',
		entryTags: {
			title: 'Монография',
			series: 'Серия',
			seriesnumber: '7',
			number: '7',
		},
	}),
	'Монография. – (Серия ; 7).',
);
assert.throws(
	() =>
		formatBibItem({
			citationKey: 'patent-year-conflict',
			entryType: 'patent',
			entryTags: {
				title: 'Устройство',
				date: '2024-05-01',
				year: '2023',
			},
		}),
	/@patent-year-conflict has conflicting date and year/,
);
assert.match(
	formatBibItem({
		citationKey: 'patent-year-consistent',
		entryType: 'patent',
		entryTags: { title: 'Устройство', date: '2024-05-01', year: '2024' },
	}),
	/2024-05-01\.$/,
);

for (const entryType of [
	'article',
	'inproceedings',
	'incollection',
	'inonline',
	'online',
	'misc',
]) {
	for (const field of [
		'edition',
		'paralleledition',
		'editionresponsibility',
		'editionaddition',
		'extent',
		'physicaldetails',
		'dimensions',
		'accompanyingmaterial',
		'numpages',
		'series',
		'seriesnumber',
	]) {
		assert.throws(
			() =>
				formatBibItem({
					citationKey: `${entryType}-${field}`,
					entryType,
					entryTags: {
						title: 'Источник',
						...(entryType === 'online' || entryType === 'inonline'
							? { url: 'https://example.org/item' }
							: {}),
						[field]: 'значение',
					},
				}),
			new RegExp(`@${entryType}-${field}.*${field}`),
		);
	}
}
for (const entryType of ['inonline', 'online', 'misc']) {
	assert.throws(
		() =>
			formatBibItem({
				citationKey: `${entryType}-pages`,
				entryType,
				entryTags: {
					title: 'Источник',
					...(entryType === 'online' || entryType === 'inonline'
						? { url: 'https://example.org/item' }
						: {}),
					pages: '12',
				},
			}),
		new RegExp(`@${entryType}-pages.*pages`),
	);
}

for (const entryTags of [
	{ title: 'Книга', paralleledition: '3rd ed.' },
	{ title: 'Книга', physicaldetails: 'ил.' },
	{ title: 'Книга', extent: '1 CD-ROM', pages: '20' },
	{ title: 'Книга', pages: '20', numpages: '20' },
	{ title: 'Книга', series: 'Серия', number: '1', seriesnumber: '2' },
	{ title: 'Книга', contenttype: 'Текст' },
]) {
	assert.throws(() =>
		formatBibItem({
			citationKey: 'incomplete',
			entryType: 'book',
			entryTags,
		}),
	);
}

const sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sto-bib-areas-'));
try {
	fs.writeFileSync(
		path.join(sourceDir, 'references.bib'),
		'@book{bilingual, title={Исследование}, paralleltitle={Study}, pages={18}, dimensions={24 см}, contenttype={Текст (визуальный)}, mediatype={непосредственный}}',
	);
	const [entry] = loadBibliography(
		{ bibliography: 'references.bib' },
		sourceDir,
		sourceDir,
	);
	assert.ok(entry);
	assert.equal(
		formatBibItem(entry),
		'Исследование = Study. – 18 с. ; 24 см. – Текст (визуальный) : непосредственный.',
	);
} finally {
	fs.rmSync(sourceDir, { recursive: true, force: true });
}

console.log('Bibliography description area tests passed.');
