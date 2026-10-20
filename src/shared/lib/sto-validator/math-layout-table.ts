import { extractWordText } from './body-xml';

/** Recognize formula wrappers, including adjacent wrappers merged by Word. */
export function isMathLayoutTable(tableXml: string): boolean {
	if (
		(tableXml.match(/<w:tbl\b/g)?.length ?? 0) !== 1 ||
		/<w:tblHeader\b/.test(tableXml) ||
		tableXml.includes('<w:drawing')
	) {
		return false;
	}
	const rows = tableXml.match(/<w:tr\b[\s\S]*?<\/w:tr>/g) ?? [];
	if (rows.length === 0) return false;
	for (const row of rows) {
		const cells = row.match(/<w:tc\b[\s\S]*?<\/w:tc>/g) ?? [];
		if (cells.length !== 3) return false;
		const [left, formula, right] = cells;
		if (
			extractWordText(left).trim() !== '' ||
			!/^[,;.]?$/u.test(extractWordText(formula).trim()) ||
			!formula.includes('<m:oMath') ||
			!/<w:jc\b[^>]*\bw:val="center"/.test(formula) ||
			left.includes('<m:oMath') ||
			right.includes('<m:oMath')
		) {
			return false;
		}
		const number = extractWordText(right).trim();
		if (
			number !== '' &&
			!/^\((?:[A-ZА-ЯЁ]\.)?\d+(?:\.\d+)*\)[,;.]?$/u.test(number)
		) {
			return false;
		}
	}
	// Word may omit explicit no-border properties when saving the wrapper.
	for (const borders of tableXml.matchAll(
		/<w:(?:tblBorders|tcBorders)\b[^>]*>([\s\S]*?)<\/w:(?:tblBorders|tcBorders)>/g,
	)) {
		for (const border of borders[1].matchAll(/<w:\w+\b[^>]*>/g)) {
			if (!/\bw:val="(?:none|nil)"/.test(border[0])) return false;
		}
	}
	return true;
}
