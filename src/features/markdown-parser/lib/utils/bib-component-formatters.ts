import { appendSeriesArea } from './bib-description-areas';
import {
	appendArea,
	appendUrlArea,
	buildPrimaryDescription,
	cleanDoi,
	cleanText,
	ensureFinalDot,
	formatArticleNumber,
	formatContinuingYear,
	formatPages,
	formatPlacePublisherYear,
	formatVolumeIssue,
	normalizeRecord,
	parseAuthors,
	type AuthorBlock,
	type NoteBlock,
} from './bib-format-utils';

export function formatSitePart(
	tags: Record<string, string>,
	title: string,
	authorBlock: AuthorBlock,
	isEng: boolean,
): string {
	const website = cleanText(tags.website || tags.booktitle);
	let primary = buildPrimaryDescription(title, authorBlock);
	const doi = cleanDoi(tags.doi ?? '');
	if (doi) primary = `${ensureFinalDot(primary)} – DOI: ${doi}`;
	const websiteResponsibility = cleanText(tags.websiteresponsibility);
	let record = `${primary} // ${website} : [${isEng ? 'website' : 'сайт'}]${websiteResponsibility ? ` / ${websiteResponsibility}` : ''}.`;
	record = appendArea(
		record,
		formatPlacePublisherYear(
			tags.address || tags.location,
			tags.publisher,
			formatContinuingYear(tags.year),
		),
	);
	record = appendUrlArea(record, tags);
	return normalizeRecord(record);
}

export function formatArticle(
	tags: Record<string, string>,
	title: string,
	authorBlock: AuthorBlock,
	isEng: boolean,
	noteBlock: NoteBlock,
): string {
	let record = buildPrimaryDescription(title, authorBlock, noteBlock);
	const doi = cleanDoi(tags.doi ?? '');
	if (doi) record = `${ensureFinalDot(record)} – DOI: ${doi}`;
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
	record = appendArea(record, formatArticleNumber(tags, isEng));
	for (const publicationNote of noteBlock.publication) {
		record = appendArea(record, publicationNote);
	}
	return normalizeRecord(appendUrlArea(record, tags));
}

export function formatCollectionPart(
	tags: Record<string, string>,
	title: string,
	authorBlock: AuthorBlock,
	isEng: boolean,
	noteBlock: NoteBlock,
): string {
	let record = buildPrimaryDescription(title, authorBlock, noteBlock);
	const doi = cleanDoi(tags.doi ?? '');
	if (doi) record = `${ensureFinalDot(record)} – DOI: ${doi}`;
	if (tags.booktitle) {
		const editor = tags.editor
			? parseAuthors(tags.editor, isEng).responsibility
			: '';
		record = `${record} // ${cleanText(tags.booktitle)}${editor ? ` / ${isEng ? 'ed. by' : 'под ред.'} ${editor}` : ''}.`;
	}

	record = appendArea(
		record,
		formatPlacePublisherYear(
			tags.address || tags.location,
			tags.publisher || tags.organization,
			tags.year,
		),
	);
	record = appendArea(
		record,
		formatVolumeIssue(tags.volume, undefined, isEng),
	);
	record = appendArea(record, formatPages(tags.pages, isEng));
	record = appendArea(record, formatArticleNumber(tags, isEng));
	record = appendSeriesArea(record, tags);
	for (const publicationNote of noteBlock.publication) {
		record = appendArea(record, publicationNote);
	}
	return normalizeRecord(appendUrlArea(record, tags));
}
