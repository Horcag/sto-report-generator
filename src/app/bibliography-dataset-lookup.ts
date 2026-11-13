import { BibliographyLookupEntry } from './bibliography-lookup';

interface DataCiteRecord {
	attributes: {
		doi: string;
		titles: { title: string }[];
		version?: string;
		publisher?: string | { name?: string };
		creators?: { name: string }[];
		url?: string;
		relatedIdentifiers?: {
			relationType: string;
			relatedIdentifier: string;
			relatedIdentifierType: string;
		}[];
		types?: { resourceTypeGeneral?: string };
	};
}

const normalized = (value: string) =>
	value
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, ' ')
		.trim();
const phrase = (value: string) => `"${value.replace(/[\\"]/g, '\\$&')}"`;

/** Explicitly requested public metadata only. Registry hits are never source verification. */
export async function lookupDataset(
	entry: BibliographyLookupEntry,
	request: typeof fetch = fetch,
) {
	if (
		!/^(dataset|набор данных)$/i.test(
			entry.fields.type?.trim() ?? entry.type,
		)
	)
		throw new Error(
			'--lookup-dataset requires an explicitly typed Dataset / набор данных entry.',
		);
	const title = entry.fields.title?.replace(/[{}]/g, '').trim();
	const version = entry.fields.version?.trim();
	if (!title || !version)
		throw new Error(
			'--lookup-dataset requires a public title and explicit version in the selected entry.',
		);
	const url = new URL('https://api.datacite.org/dois');
	url.searchParams.set(
		'query',
		`titles.title:${phrase(title)} AND version:${phrase(version)}`,
	);
	url.searchParams.set('resource-type-id', 'dataset');
	url.searchParams.set('page[size]', '10');
	const base = {
		key: entry.key,
		provider: 'DataCite',
		requestUrl: url.href,
		requested: { title, version },
		basis: 'Public registry candidates only; no-match does not establish DOI absence. Verify object, version and original source before updating evidence.',
	};
	try {
		const response = await request(url, {
			signal: AbortSignal.timeout(10000),
			headers: { Accept: 'application/vnd.api+json' },
		});
		if (!response.ok)
			return {
				...base,
				status: 'provider-error',
				error: `DataCite HTTP ${response.status}`,
				candidates: [],
			};
		const body = (await response.json()) as {
			data: DataCiteRecord[];
			meta?: { total?: number };
		};
		if (!Array.isArray(body.data))
			throw new Error(
				'Invalid DataCite response: data must be an array.',
			);
		const candidates = body.data.slice(0, 10).map(record => {
			const attributes = record.attributes;
			if (
				!attributes ||
				typeof attributes.doi !== 'string' ||
				!Array.isArray(attributes.titles)
			)
				throw new Error('Invalid DataCite candidate metadata.');
			const titles = attributes.titles.map(value => value.title);
			const versionMatch = attributes.version === version;
			const titleMatch = titles.some(candidate =>
				` ${normalized(candidate)} `.includes(` ${normalized(title)} `),
			);
			const relatedIdentifiers = (
				attributes.relatedIdentifiers ?? []
			).filter(relation =>
				[
					'HasVersion',
					'IsVersionOf',
					'IsNewVersionOf',
					'IsPreviousVersionOf',
				].includes(relation.relationType),
			);
			const hasVersions = relatedIdentifiers.some(
				relation => relation.relationType === 'HasVersion',
			);
			const versionOf = relatedIdentifiers.some(
				relation => relation.relationType === 'IsVersionOf',
			);
			const versionRole =
				hasVersions && versionOf
					? 'mixed'
					: hasVersions
						? 'has-versions'
						: versionOf
							? 'version-of'
							: 'unspecified';
			const dataset = attributes.types?.resourceTypeGeneral === 'Dataset';
			return {
				doi: attributes.doi,
				titles,
				version: attributes.version,
				publisher:
					typeof attributes.publisher === 'string'
						? attributes.publisher
						: attributes.publisher?.name,
				creators:
					attributes.creators?.map(creator => creator.name) ?? [],
				url: attributes.url,
				versionRole,
				relatedIdentifiers,
				status: !dataset
					? 'resource-type-mismatch'
					: !versionMatch
						? 'version-mismatch'
						: !titleMatch
							? 'title-mismatch'
							: 'candidate',
			};
		});
		const total = body.meta?.total ?? candidates.length;
		const truncated = total > candidates.length;
		const eligible = candidates.filter(
			candidate => candidate.status === 'candidate',
		);
		const status =
			truncated || eligible.length > 1
				? 'ambiguous'
				: eligible.length === 1
					? 'candidate'
					: !candidates.length
						? 'no-match'
						: candidates.some(
									candidate =>
										candidate.status === 'version-mismatch',
							  )
							? 'version-mismatch'
							: 'no-match';
		return { ...base, status, total, truncated, candidates };
	} catch (error) {
		return {
			...base,
			status:
				error instanceof Error &&
				['TimeoutError', 'AbortError'].includes(error.name)
					? 'timeout'
					: 'provider-error',
			error: error instanceof Error ? error.message : String(error),
			candidates: [],
		};
	}
}
