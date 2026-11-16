import { normalizeFractionDelimiters } from './fraction-delimiters';
import { normalizeScriptStructure } from './script-structure';

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

const NARY_ARGUMENT_CHARS = new Set([
	'∫',
	'∬',
	'∭',
	'∮',
	'∯',
	'∰',
	'∱',
	'∲',
	'∳',
	'∑',
	'∏',
]);
const SCRIPT_OPERANDS = new Set([
	'm:sSup',
	'm:sSub',
	'm:sSubSup',
	'm:acc',
	'm:bar',
	'm:rad',
]);
const GROUP_OPERANDS = new Set(['m:f', 'm:d', 'm:func', 'm:m']);

function isNaryOperand(element: Element): boolean {
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
			!!base?.firstElementChild && isNaryOperand(base.firstElementChild)
		);
	}
	return false;
}

function normalizeEmptyNaryArguments(mathElement: Element): void {
	// Resolve inner/consecutive operators first, and consume only one complete atom.
	for (const operator of [
		...mathElement.getElementsByTagName('m:nary'),
	].reverse()) {
		const properties = [...operator.children].find(
			child => child.tagName === 'm:naryPr',
		);
		const character =
			properties &&
			[...properties.children].find(child => child.tagName === 'm:chr');
		if (!NARY_ARGUMENT_CHARS.has(character?.getAttribute('m:val') ?? ''))
			continue;
		const argument = [...operator.children].find(
			child => child.tagName === 'm:e',
		);
		const operand = operator.nextElementSibling;
		if (
			!argument ||
			argument.children.length ||
			argument.textContent?.trim() ||
			!operand
		)
			continue;
		if (isNaryOperand(operand)) argument.appendChild(operand);
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
	for (const upperLimit of [...mathElement.getElementsByTagName('*')]
		.filter(element => ['m:limUpp', 'm:groupChr'].includes(element.tagName))
		.reverse()) {
		const limit = [...upperLimit.children].find(
			child => child.tagName === 'm:lim',
		);
		const groupProperties = [...upperLimit.children].find(
			child => child.tagName === 'm:groupChrPr',
		);
		const groupCharacter =
			groupProperties &&
			[...groupProperties.children].find(
				child => child.tagName === 'm:chr',
			);
		const groupPosition =
			groupProperties &&
			[...groupProperties.children].find(
				child => child.tagName === 'm:pos',
			);
		const mark =
			upperLimit.tagName === 'm:groupChr'
				? (groupCharacter?.getAttribute('m:val') ?? '')
				: (limit?.textContent?.trim() ?? '');
		if (upperLimit.tagName === 'm:groupChr' && !OVERBAR_CHARS.has(mark))
			continue;
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
			isBar
				? (groupCharacter?.getAttribute('m:pos') ??
						groupPosition?.getAttribute('m:val') ??
						'top')
				: ACCENT_CHARS.get(mark)!,
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
	normalizeScriptStructure(mathElement);
	normalizeAccents(mathElement);
	normalizeEmptyAccentScripts(mathElement);
	normalizeLimitOperators(mathElement);
	normalizeEmptyNaryArguments(mathElement);
	normalizeFractionDelimiters(mathElement);
}
