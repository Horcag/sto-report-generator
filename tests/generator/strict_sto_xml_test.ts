import assert from 'node:assert/strict';

import { normalizeStrictStoXml } from '@/shared/lib/docx/strict-sto/typography';
import { inspectStrictStoXml } from '@/shared/lib/docx/strict-sto/validation';
import {
	MATH_NS,
	withXml,
	WORD_NS,
	wordChild,
	wordElements,
} from '@/shared/lib/docx/strict-sto/xml';

const styles = `<w:styles xmlns:w="${WORD_NS}"><w:style w:type="paragraph" w:styleId="Normal"><w:name w:val="Normal"/><w:rPr><w:i/><w:sz w:val="20"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="RenamedCaption"><w:name w:val="Table Caption"/></w:style><w:style w:type="paragraph" w:styleId="MTDisplayEquation"><w:pPr><w:spacing w:line="240"/></w:pPr></w:style></w:styles>`;
const normalizedStyles = normalizeStrictStoXml(styles);
withXml(normalizedStyles, document => {
	assert.equal(
		document.documentElement.firstElementChild?.localName,
		'docDefaults',
	);
	const style = wordElements(document, 'style')[0];
	assert.ok(
		Array.from(style.children).findIndex(node => node.localName === 'pPr') <
			Array.from(style.children).findIndex(
				node => node.localName === 'rPr',
			),
	);
	const properties = wordChild(style, 'rPr')!;
	assert.deepEqual(
		Array.from(properties.children).map(node => node.localName),
		['rFonts', 'b', 'bCs', 'i', 'color', 'sz', 'szCs'],
	);
});

const input = `<w:document xmlns:w="${WORD_NS}" xmlns:m="${MATH_NS}"><w:body><w:p><w:pPr><w:spacing w:line="20" w:lineRule="exact"/></w:pPr><w:r><w:drawing><w:txbxContent><w:p><w:r><w:t>Вложенный текст</w:t></w:r></w:p></w:txbxContent></w:drawing></w:r></w:p><w:p><w:pPr><w:pStyle w:val="RenamedCaption"/></w:pPr><w:r><w:t>Таблица 1</w:t></w:r></w:p><w:p><w:pPr><w:spacing w:line="240"/></w:pPr><m:oMath><m:r><m:rPr><m:sty m:val="b"/></m:rPr><m:t>x</m:t></m:r></m:oMath></w:p></w:body></w:document>`;
const normalized = normalizeStrictStoXml(input, normalizedStyles);
withXml(normalized, document => {
	const paragraphs = wordElements(document, 'p');
	assert.equal(
		wordElements(paragraphs[0], 'spacing')[0].getAttributeNS(
			WORD_NS,
			'line',
		),
		'20',
		'Абзац рисунка не получает настройки вложенного текста',
	);
	assert.equal(
		wordElements(paragraphs[1], 'spacing')[0].getAttributeNS(
			WORD_NS,
			'line',
		),
		'360',
	);
	assert.equal(
		wordElements(paragraphs[2], 'spacing')[0].getAttributeNS(
			WORD_NS,
			'line',
		),
		'240',
		'Имя стиля подписи сохраняется после Word',
	);
	assert.equal(
		wordElements(paragraphs[3], 'spacing')[0].getAttributeNS(
			WORD_NS,
			'line',
		),
		'240',
	);
	assert.equal(
		document
			.getElementsByTagNameNS(MATH_NS, 'sty')[0]
			.getAttributeNS(MATH_NS, 'val'),
		'b',
	);
});
assert.ok(
	inspectStrictStoXml(
		new Map([
			['word/styles.xml', normalizedStyles],
			['word/document.xml', normalized],
		]),
	).spacing,
);

const ordinary = normalizeStrictStoXml(
	`<w:document xmlns:w="${WORD_NS}"><w:body><w:p><w:r><w:t>Текст</w:t></w:r></w:p></w:body></w:document>`,
);
withXml(
	normalizeStrictStoXml(
		`<w:document xmlns:w="${WORD_NS}"><w:body><w:p><w:pPr><w:sectPr/><w:pPrChange/></w:pPr><w:r><w:t>Разрыв раздела</w:t></w:r></w:p></w:body></w:document>`,
	),
	document => {
		assert.deepEqual(
			Array.from(wordElements(document, 'pPr')[0].children).map(
				node => node.localName,
			),
			['spacing', 'sectPr', 'pPrChange'],
		);
	},
);
const inherited = ordinary.replace(/<w:rPr>[\s\S]*?<\/w:rPr>/g, '');
const boldStyle = normalizedStyles.replaceAll('<w:b w:val="0"/>', '<w:b/>');
assert.equal(
	inspectStrictStoXml(
		new Map([
			['word/styles.xml', boldStyle],
			['word/document.xml', inherited],
		]),
	).bold,
	false,
	'Полужирное из стиля обнаружено без прямого rPr',
);
const themedStyle = normalizedStyles.replace(
	'w:ascii="Times New Roman"',
	'w:ascii="Times New Roman" w:asciiTheme="majorHAnsi"',
);
assert.equal(
	inspectStrictStoXml(
		new Map([
			['word/styles.xml', themedStyle],
			['word/document.xml', ordinary],
		]),
	).font,
	true,
	'Прямая гарнитура имеет приоритет над темой родителя',
);
console.log(
	'Strict STO XML: schema order, textbox ownership, renamed caption, mathematical spacing and style inheritance passed.',
);
