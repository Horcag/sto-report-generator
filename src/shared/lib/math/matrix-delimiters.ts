import { JSDOM } from 'jsdom';

const MATH_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/math';
const WORD_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

interface MatrixDelimiter {
	open: string;
	close: string;
	begin: string;
	end: string;
}

/** Carry MathJax's scalable fence intent through the converter's plain-text mo handling. */
export function markMatrixDelimiters(document: Document): MatrixDelimiter[] {
	const delimiters: MatrixDelimiter[] = [];
	let prefix = '\uE100MATRIX';
	while (document.documentElement.textContent?.includes(prefix))
		prefix += 'X';
	for (const row of [...document.getElementsByTagName('mrow')].reverse()) {
		if (row.getAttribute('data-mjx-texclass') !== 'INNER') continue;
		const children = [...row.children];
		const first = children[0];
		const last = children.at(-1);
		if (
			children.length < 3 ||
			first.tagName !== 'mo' ||
			last?.tagName !== 'mo' ||
			first.getAttribute('data-mjx-texclass') !== 'OPEN' ||
			last.getAttribute('data-mjx-texclass') !== 'CLOSE' ||
			first.getAttribute('stretchy') === 'false' ||
			last.getAttribute('stretchy') === 'false'
		)
			continue;
		const delimiter = {
			open: `${prefix}${delimiters.length}OPEN\uE101`,
			close: `${prefix}${delimiters.length}CLOSE\uE101`,
			begin: first.textContent ?? '',
			end: last.textContent ?? '',
		};
		first.textContent = delimiter.open;
		last.textContent = delimiter.close;
		delimiters.push(delimiter);
	}
	return delimiters;
}

export function restoreMatrixDelimiters(
	xml: string,
	delimiters: MatrixDelimiter[],
): string {
	if (!delimiters.length) return xml;
	const document = new JSDOM(xml, { contentType: 'text/xml' }).window
		.document;
	const tokens = new Set(delimiters.flatMap(item => [item.open, item.close]));
	const markers = new Map<string, Element>();
	// mathml2omml can merge a fence with neighbouring text. Split only marked runs,
	// preserving the properties and text of every non-fence segment.
	for (const text of [...document.getElementsByTagNameNS(MATH_NS, 't')]) {
		const value = text.textContent ?? '';
		if (![...tokens].some(token => value.includes(token))) continue;
		const run = text.parentElement;
		if (run?.localName !== 'r' || run.namespaceURI !== MATH_NS)
			throw new Error('Malformed matrix delimiter marker.');
		let remaining = value;
		while (remaining) {
			const found = [...tokens]
				.map(token => ({ token, offset: remaining.indexOf(token) }))
				.filter(item => item.offset >= 0)
				.sort((left, right) => left.offset - right.offset)[0];
			const chunks = found
				? [remaining.slice(0, found.offset), found.token]
				: [remaining];
			for (const chunk of chunks.filter(Boolean)) {
				const clone = run.cloneNode(true) as Element;
				clone.getElementsByTagNameNS(MATH_NS, 't')[0].textContent =
					chunk;
				run.before(clone);
				if (tokens.has(chunk)) {
					if (markers.has(chunk))
						throw new Error('Duplicate matrix delimiter marker.');
					markers.set(chunk, clone);
				}
			}
			remaining = found
				? remaining.slice(found.offset + found.token.length)
				: '';
		}
		run.remove();
	}
	for (const delimiter of delimiters) {
		const open = markers.get(delimiter.open);
		const close = markers.get(delimiter.close);
		if (!open || !close || open.parentElement !== close.parentElement)
			throw new Error(
				'Matrix delimiters lost their shared expression container.',
			);
		const contents: ChildNode[] = [];
		let node = open.nextSibling;
		while (node && node !== close) {
			contents.push(node);
			node = node.nextSibling;
		}
		if (node !== close || !contents.length)
			throw new Error(
				'Matrix delimiters lost their enclosed expression.',
			);
		const fence = document.createElementNS(MATH_NS, 'm:d');
		const properties = document.createElementNS(MATH_NS, 'm:dPr');
		for (const [name, value] of [
			['begChr', delimiter.begin],
			['endChr', delimiter.end],
			['grow', '1'],
		]) {
			const property = document.createElementNS(MATH_NS, `m:${name}`);
			property.setAttributeNS(MATH_NS, 'm:val', value);
			properties.appendChild(property);
		}
		const runProperties = [...open.children].find(
			child =>
				child.namespaceURI === WORD_NS && child.localName === 'rPr',
		);
		if (runProperties) {
			const control = document.createElementNS(MATH_NS, 'm:ctrlPr');
			control.appendChild(runProperties.cloneNode(true));
			properties.appendChild(control);
		}
		fence.appendChild(properties);
		const expression = document.createElementNS(MATH_NS, 'm:e');
		for (const child of contents) expression.appendChild(child);
		fence.appendChild(expression);
		open.replaceWith(fence);
		close.remove();
	}
	return document.documentElement.outerHTML;
}
