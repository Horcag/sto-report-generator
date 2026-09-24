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

export function parseNote(rawNote: string): NoteBlock {
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

export function formatPageCount(
	pages: string | undefined,
	isEng: boolean,
): string {
	const cleanPages = cleanText(pages);
	return cleanPages ? `${cleanPages} ${isEng ? 'p.' : 'с.'}` : '';
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

export function cleanDoi(rawDoi: string): string {
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
			.replace(/\.{2,}/g, '.')
			.replace(/\s+–\s+/g, ' – ')
			.trim(),
	);
}

export function isEnglish(langid: string | undefined): boolean {
	const lang = cleanText(langid).toLowerCase();
	return lang === 'english' || lang === 'en';
}
