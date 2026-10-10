/** Conservative declaration scan; this does not resolve CSS selectors or cascade. */
export function svgBaselineRisks(root: Element): string[] {
	const texts = [...root.querySelectorAll('text, tspan, textPath')].filter(
		node => node.textContent?.trim(),
	);
	if (!texts.length) return [];
	const risks = new Set<string>();
	const record = (property: string, raw: string): void => {
		const value = raw
			.trim()
			.replace(/\s*!\s*important\s*$/iu, '')
			.trim();
		const defaults =
			property === 'dominant-baseline'
				? ['auto', 'alphabetic']
				: ['baseline', 'alphabetic'];
		if (value && !defaults.includes(value.toLowerCase()))
			risks.add(`${property}=${value}`);
	};
	const css = (source: string): void => {
		const declarations = source.replace(/\/\*[\s\S]*?\*\//gu, '');
		for (const match of declarations.matchAll(
			/(?:^|[;{])\s*(dominant-baseline|alignment-baseline)\s*:\s*([^;{}]+)/giu,
		))
			record(match[1].toLowerCase(), match[2]);
	};
	const visited = new Set<Element>();
	for (const text of texts) {
		let node: Element | null = text;
		while (node && !visited.has(node)) {
			visited.add(node);
			for (const property of [
				'dominant-baseline',
				'alignment-baseline',
			]) {
				const value = node.getAttribute(property);
				if (value !== null) record(property, value);
			}
			css(node.getAttribute('style') ?? '');
			node = node.parentElement;
		}
	}
	// Stylesheets can target text indirectly; unused rules may also be reported.
	for (const style of root.querySelectorAll('style'))
		css(style.textContent ?? '');
	return [...risks];
}
