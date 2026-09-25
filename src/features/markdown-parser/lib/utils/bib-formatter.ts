import { BibItem } from '../types';
import {
	appendArea,
	appendUrlArea,
	buildPrimaryDescription,
	cleanDoi,
	cleanText,
	ensureFinalDot,
	formatPageCount,
	formatPages,
	formatPlacePublisherYear,
	formatVolumeIssue,
	isEnglish,
	normalizeRecord,
	parseAuthors,
	parseNote,
	titleWithType,
	type AuthorBlock,
	type NoteBlock,
} from './bib-format-utils';

/**
 * GOST R 7.0.100-2018 formatter for Russian academic source lists.
 *
 * ГОСТ Р 7.0.5-2008 describes bibliographic references/citations; the final
 * source list itself is formatted as a bibliographic record by ГОСТ Р 7.0.100.
 */
export function formatBibItem(item: BibItem): string {
	const rawTags = item.entryTags;
	const tags: Record<string, string> = {};
	for (const k of Object.keys(rawTags)) {
		tags[k.toLowerCase()] = rawTags[k] ?? '';
	}

	const entryType = (item.entryType || '').toLowerCase();
	const isEng = isEnglish(tags.langid);
	const authorBlock = parseAuthors(tags.author || '', isEng);
	const title = cleanText(tags.title);
	if (!title) {
		throw new Error(
			`Bibliography entry @${item.citationKey} has no title. Supply the source title or an editorial title in square brackets after checking the source.`,
		);
	}
	const typeInfo = cleanText(tags.howpublished || tags.type);
	const noteBlock = parseNote(tags.note || '');

	switch (entryType) {
		case 'article':
			return formatArticle(tags, title, authorBlock, isEng, noteBlock);
		case 'inproceedings':
		case 'incollection':
			return formatCollectionPart(
				tags,
				title,
				authorBlock,
				isEng,
				noteBlock,
			);
		case 'book':
			return formatBook(
				tags,
				title,
				typeInfo,
				authorBlock,
				isEng,
				noteBlock,
			);
		case 'norm':
			return formatNorm(tags, title);
		case 'standard':
			return formatStandard(tags, title);
		case 'patent':
			return formatPatent(tags, title, authorBlock, isEng);
		case 'thesis':
		case 'phdthesis':
		case 'mastersthesis':
			return formatThesis(tags, title, typeInfo, authorBlock, isEng);
		case 'inonline':
			return formatSitePart(tags, title, authorBlock, isEng);
		case 'techreport':
		case 'report':
			return formatTechReport(tags, title, typeInfo, authorBlock, isEng);
		case 'misc':
		case 'online':
			return formatOnline(tags, title, typeInfo, authorBlock, noteBlock);
		default:
			throw new Error(
				`Unsupported bibliography type "${item.entryType}" for @${item.citationKey}.`,
			);
	}
}

function formatPatent(
	tags: Record<string, string>,
	title: string,
	authorBlock: AuthorBlock,
	isEng: boolean,
): string {
	const designation = [cleanText(tags.country), cleanText(tags.number)]
		.filter(Boolean)
		.join(' ');
	const kind = isEng ? 'patent' : 'пат.';
	const responsibility = [authorBlock.responsibility, cleanText(tags.holder)]
		.filter(Boolean)
		.join(' ; ');
	let record = buildPrimaryDescription(
		titleWithType(title, `${kind} ${designation}`.trim()),
		{ heading: authorBlock.heading, responsibility },
	);
	record = appendArea(record, cleanText(tags.date || tags.year));
	record = appendArea(
		record,
		formatPageCount(tags.pages || tags.numpages, isEng),
	);
	record = appendUrlArea(record, tags);
	return normalizeRecord(record);
}

function formatThesis(
	tags: Record<string, string>,
	title: string,
	typeInfo: string,
	authorBlock: AuthorBlock,
	isEng: boolean,
): string {
	const responsibility = [
		authorBlock.responsibility,
		cleanText(tags.institution || tags.school),
	]
		.filter(Boolean)
		.join(' ; ');
	let record = buildPrimaryDescription(
		titleWithType(title, typeInfo || (isEng ? 'thesis' : 'дис.')),
		{ heading: authorBlock.heading, responsibility },
	);
	record = appendArea(
		record,
		formatPlacePublisherYear(tags.address || tags.location, '', tags.year),
	);
	record = appendArea(
		record,
		formatPageCount(tags.pages || tags.numpages, isEng),
	);
	record = appendUrlArea(record, tags);
	return normalizeRecord(record);
}

function formatStandard(tags: Record<string, string>, title: string): string {
	const designation = cleanText(tags.number);
	let record = designation ? `${designation}. ${title}` : title;
	record = appendArea(
		record,
		formatPlacePublisherYear(
			tags.address || tags.location,
			tags.publisher,
			tags.year,
		),
	);
	record = appendArea(
		record,
		formatPageCount(tags.pages || tags.numpages, false),
	);
	record = appendUrlArea(record, tags);
	return normalizeRecord(record);
}

function formatSitePart(
	tags: Record<string, string>,
	title: string,
	authorBlock: AuthorBlock,
	isEng: boolean,
): string {
	const website = cleanText(tags.website || tags.booktitle);
	let record = `${buildPrimaryDescription(title, authorBlock)} // ${website} : ${isEng ? 'website' : 'сайт'}.`;
	record = appendArea(record, cleanText(tags.year));
	record = appendUrlArea(record, tags);
	return normalizeRecord(record);
}

function formatArticle(
	tags: Record<string, string>,
	title: string,
	authorBlock: AuthorBlock,
	isEng: boolean,
	noteBlock: NoteBlock,
): string {
	let record = buildPrimaryDescription(title, authorBlock, noteBlock);
	if (tags.doi) {
		record = `${ensureFinalDot(record)} – DOI: ${cleanDoi(tags.doi)}`;
	}
	if (tags.journal) {
		record = `${record} // ${cleanText(tags.journal)}.`;
	} else {
		record = ensureFinalDot(record);
	}

	record = appendArea(record, cleanText(tags.year));
	record = appendArea(
		record,
		formatVolumeIssue(tags.volume, tags.number || tags.issue, isEng),
	);
	record = appendArea(record, formatPages(tags.pages, isEng));
	return normalizeRecord(appendUrlArea(record, tags));
}

function formatCollectionPart(
	tags: Record<string, string>,
	title: string,
	authorBlock: AuthorBlock,
	isEng: boolean,
	noteBlock: NoteBlock,
): string {
	let record = buildPrimaryDescription(title, authorBlock, noteBlock);
	if (tags.booktitle) {
		record = `${record} // ${cleanText(tags.booktitle)}.`;
	}

	record = appendArea(
		record,
		formatPlacePublisherYear(
			tags.address || tags.location,
			tags.publisher || tags.organization,
			tags.year,
		),
	);
	record = appendArea(record, formatPages(tags.pages, isEng));
	return normalizeRecord(appendUrlArea(record, tags));
}

function formatBook(
	tags: Record<string, string>,
	title: string,
	typeInfo: string,
	authorBlock: AuthorBlock,
	isEng: boolean,
	noteBlock: NoteBlock,
): string {
	const editor = tags.editor
		? parseAuthors(tags.editor, isEng).responsibility
		: '';
	const bookNote: NoteBlock = {
		responsibility: [
			...noteBlock.responsibility,
			...(editor ? [`${isEng ? 'ed. by' : 'ред.'} ${editor}`] : []),
		],
		publication: noteBlock.publication,
	};
	let record = buildPrimaryDescription(
		titleWithType(title, typeInfo),
		authorBlock,
		bookNote,
	);
	record = appendArea(record, cleanText(tags.edition));
	for (const publicationNote of noteBlock.publication) {
		record = appendArea(record, publicationNote);
	}
	record = appendArea(
		record,
		formatPlacePublisherYear(
			tags.address || tags.location,
			tags.publisher,
			tags.year,
		),
	);
	record = appendArea(
		record,
		formatPageCount(tags.pages || tags.numpages, isEng),
	);
	return normalizeRecord(appendUrlArea(record, tags));
}

function formatNorm(tags: Record<string, string>, title: string): string {
	let record = title;
	if (tags.journal) {
		record = `${record} // ${cleanText(tags.journal)}.`;
	}
	record = appendArea(record, cleanText(tags.year));
	record = appendArea(
		record,
		tags.number ? `№ ${cleanText(tags.number)}` : '',
	);
	record = appendArea(record, cleanText(tags.note));
	return normalizeRecord(appendUrlArea(record, tags));
}

function formatTechReport(
	tags: Record<string, string>,
	title: string,
	typeInfo: string,
	authorBlock: AuthorBlock,
	isEng: boolean,
): string {
	const institution = cleanText(tags.institution);
	const responsibility = [
		authorBlock.responsibility,
		institution !== authorBlock.responsibility ? institution : '',
	]
		.filter(Boolean)
		.join(' ; ');
	let record = buildPrimaryDescription(titleWithType(title, typeInfo), {
		heading: authorBlock.heading,
		responsibility,
	});
	record = appendArea(
		record,
		tags.number ? `${isEng ? 'No.' : '№'} ${cleanText(tags.number)}` : '',
	);
	record = appendArea(record, cleanText(tags.year));
	record = appendUrlArea(record, tags);
	return normalizeRecord(record);
}

function formatOnline(
	tags: Record<string, string>,
	title: string,
	typeInfo: string,
	authorBlock: AuthorBlock,
	noteBlock: NoteBlock,
): string {
	const containerTitle = cleanText(
		tags.journal || tags.booktitle || tags.website,
	);
	const titleBlock = titleWithType(title, typeInfo);
	let record = buildPrimaryDescription(titleBlock, authorBlock, noteBlock);

	if (tags.doi) {
		record = `${ensureFinalDot(record)} – DOI: ${cleanDoi(tags.doi)}`;
	}
	if (containerTitle) {
		record = `${record} // ${containerTitle}.`;
	} else {
		record = ensureFinalDot(record);
	}

	record = appendArea(
		record,
		formatPlacePublisherYear(
			tags.address || tags.location,
			tags.publisher,
			tags.year,
		),
	);
	record = appendUrlArea(record, tags);
	for (const publicationNote of noteBlock.publication) {
		record = appendArea(record, publicationNote);
	}
	return normalizeRecord(record);
}
