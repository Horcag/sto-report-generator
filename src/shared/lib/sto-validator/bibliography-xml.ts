import {
	extractWordText,
	getBodyElements,
	getParagraphStyleId,
	isParagraphXml,
} from './body-xml';

function hasSegmentedIdentifier(paragraph: string): boolean {
	// Numeric character references and Word's soft-hyphen element are literal
	// content too; joining runs must not hide a separator inside an identifier.
	const text = extractWordText(
		paragraph
			.replace(/<w:softHyphen\b[^>]*\/>/g, '<w:t>\u00AD</w:t>')
			.replace(/&#(x[\da-f]+|\d+);/gi, (_entity, code: string) => {
				const value = code.toLowerCase().startsWith('x')
					? parseInt(code.slice(1), 16)
					: Number(code);
				return value <= 0x10ffff
					? String.fromCodePoint(value)
					: _entity;
			}),
	);
	return [
		...text.matchAll(
			/(?:https?:\/\/|\b(?:URL|DOI|ISBN|ISSN|ISMN)\s*:[ \t]*)(?:\S|\uFEFF)+/gi,
		),
	].some(match => /[\u00AD\u200B\u2060\uFEFF]/u.test(match[0]));
}

export function validateBibliographyPresentation(docXml: string) {
	const markers = ['[Текст]', '[Электронный ресурс]', 'Электрон. дан.'];
	let inBibliography = false;
	let activeLinks = 0;
	let segmentedIdentifiers = 0;
	for (const paragraph of getBodyElements(docXml).filter(isParagraphXml)) {
		const text = extractWordText(paragraph).trim().toUpperCase();
		if (text === 'СПИСОК ИСПОЛЬЗОВАННЫХ ИСТОЧНИКОВ') {
			inBibliography = true;
			continue;
		}
		if (
			inBibliography &&
			/^(?:StructuralHeading|AppendixHeading)/.test(
				getParagraphStyleId(paragraph) ?? '',
			)
		)
			inBibliography = false;
		if (!inBibliography) continue;
		if (hasSegmentedIdentifier(paragraph)) segmentedIdentifiers++;
		const instructions = [
			...paragraph.matchAll(
				/<w:instrText\b[^>]*>([\s\S]*?)<\/w:instrText>/g,
			),
		]
			.map(match => match[1])
			.join('');
		if (
			/<w:hyperlink\b[^>]*\br:id=/.test(paragraph) ||
			/<w:fldSimple\b[^>]*\bw:instr="[^"]*\bHYPERLINK\b/i.test(
				paragraph,
			) ||
			/\bHYPERLINK\b/i.test(instructions)
		)
			activeLinks++;
	}
	return [
		{
			check: 'Bibliography Legacy Resource Markers',
			passed: !markers.some(marker =>
				extractWordText(docXml).includes(marker),
			),
			error: `Detected legacy bibliography marker. Do not use ${markers.join(', ')} in source-list records.`,
		},
		{
			check: 'Bibliography Literal Identifiers',
			passed: segmentedIdentifiers === 0,
			error: `${segmentedIdentifiers} bibliography paragraph(s) contain invisible separators in URLs or identifiers. Preserve literal source text and use paragraph wrapping instead.`,
		},
		{
			check: 'Bibliography Plain URL Text',
			passed: activeLinks === 0,
			error: `${activeLinks} bibliography paragraph(s) contain active URL hyperlinks. Keep source URLs as plain text; removing color/underline does not remove a hyperlink.`,
		},
	];
}
