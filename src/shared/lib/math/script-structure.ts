const MATH_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/math';
const NARY = /^[∫∬∭∮∯∰∱∲∳∑∏]$/u;
const PRIME = /^[′″‴⁗']+$/u;
const child = (node: Element, name: string): Element | undefined =>
	[...node.children].find(element => element.tagName === `m:${name}`);
const empty = (node: Element): boolean =>
	![...node.getElementsByTagName('m:t')].some(text =>
		text.textContent?.trim(),
	) &&
	[...node.children].every(element =>
		['m:r', 'm:rPr', 'm:argPr', 'm:ctrlPr'].includes(element.tagName),
	);

function naryBase(node: Element): boolean {
	if (node.tagName === 'm:nary') return true;
	if (node.tagName === 'm:r')
		return NARY.test(node.textContent?.trim() ?? '');
	if (!['m:limLow', 'm:limUpp'].includes(node.tagName)) return false;
	const base = child(node, 'e');
	return !!base && base.children.length === 1 && naryBase(base.children[0]);
}

/** Keep bare MathML operators distinct from adjacent runs, using native script conversion. */
export function prepareNaryOperators(math: Document): Map<string, string> {
	const literals = new Map<string, string>();
	let prefix = '\uE200LITERAL';
	while (math.documentElement.textContent?.includes(prefix)) prefix += 'X';
	// The dependency's nary regexp also matches literal prefixes such as ∑x.
	// Mask only non-operator token characters, then restore their original runs.
	for (const name of ['mtext', 'mi', 'mn', 'ms', 'mo']) {
		for (const token of [...math.getElementsByTagName(name)]) {
			if (name === 'mo') {
				let owner = token.parentElement;
				while (
					owner &&
					!(
						owner.tagName === 'mrow' &&
						owner
							.getAttribute('data-latex')
							?.startsWith('\\operatorname{')
					)
				)
					owner = owner.parentElement;
				if (!owner) continue;
			}
			token.textContent = [...(token.textContent ?? '')]
				.map(character => {
					if (!NARY.test(character)) return character;
					const marker = `${prefix}${literals.size}\uE201`;
					literals.set(marker, character);
					return marker;
				})
				.join('');
		}
	}
	const scripted = new Set([
		'munder',
		'mover',
		'munderover',
		'msub',
		'msup',
		'msubsup',
	]);
	for (const operator of [...math.getElementsByTagName('mo')]) {
		if (!NARY.test(operator.textContent?.trim() ?? '')) continue;
		let base = operator;
		while (
			base.parentElement?.tagName === 'mrow' &&
			base.parentElement.children.length === 1
		)
			base = base.parentElement;
		if (
			base.parentElement &&
			scripted.has(base.parentElement.tagName) &&
			base.parentElement.children[0] === base
		) {
			if (base.parentElement.tagName === 'msup') {
				const original = base.parentElement;
				const combined = math.createElementNS(
					operator.namespaceURI,
					'msubsup',
				);
				for (const attribute of [...original.attributes])
					combined.setAttribute(attribute.name, attribute.value);
				original.replaceWith(combined);
				combined.appendChild(base);
				combined.appendChild(
					math.createElementNS(operator.namespaceURI, 'mrow'),
				);
				combined.append(...[...original.children]);
			}
			continue;
		}
		const wrapper = math.createElementNS(operator.namespaceURI, 'msubsup');
		operator.replaceWith(wrapper);
		wrapper.appendChild(operator);
		wrapper.appendChild(
			math.createElementNS(operator.namespaceURI, 'mrow'),
		);
		wrapper.appendChild(
			math.createElementNS(operator.namespaceURI, 'mrow'),
		);
	}
	return literals;
}

export function normalizeScriptStructure(math: Element): void {
	// An explicit empty TeX limit is absence, not an editable Word placeholder.
	for (const limit of [
		...math.getElementsByTagName('m:limLow'),
		...math.getElementsByTagName('m:limUpp'),
	].reverse()) {
		const index = child(limit, 'lim');
		const base = child(limit, 'e');
		if (
			index &&
			empty(index) &&
			base?.children.length === 1 &&
			naryBase(base.children[0])
		)
			limit.replaceWith(...[...base.children]);
	}
	for (const nary of [...math.getElementsByTagName('m:nary')]) {
		let properties = child(nary, 'naryPr');
		for (const name of ['sub', 'sup']) {
			const index = child(nary, name);
			if (!index || !empty(index)) continue;
			if (!properties) {
				properties = math.ownerDocument.createElementNS(
					MATH_NS,
					'm:naryPr',
				);
				nary.insertBefore(properties, nary.firstChild);
			}
			let hide = child(properties, `${name}Hide`);
			if (!hide) {
				hide = math.ownerDocument.createElementNS(
					MATH_NS,
					`m:${name}Hide`,
				);
				const next = [...properties.children].find(
					element =>
						(name === 'sub' && element.tagName === 'm:supHide') ||
						element.tagName === 'm:ctrlPr',
				);
				properties.insertBefore(hide, next ?? null);
			}
			hide.setAttributeNS(MATH_NS, 'm:val', '1');
		}
	}
	// MathJax parses a prime inside braces as a script on an empty base. Only
	// flatten that artifact inside another superscript; genuine prescripts stay.
	for (const script of [...math.getElementsByTagName('m:sSup')].reverse()) {
		const base = child(script, 'e');
		const superscript = child(script, 'sup');
		if (
			script.parentElement?.tagName === 'm:sup' &&
			base &&
			empty(base) &&
			superscript &&
			[...superscript.children].every(
				element => element.tagName === 'm:r',
			) &&
			PRIME.test(superscript.textContent?.trim() ?? '')
		)
			script.replaceWith(...[...superscript.children]);
	}
}
