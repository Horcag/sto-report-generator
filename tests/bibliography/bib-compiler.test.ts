import assert from 'node:assert/strict';

import { formatBibItem } from '@/features/markdown-parser/lib/utils/bib-formatter';

// The source credits compilers, so its description starts with the title.
assert.equal(
	formatBibItem({
		citationKey: 'compiled-methodical-guide',
		entryType: 'book',
		entryTags: {
			title: 'Внешнее описание программных комплексов',
			howpublished:
				'методические указания к лабораторной работе № 1 по курсу «Проектирование программных комплексов»',
			compiler: 'Куприянов, А. В. and Кирш, Д. В.',
			address: 'Самара',
			publisher: 'Самарский университет',
			year: '2020',
			pages: '20',
		},
	}),
	'Внешнее описание программных комплексов : методические указания к лабораторной работе № 1 по курсу «Проектирование программных комплексов» / сост. А.В. Куприянов, Д.В. Кирш. – Самара : Самарский университет, 2020. – 20 с.',
);

assert.throws(
	() =>
		formatBibItem({
			citationKey: 'duplicate-compiler',
			entryType: 'book',
			entryTags: {
				title: 'Методические указания',
				compiler: 'Куприянов, А. В.',
				note: 'сост. А. В. Куприянов',
			},
		}),
	/credits compilers in both compiler and note/,
);

assert.throws(
	() =>
		formatBibItem({
			citationKey: 'article-compiler',
			entryType: 'article',
			entryTags: {
				title: 'Статья',
				journal: 'Журнал',
				compiler: 'Куприянов, А. В.',
			},
		}),
	/cannot render fields: compiler/,
);
