import { BibItem } from '../types';

/**
 * GOST 7.0.5-2008 BibTeX formatter for Russian STO reports.
 */
export function formatBibItem(item: BibItem): string {
	const rawTags = item.entryTags;
	const tags: Record<string, string> = {};
	for (const k of Object.keys(rawTags)) {
		tags[k.toLowerCase()] = rawTags[k];
	}
	const entryType = (item.entryType || '').toLowerCase();
	const lang = tags.langid || 'russian';
	const isEng = lang === 'english' || lang === 'en';

	const rawAuthors = tags.author || '';
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
			if (
				authorList.length > 3 ||
				rawAuthors.includes('and others') ||
				rawAuthors.includes('others')
			) {
				isManyAuthors = true;
				const firstAuthor = authorList[0]
					.split(',')
					.reverse()
					.join(' ')
					.trim();
				authors = `${firstAuthor} ${isEng ? '[et al.]' : '[и др.]'}`;
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
	const howpublished = tags.howpublished || tags.type || '';
	const note = tags.note || '';

	let material = '[Текст]';
	if (tags.url || entryType === 'misc') {
		material = '[Электронный ресурс]';
	}
	if (entryType === 'norm') {
		material = '';
	}
	if (title.includes('[Электронный ресурс]') || title.includes('[Текст]')) {
		material = '';
	}

	let titleBlock = `${title}`;
	if (material) titleBlock += ` ${material}`;

	if (howpublished) {
		titleBlock += ` : ${howpublished}`;
	}

	let respBlock = '';
	if (authors && entryType !== 'norm') {
		respBlock += authors;
	}
	if (tags.editor) {
		if (respBlock) respBlock += ' ; ';
		respBlock += `под ред. ${tags.editor}`;
	}
	if (note && entryType !== 'norm') {
		if (respBlock) {
			respBlock += ` ; ${note}`;
		} else {
			respBlock += note;
		}
	}

	let res = '';
	if (isCollective || isManyAuthors || !authors) {
		res += `${titleBlock}`;
		if (respBlock) {
			res += ` / ${respBlock}`;
		}
	} else {
		// 1 to 3 authors: prefix title with the first author
		res += `${firstAuthorPrefix} ${titleBlock}`;
		if (respBlock) {
			res += ` / ${respBlock}`;
		}
	}

	if (entryType === 'article') {
		const journal = tags.journal || '';
		const vol = tags.volume || '';
		const num = tags.number || tags.issue || '';
		let pages = tags.pages || '';

		// Clean pages (e.g. 252--258 -> 252-258)
		pages = pages.replace(/--/g, '-');

		if (journal) {
			res += ` // ${journal}.`;
		}
		if (year) res += ` – ${year}.`;
		if (vol) res += ` – ${isEng ? 'Vol.' : 'Т.'} ${vol}`;
		if (num) {
			if (vol) {
				res += `, ${isEng && !num.toLowerCase().includes('n') && !num.toLowerCase().includes('№') ? '№ ' : '№ '}${num.replace(/№/g, '').trim()}.`;
			} else {
				res += ` – ${isEng && !num.toLowerCase().includes('n') && !num.toLowerCase().includes('№') ? '№ ' : '№ '}${num.replace(/№/g, '').trim()}.`;
			}
		} else if (vol) {
			res += `.`;
		}
		if (pages) {
			if (
				pages.toLowerCase().includes('article') ||
				pages.toLowerCase().includes('e')
			) {
				res += ` – ${isEng ? 'Article' : 'Статья'} ${pages.replace(/article/i, '').trim()}.`;
			} else {
				res += ` – ${isEng ? 'P.' : 'С.'} ${pages}.`;
			}
		}
		if (tags.doi) res += ` – DOI: ${tags.doi}`;
	} else if (entryType === 'book') {
		res += `.`; // Add dot before the location block for books
		const address = tags.address || tags.location || 'Б.м.';
		const publisher = tags.publisher || 'Б.и.';
		const pages = tags.pages || tags.numpages || '';
		if (tags.edition) res += ` – ${tags.edition}.`;
		res += ` – ${address} : ${publisher}`;
		if (year) res += `, ${year}.`;
		if (pages) res += ` – ${pages} ${isEng ? 'p.' : 'с.'}`;
	} else if (entryType === 'norm') {
		const journal = tags.journal || '';
		const num = tags.number || '';
		if (journal) res += ` // ${journal}.`;
		if (year) res += ` – ${year}.`;
		if (num) res += ` – № ${num}.`;
		if (note) res += ` – ${note}.`;
	} else if (entryType === 'misc' || entryType === 'techreport' || tags.url) {
		const journal = tags.journal || '';
		if (journal) {
			res += ` // ${journal}.`;
		} else if (res && !res.endsWith('.')) {
			// e.g. titleBlock has no journal
		}

		const address = tags.address || tags.location || '[Б. м.]';
		if (entryType === 'techreport') {
			res += `.`;
			if (tags.institution) res += ` / ${tags.institution}`;
			if (year) res += ` – ${year}.`;
		} else {
			res += ` – Электрон. дан.`;
			res += ` – ${address}, ${year || 'Б.г.'}.`;
		}

		if (tags.url) {
			res += ` – URL: ${tags.url}`;
			if (tags.urldate) {
				// Convert 2025-06-30 to 30.06.2025
				const d = tags.urldate.split('-');
				if (d.length === 3) {
					res += ` (дата обращения: ${d[2]}.${d[1]}.${d[0]}).`;
				} else {
					res += ` (дата обращения: ${tags.urldate}).`;
				}
			} else {
				res += `.`;
			}
		} else if (year && !res.includes(year)) {
			res += ` – ${year}.`;
		}
	} else {
		if (year) res += ` – ${year}.`;
	}

	// Clean up double dots and multiple spaces
	return res
		.replace(/\.\./g, '.')
		.replace(/--/g, '-')
		.replace(/\s+/g, ' ')
		.replace(/\s+\./g, '.')
		.trim();
}
