const MATH_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/math';
const MAX_CLONED_ELEMENTS = 10_000;
const TRUE_VALUES = new Set(['1', 'true', 'on']);

function direct(parent: Element, name: string): Element[] {
	return [...parent.children].filter(
		child => child.namespaceURI === MATH_NS && child.localName === name,
	);
}

/** Give scalable fraction fences clearance without changing their visible base. */
export function normalizeFractionDelimiters(root: Element): number {
	const delimiters = [...root.getElementsByTagNameNS(MATH_NS, 'd')];
	if (root.namespaceURI === MATH_NS && root.localName === 'd')
		delimiters.unshift(root);
	let clonedElements = 0;
	let fixed = 0;
	// Snapshot first: inner additions make outer enclosures ineligible for copying.
	for (const delimiter of delimiters.reverse()) {
		const properties = direct(delimiter, 'dPr')[0];
		const arguments_ = direct(delimiter, 'e');
		if (
			!properties ||
			!TRUE_VALUES.has(
				direct(properties, 'grow')[0]?.getAttributeNS(MATH_NS, 'val') ??
					'',
			) ||
			arguments_.length !== 1 ||
			direct(arguments_[0], 'argPr').length > 0 ||
			(direct(properties, 'begChr')[0]?.getAttributeNS(MATH_NS, 'val') ===
				'' &&
				direct(properties, 'endChr')[0]?.getAttributeNS(
					MATH_NS,
					'val',
				) === '') ||
			!delimiter.getElementsByTagNameNS(MATH_NS, 'f').length ||
			delimiter.getElementsByTagNameNS(MATH_NS, 'm').length ||
			delimiter.getElementsByTagNameNS(MATH_NS, 'phant').length
		)
			continue;
		const argument = arguments_[0];
		const count = argument.getElementsByTagName('*').length;
		if (clonedElements + count > MAX_CLONED_ELEMENTS) {
			throw new Error(
				`Fraction delimiter clearance exceeds ${MAX_CLONED_ELEMENTS} cloned XML elements.`,
			);
		}
		const document = root.ownerDocument;
		const create = (name: string, value?: string) => {
			const element = document.createElementNS(MATH_NS, `m:${name}`);
			if (value !== undefined)
				element.setAttributeNS(MATH_NS, 'm:val', value);
			return element;
		};
		const phantom = create('phant');
		const phantomProperties = create('phantPr');
		phantomProperties.append(create('show', '0'), create('zeroWid', '1'));
		const phantomBase = create('e');
		const box = create('box');
		const boxBase = create('e');
		const argumentProperties = create('argPr');
		argumentProperties.append(create('argSz', '1'));
		boxBase.append(argumentProperties);
		for (const child of [...argument.childNodes])
			boxBase.appendChild(child.cloneNode(true));
		box.append(boxBase);
		phantomBase.append(box);
		phantom.append(phantomProperties, phantomBase);
		argument.append(phantom);
		clonedElements += count;
		fixed += 1;
	}
	return fixed;
}
