import type { ValidationResult } from '../sto-validator';
import {
	getParagraphStyleId,
	getReportBodyElements,
	isParagraphXml,
	paragraphHasStyle,
} from './body-xml';

/** Styles are checked separately; paragraph overrides must not invalidate their contract. */
export function validateTableCaptionDirectFormatting(
	docXml: string,
	stylesXml: string,
): ValidationResult {
	const locations: string[] = [];
	for (const [index, paragraph] of getReportBodyElements(docXml).entries()) {
		if (
			!isParagraphXml(paragraph) ||
			!paragraphHasStyle(paragraph, stylesXml, 'TableCaption')
		)
			continue;
		const properties =
			/<w:pPr\b[^>]*>([\s\S]*?)<\/w:pPr>/.exec(paragraph)?.[1] ?? '';
		const attribute = (tag: string, name: string) => {
			const element =
				new RegExp(`<w:${tag}\\b[^>]*>`).exec(properties)?.[0] ?? '';
			return new RegExp(`\\bw:${name}="([^"]*)"`).exec(element)?.[1];
		};
		const alignment = attribute('jc', 'val');
		const line = attribute('spacing', 'line');
		const rule = attribute('spacing', 'lineRule');
		if (
			(alignment !== undefined && alignment !== 'left') ||
			(line !== undefined && Number(line) !== 240) ||
			(rule !== undefined && rule !== 'auto') ||
			[
				'firstLine',
				'hanging',
				'left',
				'right',
				'start',
				'end',
				'firstLineChars',
				'hangingChars',
				'leftChars',
				'rightChars',
			].some(name => {
				const value = attribute('ind', name);
				return value !== undefined && Number(value) !== 0;
			})
		)
			locations.push(
				`word/document.xml: paragraph ${index + 1} (${getParagraphStyleId(paragraph)})`,
			);
	}
	return {
		check: 'Table Caption Direct Formatting',
		passed: locations.length === 0,
		...(locations.length
			? {
					error: `Table captions must preserve left alignment, zero indent and single spacing: ${locations.join('; ')}`,
				}
			: {}),
	};
}
