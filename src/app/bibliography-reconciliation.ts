import { BibliographyLookupEntry } from './bibliography-lookup';

type MatchStatus =
	| 'matched'
	| 'merged'
	| 'split'
	| 'ambiguous'
	| 'identifier-conflict'
	| 'unmatched'
	| 'number-only';

function normalizedTitle(value: string): string {
	return value
		.normalize('NFKC')
		.toLowerCase()
		.replace(/[{}]/g, '')
		.replace(/[^\p{L}\p{N}]+/gu, ' ')
		.trim();
}

function identifiers(value: string): string[] {
	const doi = [...value.matchAll(/\b10\.\d{4,9}\/[^\s<>"{}]+/gi)].map(
		match => `doi:${match[0].replace(/[.,;:)\]]+$/, '').toLowerCase()}`,
	);
	const arxiv = [
		...value.matchAll(
			/(?:arxiv:\s*|arxiv\.org\/(?:abs|pdf)\/)(\d{4}\.\d{4,5}(?:v\d+)?|[a-z-]+(?:\.[A-Z]{2})?\/\d{7}(?:v\d+)?)/gi,
		),
	].map(match => `arxiv:${match[1].toLowerCase()}`);
	const urls = [...value.matchAll(/https?:\/\/[^\s<>"{}]+/gi)].flatMap(
		match => {
			const url = match[0].replace(/[.,;:)\]]+$/, '').replace(/\/$/, '');
			try {
				const parsed = new URL(url);
				return /(?:^|\.)(?:doi\.org|arxiv\.org)$/i.test(parsed.hostname)
					? []
					: [`url:${parsed.href.replace(/\/$/, '')}`];
			} catch {
				return [];
			}
		},
	);
	return [...new Set([...doi, ...arxiv, ...urls])];
}

export function validateExtractedReferences(value: unknown): string[] {
	if (
		!Array.isArray(value) ||
		value.some(item => typeof item !== 'string' || !item.trim())
	) {
		throw new Error(
			'--extracted must contain a JSON array of non-empty reference strings.',
		);
	}
	return value;
}

/** Structural comparison only: a match never verifies a source or its metadata. */
export function reconcileBibliography(
	entries: BibliographyLookupEntry[],
	extracted: string[],
) {
	validateExtractedReferences(extracted);
	const inventory = entries.map((entry, index) => {
		const fields = entry.fields;
		const arxiv =
			fields.archiveprefix?.toLowerCase() === 'arxiv' && fields.eprint
				? `arxiv:${fields.eprint}`
				: '';
		return {
			key: entry.key,
			referenceNumber: index + 1,
			title: normalizedTitle(fields.title ?? ''),
			identifiers: identifiers(
				`${fields.doi ? `https://doi.org/${fields.doi.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '').replace(/^doi:\s*/i, '')}` : ''} ${fields.url ?? ''} ${arxiv}`,
			),
		};
	});
	const references = extracted.map((text, index) => {
		const referenceNumber =
			Number(
				text
					.match(/^\s*(?:\[(\d+)\]|(\d+)[.)]?\s)/)
					?.slice(1)
					.find(Boolean),
			) || undefined;
		const heading = text
			.replace(/^\s*(?:\[\d+\]|\d+[.)]?\s)\s*/, '')
			.split(/\s+\/\s+/, 1)[0]
			.replace(
				/\s*\[(?:Текст|Электронный ресурс|Text|Electronic resource)\]\s*$/i,
				'',
			);
		const completeHeading = /\s+\/\s+/.test(text)
			? normalizedTitle(heading)
			: '';
		const shortHeadingMatches = inventory.filter(
			entry =>
				entry.title.split(' ').length >= 2 &&
				entry.title === completeHeading,
		);
		const numberedHeading =
			referenceNumber !== undefined &&
			shortHeadingMatches.some(
				entry => entry.referenceNumber === referenceNumber,
			) &&
			extracted.filter(
				other =>
					Number(
						other
							.match(/^\s*(?:\[(\d+)\]|(\d+)[.)]?\s)/)
							?.slice(1)
							.find(Boolean),
					) === referenceNumber,
			).length === 1;

		const ids = identifiers(text);
		const normalized = ` ${normalizedTitle(text)} `;
		const rawTitleMatches = inventory.filter(
			entry =>
				(entry.title.length >= 16 &&
					entry.title.split(' ').length >= 3 &&
					normalized.includes(` ${entry.title} `)) ||
				(numberedHeading && shortHeadingMatches.includes(entry)),
		);
		// A shorter title occurring only inside another title is not a second source.
		const titleMatches = rawTitleMatches.filter(entry => {
			const longer = rawTitleMatches.filter(
				other =>
					other.title !== entry.title &&
					` ${other.title} `.includes(` ${entry.title} `),
			);
			return (
				!longer.length ||
				longer
					.reduce(
						(remaining, other) =>
							remaining.replaceAll(` ${other.title} `, ' '),
						normalized,
					)
					.includes(` ${entry.title} `)
			);
		});
		const idMatches = inventory.filter(entry =>
			entry.identifiers.some(id => ids.includes(id)),
		);
		const candidates = inventory.filter(
			entry => titleMatches.includes(entry) || idMatches.includes(entry),
		);
		const matchedBy = [
			...(titleMatches.length ? ['title'] : []),
			...(idMatches.length ? ['identifier'] : []),
		];
		const conflictTargets =
			idMatches.length === 1 && titleMatches.includes(idMatches[0])
				? idMatches
				: titleMatches;
		const conflicts = ids.some(
			id =>
				conflictTargets.some(entry =>
					entry.identifiers.some(
						expected => expected.split(':')[0] === id.split(':')[0],
					),
				) &&
				!conflictTargets.some(entry => entry.identifiers.includes(id)),
		);
		let status: MatchStatus = 'matched';
		if (conflicts) status = 'identifier-conflict';
		else if (candidates.length > 1) {
			const identicalTitles =
				titleMatches.length > 1 &&
				new Set(titleMatches.map(entry => entry.title)).size === 1;
			if (identicalTitles && idMatches.length === 1) {
				candidates.splice(0, candidates.length, idMatches[0]);
			} else
				status =
					identicalTitles ||
					(idMatches.length > 1 &&
						new Set(
							idMatches.flatMap(entry =>
								entry.identifiers.filter(id =>
									ids.includes(id),
								),
							),
						).size === 1)
						? 'ambiguous'
						: 'merged';
		} else if (!candidates.length)
			status =
				referenceNumber &&
				inventory.some(
					entry => entry.referenceNumber === referenceNumber,
				)
					? 'number-only'
					: 'unmatched';
		return {
			index: index + 1,
			text,
			referenceNumber,
			status: status as MatchStatus,
			matchedBy,
			candidates: candidates.map(({ key, referenceNumber }) => ({
				key,
				referenceNumber,
			})),
			orderMismatch:
				candidates.length === 1 &&
				index + 1 !== candidates[0].referenceNumber,
			duplicateNumber:
				referenceNumber !== undefined &&
				extracted.filter(
					other =>
						Number(
							other
								.match(/^\s*(?:\[(\d+)\]|(\d+)[.)]?\s)/)
								?.slice(1)
								.find(Boolean),
						) === referenceNumber,
				).length > 1,
			numberMismatch:
				referenceNumber !== undefined &&
				candidates.length === 1 &&
				referenceNumber !== candidates[0].referenceNumber,
		};
	});
	for (const reference of references) {
		if (
			reference.status === 'matched' &&
			references.filter(
				other =>
					other.status === 'matched' &&
					other.candidates[0]?.key === reference.candidates[0]?.key,
			).length > 1
		) {
			// Mark all occurrences together; mutation must not affect subsequent counts.
			for (const other of references.filter(
				other =>
					other.status === 'matched' &&
					other.candidates[0]?.key === reference.candidates[0]?.key,
			))
				other.status = 'split';
		}
	}
	return {
		passed:
			references.every(
				reference =>
					reference.status === 'matched' &&
					!reference.numberMismatch &&
					!reference.orderMismatch &&
					!reference.duplicateNumber,
			) &&
			inventory.every(entry =>
				references.some(reference =>
					reference.candidates.some(
						candidate => candidate.key === entry.key,
					),
				),
			),
		basis: 'Offline structural comparison only; no-match does not establish source absence and matches do not verify metadata.',
		references,
		notObserved: inventory
			.filter(
				entry =>
					!references.some(reference =>
						reference.candidates.some(
							candidate => candidate.key === entry.key,
						),
					),
			)
			.map(({ key, referenceNumber }) => ({ key, referenceNumber })),
	};
}
