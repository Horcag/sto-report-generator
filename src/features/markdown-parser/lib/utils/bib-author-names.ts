/** BibTeX protects corporate names and literal name parts with braces. */
export function splitAuthorNames(raw: string): string[] {
	const names: string[] = [];
	let depth = 0;
	let start = 0;
	for (let index = 0; index < raw.length; index++) {
		if (raw[index] === '{') depth++;
		if (raw[index] === '}') depth--;
		if (depth !== 0) continue;
		const separator = /^\s+and\s+/i.exec(raw.slice(index));
		if (!separator) continue;
		names.push(raw.slice(start, index).trim());
		index += separator[0].length - 1;
		start = index + 1;
	}
	names.push(raw.slice(start).trim());
	return names.filter(Boolean);
}

export function formatAuthorName(
	name: string,
	collective: boolean,
): {
	heading: string;
	responsibility: string;
} {
	if (collective) {
		return { heading: '', responsibility: name };
	}
	const parts = name.split(',').map(part => part.trim());
	if (parts.length === 1) {
		// Without explicit BibTeX family/given separation, keep the source's
		// spelling and order rather than guessing compound surnames.
		return { heading: name, responsibility: name };
	}
	const family = parts[0] ?? '';
	const given = parts.at(-1) ?? '';
	const suffix = parts.length > 2 ? parts[1] : '';
	const initials = given
		.split(/\s+/)
		.filter(Boolean)
		.flatMap(word => word.match(/\p{L}[\p{L}\p{M}]*\.?|-/gu) ?? [])
		.map(part => (part === '-' ? '-' : `${part[0]}.`))
		.join(' ')
		.replace(/\s*-\s*/g, '-');
	const suffixPart = suffix ? `, ${suffix}` : '';
	return {
		heading: `${family}${initials ? `, ${initials}` : ''}${suffixPart}`,
		responsibility: `${initials ? `${initials} ` : ''}${family}${suffixPart}`,
	};
}
