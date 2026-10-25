import { formatAuthorName, splitAuthorNames } from './bib-author-names';

export interface AuthorBlock {
	heading: string;
	responsibility: string;
}

export interface NoteBlock {
	responsibility: string[];
	publication: string[];
}

export function buildPrimaryDescription(
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

export function parseAuthors(rawAuthors: string, isEng: boolean): AuthorBlock {
	const raw = rawAuthors.trim();
	if (!raw) {
		return { heading: '', responsibility: '' };
	}

	const names = splitAuthorNames(raw);
	const hasOthers = names.some(name => /^others$/i.test(name));
	const persons = names
		.filter(name => cleanText(name) && !/^others$/i.test(name))
		.map(name => formatAuthorName(cleanText(name), /^\{.*\}$/s.test(name)));

	if (persons.length === 0) {
		return { heading: '', responsibility: '' };
	}

	if (hasOthers || persons.length > 4) {
		const visibleAuthors = persons
			.slice(0, 3)
			.map(person => person.responsibility);
		return {
			heading: '',
			responsibility: `${visibleAuthors.join(', ')} ${isEng ? '[et al.]' : '[и др.]'}`,
		};
	}

	const responsibility = persons
		.map(person => person.responsibility)
		.join(', ');
	const heading = persons.length <= 3 ? (persons[0]?.heading ?? '') : '';
	return { heading, responsibility };
}

export function parseNote(rawNote: string): NoteBlock {
	const note = cleanText(rawNote);
	if (!note) {
		return { responsibility: [], publication: [] };
	}

	const parts = note
		.split(/\s+–\s+/)
		.map(cleanText)
		.map(spaceInitials)
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

export function titleWithType(title: string, typeInfo: string): string {
	return typeInfo ? `${title} : ${cleanText(typeInfo)}` : title;
}

export function formatVolumeIssue(
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

export function formatPages(pages: string | undefined, isEng: boolean): string {
	const cleanPages = normalizePageRange(pages);
	if (!cleanPages) {
		return '';
	}

	if (/^(?:article|e)\s*/i.test(cleanPages)) {
		return `${isEng ? 'Article' : 'Статья'} ${cleanPages.replace(/^article\s*/i, '').trim()}`;
	}
	return `${isEng ? 'P.' : 'С.'} ${cleanPages}`;
}

export function formatArticleNumber(
	tags: Record<string, string>,
	isEng: boolean,
): string {
	const number = cleanText(tags.eid || tags.articleno);
	return number ? `${isEng ? 'Article' : 'Статья'} ${number}` : '';
}

export function formatVersion(
	tags: Record<string, string>,
	isEng: boolean,
): string {
	const version = cleanText(tags.version);
	return version ? `${isEng ? 'Version' : 'Версия'} ${version}` : '';
}

export function formatPageCount(
	pages: string | undefined,
	isEng: boolean,
): string {
	const cleanPages = cleanText(pages);
	return cleanPages ? `${cleanPages} ${isEng ? 'p.' : 'с.'}` : '';
}

/** Continuing website dates are supplied explicitly, never inferred from access. */
export function formatContinuingYear(year: string | undefined): string {
	return cleanText(year).replace(
		/^(\d{4})\s*(?:--|[–-])\s*(\d{4})?$/,
		(_, start: string, end: string | undefined) =>
			end ? `${start}–${end}` : `${start} –`,
	);
}

export function formatPlacePublisherYear(
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

export function appendArea(record: string, area: string | undefined): string {
	const cleanArea = cleanText(area);
	if (!cleanArea) {
		return record;
	}
	return `${ensureFinalDot(record)} – ${ensureFinalDot(cleanArea)}`;
}

export function appendUrlArea(
	record: string,
	tags: Record<string, string>,
): string {
	if (!tags.url) {
		return record;
	}
	if (/\s/.test(tags.url.trim())) {
		throw new Error('Bibliography URL must not contain whitespace.');
	}

	const accessDate = formatAccessDate(tags.urldate);
	const accessMode = cleanText(
		tags.access || tags.accessmode || tags.availability,
	);
	const url = cleanText(tags.url);
	// ГОСТ Р 7.0.108-2022, 5.3.5: explicit update/republication notes
	// precede the address; publication date and access mode follow it.
	let result = record;
	if (tags.updated) {
		result = appendArea(
			result,
			`Дата обновления: ${cleanText(tags.updated)}`,
		);
	}
	if (tags.republication) {
		result = appendArea(result, tags.republication);
	}
	result = `${ensureFinalDot(result)} – URL: ${url}`;
	if (accessDate) {
		result += ` (дата обращения: ${accessDate}).`;
	} else {
		result = ensureFinalDot(result);
	}
	if (tags.publicationdate) {
		result = appendArea(
			result,
			`Дата публикации: ${cleanText(tags.publicationdate)}`,
		);
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

export function cleanDoi(rawDoi: string): string {
	return cleanText(rawDoi).replace(
		/^(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:\s*)/i,
		'',
	);
}

function normalizePageRange(pages: string | undefined): string {
	return cleanText(pages).replace(/--/g, '-');
}

function spaceInitials(value: string): string {
	return cleanText(value).replace(/(\p{Lu})\.\s*(?=\p{Lu}\.)/gu, '$1. ');
}

export function cleanText(value: string | undefined): string {
	return (value ?? '').replace(/[{}]/g, '').replace(/\s+/g, ' ').trim();
}

export function ensureFinalDot(value: string): string {
	const trimmed = value.trim();
	if (!trimmed) {
		return trimmed;
	}
	return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

export function normalizeRecord(record: string): string {
	return ensureFinalDot(
		record
			.replace(/\s+/g, ' ')
			.replace(/\s+([,.])/g, '$1')
			.replace(/(\d{4}) –\./g, '$1 – .')
			.replace(/\.{2,}/g, '.')
			.replace(/\s+–\s+/g, ' – ')
			.trim(),
	);
}

export function isEnglish(langid: string | undefined): boolean {
	const lang = cleanText(langid).toLowerCase();
	return lang === 'english' || lang === 'en';
}
