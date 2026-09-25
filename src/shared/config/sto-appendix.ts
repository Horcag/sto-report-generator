export interface AppendixHeading {
	label: string;
	title: string;
}

export const APPENDIX_LABELS = [
	'А',
	'Б',
	'В',
	'Г',
	'Д',
	'Е',
	'Ж',
	'И',
	'К',
	'Л',
	'М',
	'Н',
	'П',
	'Р',
	'С',
	'Т',
	'У',
	'Ф',
	'Х',
	'Ц',
	'Ш',
	'Щ',
	'Э',
	'Ю',
	'Я',
] as const;

export function parseAppendixHeading(
	label: string,
	title: string,
): AppendixHeading {
	const normalizedLabel = label.trim().toUpperCase();
	const normalizedTitle = title.trim();
	if (
		!APPENDIX_LABELS.includes(
			normalizedLabel as (typeof APPENDIX_LABELS)[number],
		)
	) {
		throw new Error(`Invalid appendix letter: ${label}.`);
	}
	if (
		!normalizedTitle ||
		normalizedTitle.endsWith('.') ||
		normalizedTitle.includes('"')
	) {
		throw new Error(
			'Appendix title must be nonempty, have no final period, and contain no straight double quote.',
		);
	}
	return { label: normalizedLabel, title: normalizedTitle };
}

export function appendixTocText(appendix: AppendixHeading): string {
	return `Приложение ${appendix.label}. ${appendix.title}`;
}
