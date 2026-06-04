import { mml2omml } from '@hungknguyen/mathml2omml';
import {
	Math as DocxMath,
	MathFraction,
	MathIntegral,
	MathLimitLower,
	MathLimitUpper,
	MathRadical,
	MathRun,
	MathSubScript,
	MathSubSuperScript,
	MathSum,
	MathSuperScript,
} from 'docx';
import { JSDOM } from 'jsdom';
import mathjax, { MathJaxApi } from 'mathjax';

type DocxMathChild =
	| MathFraction
	| MathIntegral
	| MathLimitLower
	| MathLimitUpper
	| MathRadical
	| MathRun
	| MathSubScript
	| MathSubSuperScript
	| MathSum
	| MathSuperScript;

let mathJaxInstance: MathJaxApi | undefined;

export async function mathJaxReady(): Promise<boolean> {
	if (!mathJaxInstance) {
		mathJaxInstance = await mathjax.init({
			loader: { load: ['input/tex'] },
		});
	}
	return true;
}

function convertChildren(children: HTMLCollection): DocxMathChild[] {
	return [...children]
		.map(child => convertItem(child))
		.filter((child): child is DocxMathChild => child !== undefined);
}

function firstChildByTagName(element: Element, tagName: string): Element {
	const child = element.getElementsByTagName(tagName)[0];
	if (!child) {
		throw new Error(`Malformed OMML: ${tagName} not found.`);
	}
	return child;
}

function convertItem(item: Element): DocxMathChild | undefined {
	const tagName = item.tagName.toLowerCase();
	if (tagName === 'm:f') {
		return buildFraction(item);
	}
	if (tagName === 'm:r') {
		return buildMathRun(item);
	}
	if (tagName === 'm:ssub') {
		return buildSubScript(item);
	}
	if (tagName === 'm:ssup') {
		return buildSuperScript(item);
	}
	if (tagName === 'm:ssubsup') {
		return buildSubSuperScript(item);
	}
	if (tagName === 'm:rad') {
		return buildRadical(item);
	}
	if (tagName === 'm:limupp') {
		return buildLimitUpper(item);
	}
	if (tagName === 'm:limlow') {
		return buildLimitLower(item);
	}
	if (tagName === 'm:nary') {
		return buildNary(item);
	}
	return new MathRun('口');
}

function buildFraction(item: Element): MathFraction {
	const numerator = firstChildByTagName(item, 'm:num');
	const denominator = firstChildByTagName(item, 'm:den');
	return new MathFraction({
		numerator: convertChildren(numerator.children),
		denominator: convertChildren(denominator.children),
	});
}

function buildMathRun(item: Element): MathRun {
	const text = firstChildByTagName(item, 'm:t');
	return new MathRun(text.textContent ?? '');
}

function buildSubScript(item: Element): MathSubScript {
	const element = firstChildByTagName(item, 'm:e');
	const subScript = firstChildByTagName(item, 'm:sub');
	return new MathSubScript({
		children: convertChildren(element.children),
		subScript: convertChildren(subScript.children),
	});
}

function buildSuperScript(item: Element): MathSuperScript {
	const element = firstChildByTagName(item, 'm:e');
	const superScript = firstChildByTagName(item, 'm:sup');
	return new MathSuperScript({
		children: convertChildren(element.children),
		superScript: convertChildren(superScript.children),
	});
}

function buildSubSuperScript(item: Element): MathSubSuperScript {
	const element = firstChildByTagName(item, 'm:e');
	const subScript = firstChildByTagName(item, 'm:sub');
	const superScript = firstChildByTagName(item, 'm:sup');
	return new MathSubSuperScript({
		children: convertChildren(element.children),
		subScript: convertChildren(subScript.children),
		superScript: convertChildren(superScript.children),
	});
}

function buildRadical(item: Element): MathRadical {
	const element = firstChildByTagName(item, 'm:e');
	const degree = item.getElementsByTagName('m:deg')[0]?.children[0];
	return new MathRadical({
		children: convertChildren(element.children),
		degree: degree
			? [convertItem(degree)].filter(
					(child): child is DocxMathChild => !!child,
				)
			: undefined,
	});
}

function buildLimitUpper(item: Element): MathLimitUpper {
	const element = firstChildByTagName(item, 'm:e');
	const limit = firstChildByTagName(item, 'm:lim');
	return new MathLimitUpper({
		children: convertChildren(element.children),
		limit: convertChildren(limit.children),
	});
}

function buildLimitLower(item: Element): MathLimitLower {
	const element = firstChildByTagName(item, 'm:e');
	const limit = firstChildByTagName(item, 'm:lim');
	return new MathLimitLower({
		children: convertChildren(element.children),
		limit: convertChildren(limit.children),
	});
}

function buildNary(item: Element): MathIntegral | MathSum | undefined {
	const char = firstChildByTagName(item, 'm:chr');
	const charValue = char.getAttribute('m:val');
	const element = firstChildByTagName(item, 'm:e');
	const subScript = firstChildByTagName(item, 'm:sub');
	const superScript = firstChildByTagName(item, 'm:sup');
	const options = {
		children: convertChildren(element.children),
		subScript: convertChildren(subScript.children),
		superScript: convertChildren(superScript.children),
	};

	if (charValue === '∑') {
		return new MathSum(options);
	}
	if (charValue === '∫') {
		return new MathIntegral(options);
	}
	return undefined;
}

export function convertOmml2Math(ommlString: string): DocxMath {
	const document = new JSDOM(ommlString, { contentType: 'text/xml' }).window
		.document;
	const mathElement = document.getElementsByTagName('m:oMath')[0];
	if (!mathElement) {
		throw new Error('Malformed OMML: m:oMath not found.');
	}
	return new DocxMath({
		children: convertChildren(mathElement.children),
	});
}

export function convertMathMl2Math(mathMlString: string): DocxMath {
	const ommlString = mml2omml(mathMlString, { disableDecode: true });
	return convertOmml2Math(ommlString);
}

export function convertLatex2Math(latexString: string): DocxMath {
	if (!mathJaxInstance) {
		throw new Error(
			'MathJax is not initialized. Call mathJaxReady() before converting formulas.',
		);
	}
	return convertMathMl2Math(mathJaxInstance.tex2mml(latexString));
}
