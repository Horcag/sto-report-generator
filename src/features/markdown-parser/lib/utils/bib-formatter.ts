import { BibItem } from '../types';

/**
 * GOST 7.0.5-2008 BibTeX formatter for Russian STO reports.
 */
export function formatBibItem(item: BibItem): string {
	const tags = item.entryTags;
	let rawAuthors = tags.author || '';
	let authors = '';
	let isCollective = false;
	let isManyAuthors = false;
	let firstAuthorPrefix = '';

	if (rawAuthors) {
		// Check for collective author enclosed in braces
		if (rawAuthors.includes('{') && rawAuthors.includes('}')) {
			isCollective = true;
			authors = rawAuthors.replace(/[{}]/g, '').trim();
		} else {
			const authorList = rawAuthors.split(' and ');
			if (authorList.length > 3) {
				isManyAuthors = true;
				const firstAuthor = authorList[0]
					.split(',')
					.reverse()
					.join(' ')
					.trim();
				authors = `${firstAuthor} [и др.]`;
			} else {
				authors = authorList
					.map((a: string) => a.split(',').reverse().join(' ').trim())
					.join(', ');
				// First author for prefix
				firstAuthorPrefix = authorList[0].split(',')[0].trim();
				const initialsMatch = authorList[0].match(/,\s*([A-ZА-ЯЁ].*)/);
				if (initialsMatch) {
					firstAuthorPrefix += ', ' + initialsMatch[1].trim();
				}
			}
		}
	}

	const title = tags.title ? tags.title.replace(/[{}]/g, '') : 'Без названия';
	const year = tags.year || '';

	let res = '';
	if (isCollective || isManyAuthors || !authors) {
		res += `${title}`;
		if (authors) {
			res += ` / ${authors}`;
		}
	} else {
		// 1 to 3 authors: prefix title with the first author
		res += `${firstAuthorPrefix} ${title} / ${authors}`;
	}

	if (item.entryType === 'article') {
		const journal = tags.journal || '';
		const vol = tags.volume || '';
		const num = tags.number || tags.issue || '';
		const pages = tags.pages || '';
		res += ` // ${journal}.`;
		if (year) res += ` – ${year}.`;
		if (vol) res += ` – Т. ${vol}`;
		if (num) res += `, № ${num}.`;
		if (pages) res += ` – С. ${pages}.`;
	} else if (item.entryType === 'book') {
		const address = tags.address || tags.location || 'Б.м.';
		const publisher = tags.publisher || 'Б.и.';
		const pages = tags.pages || tags.numpages || '';
		res += ` – ${address} : ${publisher}`;
		if (year) res += `, ${year}.`;
		if (pages) res += ` – ${pages} с.`;
	} else {
		if (year) res += ` – ${year}.`;
	}

	return res;
}
