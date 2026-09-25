const MATH_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/math';
const ACCENT_CHARS = new Map([
	['~', '\u0303'],
	['˜', '\u0303'],
	['^', '\u0302'],
	['→', '\u20d7'],
	['˙', '\u0307'],
	['¨', '\u0308'],
]);
const OVERBAR_CHARS = new Set(['¯', '―']);
const UPRIGHT_LIMIT_OPERATORS = new Set(['min', 'max', 'lim', 'inf', 'sup']);

function normalizeLimitOperators(mathElement: Element): void {
	for (const limit of [
		...mathElement.getElementsByTagName('m:limLow'),
		...mathElement.getElementsByTagName('m:limUpp'),
	]) {
		const base = [...limit.children].find(child => child.tagName === 'm:e');
		const runs = base ? [...base.getElementsByTagName('m:r')] : [];
		if (runs.length !== 1) continue;
		const run = runs[0];
		if (!UPRIGHT_LIMIT_OPERATORS.has(run.textContent?.trim() ?? ''))
			continue;
		let properties = [...run.children].find(
			child => child.tagName === 'm:rPr',
		);
		if (!properties) {
			properties = mathElement.ownerDocument.createElementNS(
				MATH_NS,
				'm:rPr',
			);
			run.insertBefore(properties, run.firstChild);
		}
		if (
			![...properties.children].some(child => child.tagName === 'm:nor')
		) {
			properties.appendChild(
				mathElement.ownerDocument.createElementNS(MATH_NS, 'm:nor'),
			);
		}
	}
}

function normalizeAccents(mathElement: Element): void {
	const document = mathElement.ownerDocument;
	for (const upperLimit of [
		...mathElement.getElementsByTagName('m:limUpp'),
	]) {
		const limit = [...upperLimit.children].find(
			child => child.tagName === 'm:lim',
		);
		const mark = limit?.textContent?.trim() ?? '';
		if (!OVERBAR_CHARS.has(mark) && !ACCENT_CHARS.has(mark)) {
			continue;
		}
		const base = [...upperLimit.children].find(
			child => child.tagName === 'm:e',
		);
		if (!base) {
			throw new Error('Malformed OMML: accent base not found.');
		}
		const isBar = OVERBAR_CHARS.has(mark);
		const replacement = document.createElementNS(
			MATH_NS,
			isBar ? 'm:bar' : 'm:acc',
		);
		const properties = document.createElementNS(
			MATH_NS,
			isBar ? 'm:barPr' : 'm:accPr',
		);
		const character = document.createElementNS(
			MATH_NS,
			isBar ? 'm:pos' : 'm:chr',
		);
		character.setAttributeNS(
			MATH_NS,
			'm:val',
			isBar ? 'top' : ACCENT_CHARS.get(mark)!,
		);
		properties.appendChild(character);
		replacement.appendChild(properties);
		replacement.appendChild(base.cloneNode(true));
		upperLimit.replaceWith(replacement);
	}
}

export function normalizeOmmlMath(mathElement: Element): void {
	normalizeAccents(mathElement);
	normalizeLimitOperators(mathElement);
}
