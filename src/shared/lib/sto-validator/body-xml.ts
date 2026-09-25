import { resolveWordStyleId } from '../word-style-properties';

export function decodeXmlText(value: string): string {
	return value
		.replaceAll('&lt;', '<')
		.replaceAll('&gt;', '>')
		.replaceAll('&amp;', '&')
		.replaceAll('&quot;', '"')
		.replaceAll('&apos;', "'");
}

export function extractWordText(xml: string): string {
	return [...xml.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)]
		.map(item => decodeXmlText(item[1]))
		.join('');
}

export function getBodyElements(docXml: string): string[] {
	const bodyXml = /<w:body\b[^>]*>([\s\S]*?)<\/w:body>/.exec(docXml)?.[1];
	return (
		bodyXml?.match(/<w:p\b[\s\S]*?<\/w:p>|<w:tbl\b[\s\S]*?<\/w:tbl>/g) ?? []
	);
}

export function getReportBodyElements(docXml: string): string[] {
	const elements = getBodyElements(docXml);
	const reportStartIndex = elements.findIndex(
		elementXml =>
			isParagraphXml(elementXml) &&
			extractWordText(elementXml).trim().toLocaleUpperCase('ru-RU') ===
				'РЕФЕРАТ',
	);
	return reportStartIndex >= 0 ? elements.slice(reportStartIndex) : elements;
}

export function getReportTables(docXml: string): string[] {
	return getReportBodyElements(docXml).filter(isTableXml);
}

export function isParagraphXml(elementXml: string): boolean {
	return elementXml.startsWith('<w:p');
}

export function isTableXml(elementXml: string): boolean {
	return elementXml.startsWith('<w:tbl');
}

export function paragraphHasDrawing(paragraphXml: string): boolean {
	return paragraphXml.includes('<w:drawing');
}

export function isVisibleParagraph(paragraphXml: string): boolean {
	return (
		extractWordText(paragraphXml).trim().length > 0 ||
		paragraphHasDrawing(paragraphXml)
	);
}

export function paragraphHasStyle(
	paragraphXml: string,
	stylesXml: string,
	styleId: string,
): boolean {
	const resolvedStyleId = resolveWordStyleId(stylesXml, styleId);
	return (
		resolvedStyleId !== null &&
		getParagraphStyleId(paragraphXml) === resolvedStyleId
	);
}

export function getContinuationFailures(
	docXml: string,
	stylesXml: string,
): {
	label: number;
	border: number;
} {
	const elements = getReportBodyElements(docXml);
	let label = 0;
	let border = 0;
	for (let index = 0; index < elements.length; index++) {
		const paragraph = elements[index];
		if (!isParagraphXml(paragraph)) continue;
		const text = extractWordText(paragraph).trim();
		if (!/^Продолжение\s+таблицы(?:\s|$)/iu.test(text)) continue;
		const previousTable = elements[index - 1];
		const nextTable = elements[index + 1];
		const previousCaption = elements
			.slice(0, index)
			.reverse()
			.find(
				element =>
					isParagraphXml(element) &&
					/^Таблица\s+/iu.test(extractWordText(element).trim()),
			);
		const number =
			/^Продолжение таблицы\s+((?:[А-Я]\.)?\d+(?:\.\d+)?)$/u.exec(
				text,
			)?.[1];
		const captionNumber =
			previousCaption &&
			/^Таблица\s+((?:[А-Я]\.)?\d+(?:\.\d+)?)/u.exec(
				extractWordText(previousCaption).trim(),
			)?.[1];
		const alignment = /<w:jc\b[^>]*w:val="([^"]+)"/.exec(paragraph)?.[1];
		if (
			!number ||
			number !== captionNumber ||
			!previousTable ||
			!isTableXml(previousTable) ||
			!nextTable ||
			!isTableXml(nextTable) ||
			!paragraphHasStyle(paragraph, stylesXml, 'TableCaption') ||
			(alignment !== undefined && alignment !== 'left')
		)
			label++;
		if (previousTable && isTableXml(previousTable)) {
			const lastRow =
				previousTable.match(/<w:tr\b[\s\S]*?<\/w:tr>/g)?.at(-1) ?? '';
			const tableBorders =
				/<w:tblBorders\b[\s\S]*?<\/w:tblBorders>/.exec(
					previousTable,
				)?.[0] ?? '';
			const bottomBorder =
				/<w:bottom\b[^>]*w:val="(?!nil|none)[^"]+"/.test(
					tableBorders,
				) || /<w:bottom\b[^>]*w:val="(?!nil|none)[^"]+"/.test(lastRow);
			if (bottomBorder) border++;
		}
	}
	return { label, border };
}

export function getNoteFailures(docXml: string): {
	placement: number;
	form: number;
	tableEnd: number;
} {
	const elements = getReportBodyElements(docXml);
	let placement = 0;
	let form = 0;
	let tableEnd = 0;
	for (let index = 0; index < elements.length; index++) {
		const element = elements[index];
		if (!isParagraphXml(element)) continue;
		const text = extractWordText(element).trim();
		if (!/^Примечани[ея](?:\s|:|$)/iu.test(text)) continue;
		const previous = elements[index - 1];
		if (
			!previous ||
			(isParagraphXml(previous) && !isVisibleParagraph(previous))
		)
			placement++;
		const isSingle = /^Примечание\s+–\s+\S/u.test(text);
		const isPlural = /^Примечания\s*:?$/u.test(text);
		if (!isSingle && !isPlural) form++;
		if (isPlural) {
			let expected = 1;
			for (let next = index + 1; next < elements.length; next++) {
				if (!isParagraphXml(elements[next])) break;
				const numbered = /^(\d+)\s+\S/u.exec(
					extractWordText(elements[next]).trim(),
				);
				if (!numbered) break;
				if (Number(numbered[1]) !== expected++) form++;
			}
			if (expected < 3) form++;
		}
		if (previous && isTableXml(previous)) {
			const next = elements[index + 1];
			if (
				next &&
				isParagraphXml(next) &&
				/^Продолжение таблицы\s+/u.test(extractWordText(next).trim())
			)
				tableEnd++;
		}
	}
	return { placement, form, tableEnd };
}

export function getParagraphStyleId(paragraphXml: string): string | null {
	const styleTag = /<w:pStyle\b[^>]*\/>/.exec(paragraphXml)?.[0];
	return styleTag ? (/\bw:val="([^"]+)"/.exec(styleTag)?.[1] ?? null) : null;
}
