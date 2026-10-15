import { JSDOM } from 'jsdom';

import {
	decodeXmlText,
	extractWordText,
	getBodyElements,
	isParagraphXml,
} from './body-xml';

const ACCENT_MARKS = new Set(['¯', '―', '~', '˜', '^', '→', '˙', '¨']);
const UPRIGHT_LIMIT_OPERATORS = new Set(['min', 'max', 'lim', 'inf', 'sup']);

export function inspectMathStructures(documentXml: string): {
	accentLimits: number;
	italicLimitOperators: number;
} {
	const document = new JSDOM(documentXml, { contentType: 'text/xml' }).window
		.document;
	let accentLimits = 0;
	let italicLimitOperators = 0;
	for (const upperLimit of [...document.getElementsByTagName('m:limUpp')]) {
		const limit = [...upperLimit.children].find(
			child => child.tagName === 'm:lim',
		);
		if (limit && ACCENT_MARKS.has(limit.textContent?.trim() ?? '')) {
			accentLimits++;
		}
	}
	for (const kind of ['m:limLow', 'm:limUpp']) {
		for (const limit of [...document.getElementsByTagName(kind)]) {
			const base = [...limit.children].find(
				child => child.tagName === 'm:e',
			);
			const runs = base ? [...base.getElementsByTagName('m:r')] : [];
			if (runs.length !== 1) continue;
			const run = runs[0];
			if (!UPRIGHT_LIMIT_OPERATORS.has(run.textContent?.trim() ?? '')) {
				continue;
			}
			const properties = [...run.children].find(
				child => child.tagName === 'm:rPr',
			);
			if (
				!properties ||
				![...properties.children].some(
					child => child.tagName === 'm:nor',
				)
			) {
				italicLimitOperators++;
			}
		}
	}
	return { accentLimits, italicLimitOperators };
}

export function hasFormulaPeriodBeforeWhere(docXml: string): boolean {
	const elements = getBodyElements(docXml);

	for (let index = 1; index < elements.length; index++) {
		const explanation = elements[index];
		const formulaBlock = elements[index - 1];
		if (
			!isParagraphXml(explanation) ||
			!/^где(?:\s|$)/u.test(extractWordText(explanation).trim()) ||
			!formulaBlock.includes('<m:oMath')
		) {
			continue;
		}
		const mathText = [
			...formulaBlock.matchAll(/<m:t[^>]*>([\s\S]*?)<\/m:t>/g),
		]
			.map(item => decodeXmlText(item[1]).trim())
			.join('')
			.trim();

		if (mathText.endsWith('.')) {
			return true;
		}
	}

	return false;
}
