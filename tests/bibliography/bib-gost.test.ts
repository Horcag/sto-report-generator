import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { parseMarkdownToDocx } from '@/features/markdown-parser';
import { BibItem } from '@/features/markdown-parser/lib/types';
import { formatBibItem } from '@/features/markdown-parser/lib/utils/bib-formatter';

import { testBibliographyPathResolution } from './bib_path_resolution_tests';

const tests: { input: BibItem; expected: string }[] = [
	{
		input: {
			citationKey: 'samarsky',
			entryType: 'book',
			entryTags: {
				author: 'Самарский, А. А.',
				title: 'Теория разностных схем',
				howpublished: 'учеб. пособие',
				address: 'М.',
				publisher: 'Наука',
				year: '1977',
				pages: '656',
			},
		},
		expected:
			'Самарский, А.А. Теория разностных схем : учеб. пособие / А.А. Самарский. – М. : Наука, 1977. – 656 с.',
	},
	{
		input: {
			citationKey: 'tikhonov',
			entryType: 'book',
			entryTags: {
				author: 'Тихонов, А. Н. and Самарский, А. А.',
				title: 'Уравнения математической физики',
				howpublished: 'учеб. пособие',
				address: 'М.',
				publisher: 'Наука',
				year: '1972',
				pages: '736',
			},
		},
		expected:
			'Тихонов, А.Н. Уравнения математической физики : учеб. пособие / А.Н. Тихонов, А.А. Самарский. – М. : Наука, 1972. – 736 с.',
	},
	{
		input: {
			citationKey: 'ilyasova',
			entryType: 'book',
			entryTags: {
				author: 'Ильясова, Н. Ю. and Куприянов, А. В. and Храмов, А. Г.',
				title: 'Информационные технологии анализа изображений в задачах медицинской диагностики',
				address: 'М.',
				publisher: 'Радио и связь',
				year: '2012',
				pages: '424',
			},
		},
		expected:
			'Ильясова, Н.Ю. Информационные технологии анализа изображений в задачах медицинской диагностики / Н.Ю. Ильясова, А.В. Куприянов, А.Г. Храмов. – М. : Радио и связь, 2012. – 424 с.',
	},
	{
		input: {
			citationKey: 'volkov',
			entryType: 'book',
			entryTags: {
				author: 'Волков, А. В. and others',
				title: 'Методы компьютерной оптики',
				howpublished: 'учеб. для вузов',
				note: 'под ред. В. А. Сойфера. – 2-е изд., испр.',
				address: 'М.',
				publisher: 'Физматлит',
				year: '2003',
				pages: '688',
			},
		},
		expected:
			'Методы компьютерной оптики : учеб. для вузов / А.В. Волков [и др.] ; под ред. В.А. Сойфера. – 2-е изд., испр. – М. : Физматлит, 2003. – 688 с.',
	},
	{
		input: {
			citationKey: 'fursov',
			entryType: 'article',
			entryTags: {
				author: 'Фурсов, В. А.',
				title: 'Построение КИХ-фильтров в заданном параметрическом классе частотных характеристик',
				journal: 'Компьютерная оптика',
				year: '2016',
				volume: '40',
				number: '6',
				pages: '878-886',
			},
		},
		expected:
			'Фурсов, В.А. Построение КИХ-фильтров в заданном параметрическом классе частотных характеристик / В.А. Фурсов // Компьютерная оптика. – 2016. – Т. 40, № 6. – С. 878-886.',
	},
	{
		input: {
			citationKey: 'petergof',
			entryType: 'misc',
			entryTags: {
				title: 'Петергоф',
				journal: 'Википедия: свободная энцикл.',
				address: '[Б. м.]',
				year: '2012',
				url: 'http://ru.wikipedia.org/wiki/Петродворец',
				urldate: '2012-11-08',
			},
		},
		expected:
			'Петергоф // Википедия: свободная энцикл. – [Б. м.], 2012. – URL: http://ru.wikipedia.org/wiki/Петродворец (дата обращения: 08.11.2012).',
	},
	{
		input: {
			citationKey: 'biryukova',
			entryType: 'inproceedings',
			entryTags: {
				author: 'Бирюкова, Е. В. and Парингер, Р. А. and Куприянов, А. В.',
				title: 'Разработка технологии построения эффективного набора признаков для различения классов текстурных изображений',
				booktitle:
					'Материалы Международной конференции и молодежной школы «Информационные технологии и нанотехнологии» (ИТНТ-2016). Самара, 17-19 мая 2016 г.',
				address: 'Самара',
				publisher: 'Самарский Научный Центр РАН',
				year: '2016',
				pages: '357--360',
			},
		},
		expected:
			'Бирюкова, Е.В. Разработка технологии построения эффективного набора признаков для различения классов текстурных изображений / Е.В. Бирюкова, Р.А. Парингер, А.В. Куприянов // Материалы Международной конференции и молодежной школы «Информационные технологии и нанотехнологии» (ИТНТ-2016). Самара, 17-19 мая 2016 г. – Самара : Самарский Научный Центр РАН, 2016. – С. 357-360.',
	},
	{
		input: {
			citationKey: 'bobrova',
			entryType: 'incollection',
			entryTags: {
				author: 'Боброва, А. И. and Мец, Ф. И.',
				title: 'К вопросу о многокомпонентности культуры средневекового населения Томско-Нарымского Приобья',
				booktitle:
					'Палеодемография и миграционные процессы в Западной Сибири в древности и средневековье',
				address: 'Барнаул',
				year: '1994',
				pages: '163--164',
			},
		},
		expected:
			'Боброва, А.И. К вопросу о многокомпонентности культуры средневекового населения Томско-Нарымского Приобья / А.И. Боброва, Ф.И. Мец // Палеодемография и миграционные процессы в Западной Сибири в древности и средневековье. – Барнаул, 1994. – С. 163-164.',
	},
	{
		input: {
			citationKey: 'albanesi',
			entryType: 'techreport',
			entryTags: {
				author: 'Albanesi, S. and Vamossy, D. F.',
				title: 'Credit Scores: Performance and Equity',
				type: 'Working Paper',
				institution: 'National Bureau of Economic Research',
				number: '32917',
				year: '2024',
				langid: 'english',
			},
		},
		expected:
			'Albanesi, S. Credit Scores: Performance and Equity : Working Paper / S. Albanesi, D.F. Vamossy ; National Bureau of Economic Research. – No. 32917. – 2024.',
	},
	{
		input: {
			citationKey: 'cbr2024',
			entryType: 'report',
			entryTags: {
				title: 'Аналитический обзор рынка кредитования',
				author: '{Банк России}',
				institution: 'Банк России',
				type: 'информационно-аналитические материалы',
				year: '2024',
				url: 'https://example.org/report.pdf',
				urldate: '2025-07-01',
			},
		},
		expected:
			'Аналитический обзор рынка кредитования : информационно-аналитические материалы / Банк России. – 2024. – URL: https://example.org/report.pdf (дата обращения: 01.07.2025).',
	},
	{
		input: {
			citationKey: 'constitution',
			entryType: 'norm',
			entryTags: {
				title: 'Конституция Российской Федерации',
				year: '2014',
				journal: 'Собрание законодательства РФ',
				number: '31',
				note: 'Ст. 4398',
			},
		},
		expected:
			'Конституция Российской Федерации // Собрание законодательства РФ. – 2014. – № 31. – Ст. 4398.',
	},
	{
		input: {
			citationKey: 'bank-regulation',
			entryType: 'norm',
			entryTags: {
				title: 'О порядке формирования резервов',
				author: '{{Банк России}}',
				howpublished: 'Положение Банка России от 28.06.2017 № 590-П',
				journal: 'Вестник Банка России',
				year: '2017',
				number: '65--66',
				langid: 'russian',
			},
		},
		expected:
			'О порядке формирования резервов : Положение Банка России от 28.06.2017 № 590-П / Банк России // Вестник Банка России. – 2017. – № 65–66.',
	},
	{
		input: {
			citationKey: 'patent',
			entryType: 'patent',
			entryTags: {
				author: 'Иванов, И. И.',
				title: 'Устройство обработки изображений',
				country: 'RU',
				number: '123456',
				holder: 'Самарский университет',
				year: '2020',
				pages: '8',
			},
		},
		expected:
			'Иванов, И.И. Устройство обработки изображений : пат. RU 123456 / И.И. Иванов ; Самарский университет. – 2020. – 8 с.',
	},
	{
		input: {
			citationKey: 'thesis',
			entryType: 'phdthesis',
			entryTags: {
				author: 'Петров, П. П.',
				title: 'Методы анализа изображений',
				type: 'дис. канд. техн. наук',
				institution: 'Самарский университет',
				address: 'Самара',
				year: '2021',
				pages: '150',
			},
		},
		expected:
			'Петров, П.П. Методы анализа изображений : дис. канд. техн. наук / П.П. Петров ; Самарский университет. – Самара, 2021. – 150 с.',
	},
	{
		input: {
			citationKey: 'standard',
			entryType: 'standard',
			entryTags: {
				number: 'ГОСТ Р 7.0.100-2018',
				title: 'Библиографическая запись. Библиографическое описание',
				address: 'М.',
				publisher: 'Стандартинформ',
				year: '2018',
				pages: '128',
			},
		},
		expected:
			'ГОСТ Р 7.0.100-2018. Библиографическая запись. Библиографическое описание. – М. : Стандартинформ, 2018. – 128 с.',
	},
	{
		input: {
			citationKey: 'sitePart',
			entryType: 'inonline',
			entryTags: {
				title: 'Правила оформления отчётов',
				website: 'Самарский университет',
				year: '2022',
				url: 'https://ssau.ru/rules',
				urldate: '2024-03-12',
			},
		},
		expected:
			'Правила оформления отчётов // Самарский университет : сайт. – 2022. – URL: https://ssau.ru/rules (дата обращения: 12.03.2024).',
	},
];

let failed = 0;
for (const t of tests) {
	const actual = formatBibItem(t.input);
	if (actual !== t.expected) {
		console.error(`\nFAIL: ${t.input.citationKey}`);
		console.error(`Expected: ${t.expected}`);
		console.error(`Actual:   ${actual}`);
		failed++;
	} else {
		console.log(`PASS: ${t.input.citationKey}`);
	}
}

if (failed > 0) process.exit(1);

assert.throws(
	() =>
		formatBibItem({
			citationKey: 'unsupported',
			entryType: 'software',
			entryTags: { title: 'Program', url: 'https://example.org' },
		}),
	/Unsupported bibliography type "software" for @unsupported/,
);

assert.throws(
	() =>
		formatBibItem({
			citationKey: 'untitled',
			entryType: 'book',
			entryTags: {},
		}),
	/Bibliography entry @untitled has no title/,
);
const noInventedPrintData = formatBibItem({
	citationKey: 'print-unknown',
	entryType: 'book',
	entryTags: { title: 'Печатный источник', year: '2020' },
});
assert.doesNotMatch(
	noInventedPrintData,
	/Без названия|\[Б\. м\.\]|\[б\. и\.\]/,
);
assert.match(
	formatBibItem({
		citationKey: 'edited-book',
		entryType: 'book',
		entryTags: {
			title: 'Сборник исследований',
			editor: 'Иванов, И. И.',
			address: 'Самара',
			publisher: 'Издательство',
			year: '2025',
			pages: '200',
		},
	}),
	/Сборник исследований \/ ред\. И\.И\. Иванов\. – Самара : Издательство, 2025\. – 200 с\./,
);
const undatedNetworkResource = formatBibItem({
	citationKey: 'online-undated',
	entryType: 'online',
	entryTags: {
		title: 'Сетевой ресурс',
		url: 'https://example.org/item',
		urldate: '2026-09-25',
	},
});
assert.doesNotMatch(undatedNetworkResource, /\[Б\. м\.\]|\[б\. г\.\]/);
assert.match(
	undatedNetworkResource,
	/URL: https:\/\/example\.org\/item \(дата обращения: 25\.09\.2026\)/,
);
assert.match(
	formatBibItem({
		citationKey: 'published-online',
		entryType: 'online',
		entryTags: {
			title: 'Сетевой сборник',
			publisher: 'Самарский университет',
			year: '2025',
			url: 'https://example.org/collection',
			urldate: '2026-09-25',
		},
	}),
	/Самарский университет, 2025\. – URL:/,
);
assert.match(
	formatBibItem({
		citationKey: 'online-article',
		entryType: 'article',
		entryTags: {
			title: 'Сетевая статья',
			journal: 'Журнал',
			year: '2025',
			url: 'https://example.org/article',
			urldate: '2026-09-25',
		},
	}),
	/URL: https:\/\/example\.org\/article \(дата обращения: 25\.09\.2026\)/,
);

// ГОСТ Р 7.0.100-2018: 5.7 places the series after extent; 5.9 places
// identifiers after notes. Values come only from explicit source metadata.
assert.equal(
	formatBibItem({
		citationKey: 'numbered-series',
		entryType: 'book',
		entryTags: {
			title: 'Труды по оптике',
			year: '2024',
			pages: '220',
			series: 'Библиотека исследователя',
			number: 'вып. 3',
			isbn: '978-5-00000-123-4',
		},
	}),
	'Труды по оптике. – 2024. – 220 с. – (Библиотека исследователя ; вып. 3). – ISBN 978-5-00000-123-4.',
);
assert.equal(
	formatBibItem({
		citationKey: 'identified-article',
		entryType: 'article',
		entryTags: {
			title: 'Новая методика',
			journal: 'Научный журнал',
			year: '2025',
			pages: '10-15',
			url: 'https://example.org/article',
			urldate: '2026-09-25',
			doi: 'https://doi.org/10.1234/example',
		},
	}),
	'Новая методика // Научный журнал. – 2025. – С. 10-15. – URL: https://example.org/article (дата обращения: 25.09.2026). – DOI 10.1234/example.',
);
assert.equal(
	formatBibItem({
		citationKey: 'unidentified-book',
		entryType: 'book',
		entryTags: { title: 'Книга', series: 'Серия' },
	}),
	'Книга. – (Серия).',
);
assert.equal(
	formatBibItem({
		citationKey: 'updated-network-resource',
		entryType: 'online',
		entryTags: {
			title: 'Электронный документ',
			updated: '25.02.2025',
			republication: 'Электронная версия печатного издания',
			url: 'https://example.org/document',
			urldate: '2026-09-25',
			publicationdate: '26.02.2025',
			accessmode: 'по подписке',
		},
	}),
	'Электронный документ. – Дата обновления: 25.02.2025. – Электронная версия печатного издания. – URL: https://example.org/document (дата обращения: 25.09.2026). – Дата публикации: 26.02.2025. – Режим доступа: по подписке.',
);

testBibliographyPathResolution();

async function testSpecialTypeCitations(): Promise<void> {
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sto-bib-special-'));
	try {
		const bibPath = path.join(tempDir, 'references.bib');
		fs.writeFileSync(
			bibPath,
			tests
				.slice(-4)
				.map(({ input }) => {
					const fields = Object.entries(input.entryTags)
						.map(([key, value]) => `  ${key} = {${value}}`)
						.join(',\n');
					return `@${input.entryType}{${input.citationKey},\n${fields}\n}`;
				})
				.join('\n\n'),
		);
		const elements = await parseMarkdownToDocx(
			String.raw`Патент [@patent], диссертация [@thesis], стандарт [@standard], часть сайта [@sitePart].

\begin{sto_bibliography}
\end{sto_bibliography}`,
			{ bibliography: bibPath },
			{ sourceDir: tempDir },
		);
		const actual = JSON.stringify(elements).replaceAll('\u200B', '');
		assert.match(
			actual,
			/Патент \[1\], диссертация \[2\], стандарт \[3\], часть сайта \[4\]/,
		);
		for (const { expected } of tests.slice(-4)) {
			assert.ok(actual.includes(expected), expected);
		}
	} finally {
		fs.rmSync(tempDir, { recursive: true, force: true });
	}
}

testSpecialTypeCitations()
	.then(() => console.log('\nAll bibliography tests passed!'))
	.catch(error => {
		console.error(error);
		process.exitCode = 1;
	});
