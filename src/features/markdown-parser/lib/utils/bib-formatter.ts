import { BibItem } from '../types';

interface AuthorBlock {
	heading: string;
	responsibility: string;
}

interface NoteBlock {
	responsibility: string[];
	publication: string[];
}

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
	const title = cleanText(tags.title) || 'Без названия';
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
		case 'techreport':
			return formatTechReport(tags, title, typeInfo, authorBlock, isEng);
		case 'misc':
		case 'online':
			return formatOnline(
				tags,
				title,
				typeInfo,
				authorBlock,
				isEng,
				noteBlock,
			);
		default:
			if (tags.url) {
				return formatOnline(
					tags,
					title,
					typeInfo,
					authorBlock,
					isEng,
					noteBlock,
				);
			}
			return normalizeRecord(
				appendYear(
					buildPrimaryDescription(
						titleWithType(title, typeInfo),
						authorBlock,
					),
					tags.year,
				),
			);
	}
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
	return normalizeRecord(record);
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
	return normalizeRecord(record);
}

function formatBook(
	tags: Record<string, string>,
	title: string,
	typeInfo: string,
	authorBlock: AuthorBlock,
	isEng: boolean,
	noteBlock: NoteBlock,
): string {
	let record = buildPrimaryDescription(
		titleWithType(title, typeInfo),
		authorBlock,
		noteBlock,
	);
	record = appendArea(record, cleanText(tags.edition));
	for (const publicationNote of noteBlock.publication) {
		record = appendArea(record, publicationNote);
	}
	record = appendArea(
		record,
		formatPlacePublisherYear(
			tags.address || tags.location || '[Б. м.]',
			tags.publisher || '[б. и.]',
			tags.year,
		),
	);
	record = appendArea(
		record,
		formatPageCount(tags.pages || tags.numpages, isEng),
	);
	return normalizeRecord(record);
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
	return normalizeRecord(record);
}

function formatTechReport(
	tags: Record<string, string>,
	title: string,
	typeInfo: string,
	authorBlock: AuthorBlock,
	isEng: boolean,
): string {
	const responsibility = [
		authorBlock.responsibility,
		cleanText(tags.institution),
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
	isEng: boolean,
	noteBlock: NoteBlock,
): string {
	const containerTitle = cleanText(
		tags.journal || tags.booktitle || tags.website,
	);
	const titleBlock = containerTitle
		? titleWithType(title, typeInfo)
		: titleWithType(title, typeInfo || '[сайт]');
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
			tags.address || tags.location || '[Б. м.]',
			'',
			tags.year || (isEng ? '[s. a.]' : '[б. г.]'),
		),
	);
	record = appendUrlArea(record, tags);
	for (const publicationNote of noteBlock.publication) {
		record = appendArea(record, publicationNote);
	}
	return normalizeRecord(record);
}

function buildPrimaryDescription(
	titleBlock: string,
	authorBlock: AuthorBlock,
	noteBlock?: NoteBlock,
): string {
	const responsibilityParts = [
		authorBlock.responsibility,
		...(noteBlock?.responsibility ?? []),
	].filter(Boolean);
	const responsibility = responsibilityParts.join(' ; ');
	const description = authorBlock.heading
		? `${authorBlock.heading}. ${titleBlock}`
		: titleBlock;

	return responsibility ? `${description} / ${responsibility}` : description;
}

function parseAuthors(rawAuthors: string, isEng: boolean): AuthorBlock {
	const raw = rawAuthors.trim();
	if (!raw) {
		return { heading: '', responsibility: '' };
	}

	const withoutBraces = cleanText(raw);
	const isCollective = /^\{+[^{}].*}+$/s.test(raw) && !/\s+and\s+/i.test(raw);
	if (isCollective) {
		return { heading: '', responsibility: withoutBraces };
	}

	const hasOthers = /\bothers\b/i.test(raw);
	const persons = raw
		.split(/\s+and\s+/i)
		.map(cleanText)
		.filter(value => value && !/^others$/i.test(value));

	if (persons.length === 0) {
		return { heading: '', responsibility: '' };
	}

	if (hasOthers || persons.length > 4) {
		const visibleAuthors = persons
			.slice(0, 3)
			.map(formatResponsibilityName);
		return {
			heading: '',
			responsibility: `${visibleAuthors.join(', ')} ${isEng ? '[et al.]' : '[и др.]'}`,
		};
	}

	const responsibility = persons.map(formatResponsibilityName).join(', ');
	const heading =
		persons.length <= 3 ? formatHeadingName(persons[0] ?? '') : '';
	return { heading, responsibility };
}

function parseNote(rawNote: string): NoteBlock {
	const note = cleanText(rawNote);
	if (!note) {
		return { responsibility: [], publication: [] };
	}

	const parts = note
		.split(/\s+–\s+/)
		.map(cleanText)
		.map(compactInitials)
		.filter(Boolean);
	if (parts.length === 0) {
		return { responsibility: [], publication: [] };
	}

	const [first, ...rest] = parts;
	if (/^(под ред\.|ред\.|сост\.)/i.test(first)) {
		return { responsibility: [first], publication: rest };
	}
	return { responsibility: [], publication: parts };
}

function formatHeadingName(rawName: string): string {
	const name = cleanText(rawName);
	const commaIndex = name.indexOf(',');
	if (commaIndex < 0) {
		return compactInitials(name);
	}

	const family = name.slice(0, commaIndex).trim();
	const given = compactInitials(name.slice(commaIndex + 1).trim());
	return given ? `${family}, ${given}` : family;
}

function formatResponsibilityName(rawName: string): string {
	const name = cleanText(rawName);
	const commaIndex = name.indexOf(',');
	if (commaIndex < 0) {
		return compactInitials(name);
	}

	const family = name.slice(0, commaIndex).trim();
	const given = compactInitials(name.slice(commaIndex + 1).trim());
	return given ? `${given} ${family}` : family;
}

function titleWithType(title: string, typeInfo: string): string {
	return typeInfo ? `${title} : ${cleanText(typeInfo)}` : title;
}

function formatVolumeIssue(
	volume: string | undefined,
	issue: string | undefined,
	isEng: boolean,
): string {
	const cleanVolume = cleanText(volume);
	const cleanIssue = cleanText(issue).replace(/^№\s*/, '');
	if (cleanVolume && cleanIssue) {
		return `${isEng ? 'Vol.' : 'Т.'} ${cleanVolume}, № ${cleanIssue}`;
	}
	if (cleanVolume) {
		return `${isEng ? 'Vol.' : 'Т.'} ${cleanVolume}`;
	}
	if (cleanIssue) {
		return `№ ${cleanIssue}`;
	}
	return '';
}

function formatPages(pages: string | undefined, isEng: boolean): string {
	const cleanPages = normalizePageRange(pages);
	if (!cleanPages) {
		return '';
	}

	if (/^(?:article|e)\s*/i.test(cleanPages)) {
		return `${isEng ? 'Article' : 'Статья'} ${cleanPages.replace(/^article\s*/i, '').trim()}`;
	}
	return `${isEng ? 'P.' : 'С.'} ${cleanPages}`;
}

function formatPageCount(pages: string | undefined, isEng: boolean): string {
	const cleanPages = cleanText(pages);
	return cleanPages ? `${cleanPages} ${isEng ? 'p.' : 'с.'}` : '';
}

function formatPlacePublisherYear(
	place: string | undefined,
	publisher: string | undefined,
	year: string | undefined,
): string {
	const cleanPlace = cleanText(place);
	const cleanPublisher = cleanText(publisher);
	const cleanYear = cleanText(year);

	const result =
		cleanPlace && cleanPublisher
			? `${cleanPlace} : ${cleanPublisher}`
			: cleanPlace || cleanPublisher;

	if (cleanYear) {
		return result ? `${result}, ${cleanYear}` : cleanYear;
	}
	return result;
}

function appendYear(record: string, year: string | undefined): string {
	return appendArea(record, cleanText(year));
}

function appendArea(record: string, area: string | undefined): string {
	const cleanArea = cleanText(area);
	if (!cleanArea) {
		return record;
	}
	return `${ensureFinalDot(record)} – ${ensureFinalDot(cleanArea)}`;
}

function appendUrlArea(record: string, tags: Record<string, string>): string {
	if (!tags.url) {
		return record;
	}

	const accessDate = formatAccessDate(tags.urldate);
	const accessMode = cleanText(
		tags.access || tags.accessmode || tags.availability,
	);
	const url = cleanText(tags.url);
	let result = `${ensureFinalDot(record)} – URL: ${url}`;
	if (accessDate) {
		result += ` (дата обращения: ${accessDate}).`;
	} else {
		result = ensureFinalDot(result);
	}
	if (accessMode) {
		result = appendArea(result, `Режим доступа: ${accessMode}`);
	}
	return result;
}

function formatAccessDate(rawDate: string | undefined): string {
	const date = cleanText(rawDate);
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
	if (match) {
		return `${match[3]}.${match[2]}.${match[1]}`;
	}
	return date;
}

function cleanDoi(rawDoi: string): string {
	return cleanText(rawDoi).replace(
		/^(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:\s*)/i,
		'',
	);
}

function normalizePageRange(pages: string | undefined): string {
	return cleanText(pages).replace(/--/g, '-');
}

function compactInitials(value: string): string {
	return cleanText(value).replace(/([A-ZА-ЯЁ])\.\s+(?=[A-ZА-ЯЁ]\.)/g, '$1.');
}

function cleanText(value: string | undefined): string {
	return (value ?? '').replace(/[{}]/g, '').replace(/\s+/g, ' ').trim();
}

function ensureFinalDot(value: string): string {
	const trimmed = value.trim();
	if (!trimmed) {
		return trimmed;
	}
	return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

function normalizeRecord(record: string): string {
	return ensureFinalDot(
		record
			.replace(/\s+/g, ' ')
			.replace(/\s+([,.])/g, '$1')
			.replace(/\.{2,}/g, '.')
			.replace(/\s+–\s+/g, ' – ')
			.trim(),
	);
}

function isEnglish(langid: string | undefined): boolean {
	const lang = cleanText(langid).toLowerCase();
	return lang === 'english' || lang === 'en';
}
