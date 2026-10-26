import { normalizeFractionDelimiters } from './fraction-delimiters';

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

const INTEGRAL_CHARS = new Set(['∫', '∬', '∭', '∮', '∯', '∰', '∱', '∲', '∳']);
const SCRIPT_OPERANDS = new Set([
	'm:sSup',
	'm:sSub',
	'm:sSubSup',
	'm:acc',
	'm:bar',
	'm:rad',
]);
const GROUP_OPERANDS = new Set(['m:f', 'm:d', 'm:func', 'm:m']);

function isIntegralOperand(element: Element): boolean {
	if (element.tagName === 'm:r') {
		return /^[\p{L}\p{N}\p{M}]+$/u.test(element.textContent?.trim() ?? '');
	}
	if (GROUP_OPERANDS.has(element.tagName)) {
		return /[\p{L}\p{N}]/u.test(element.textContent ?? '');
	}
	if (SCRIPT_OPERANDS.has(element.tagName) || element.tagName === 'm:nary') {
		const base = [...element.children].find(
			child => child.tagName === 'm:e',
		);
		return (
			!!base?.firstElementChild &&
			isIntegralOperand(base.firstElementChild)
		);
	}
	return false;
}

function normalizeEmptyIntegralArguments(mathElement: Element): void {
	// Resolve inner/consecutive integrals first, and consume only one complete atom.
	for (const integral of [
		...mathElement.getElementsByTagName('m:nary'),
	].reverse()) {
		const properties = [...integral.children].find(
			child => child.tagName === 'm:naryPr',
		);
		const character =
			properties &&
			[...properties.children].find(child => child.tagName === 'm:chr');
		if (!INTEGRAL_CHARS.has(character?.getAttribute('m:val') ?? ''))
			continue;
		const argument = [...integral.children].find(
			child => child.tagName === 'm:e',
		);
		const operand = integral.nextElementSibling;
		if (
			!argument ||
			argument.children.length ||
			argument.textContent?.trim() ||
			!operand
		)
			continue;
		if (isIntegralOperand(operand)) argument.appendChild(operand);
	}
}

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

function normalizeEmptyAccentScripts(mathElement: Element): void {
	// Word measures an invisible empty script when sizing an accent above it.
	for (const accent of [
		...mathElement.getElementsByTagName('m:bar'),
		...mathElement.getElementsByTagName('m:acc'),
	]) {
		const base = [...accent.children].find(
			child => child.tagName === 'm:e',
		);
		if (!base || base.children.length !== 1) continue;
		const script = base.children[0];
		if (script.tagName !== 'm:sSup' && script.tagName !== 'm:sSub')
			continue;
		const argument = [...script.children].find(
			child => child.tagName === 'm:e',
		);
		const index = [...script.children].find(
			child => child.tagName === 'm:sup' || child.tagName === 'm:sub',
		);
		if (argument && index && index.children.length === 0) {
			script.replaceWith(...[...argument.children]);
		}
	}
}

export function normalizeOmmlMath(mathElement: Element): void {
	normalizeAccents(mathElement);
	normalizeEmptyAccentScripts(mathElement);
	normalizeLimitOperators(mathElement);
	normalizeEmptyIntegralArguments(mathElement);
	normalizeFractionDelimiters(mathElement);
}
