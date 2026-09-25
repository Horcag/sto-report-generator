export type StoInlineListKind = 'simple' | 'complex';

export function parseStoInlineListItems(value: string): string[] | null {
	const items = value.split('|').map(item => item.trim());
	if (items.length < 2 || items.some(item => !item || /[;.]$/.test(item))) {
		return null;
	}
	return items;
}

export function formatStoInlineList(
	kind: StoInlineListKind,
	items: readonly string[],
): string {
	return items.join(kind === 'simple' ? ', ' : '; ');
}
