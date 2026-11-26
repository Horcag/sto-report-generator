import {
	ensureWordChild,
	insideMath,
	paragraphElements,
	paragraphSpacingKind,
	setWordAttribute,
	strictStyleKind,
	withXml,
	WORD_NS,
	wordChild,
	wordElements,
} from './xml';

function normalizeRunProperties(properties: Element): void {
	const fonts = ensureWordChild(properties, 'rFonts');
	for (const name of Array.from(fonts.attributes))
		fonts.removeAttributeNode(name);
	for (const name of ['ascii', 'hAnsi', 'eastAsia', 'cs']) {
		setWordAttribute(fonts, name, 'Times New Roman');
	}
	for (const name of ['b', 'bCs']) {
		setWordAttribute(ensureWordChild(properties, name), 'val', '0');
	}
	const color = ensureWordChild(properties, 'color');
	for (const attribute of Array.from(color.attributes))
		color.removeAttributeNode(attribute);
	setWordAttribute(color, 'val', '000000');
	for (const name of ['sz', 'szCs']) {
		setWordAttribute(ensureWordChild(properties, name), 'val', '28');
	}
}

function setSpacing(properties: Element, line: string): void {
	const spacing = ensureWordChild(properties, 'spacing');
	setWordAttribute(spacing, 'line', line);
	setWordAttribute(spacing, 'lineRule', 'auto');
}

/** Применяет буквальную типографику СТО, сохраняя формулы и структуру документа. */
export function normalizeStrictStoXml(xml: string, stylesXml = ''): string {
	return withXml(xml, document => {
		const isStyles = document.documentElement.localName === 'styles';
		if (isStyles) {
			const defaults = ensureWordChild(
				document.documentElement,
				'docDefaults',
			);
			normalizeRunProperties(
				ensureWordChild(ensureWordChild(defaults, 'rPrDefault'), 'rPr'),
			);
			setSpacing(
				ensureWordChild(ensureWordChild(defaults, 'pPrDefault'), 'pPr'),
				'360',
			);
			for (const style of wordElements(document, 'style')) {
				normalizeRunProperties(ensureWordChild(style, 'rPr'));
				if (style.getAttributeNS(WORD_NS, 'type') === 'paragraph') {
					const id = style.getAttributeNS(WORD_NS, 'styleId');
					const kind = strictStyleKind(id, xml);
					if (kind !== 'math') {
						setSpacing(
							ensureWordChild(style, 'pPr'),
							kind === 'caption' ? '240' : '360',
						);
					}
				}
			}
		}
		for (const level of wordElements(document, 'lvl')) {
			normalizeRunProperties(ensureWordChild(level, 'rPr'));
		}
		for (const paragraph of wordElements(document, 'p')) {
			if (insideMath(paragraph)) continue;
			const runs = paragraphElements(paragraph, 'r').filter(
				run => !insideMath(run),
			);
			const code =
				runs.length > 0 &&
				runs.every(
					run =>
						wordChild(
							wordChild(run, 'rPr') ?? run,
							'rFonts',
						)?.getAttributeNS(WORD_NS, 'ascii') === 'Courier New',
				);
			const hasText = paragraphElements(paragraph, 't').some(
				text => !insideMath(text) && text.textContent?.length,
			);
			if (!hasText && !paragraphElements(paragraph, 'fldChar').length)
				continue;
			const properties = ensureWordChild(paragraph, 'pPr');
			const kind = paragraphSpacingKind(paragraph, stylesXml);
			if (kind !== 'math')
				setSpacing(properties, kind === 'caption' ? '240' : '360');
			if (code) {
				const indent = ensureWordChild(properties, 'ind');
				indent.removeAttributeNS(WORD_NS, 'hanging');
				setWordAttribute(indent, 'left', '0');
				setWordAttribute(indent, 'firstLine', '709');
				setWordAttribute(
					ensureWordChild(properties, 'jc'),
					'val',
					'both',
				);
			}
		}
		for (const run of wordElements(document, 'r')) {
			if (!insideMath(run))
				normalizeRunProperties(ensureWordChild(run, 'rPr'));
		}
		for (const properties of wordElements(document, 'rPr')) {
			if (!insideMath(properties)) normalizeRunProperties(properties);
		}
		return document.documentElement.outerHTML;
	});
}

export function isStrictStoProperty(xml: string): boolean {
	return withXml(xml, document =>
		Array.from(document.documentElement.children).some(
			property =>
				property.getAttribute('name') === 'STOStylePreset' &&
				property.textContent === 'sto-strict',
		),
	);
}
