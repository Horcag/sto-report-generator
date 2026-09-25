export function parseIsoDate(value: string): Date | undefined {
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
	if (!match) {
		return undefined;
	}
	const year = Number(match[1]);
	const month = Number(match[2]);
	const day = Number(match[3]);
	const parsed = new Date(Date.UTC(year, month - 1, day));
	if (
		parsed.getUTCFullYear() !== year ||
		parsed.getUTCMonth() !== month - 1 ||
		parsed.getUTCDate() !== day
	) {
		return undefined;
	}
	return parsed;
}

export function isFutureDate(value: string): boolean {
	const parsed = parseIsoDate(value);
	if (!parsed) {
		return false;
	}
	const now = new Date();
	const today = new Date(
		Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()),
	);
	return parsed.getTime() > today.getTime();
}

export function yearFromIsoDate(value: string): string | undefined {
	return parseIsoDate(value)?.getUTCFullYear().toString();
}
