import type { LineDash, ShapeLineCap, ShapeLineJoin } from 'docx/shapes';

import { parseSvgPaint } from './color';
import { SvgComputedStyle, SvgStrokeDash } from './types';

const PIXELS_PER_INCH = 96;
const SUPPORTED_NAMED_FONTS = new Map<string, string>([
	['times new roman', 'Times New Roman'],
	['times', 'Times New Roman'],
	['serif', 'Times New Roman'],
	['dejavu serif', 'Times New Roman'],
	['liberation serif', 'Times New Roman'],
	['georgia', 'Georgia'],
	['cambria', 'Cambria'],
	['arial', 'Arial'],
	['helvetica', 'Arial'],
	['sans-serif', 'Arial'],
	['dejavu sans', 'Arial'],
	['liberation sans', 'Arial'],
	['calibri', 'Calibri'],
	['verdana', 'Verdana'],
	['tahoma', 'Tahoma'],
	['segoe ui', 'Segoe UI'],
	['courier new', 'Courier New'],
	['courier', 'Courier New'],
	['monospace', 'Courier New'],
	['dejavu sans mono', 'Courier New'],
	['liberation mono', 'Courier New'],
	['consolas', 'Consolas'],
]);

export const DEFAULT_SVG_STYLE: SvgComputedStyle = {
	fillRaw: '#000000',
	fillOpacity: 1,
	fillRule: 'nonzero',
	strokeRaw: 'none',
	strokeWidth: 1,
	strokeOpacity: 1,
	strokeDasharray: 'none',
	strokeLinecap: 'flat',
	strokeLinejoin: 'miter',
	opacity: 1,
	colorHex: '000000',
	fontFamily: 'Times New Roman',
	fontSizePx: 12,
	bold: false,
	italic: false,
	textAnchor: 'start',
	dominantBaseline: 'auto',
	display: 'inline',
	visibility: 'visible',
};

const INHERITED_PROPERTIES = new Set([
	'color',
	'dominant-baseline',
	'alignment-baseline',
	'fill',
	'fill-opacity',
	'fill-rule',
	'font-family',
	'font-size',
	'font-style',
	'font-weight',
	'marker-end',
	'marker-mid',
	'marker-start',
	'stroke',
	'stroke-dasharray',
	'stroke-linecap',
	'stroke-linejoin',
	'stroke-opacity',
	'stroke-width',
	'text-anchor',
	'visibility',
]);

export interface CssStyleRule {
	selectors: string[];
	declarations: ReadonlyMap<string, string>;
	order: number;
}

function parseDeclarationBlock(block: string): Map<string, string> {
	const map = new Map<string, string>();
	for (const entry of block.split(';')) {
		const colon = entry.indexOf(':');
		if (colon < 0) continue;
		const key = entry.slice(0, colon).trim().toLowerCase();
		const value = entry
			.slice(colon + 1)
			.replace(/\s*!\s*important\s*$/iu, '')
			.trim();
		if (key && value) map.set(key, value);
	}
	return map;
}

/** Extract rule blocks from `<style>` elements (rejecting dynamic `@import` or unsupported scripting directives). */
export function collectCssRules(root: Element): CssStyleRule[] {
	const rules: CssStyleRule[] = [];
	let order = 0;
	for (const styleEl of root.querySelectorAll('style')) {
		const rawCss = (styleEl.textContent ?? '').replace(
			/\/\*[\s\S]*?\*\//gu,
			'',
		);
		for (const match of rawCss.matchAll(/([^{}]+)\{([^{}]*)\}/gu)) {
			const selectorText = match[1].trim();
			if (selectorText.startsWith('@')) continue;
			const declarations = parseDeclarationBlock(match[2]);
			if (declarations.size === 0) continue;
			const selectors = selectorText
				.split(',')
				.map(item => item.trim())
				.filter(Boolean);
			rules.push({ selectors, declarations, order: order++ });
		}
	}
	return rules;
}

function selectorSpecificity(
	selector: string,
): [number, number, number] | null {
	if (/[:[\]+~]/u.test(selector)) return null;
	const parts = selector
		.trim()
		.replace(/\s*>\s*/gu, ' > ')
		.split(/\s+/u)
		.filter(item => item !== '>');
	let ids = 0;
	let classes = 0;
	let tags = 0;
	for (const part of parts) {
		if (!part || part === '*') continue;
		const segments = part.split(/(?=[#.])/u);
		for (const segment of segments) {
			if (segment.startsWith('#')) ids += 1;
			else if (segment.startsWith('.')) classes += 1;
			else tags += 1;
		}
	}
	return [ids, classes, tags];
}

function matchesSimpleSelector(element: Element, simple: string): boolean {
	if (simple === '*') return true;
	const idMatch = /#([a-zA-Z0-9_-]+)/u.exec(simple);
	if (idMatch && element.getAttribute('id') !== idMatch[1]) return false;
	const tagMatch = /^([a-zA-Z0-9_-]+)/u.exec(simple);
	if (tagMatch && element.localName !== tagMatch[1]) return false;
	const classNames = (element.getAttribute('class') ?? '')
		.split(/\s+/u)
		.filter(Boolean);
	for (const classMatch of simple.matchAll(/\.([a-zA-Z0-9_-]+)/gu)) {
		if (!classNames.includes(classMatch[1])) return false;
	}
	return true;
}

function matchesSelector(element: Element, selector: string): boolean {
	const tokens = selector
		.trim()
		.replace(/\s*>\s*/gu, ' > ')
		.split(/\s+/u)
		.filter(Boolean);
	if (tokens.length === 0) return false;
	const walk = (index: number, current: Element | null): boolean => {
		if (!current) return false;
		const token = tokens[index];
		if (!matchesSimpleSelector(current, token)) return false;
		if (index === 0) return true;
		if (tokens[index - 1] === '>') {
			return walk(index - 2, current.parentElement);
		}
		for (let anc = current.parentElement; anc; anc = anc.parentElement) {
			if (walk(index - 1, anc)) return true;
		}
		return false;
	};
	return walk(tokens.length - 1, element);
}

/** Convert an SVG length string (`px`, `pt`, `mm`, `cm`, `in`, `em`, `%`) into SVG user units (px). */
export function parseSvgLength(
	raw: string | null | undefined,
	fallback: number,
	emBasePx = 12,
	percentBase?: number,
): number {
	if (!raw) return fallback;
	const value = raw.trim().toLowerCase();
	if (!value) return fallback;
	const match =
		/^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)\s*(px|pt|mm|cm|in|em|rem|%)?$/u.exec(
			value,
		);
	if (!match) {
		throw new Error(`Unsupported SVG length value "${raw}".`);
	}
	const num = Number.parseFloat(match[1]);
	const unit = match[2] ?? 'px';
	switch (unit) {
		case 'px':
			return num;
		case 'pt':
			return (num * PIXELS_PER_INCH) / 72;
		case 'mm':
			return (num * PIXELS_PER_INCH) / 25.4;
		case 'cm':
			return (num * PIXELS_PER_INCH) / 2.54;
		case 'in':
			return num * PIXELS_PER_INCH;
		case 'em':
		case 'rem':
			return num * emBasePx;
		case '%':
			if (percentBase === undefined) {
				throw new Error(
					`Percentage length "${raw}" requires a known viewport axis.`,
				);
			}
			return (num / 100) * percentBase;
		default:
			return num;
	}
}

export function normalizeFontFamily(raw: string): string {
	for (const candidate of raw.split(',')) {
		const cleaned = candidate.trim().replace(/^["']|["']$/gu, '');
		const mapped = SUPPORTED_NAMED_FONTS.get(cleaned.toLowerCase());
		if (mapped) return mapped;
	}
	const first = raw
		.split(',')[0]
		?.trim()
		.replace(/^["']|["']$/gu, '');
	return first || 'Times New Roman';
}

function parseUnitInterval(raw: string, fallback: number): number {
	const value = Number.parseFloat(raw);
	return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : fallback;
}

function normalizeUrlRef(raw: string | undefined): string | undefined {
	if (!raw || raw.trim().toLowerCase() === 'none') return undefined;
	const match = /^url\(\s*#([^)\s]+)\s*\)$/iu.exec(raw.trim());
	return match?.[1];
}

function resolveMarkerAttr(
	value: string | undefined,
	inherited: string | undefined,
): string | undefined {
	if (value === undefined) return inherited;
	return normalizeUrlRef(value);
}

/** Resolve full SVG style inheritance across parent styles, presentation attributes, `<style>` rules, and inline `style=""`. */
export function resolveElementStyle(
	element: Element,
	parent: SvgComputedStyle,
	rules: readonly CssStyleRule[],
): SvgComputedStyle {
	const declarations = new Map<string, string>();
	for (const attribute of Array.from(element.attributes)) {
		const key = attribute.localName.toLowerCase();
		if (
			INHERITED_PROPERTIES.has(key) ||
			key === 'opacity' ||
			key === 'display'
		) {
			declarations.set(key, attribute.value.trim());
		}
	}
	const matchedRules: {
		spec: [number, number, number];
		order: number;
		rule: CssStyleRule;
	}[] = [];
	for (const rule of rules) {
		for (const selector of rule.selectors) {
			const spec = selectorSpecificity(selector);
			if (!spec) {
				if (selector.includes(':')) {
					throw new Error(
						`Unsupported CSS selector "${selector}" in SVG <style>.`,
					);
				}
				continue;
			}
			if (matchesSelector(element, selector)) {
				matchedRules.push({ spec, order: rule.order, rule });
			}
		}
	}
	matchedRules.sort(
		(left, right) =>
			left.spec[0] - right.spec[0] ||
			left.spec[1] - right.spec[1] ||
			left.spec[2] - right.spec[2] ||
			left.order - right.order,
	);
	for (const item of matchedRules) {
		for (const [key, value] of item.rule.declarations) {
			declarations.set(key, value);
		}
	}
	const inlineStyle = element.getAttribute('style');
	if (inlineStyle) {
		for (const [key, value] of parseDeclarationBlock(inlineStyle)) {
			declarations.set(key, value);
		}
	}
	const get = (name: string): string | undefined => {
		const val = declarations.get(name);
		return val?.toLowerCase() === 'inherit' ? undefined : val;
	};
	const colorRaw = get('color');
	const colorHex = colorRaw
		? (parseSvgPaint(colorRaw, parent.colorHex)?.hex ?? parent.colorHex)
		: parent.colorHex;
	const fontSizeRaw = get('font-size');
	const fontSizePx = fontSizeRaw
		? parseSvgLength(fontSizeRaw, parent.fontSizePx, parent.fontSizePx)
		: parent.fontSizePx;
	const strokeWidthRaw = get('stroke-width');
	const strokeWidth = strokeWidthRaw
		? Math.max(
				0,
				parseSvgLength(strokeWidthRaw, parent.strokeWidth, fontSizePx),
			)
		: parent.strokeWidth;
	const cap = (get('stroke-linecap') ?? '').toLowerCase();
	const strokeLinecap: ShapeLineCap =
		cap === 'round'
			? 'round'
			: cap === 'square'
				? 'square'
				: cap === 'butt'
					? 'flat'
					: parent.strokeLinecap;
	const join = (get('stroke-linejoin') ?? '').toLowerCase();
	const strokeLinejoin: ShapeLineJoin =
		join === 'round'
			? 'round'
			: join === 'bevel'
				? 'bevel'
				: join === 'miter'
					? 'miter'
					: parent.strokeLinejoin;
	const anchor = (get('text-anchor') ?? '').toLowerCase();
	const textAnchor: 'start' | 'middle' | 'end' =
		anchor === 'middle' || anchor === 'end' || anchor === 'start'
			? anchor
			: parent.textAnchor;
	const boldAttr = (get('font-weight') ?? '').toLowerCase();
	const bold = boldAttr
		? boldAttr === 'bold' ||
			boldAttr === 'bolder' ||
			Number.parseFloat(boldAttr) >= 600
		: parent.bold;
	const italicAttr = (get('font-style') ?? '').toLowerCase();
	const italic = italicAttr
		? italicAttr === 'italic' || italicAttr === 'oblique'
		: parent.italic;
	const fillRuleAttr = (get('fill-rule') ?? '').toLowerCase();
	const fillRule: 'nonzero' | 'evenodd' =
		fillRuleAttr === 'evenodd' || fillRuleAttr === 'nonzero'
			? fillRuleAttr
			: parent.fillRule;
	const opacityAttr = get('opacity');
	const elementOpacity = opacityAttr ? parseUnitInterval(opacityAttr, 1) : 1;
	const fillOpAttr = get('fill-opacity');
	const strokeOpAttr = get('stroke-opacity');

	return {
		fillRaw: get('fill') ?? parent.fillRaw,
		fillOpacity: fillOpAttr
			? parseUnitInterval(fillOpAttr, parent.fillOpacity)
			: parent.fillOpacity,
		fillRule,
		strokeRaw: get('stroke') ?? parent.strokeRaw,
		strokeWidth,
		strokeOpacity: strokeOpAttr
			? parseUnitInterval(strokeOpAttr, parent.strokeOpacity)
			: parent.strokeOpacity,
		strokeDasharray: get('stroke-dasharray') ?? parent.strokeDasharray,
		strokeLinecap,
		strokeLinejoin,
		opacity: parent.opacity * elementOpacity,
		colorHex,
		fontFamily: get('font-family')
			? normalizeFontFamily(get('font-family')!)
			: parent.fontFamily,
		fontSizePx,
		bold,
		italic,
		textAnchor,
		dominantBaseline: (
			get('dominant-baseline') ??
			get('alignment-baseline') ??
			parent.dominantBaseline
		).toLowerCase(),
		markerStart: resolveMarkerAttr(get('marker-start'), parent.markerStart),
		markerEnd: resolveMarkerAttr(get('marker-end'), parent.markerEnd),
		markerMid: resolveMarkerAttr(get('marker-mid'), parent.markerMid),
		display: (get('display') ?? 'inline').toLowerCase(),
		visibility: (get('visibility') ?? parent.visibility).toLowerCase(),
	};
}

/** Map SVG `stroke-dasharray` values into OOXML `LineDash` or `CustomLineDash` multiples of stroke width. */
export function resolveStrokeDash(
	dasharrayRaw: string,
	strokeWidth: number,
): SvgStrokeDash | undefined {
	const raw = dasharrayRaw.trim().toLowerCase();
	if (!raw || raw === 'none') return undefined;
	const numbers = raw
		.split(/[\s,]+/u)
		.filter(Boolean)
		.map(token => parseSvgLength(token, 0));
	if (
		numbers.length === 0 ||
		numbers.some(value => !Number.isFinite(value) || value < 0) ||
		numbers.every(value => value === 0)
	) {
		return undefined;
	}
	const expanded =
		numbers.length % 2 === 1 ? [...numbers, ...numbers] : numbers;
	const width = Math.max(strokeWidth, 0.25);
	const pairs: { length: number; gap: number }[] = [];
	for (let i = 0; i < expanded.length; i += 2) {
		pairs.push({
			length: Math.max(0, expanded[i] / width),
			gap: Math.max(0, expanded[i + 1] / width),
		});
	}
	if (pairs.length === 1 && pairs[0].length <= 1.25 && pairs[0].gap >= 0.8) {
		return 'dot' as LineDash;
	}
	return pairs;
}
