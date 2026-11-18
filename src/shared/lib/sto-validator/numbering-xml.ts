import { STO_RULES } from '../../config';

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getNumberingLevels(numberingXml: string): string[] {
	return numberingXml.match(/<w:lvl\b[\s\S]*?<\/w:lvl>/g) ?? [];
}

function hasExpectedBibliographyNumbering(numberingXml: string): boolean {
	const bibliographyParagraph = STO_RULES.bibliography.paragraph;
	const bibliographyIndentPattern = new RegExp(
		String.raw`<w:ind\b(?=[^>]*w:left="${bibliographyParagraph.leftIndentDxa}")(?=[^>]*w:hanging="${bibliographyParagraph.hangingIndentDxa}")`,
	);

	return getNumberingLevels(numberingXml).some(
		levelXml =>
			/<w:lvlText w:val="%1"\/>/.test(levelXml) &&
			bibliographyIndentPattern.test(levelXml) &&
			!/<w:suff\b[^>]*w:val="space"/.test(levelXml),
	);
}

function findSharedUsedAbstractNumbers(
	docXml: string | null,
	numberingXml: string,
): string[] {
	if (!docXml) {
		return [];
	}

	const usedNumIds = new Set<string>();
	for (const numPr of docXml.match(/<w:numPr\b[\s\S]*?<\/w:numPr>/g) ?? []) {
		const numIdMatch = /<w:numId\b[^>]*\bw:val="([^"]+)"/.exec(numPr);
		if (numIdMatch && numIdMatch[1] !== '0') {
			usedNumIds.add(numIdMatch[1]);
		}
	}
	if (usedNumIds.size < 2) {
		return [];
	}

	const numToAbstract = new Map<string, string>();
	for (const numBlock of numberingXml.match(/<w:num\b[\s\S]*?<\/w:num>/g) ??
		[]) {
		const numIdMatch = /<w:num\b[^>]*\bw:numId="([^"]+)"/.exec(numBlock);
		const absIdMatch = /<w:abstractNumId\b[^>]*\bw:val="([^"]+)"/.exec(
			numBlock,
		);
		if (numIdMatch && absIdMatch) {
			numToAbstract.set(numIdMatch[1], absIdMatch[1]);
		}
	}

	const styleLinkedAbstracts = new Set<string>();
	for (const absBlock of numberingXml.match(
		/<w:abstractNum\b[\s\S]*?<\/w:abstractNum>/g,
	) ?? []) {
		const absIdMatch =
			/<w:abstractNum\b[^>]*\bw:abstractNumId="([^"]+)"/.exec(absBlock);
		if (absIdMatch && /<w:(?:styleLink|numStyleLink)\b/.test(absBlock)) {
			styleLinkedAbstracts.add(absIdMatch[1]);
		}
	}

	const usedByAbstract = new Map<string, string[]>();
	for (const numId of usedNumIds) {
		const abstractId = numToAbstract.get(numId);
		if (!abstractId || styleLinkedAbstracts.has(abstractId)) {
			continue;
		}
		const bucket = usedByAbstract.get(abstractId) ?? [];
		bucket.push(numId);
		usedByAbstract.set(abstractId, bucket);
	}

	return [...usedByAbstract.entries()]
		.filter(([, numIds]) => numIds.length > 1)
		.map(
			([abstractId, numIds]) =>
				`abstractNumId=${abstractId} shared by numId=${numIds.join(',')}`,
		);
}

/** Validate bibliography/list formatting and ensure active lists do not share an `<w:abstractNum>`. */
export function validateNumbering(
	docXml: string | null,
	numberingXml: string | null,
) {
	if (numberingXml === null) {
		return [];
	}

	const firstLineIndent = STO_RULES.typography.firstLineIndentDxa;
	const bibliographyParagraph = STO_RULES.bibliography.paragraph;
	const bibLevelMatch = hasExpectedBibliographyNumbering(numberingXml);
	const listLevelMatch = new RegExp(
		String.raw`<w:lvlText w:val="${escapeRegExp(STO_RULES.typography.listMarker)}"/>.*?<w:ind[^>]*w:left="0"[^>]*w:firstLine="${firstLineIndent}"`,
		's',
	).test(numberingXml);
	const sharedAbstracts = findSharedUsedAbstractNumbers(docXml, numberingXml);

	return [
		{
			check: 'Bibliography Numbering Indent & Format',
			passed: bibLevelMatch,
			error: bibLevelMatch
				? ''
				: `Bibliography numbering missing or has incorrect indent/suffix (expected left ${bibliographyParagraph.leftIndentDxa}, hanging ${bibliographyParagraph.hangingIndentDxa}, tab after number) / dot format.`,
		},
		{
			check: 'List Numbering Indent & Format',
			passed: listLevelMatch,
			error: listLevelMatch
				? ''
				: `List numbering missing ${STO_RULES.typography.listMarker} marker or has incorrect indent (expected left 0, firstLine ${firstLineIndent}).`,
		},
		{
			check: 'List Abstract Numbering Isolation',
			passed: sharedAbstracts.length === 0,
			error:
				sharedAbstracts.length === 0
					? ''
					: `Shared abstract numbering detected (${sharedAbstracts.join('; ')}). Independent lists must reference separate abstractNum definitions.`,
		},
	];
}
