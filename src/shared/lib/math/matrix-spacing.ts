import { STO_RULES } from '../../config/sto-rules';

const MATHML_NS = 'http://www.w3.org/1998/Math/MathML';
const OMML_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/math';
const SIZE_CONTEXTS = new Set([
	'mfrac',
	'msqrt',
	'mroot',
	'msub',
	'msup',
	'msubsup',
	'munder',
	'mover',
	'munderover',
	'mmultiscripts',
]);

function hasNormalMatrixSize(matrix: Element): boolean {
	for (let node: Element | null = matrix; node; node = node.parentElement) {
		if (node.namespaceURI !== MATHML_NS) continue;
		if (
			SIZE_CONTEXTS.has(node.localName) ||
			node.hasAttribute('mathsize') ||
			(node.hasAttribute('scriptlevel') &&
				node.getAttribute('scriptlevel') !== '0')
		)
			return false;
	}
	return true;
}

export function matrixMinRowBaselineTwips(matrix: Element): number | undefined {
	if (!hasNormalMatrixSize(matrix)) return undefined;
	const values = matrix.getAttribute('rowspacing')?.trim().split(/\s+/u);
	if (
		!values?.length ||
		values.some(value => !/^(?:\d+(?:\.\d*)?|\.\d+)pt$/u.test(value))
	)
		return undefined;
	const gaps = values.map(value => Number(value.slice(0, -2)));
	if (gaps.some(gap => !Number.isFinite(gap) || gap !== gaps[0]))
		return undefined;
	// Deliberate TeX-style 1.2em strut policy for normal report text, not an
	// exact MathML row-gap conversion. Word's rSpRule=3 is a minimum baseline
	// distance in TWIPS (MS-OI29500 Word implementation note for rSp); tall cells may expand it.
	const twips = Math.round(
		(1.2 * STO_RULES.typography.fontSizePoints + gaps[0]) * 20,
	);
	return Number.isSafeInteger(twips) ? twips : undefined;
}

export function matrixColumnGapTwips(matrix: Element): number | undefined {
	if (!hasNormalMatrixSize(matrix)) return undefined;
	const values = matrix.getAttribute('columnspacing')?.trim().split(/\s+/u);
	if (!values?.length) return undefined;
	const gaps = values.map(value => {
		const match = /^(\d+(?:\.\d*)?|\.\d+)(em|pt)$/u.exec(value);
		return match
			? Number(match[1]) *
					(match[2] === 'em'
						? STO_RULES.typography.fontSizePoints
						: 1)
			: NaN;
	});
	if (gaps.some(gap => !Number.isFinite(gap) || gap !== gaps[0]))
		return undefined;
	const twips = Math.round(gaps[0] * 20);
	return Number.isSafeInteger(twips) ? twips : undefined;
}

const PROPERTY_ORDER = [
	'baseJc',
	'plcHide',
	'rSpRule',
	'cGpRule',
	'rSp',
	'cSp',
	'cGp',
	'mcs',
	'ctrlPr',
];

function restoreSpacing(
	properties: Element,
	rule: string,
	spacing: string,
	twips: number,
): void {
	for (const child of [...properties.children]) {
		if (
			child.namespaceURI === OMML_NS &&
			[rule, spacing].includes(child.localName)
		)
			child.remove();
	}
	for (const [name, value] of [
		[rule, '3'],
		[spacing, String(twips)],
	]) {
		const following =
			[...properties.children].find(
				child =>
					child.namespaceURI === OMML_NS &&
					PROPERTY_ORDER.indexOf(child.localName) >
						PROPERTY_ORDER.indexOf(name),
			) ?? null;
		const property = properties.ownerDocument.createElementNS(
			OMML_NS,
			`m:${name}`,
		);
		property.setAttributeNS(OMML_NS, 'm:val', value);
		properties.insertBefore(property, following);
	}
}

export function restoreMatrixRowSpacing(
	properties: Element,
	twips: number,
): void {
	restoreSpacing(properties, 'rSpRule', 'rSp', twips);
}

export function restoreMatrixColumnSpacing(
	properties: Element,
	twips: number,
): void {
	// Word cGpRule=3 expresses the column gap directly in TWIPS.
	restoreSpacing(properties, 'cGpRule', 'cGp', twips);
}
