import { cleanText } from './bib-format-utils';

const COMMON_FIELDS = [
	'title',
	'paralleltitle',
	'subtitle',
	'year',
	'url',
	'urldate',
	'updated',
	'republication',
	'publicationdate',
	'access',
	'accessmode',
	'availability',
	'bibliographicnote',
	'isbn',
	'issn',
	'ismn',
	'doi',
	'contenttype',
	'mediatype',
	'responsibilityabsence',
	'omissionreasons',
];
const PHYSICAL_FIELDS = [
	'pages',
	'numpages',
	'extent',
	'physicaldetails',
	'dimensions',
	'accompanyingmaterial',
];
const PLACE_FIELDS = ['address', 'location', 'publisher'];
const AUTHOR_FIELDS = ['author', 'langid'];
const TYPE_FIELDS: Record<string, string[]> = {
	article: [
		...AUTHOR_FIELDS,
		'note',
		'journal',
		'volume',
		'number',
		'issue',
		'pages',
	],
	inproceedings: [
		...AUTHOR_FIELDS,
		'note',
		'booktitle',
		...PLACE_FIELDS,
		'organization',
		'pages',
	],
	incollection: [
		...AUTHOR_FIELDS,
		'note',
		'booktitle',
		...PLACE_FIELDS,
		'organization',
		'pages',
	],
	book: [
		...AUTHOR_FIELDS,
		'note',
		'editor',
		'compiler',
		'howpublished',
		'type',
		...PLACE_FIELDS,
		...PHYSICAL_FIELDS,
		'series',
		'seriesnumber',
		'number',
		'edition',
		'paralleledition',
		'editionresponsibility',
		'editionaddition',
	],
	norm: [...AUTHOR_FIELDS, 'howpublished', 'journal', 'number', 'note'],
	standard: ['number', ...PLACE_FIELDS, ...PHYSICAL_FIELDS],
	patent: [
		...AUTHOR_FIELDS,
		'country',
		'number',
		'holder',
		'date',
		...PHYSICAL_FIELDS,
	],
	thesis: [
		...AUTHOR_FIELDS,
		'howpublished',
		'type',
		'institution',
		'school',
		'address',
		'location',
		...PHYSICAL_FIELDS,
	],
	inonline: [...AUTHOR_FIELDS, 'website', 'booktitle'],
	report: [
		...AUTHOR_FIELDS,
		'howpublished',
		'type',
		'institution',
		'number',
		...PHYSICAL_FIELDS,
	],
	online: [
		...AUTHOR_FIELDS,
		'howpublished',
		'type',
		'note',
		'journal',
		'booktitle',
		'website',
		...PLACE_FIELDS,
	],
};
TYPE_FIELDS.phdthesis = TYPE_FIELDS.thesis;
TYPE_FIELDS.mastersthesis = TYPE_FIELDS.thesis;
TYPE_FIELDS.techreport = TYPE_FIELDS.report;
TYPE_FIELDS.misc = [...TYPE_FIELDS.online, 'entrysubtype'];
const KNOWN_FIELDS = new Set([
	...COMMON_FIELDS,
	...Object.values(TYPE_FIELDS).flat(),
	'entrysubtype',
]);

/** Known BibTeX fields are accepted only where their value is consumed. */
export function unrenderedKnownFields(
	entryType: string,
	tags: Record<string, string>,
): string[] {
	const typeFields = TYPE_FIELDS[entryType];
	if (!typeFields) return [];
	const allowed = new Set([...COMMON_FIELDS, ...typeFields]);
	return [...KNOWN_FIELDS].filter(
		field => cleanText(tags[field]) && !allowed.has(field),
	);
}
