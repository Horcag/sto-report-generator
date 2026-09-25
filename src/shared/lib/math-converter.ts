import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { mml2omml } from '@hungknguyen/mathml2omml';
import {
	Math as DocxMath,
	ImportedXmlComponent,
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

export class FormulaConversionError extends Error {
	constructor(
		public readonly latex: string,
		reason: string,
	) {
		super(`Formula conversion failed for "${latex}": ${reason}`);
		this.name = 'FormulaConversionError';
	}
}

export function normalizeMathJaxImportSpecifier(file: string): string {
	if (/^[a-zA-Z]:[\\/]/.test(file)) {
		const url = new URL('file:///');
		url.pathname = `/${file.replace(/\\/g, '/')}`;
		return url.href;
	}
	if (path.isAbsolute(file)) {
		return pathToFileURL(file).href;
	}
	return file;
}

async function importMathJaxComponent(file: string): Promise<unknown> {
	return import(normalizeMathJaxImportSpecifier(file));
}

export async function mathJaxReady(): Promise<boolean> {
	if (!mathJaxInstance) {
		mathJaxInstance = await mathjax.init({
			loader: {
				load: ['input/tex'],
				require: importMathJaxComponent,
			},
			tex: {
				macros: {
					stovec: ['\\mathbf{#1}', 1],
					stomat: ['\\mathbf{#1}', 1],
					stotemp: ['\\text{#1}', 1],
					stoelem: ['\\text{#1}', 1],
					stoabbr: ['\\text{#1}', 1],
				},
			},
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
	const run = new StyledMathRun(text.textContent ?? '');
	run.addProperties(item);
	return run;
}

class StyledMathRun extends MathRun {
	addProperties(item: Element): void {
		const properties = [...item.children].filter(
			child => child.tagName === 'w:rPr' || child.tagName === 'm:rPr',
		);
		this.root.unshift(...properties.map(importMathProperty));
	}
}

function importMathProperty(element: Element): ImportedXmlComponent {
	const component = new ImportedXmlComponent(
		element.tagName,
		Object.fromEntries(
			[...element.attributes].map(attribute => [
				attribute.name,
				attribute.value,
			]),
		),
	);
	for (const child of element.childNodes) {
		if (child.nodeType === 1) {
			component.push(importMathProperty(child as Element));
		} else if (child.nodeType === 3 && child.textContent) {
			component.push(child.textContent);
		}
	}
	return component;
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
	const mathMl = new JSDOM(mathMlString, { contentType: 'text/xml' }).window
		.document;
	const mathError = mathMl.getElementsByTagName('merror')[0];
	if (mathError) {
		throw new Error(
			mathError.getAttribute('data-mjx-error') ??
				mathError.textContent ??
				'MathJax reported malformed TeX.',
		);
	}
	const unknownCommand = [...mathMl.getElementsByTagName('mtext')].find(
		element =>
			element.getAttribute('mathcolor') === 'red' &&
			element.getAttribute('data-latex')?.startsWith('\\'),
	);
	if (unknownCommand) {
		throw new Error(
			`Unknown TeX command ${unknownCommand.getAttribute('data-latex')}.`,
		);
	}
	const ommlString = mml2omml(mathMlString, { disableDecode: true });
	return convertOmml2Math(ommlString);
}

export function convertLatex2Math(latexString: string): DocxMath {
	if (!mathJaxInstance) {
		throw new Error(
			'MathJax is not initialized. Call mathJaxReady() before converting formulas.',
		);
	}
	try {
		return convertMathMl2Math(mathJaxInstance.tex2mml(latexString));
	} catch (error) {
		throw new FormulaConversionError(
			latexString,
			error instanceof Error ? error.message : String(error),
		);
	}
}
