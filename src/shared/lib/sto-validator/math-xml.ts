import { JSDOM } from 'jsdom';

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
