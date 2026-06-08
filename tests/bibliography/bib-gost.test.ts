import { BibItem } from '@/features/markdown-parser/lib/types';
import { formatBibItem } from '@/features/markdown-parser/lib/utils/bib-formatter';

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
			'Самарский, А. А. Теория разностных схем [Текст] : учеб. пособие / А. А. Самарский. – М. : Наука, 1977. – 656 с.',
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
			'Тихонов, А. Н. Уравнения математической физики [Текст] : учеб. пособие / А. Н. Тихонов, А. А. Самарский. – М. : Наука, 1972. – 736 с.',
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
			'Ильясова, Н. Ю. Информационные технологии анализа изображений в задачах медицинской диагностики [Текст] / Н. Ю. Ильясова, А. В. Куприянов, А. Г. Храмов. – М. : Радио и связь, 2012. – 424 с.',
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
			'Методы компьютерной оптики [Текст] : учеб. для вузов / А. В. Волков [и др.] ; под ред. В. А. Сойфера. – 2-е изд., испр. – М. : Физматлит, 2003. – 688 с.',
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
			'Фурсов, В. А. Построение КИХ-фильтров в заданном параметрическом классе частотных характеристик [Текст] / В. А. Фурсов // Компьютерная оптика. – 2016. – Т. 40, № 6. – С. 878-886.',
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
			'Петергоф [Электронный ресурс] // Википедия: свободная энцикл. – Электрон. дан. – [Б. м.], 2012. – URL: http://ru.wikipedia.org/wiki/Петродворец (дата обращения: 08.11.2012).',
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
			'Бирюкова, Е. В. Разработка технологии построения эффективного набора признаков для различения классов текстурных изображений [Текст] / Е. В. Бирюкова, Р. А. Парингер, А. В. Куприянов // Материалы Международной конференции и молодежной школы «Информационные технологии и нанотехнологии» (ИТНТ-2016). Самара, 17-19 мая 2016 г. – Самара : Самарский Научный Центр РАН, 2016. – С. 357-360.',
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
			'Боброва, А. И. К вопросу о многокомпонентности культуры средневекового населения Томско-Нарымского Приобья [Текст] / А. И. Боброва, Ф. И. Мец // Палеодемография и миграционные процессы в Западной Сибири в древности и средневековье. – Барнаул, 1994. – С. 163-164.',
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
			'Albanesi, S. Credit Scores: Performance and Equity [Текст] : Working Paper / S. Albanesi, D. F. Vamossy / National Bureau of Economic Research. – No. 32917. – 2024.',
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

if (failed > 0) {
	process.exit(1);
} else {
	console.log('\nAll tests passed!');
}
