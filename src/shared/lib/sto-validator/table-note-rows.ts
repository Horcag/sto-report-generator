/** Recognize explicit single notes and plural labels followed by numbered note text.
 * A bare glossary/data value "Примечание" or "Примечания" is not enough.
 */
export function inspectTableNoteRows(rows: string[]): {
	noteRows: number[];
	invalidForms: number[];
	beforeData: number[];
} {
	const noteRows: number[] = [];
	const invalidForms: number[] = [];
	const beforeData: number[] = [];
	let noteStart: number | undefined;
	const singularRows: number[] = [];
	let pluralFound = false;
	for (let index = 0; index < rows.length; index++) {
		const text = rows[index];
		if (/^Примечание\s+[–—-]\s+\S/u.test(text)) {
			singularRows.push(index);
			noteRows.push(index);
			noteStart ??= index;
			if (!/^Примечание\s+–\s+\S/u.test(text)) invalidForms.push(index);
		} else if (
			/^Примечания\s*:?$/u.test(text) &&
			/^\d+\.?\s+\S/u.test(rows[index + 1] ?? '')
		) {
			pluralFound = true;
			const start = index;
			noteStart ??= start;
			noteRows.push(start);
			let expected = 1;
			let match: RegExpExecArray | null;
			while (
				index + 1 < rows.length &&
				(match = /^(\d+)(\.)?\s+\S/u.exec(rows[index + 1]))
			) {
				index++;
				noteRows.push(index);
				if (Number(match[1]) !== expected || match[2])
					invalidForms.push(index);
				expected++;
			}
			if (expected < 3) invalidForms.push(start);
		} else if (noteStart !== undefined && text) {
			beforeData.push(noteStart);
			noteStart = undefined;
		}
	}
	if (singularRows.length > 1 || (singularRows.length && pluralFound)) {
		for (const index of singularRows)
			if (!invalidForms.includes(index)) invalidForms.push(index);
	}
	return { noteRows, invalidForms, beforeData };
}
