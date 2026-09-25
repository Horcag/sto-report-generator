export interface CitationReference {
	key: string;
	page?: string;
}

/** Parse the generator's numbered end-reference syntax, including page locators. */
export function parseCitationReferences(raw: string): CitationReference[] {
	const references: CitationReference[] = [];
	let remaining = raw.trim();
	if (!remaining) {
		throw new Error('Invalid citation [@]: expected a BibTeX key.');
	}
	while (remaining) {
		const keyMatch = /^@?([^\s,;\]]+)/.exec(remaining);
		if (!keyMatch) {
			throw new Error(
				`Invalid citation [@${raw}]: expected a BibTeX key.`,
			);
		}
		const key = keyMatch[1];
		remaining = remaining.slice(keyMatch[0].length).trimStart();
		let page: string | undefined;
		const locator = /^,\s*((?:с|p)\.)\s*(\d+(?:\s*[-–]\s*\d+)?)/i.exec(
			remaining,
		);
		if (!locator && /^,\s*(?:с|p)\.(?!\s*\d)/i.test(remaining)) {
			throw new Error(
				`Invalid citation [@${raw}]: page locator needs a page number.`,
			);
		}
		if (locator) {
			page = `${locator[1]} ${locator[2].replace(/\s*[-–]\s*/g, '–')}`;
			remaining = remaining.slice(locator[0].length).trimStart();
		}
		references.push({ key, ...(page ? { page } : {}) });
		if (!remaining) {
			break;
		}
		if (remaining[0] !== ',' && remaining[0] !== ';') {
			throw new Error(
				`Invalid citation [@${raw}]: unexpected text after @${key}.`,
			);
		}
		remaining = remaining.slice(1).trimStart();
		if (!remaining) {
			throw new Error(`Invalid citation [@${raw}]: trailing separator.`);
		}
	}
	return references;
}
