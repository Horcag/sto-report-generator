import { BibItem } from '../types';
import {
	appendFinalAreas,
	appendSeriesArea,
	formatEditionArea,
	formatPhysicalArea,
	formatTitleArea,
	validateDescriptionAreas,
} from './bib-description-areas';
import {
	appendArea,
	appendUrlArea,
	buildPrimaryDescription,
	cleanText,
	ensureFinalDot,
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
 * Formatter for independent source-list descriptions using selected
 * ГОСТ Р 7.0.100-2018 fields. A ГОСТ Р 7.0.5-2008 behind-text reference
 * has different semantics and must not be inferred from the numbered list.
 */
export function formatBibItem(item: BibItem): string {
	const rawTags = item.entryTags;
	const tags: Record<string, string> = {};
	for (const k of Object.keys(rawTags)) {
		tags[k.toLowerCase()] = rawTags[k] ?? '';
	}

	const entryType = (item.entryType || '').toLowerCase();
	validateDescriptionAreas(entryType, tags, item.citationKey);
	const isEng = isEnglish(tags.langid);
	const authorBlock = parseAuthors(tags.author || '', isEng);
	const mainTitle = cleanText(tags.title);
	if (!mainTitle) {
		throw new Error(
			`Bibliography entry @${item.citationKey} has no title. Supply the source title or an editorial title in square brackets after checking the source.`,
		);
	}
	const title = formatTitleArea(mainTitle, tags);
	const typeInfo = cleanText(tags.howpublished || tags.type);
	const noteBlock = parseNote(tags.note || '');

	let record: string;
	switch (entryType) {
		case 'article':
			record = formatArticle(tags, title, authorBlock, isEng, noteBlock);
			break;
		case 'inproceedings':
		case 'incollection':
			record = formatCollectionPart(
				tags,
				title,
				authorBlock,
				isEng,
				noteBlock,
			);
			break;
		case 'book':
			record = formatBook(
				tags,
				title,
				typeInfo,
				authorBlock,
				isEng,
				noteBlock,
			);
			break;
		case 'norm':
			record = formatNorm(tags, title, authorBlock);
			break;
		case 'standard':
			record = formatStandard(tags, title);
			break;
		case 'patent':
			record = formatPatent(tags, title, authorBlock, isEng);
			break;
		case 'thesis':
		case 'phdthesis':
		case 'mastersthesis':
			record = formatThesis(tags, title, typeInfo, authorBlock, isEng);
			break;
		case 'inonline':
			record = formatSitePart(tags, title, authorBlock, isEng);
			break;
		case 'techreport':
		case 'report':
			record = formatTechReport(
				tags,
				title,
				typeInfo,
				authorBlock,
				isEng,
			);
			break;
		case 'misc':
		case 'online':
			record = formatOnline(
				tags,
				title,
				typeInfo,
				authorBlock,
				noteBlock,
			);
			break;
		default:
			throw new Error(
				`Unsupported bibliography type "${item.entryType}" for @${item.citationKey}.`,
			);
	}
	return normalizeRecord(appendFinalAreas(record, tags));
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
	record = appendArea(record, formatPhysicalArea(tags, isEng));
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
	record = appendArea(record, formatPhysicalArea(tags, isEng));
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
	record = appendArea(record, formatPhysicalArea(tags, false));
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
	for (const publicationNote of noteBlock.publication) {
		record = appendArea(record, publicationNote);
	}
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
	for (const publicationNote of noteBlock.publication) {
		record = appendArea(record, publicationNote);
	}
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
	const compiler = tags.compiler
		? parseAuthors(tags.compiler, isEng).responsibility
		: '';
	const bookNote: NoteBlock = {
		responsibility: [
			...(compiler
				? [`${isEng ? 'compiled by' : 'сост.'} ${compiler}`]
				: []),
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
	record = appendArea(record, formatEditionArea(tags));
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
	record = appendArea(record, formatPhysicalArea(tags, isEng));
	record = appendSeriesArea(record, tags);
	return normalizeRecord(appendUrlArea(record, tags));
}

function formatNorm(
	tags: Record<string, string>,
	title: string,
	authorBlock: AuthorBlock,
): string {
	let record = buildPrimaryDescription(
		titleWithType(title, cleanText(tags.howpublished)),
		authorBlock,
	);
	if (tags.journal) {
		record = `${record} // ${cleanText(tags.journal)}.`;
	}
	record = appendArea(record, cleanText(tags.year));
	record = appendArea(
		record,
		tags.number
			? `№ ${cleanText(tags.number).replace(/(\d)--(\d)/g, '$1–$2')}`
			: '',
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
	record = appendArea(record, formatPhysicalArea(tags, isEng));
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
