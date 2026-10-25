import {
	extractWordText,
	getBodyElements,
	getParagraphStyleId,
	isParagraphXml,
} from './body-xml';

export function validateBibliographyPresentation(docXml: string) {
	const markers = ['[Текст]', '[Электронный ресурс]', 'Электрон. дан.'];
	let inBibliography = false;
	let activeLinks = 0;
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
			check: 'Bibliography Plain URL Text',
			passed: activeLinks === 0,
			error: `${activeLinks} bibliography paragraph(s) contain active URL hyperlinks. Keep source URLs as plain text; removing color/underline does not remove a hyperlink.`,
		},
	];
}
