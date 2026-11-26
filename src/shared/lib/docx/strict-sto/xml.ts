import { JSDOM } from 'jsdom';

import { isMathLayoutTable } from '../../sto-validator/math-layout-table';
import { findWordStyleXml } from '../styles';

export const WORD_NS =
	'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
export const MATH_NS =
	'http://schemas.openxmlformats.org/officeDocument/2006/math';

const ORDER: Record<string, string[]> = {
	styles: ['docDefaults', 'latentStyles', 'style'],
	style: 'name aliases basedOn next link autoRedefine hidden uiPriority semiHidden unhideWhenUsed qFormat locked personal personalCompose personalReply rsid pPr rPr tblPr trPr tcPr tblStylePr'.split(
		' ',
	),
	docDefaults: ['rPrDefault', 'pPrDefault'],
	lvl: 'start numFmt lvlRestart pStyle isLgl suff lvlText lvlPicBulletId legacy lvlJc pPr rPr'.split(
		' ',
	),
	rPr: 'rStyle rFonts b bCs i iCs caps smallCaps strike dstrike outline shadow emboss imprint noProof snapToGrid vanish webHidden color spacing w kern position sz szCs highlight u effect bdr shd fitText vertAlign rtl cs em lang eastAsianLayout specVanish oMath rPrChange'.split(
		' ',
	),
	pPr: 'pStyle keepNext keepLines pageBreakBefore framePr widowControl numPr suppressLineNumbers pBdr shd tabs suppressAutoHyphens kinsoku wordWrap overflowPunct topLinePunct autoSpaceDE autoSpaceDN bidi adjustRightInd snapToGrid spacing ind contextualSpacing mirrorIndents suppressOverlap jc textDirection textAlignment textboxTightWrap outlineLvl divId cnfStyle rPr sectPr pPrChange'.split(
		' ',
	),
};

export function wordElements(
	parent: Document | Element,
	name: string,
): Element[] {
	return Array.from(parent.getElementsByTagNameNS(WORD_NS, name));
}

export function wordChild(parent: Element, name: string): Element | undefined {
	return Array.from(parent.children).find(
		child => child.namespaceURI === WORD_NS && child.localName === name,
	);
}

export function paragraphElements(paragraph: Element, name: string): Element[] {
	return wordElements(paragraph, name).filter(element => {
		for (
			let parent = element.parentElement;
			parent;
			parent = parent.parentElement
		) {
			if (parent.namespaceURI === WORD_NS && parent.localName === 'p')
				return parent === paragraph;
		}
		return false;
	});
}

export function strictStyleKind(
	id: string | null,
	stylesXml: string,
): 'caption' | 'math' | 'ordinary' {
	const visited = new Set<string>();
	while (id && !visited.has(id)) {
		visited.add(id);
		if (id === 'TableCaption') return 'caption';
		if (id === 'Formula' || id === 'MTDisplayEquation') return 'math';
		const style = findWordStyleXml(stylesXml, id) ?? '';
		const name = /<w:name\b[^>]*w:val="([^"]+)"/.exec(style)?.[1];
		if (name === 'Table Caption' || name === '+№ - Название таблицы')
			return 'caption';
		if (name === 'Display Equation') return 'math';
		id = /<w:basedOn\b[^>]*w:val="([^"]+)"/.exec(style)?.[1] ?? null;
	}
	return 'ordinary';
}

export function ensureWordChild(parent: Element, name: string): Element {
	const existing = wordChild(parent, name);
	if (existing) return existing;
	const child = parent.ownerDocument.createElementNS(WORD_NS, `w:${name}`);
	const order = ORDER[parent.localName];
	const rank = order?.indexOf(name) ?? -1;
	const next = Array.from(parent.children).find(candidate => {
		if (rank < 0) return name === 'pPr' || name === 'rPr';
		const candidateRank = order.indexOf(candidate.localName);
		return candidateRank >= 0 && candidateRank > rank;
	});
	parent.insertBefore(child, next ?? null);
	return child;
}

export function setWordAttribute(
	element: Element,
	name: string,
	value: string,
) {
	element.setAttributeNS(WORD_NS, `w:${name}`, value);
}

export function wordValue(element: Element | undefined): string | null {
	return element?.getAttributeNS(WORD_NS, 'val') ?? null;
}

export function insideMath(element: Element): boolean {
	for (
		let current: Element | null = element;
		current;
		current = current.parentElement
	) {
		if (current.namespaceURI === MATH_NS) return true;
	}
	return false;
}

export function withXml<T>(xml: string, action: (document: Document) => T): T {
	const dom = new JSDOM(xml, { contentType: 'text/xml' });
	try {
		return action(dom.window.document);
	} finally {
		dom.window.close();
	}
}

export function paragraphSpacingKind(
	paragraph: Element,
	stylesXml: string,
): 'caption' | 'math' | 'ordinary' {
	const style = wordValue(
		wordChild(wordChild(paragraph, 'pPr') ?? paragraph, 'pStyle'),
	);
	const kind = strictStyleKind(style, stylesXml);
	if (kind !== 'ordinary') return kind;
	for (
		let parent = paragraph.parentElement;
		parent;
		parent = parent.parentElement
	) {
		if (parent.namespaceURI === WORD_NS && parent.localName === 'tbl') {
			if (isMathLayoutTable(parent.outerHTML, stylesXml)) return 'math';
			break;
		}
	}
	if (
		paragraph.getElementsByTagNameNS(MATH_NS, 'oMath').length &&
		!paragraphElements(paragraph, 't').some(
			text => !insideMath(text) && text.textContent?.trim(),
		)
	)
		return 'math';
	return 'ordinary';
}
