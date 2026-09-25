export interface StoTerm {
	term: string;
	explanation: string;
	unit?: string;
}

export function parseStoTermLine(line: string): StoTerm | null {
	const cells = line.split('|').map(cell => cell.trim());
	if (
		(cells.length !== 2 && cells.length !== 3) ||
		!cells[0] ||
		!cells[1] ||
		(cells.length === 3 && !cells[2])
	) {
		return null;
	}
	return {
		term: cells[0],
		explanation: cells[1],
		unit: cells[2],
	};
}

export function compareStoTerms(left: string, right: string): number {
	return left.localeCompare(right, 'ru', { sensitivity: 'base' });
}
