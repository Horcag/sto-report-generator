export interface BibliographyLookupEntry {
	key: string;
	type: string;
	fields: Record<string, string | undefined>;
}

export function bibliographySearchQueries(
	entry: BibliographyLookupEntry,
): string[] {
	const fields = entry.fields;
	const title = `"${(fields.title ?? '').replace(/[{}]/g, '')}"`;
	const doi = fields.doi
		?.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '')
		.replace(/^doi:\s*/i, '');
	const arxiv =
		fields.eprint ??
		fields.url?.match(/arxiv\.org\/(?:abs|pdf)\/([^?#\s]+)/i)?.[1];
	const version = fields.version ? ` version ${fields.version}` : '';
	const isArxiv =
		fields.archiveprefix?.toLowerCase() === 'arxiv' ||
		/arxiv\.org/i.test(fields.url ?? '');
	let hostname = '';
	try {
		hostname = new URL(fields.url ?? '').hostname;
	} catch {
		/* Search planning accepts missing or invalid URLs without inventing one. */
	}
	const queries = [
		`${title} ${fields.publisher ?? fields.institution ?? ''}${version} original bibliographic record`.replace(
			/\s+/g,
			' ',
		),
	];
	if (doi)
		queries.push(
			`https://doi.org/${doi}`,
			`"${doi}" Crossref DataCite registration record`,
		);
	if (arxiv && isArxiv) {
		queries.push(`https://arxiv.org/abs/${arxiv.replace(/\.pdf$/i, '')}`);
	}
	if (fields.url) queries.push(fields.url);
	if (
		/dataset|набор данных/i.test(
			`${fields.type ?? ''} ${fields.howpublished ?? ''}`,
		)
	) {
		queries.push(
			`${title} dataset repository version${fields.version ? ` ${fields.version}` : ''} canonical record DataCite`,
		);
	} else if (isArxiv) {
		queries.push(
			`${title}${version} site:arxiv.org abstract version history`,
		);
	} else if (
		['online', 'inonline', 'misc'].includes(entry.type.toLowerCase())
	) {
		queries.push(
			`${title} ${fields.organization ?? fields.institution ?? ''}${version} ${hostname ? `site:${hostname}` : 'official website'} ${/(?:^|\.)gov(?:\.[a-z]{2})?$/i.test(hostname) ? 'government publication record' : 'canonical page documentation'}`.replace(
				/\s+/g,
				' ',
			),
		);
	} else {
		queries.push(
			`${title} ${fields.journal ?? fields.booktitle ?? fields.publisher ?? ''} publisher catalog metadata`.replace(
				/\s+/g,
				' ',
			),
		);
		if (!doi) queries.push(`${title} Crossref registration record`);
	}
	return [...new Set(queries)];
}
