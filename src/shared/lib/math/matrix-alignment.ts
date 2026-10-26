import { JSDOM } from 'jsdom';

import {
	matrixColumnGapTwips,
	matrixMinRowBaselineTwips,
	restoreMatrixColumnSpacing,
	restoreMatrixRowSpacing,
} from './matrix-spacing';

const MATHML_NS = 'http://www.w3.org/1998/Math/MathML';
const OMML_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/math';

export interface MatrixAlignment {
	columns: string[];
	rowLengths: number[];
	parent: number | null;
	minRowBaselineTwips?: number;
	columnGapTwips?: number;
}

function direct(element: Element, namespace: string, name: string): Element[] {
	return [...element.children].filter(
		child => child.namespaceURI === namespace && child.localName === name,
	);
}

function parentMatrix(element: Element, matrices: Element[]): number | null {
	for (
		let parent = element.parentElement;
		parent;
		parent = parent.parentElement
	) {
		const index = matrices.indexOf(parent);
		if (index !== -1) return index;
	}
	return null;
}

/** Read column alignment before mathml2omml replaces every table alignment with center. */
export function collectMatrixAlignments(document: Document): MatrixAlignment[] {
	const matrices = [...document.getElementsByTagNameNS(MATHML_NS, 'mtable')];
	return matrices.map(matrix => {
		const rows = direct(matrix, MATHML_NS, 'mtr');
		const rowLengths = rows.map(
			row => direct(row, MATHML_NS, 'mtd').length,
		);
		if (
			!rows.length ||
			rows.length !== matrix.children.length ||
			rowLengths.some(length => length === 0)
		) {
			throw new Error('Unsupported MathML matrix row structure.');
		}
		const alignments = (
			matrix.getAttribute('columnalign')?.trim() || 'center'
		).split(/\s+/u);
		if (
			alignments.some(
				alignment => !['left', 'center', 'right'].includes(alignment),
			)
		) {
			throw new Error('Unsupported MathML matrix column alignment.');
		}
		const minRowBaselineTwips = matrixMinRowBaselineTwips(matrix);
		const columnGapTwips = matrixColumnGapTwips(matrix);
		return {
			...(minRowBaselineTwips === undefined
				? {}
				: { minRowBaselineTwips }),
			...(columnGapTwips === undefined ? {} : { columnGapTwips }),
			columns: Array.from(
				{ length: Math.max(...rowLengths) },
				(_, index) => alignments[index] ?? alignments.at(-1)!,
			),
			rowLengths,
			parent: parentMatrix(matrix, matrices),
		};
	});
}

/** Restore source alignment only when matrix count, nesting and dimensions still agree. */
export function restoreMatrixAlignments(
	omml: string,
	source: readonly MatrixAlignment[],
): string {
	const document = new JSDOM(omml, { contentType: 'text/xml' }).window
		.document;
	const matrices = [...document.getElementsByTagNameNS(OMML_NS, 'm')];
	if (matrices.length !== source.length)
		throw new Error('MathML/OMML matrix count mismatch.');
	for (const [index, matrix] of matrices.entries()) {
		const expected = source[index];
		const rows = direct(matrix, OMML_NS, 'mr');
		if (
			parentMatrix(matrix, matrices) !== expected.parent ||
			rows.length !== expected.rowLengths.length ||
			rows.some(
				(row, rowIndex) =>
					direct(row, OMML_NS, 'e').length !==
					expected.rowLengths[rowIndex],
			)
		) {
			throw new Error(
				'MathML/OMML matrix nesting or dimensions mismatch.',
			);
		}
		let properties = direct(matrix, OMML_NS, 'mPr')[0];
		if (!properties) {
			properties = document.createElementNS(OMML_NS, 'm:mPr');
			matrix.prepend(properties);
		}
		for (const old of direct(properties, OMML_NS, 'mcs')) old.remove();
		const columns = document.createElementNS(OMML_NS, 'm:mcs');
		for (let column = 0; column < expected.columns.length;) {
			const alignment = expected.columns[column];
			let end = column + 1;
			while (expected.columns[end] === alignment) end++;
			const group = document.createElementNS(OMML_NS, 'm:mc');
			const groupProperties = document.createElementNS(OMML_NS, 'm:mcPr');
			for (const [name, value] of [
				['count', String(end - column)],
				['mcJc', alignment],
			]) {
				const property = document.createElementNS(OMML_NS, `m:${name}`);
				property.setAttributeNS(OMML_NS, 'm:val', value);
				groupProperties.append(property);
			}
			group.append(groupProperties);
			columns.append(group);
			column = end;
		}
		if (expected.minRowBaselineTwips !== undefined) {
			restoreMatrixRowSpacing(properties, expected.minRowBaselineTwips);
		}
		if (expected.columnGapTwips !== undefined) {
			restoreMatrixColumnSpacing(properties, expected.columnGapTwips);
		}
		// mcs precedes the control properties in the OMML matrix property sequence.
		properties.insertBefore(
			columns,
			direct(properties, OMML_NS, 'ctrlPr')[0] ?? null,
		);
	}
	return document.documentElement.outerHTML;
}
