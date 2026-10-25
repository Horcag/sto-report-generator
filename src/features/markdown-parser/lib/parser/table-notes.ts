import { Token, Tokens } from 'marked';

/** Only explicit immediately following note paragraphs belong to the table. */
export function readTableNotes(
	tokens: Token[],
	tableIndex: number,
): { texts: string[]; lastIndex: number } {
	const skipSpaces = (start: number) => {
		while (tokens[start]?.type === 'space') start++;
		return start;
	};
	const firstIndex = skipSpaces(tableIndex + 1);
	const first = tokens[firstIndex];
	if (first?.type !== 'paragraph')
		return { texts: [], lastIndex: tableIndex };
	const text = (first as Tokens.Paragraph).text.trim();
	if (/^Примечание\s+–\s+\S/u.test(text)) {
		const next = tokens[skipSpaces(firstIndex + 1)];
		if (
			next?.type === 'paragraph' &&
			/^Примечани[ея]\s/u.test((next as Tokens.Paragraph).text)
		)
			throw new Error(
				'Multiple table notes require a plural label and sequential numbering.',
			);
		return { texts: [text], lastIndex: firstIndex };
	}
	if (!/^Примечания\s*(?:\n|$)/u.test(text))
		return { texts: [], lastIndex: tableIndex };
	const texts = text
		.split('\n')
		.map(line => line.trim())
		.filter(Boolean);
	let lastIndex = firstIndex;
	let nextIndex = skipSpaces(firstIndex + 1);
	while (tokens[nextIndex]?.type === 'paragraph') {
		const lines = (tokens[nextIndex] as Tokens.Paragraph).text
			.trim()
			.split('\n');
		if (!lines.every(line => /^\d+\s+\S/u.test(line))) break;
		texts.push(...lines);
		lastIndex = nextIndex;
		nextIndex = skipSpaces(nextIndex + 1);
	}
	if (
		texts.length < 3 ||
		texts.slice(1).some((line, index) => !line.startsWith(`${index + 1} `))
	)
		throw new Error(
			'Multiple table notes require at least two sequential paragraphs: 1 text, 2 text.',
		);
	return { texts, lastIndex };
}
