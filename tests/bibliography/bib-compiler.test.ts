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
			note: 'сост. А. В. Куприянов, Д. В. Кирш',
			address: 'Самара',
			publisher: 'Самарский университет',
			year: '2020',
			pages: '20',
		},
	}),
	'Внешнее описание программных комплексов : методические указания к лабораторной работе № 1 по курсу «Проектирование программных комплексов» / сост. А.В. Куприянов, Д.В. Кирш. – Самара : Самарский университет, 2020. – 20 с.',
);
