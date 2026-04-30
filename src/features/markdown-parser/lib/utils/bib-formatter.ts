import { BibItem } from '../types';

/**
 * GOST 7.0.5-2008 BibTeX formatter for Russian STO reports.
 */
export function formatBibItem(item: BibItem): string {
	const tags = item.entryTags;
	let authors = tags.author || '';
	if (authors) {
		const authorList = authors.split(' and ');
		if (authorList.length > 3) {
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
		}
	}

	const title = tags.title ? tags.title.replace(/[{}]/g, '') : 'Без названия';
	const year = tags.year || '';

	let res = '';
	if (authors) {
		const firstAuthor = authors.split(' ')[0] || '';
		res += `${firstAuthor} ${title}`;
		if (authors.includes('[и др.]')) {
			res += ` / ${authors}`;
		} else {
			res += ` / ${authors}`;
		}
	} else {
		res += `${title}`;
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
