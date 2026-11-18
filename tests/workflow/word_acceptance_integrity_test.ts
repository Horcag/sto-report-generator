import assert from 'node:assert/strict';

import { assertPreservedParagraphOrder } from '@/app/word-acceptance-integrity';

const paragraph = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
const document = (paragraphs: string[]) =>
	`<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs.join('')}</w:body></w:document>`;

export function runWordAcceptanceIntegrityTests(): void {
	for (const [character, element] of [
		['\t', 'tab'],
		['\n', 'br'],
		['\r', 'cr'],
	]) {
		const literal = document([paragraph(`SHORT TOC ENTRY${character}123`)]);
		const native = document([
			`<w:p><w:pPr><w:tabs><w:tab w:val="right" w:pos="9000"/></w:tabs></w:pPr><w:r><w:t>SHORT TOC ENTRY</w:t></w:r><w:r><w:${element}/><w:t>123</w:t></w:r></w:p>`,
		]);
		assert.doesNotThrow(() =>
			assertPreservedParagraphOrder(literal, native),
		);
		assert.doesNotThrow(() =>
			assertPreservedParagraphOrder(native, literal),
		);
	}
	const tabStopOnly = document([
		'<w:p><w:pPr><w:tabs><w:tab w:val="right" w:pos="9000"/></w:tabs></w:pPr><w:r><w:t>a</w:t><w:t>b</w:t></w:r></w:p>',
	]);
	assert.doesNotThrow(() =>
		assertPreservedParagraphOrder(document([paragraph('ab')]), tabStopOnly),
	);
	for (const [source, accepted] of [
		[document([paragraph('a b')]), tabStopOnly],
		[tabStopOnly, document([paragraph('a b')])],
	]) {
		assert.throws(
			() => assertPreservedParagraphOrder(source, accepted),
			/changed or reordered document text/,
		);
	}

	const source = document([
		paragraph('Министерство науки и высшего образования'),
		paragraph('ПРИЛОЖЕНИЕ А Расчётные данные'),
		paragraph('А.1 Проверка результатов исследования'),
	]);
	assert.doesNotThrow(() => assertPreservedParagraphOrder(source, source));
	const corrupted = document([
		paragraph('МА.1 Проверка результатов исследования'),
		paragraph('инистерство науки и высшего образования'),
		paragraph('ПРИЛОЖЕНИЕ А Расчётные данные'),
	]);
	assert.throws(
		() => assertPreservedParagraphOrder(source, corrupted),
		/changed or reordered document text/,
	);
	const reordered = document([
		paragraph('А.1 Проверка результатов исследования'),
		paragraph('Министерство науки и высшего образования'),
		paragraph('ПРИЛОЖЕНИЕ А Расчётные данные'),
	]);
	assert.throws(
		() => assertPreservedParagraphOrder(source, reordered),
		/changed or reordered document text/,
	);
	const shortHeadings = document([
		paragraph('Основная часть'),
		paragraph('А.1 Тест'),
	]);
	assert.throws(
		() =>
			assertPreservedParagraphOrder(
				shortHeadings,
				document([paragraph('А.1 Тест'), paragraph('Основная часть')]),
			),
		/changed or reordered document text/,
	);
	const table =
		'<w:tbl><w:tr><w:tc>' +
		paragraph('Первая ячейка') +
		'</w:tc><w:tc>' +
		paragraph('Вторая ячейка') +
		'</w:tc></w:tr></w:tbl>';
	assert.throws(
		() =>
			assertPreservedParagraphOrder(
				document([table]),
				document([table.replace('Первая ячейка', 'Утерянный текст')]),
			),
		/changed or reordered document text/,
	);

	// Drawing textboxes and mc:Fallback copies must never perturb body paragraph integrity.
	const withDrawingAndFallback = document([
		paragraph('Первый абзац'),
		`<w:p><w:r><w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData><wpg:wgp xmlns:wpg="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup"><wps:wsp xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"><wps:txbx><w:txbxContent><w:p><w:r><w:t>Внутри фигуры</w:t></w:r></w:p></w:txbxContent></wps:txbx></wps:wsp></wpg:wgp></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>` +
			`<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><mc:Choice Requires="wpg">${paragraph('Активный выбор')}</mc:Choice><mc:Fallback>${paragraph('Игнорируемый фоллбэк')}</mc:Fallback></mc:AlternateContent>`,
		paragraph('Второй абзац'),
	]);
	const matchingChoiceOnly = document([
		paragraph('Первый абзац'),
		paragraph('Активный выбор'),
		paragraph('Второй абзац'),
	]);
	assert.doesNotThrow(() =>
		assertPreservedParagraphOrder(
			withDrawingAndFallback,
			matchingChoiceOnly,
		),
	);
	assert.throws(
		() =>
			assertPreservedParagraphOrder(
				withDrawingAndFallback,
				document([
					paragraph('Первый абзац'),
					paragraph('Игнорируемый фоллбэк'),
					paragraph('Второй абзац'),
				]),
			),
		/changed or reordered document text/,
	);
}

runWordAcceptanceIntegrityTests();
console.log('Word acceptance integrity tests passed.');
