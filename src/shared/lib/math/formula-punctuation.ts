/** Shared syntax for structured symbol explanations, after Markdown/OMML decoding. */
const SYMBOL = String.raw`(?:⟦[^⟧\r\n]+⟧|[A-Za-zА-Яа-яЁё](?:[_^][A-Za-zА-Яа-яЁё0-9{}]+|[0-9]+)?)`;
const DEFINITION = String.raw`${SYMBOL}\s+[–−—-]\s+`;

export function startsSymbolDefinition(text: string): boolean {
	return new RegExp(String.raw`^\s*${DEFINITION}`, 'u').test(text);
}

export function inspectFormulaExplanation(text: string): {
	colon: boolean;
	definitions: string[];
} | null {
	const where = /^\s*где(?=\s|:|$)\s*(:?)\s*/iu.exec(text);
	if (!where) return null;
	const body = text.slice(where[0].length).trim();
	if (!startsSymbolDefinition(body)) return null;
	const starts = [
		...body.matchAll(
			new RegExp(String.raw`(?:^|(?<=[\s;,]))${DEFINITION}`, 'gu'),
		),
	];
	return {
		colon: where[1] === ':',
		definitions: starts.map((match, index) =>
			body.slice(match.index, starts[index + 1]?.index).trim(),
		),
	};
}

export function hasExplanationFinalPeriod(definition: string): boolean {
	// A dot inside an abbreviation or decimal is not a sentence terminator.
	return /\.\s*$/u.test(definition);
}
