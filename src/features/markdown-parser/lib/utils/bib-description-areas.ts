import { unrenderedKnownFields } from './bib-field-contract';
import {
	appendArea,
	cleanDoi,
	cleanText,
	ensureFinalDot,
	formatPageCount,
} from './bib-format-utils';

/** ГОСТ Р 7.0.100-2018, 5.2.4–5.2.5: supplied title elements only. */
export function formatTitleArea(
	title: string,
	tags: Record<string, string>,
): string {
	const parallelTitle = cleanText(tags.paralleltitle);
	const subtitle = cleanText(tags.subtitle);
	const main = parallelTitle ? `${title} = ${parallelTitle}` : title;
	return subtitle ? `${main} : ${subtitle}` : main;
}

/** ГОСТ Р 7.0.100-2018, 5.3.3–5.3.6: edition is one area. */
export function formatEditionArea(tags: Record<string, string>): string {
	const edition = cleanText(tags.edition);
	const parallel = cleanText(tags.paralleledition);
	const responsibility = cleanText(tags.editionresponsibility);
	const addition = cleanText(tags.editionaddition);
	if (!edition && (parallel || responsibility || addition)) {
		throw new Error(
			'Parallel edition, edition responsibility and edition addition require an edition.',
		);
	}
	if (!edition) return '';
	return `${edition}${parallel ? ` = ${parallel}` : ''}${responsibility ? ` / ${responsibility}` : ''}${addition ? `, ${addition}` : ''}`;
}

/** Reject supplied description areas that the selected record layout cannot render. */
export function validateDescriptionAreas(
	entryType: string,
	tags: Record<string, string>,
	citationKey: string,
): void {
	validateCompetingAliases(entryType, tags, citationKey);
	const hasUrl = Boolean(cleanText(tags.url));
	const entrySubtype = cleanText(tags.entrysubtype).toLowerCase();
	if (entryType === 'misc' && entrySubtype) {
		if (!['online', 'electronic'].includes(entrySubtype)) {
			throw new Error(
				`Bibliography entry @${citationKey} has unsupported entrysubtype "${tags.entrysubtype}". Supported @misc values: online, electronic.`,
			);
		}
		if (!hasUrl) {
			throw new Error(
				`Bibliography entry @${citationKey} (misc entrysubtype=${entrySubtype}) requires url for a network resource.`,
			);
		}
	}
	if (['online', 'inonline'].includes(entryType) && !hasUrl) {
		throw new Error(
			`Bibliography entry @${citationKey} (${entryType}) requires url for a network resource.`,
		);
	}
	const urlDependentFields = [
		'urldate',
		'updated',
		'republication',
		'publicationdate',
		'access',
		'accessmode',
		'availability',
	].filter(field => cleanText(tags[field]));
	if (!hasUrl && urlDependentFields.length > 0) {
		throw new Error(
			`Bibliography entry @${citationKey} requires url for fields: ${urlDependentFields.join(', ')}.`,
		);
	}
	const unsupported = unrenderedKnownFields(entryType, tags);
	if (unsupported.length > 0) {
		throw new Error(
			`Bibliography entry @${citationKey} (${entryType}) cannot render fields: ${unsupported.join(', ')}.`,
		);
	}
	const numberField = cleanText(tags.seriesnumber)
		? 'seriesnumber'
		: entryType === 'book' && cleanText(tags.number)
			? 'number'
			: '';
	if (numberField && !cleanText(tags.series)) {
		throw new Error(
			`Bibliography entry @${citationKey}: ${numberField} requires series.`,
		);
	}
}

function validateCompetingAliases(
	entryType: string,
	tags: Record<string, string>,
	citationKey: string,
): void {
	const groups: string[][] = [['access', 'accessmode', 'availability']];
	if (
		[
			'book',
			'thesis',
			'phdthesis',
			'mastersthesis',
			'report',
			'techreport',
			'online',
			'misc',
		].includes(entryType)
	) {
		groups.push(['howpublished', 'type']);
	}
	if (
		[
			'book',
			'thesis',
			'phdthesis',
			'mastersthesis',
			'standard',
			'inproceedings',
			'incollection',
			'online',
			'misc',
		].includes(entryType)
	) {
		groups.push(['address', 'location']);
	}
	if (['thesis', 'phdthesis', 'mastersthesis'].includes(entryType)) {
		groups.push(['institution', 'school']);
	}
	if (entryType === 'article') groups.push(['number', 'issue']);
	if (entryType === 'book') groups.push(['seriesnumber', 'number']);
	if (entryType === 'inonline') groups.push(['website', 'booktitle']);
	if (['online', 'misc'].includes(entryType)) {
		groups.push(['journal', 'booktitle', 'website']);
	}
	if (['inproceedings', 'incollection'].includes(entryType)) {
		groups.push(['publisher', 'organization']);
	}
	for (const group of groups) {
		const supplied = group.filter(field => cleanText(tags[field]));
		if (new Set(supplied.map(field => cleanText(tags[field]))).size > 1) {
			throw new Error(
				`Bibliography entry @${citationKey} has conflicting alias fields: ${supplied.join(', ')}.`,
			);
		}
	}
	if (
		entryType === 'patent' &&
		cleanText(tags.date) &&
		cleanText(tags.year)
	) {
		const date = cleanText(tags.date);
		const year = cleanText(tags.year);
		const dateYear =
			/^(\d{4})(?:-\d{2}-\d{2})?$/.exec(date)?.[1] ??
			/^\d{2}\.\d{2}\.(\d{4})$/.exec(date)?.[1];
		if (dateYear !== year) {
			throw new Error(
				`Bibliography entry @${citationKey} has conflicting date and year.`,
			);
		}
	}
}

/** ГОСТ Р 7.0.100-2018, 5.6: extent and its optional details form one area. */
export function formatPhysicalArea(
	tags: Record<string, string>,
	isEng: boolean,
): string {
	if (cleanText(tags.pages) && cleanText(tags.numpages)) {
		throw new Error('Use pages or numpages, not both.');
	}
	if (
		cleanText(tags.extent) &&
		(cleanText(tags.pages) || cleanText(tags.numpages))
	) {
		throw new Error('Use extent or pages/numpages, not both.');
	}
	const extent =
		cleanText(tags.extent) ||
		formatPageCount(tags.pages || tags.numpages, isEng);
	const details = cleanText(tags.physicaldetails);
	const dimensions = cleanText(tags.dimensions);
	const accompanying = cleanText(tags.accompanyingmaterial);
	if (!extent && (details || dimensions || accompanying)) {
		throw new Error(
			'Physical details, dimensions and accompanying material require an extent.',
		);
	}
	if (!extent) return '';
	return `${extent}${details ? ` : ${details}` : ''}${dimensions ? ` ; ${dimensions}` : ''}${accompanying ? ` + ${accompanying}` : ''}`;
}

/** ГОСТ Р 7.0.100-2018, 5.8–5.10: notes, identifiers, content/access. */
export function appendFinalAreas(
	record: string,
	tags: Record<string, string>,
): string {
	let result = appendArea(record, tags.bibliographicnote);
	result = appendIdentifierAreas(result, tags);
	const content = cleanText(tags.contenttype);
	const medium = cleanText(tags.mediatype);
	if (content !== '' && medium !== '') {
		result = appendArea(result, `${content} : ${medium}`);
	} else if (content || medium) {
		throw new Error(
			'Content type and media type must be supplied together.',
		);
	}
	return result;
}

/** ГОСТ Р 7.0.100-2018, 5.7: series follows the extent in parentheses. */
export function appendSeriesArea(
	record: string,
	tags: Record<string, string>,
): string {
	const title = cleanText(tags.series);
	if (!title) return record;
	if (
		cleanText(tags.seriesnumber) &&
		cleanText(tags.number) &&
		cleanText(tags.seriesnumber) !== cleanText(tags.number)
	) {
		throw new Error('Use seriesnumber or number, not both.');
	}
	const number = cleanText(tags.seriesnumber || tags.number);
	const series = number ? `${title} ; ${number}` : title;
	return `${ensureFinalDot(record)} – (${series})`;
}

/** ГОСТ Р 7.0.100-2018, 5.9: identifiers follow notes, not the title. */
export function appendIdentifierAreas(
	record: string,
	tags: Record<string, string>,
): string {
	let result = record;
	for (const [field, label] of [
		['isbn', 'ISBN'],
		['issn', 'ISSN'],
		['ismn', 'ISMN'],
		['doi', 'DOI'],
	] as const) {
		const value =
			field === 'doi'
				? cleanDoi(tags[field] ?? '')
				: cleanText(tags[field]);
		if (value) result = appendArea(result, `${label} ${value}`);
	}
	return result;
}
