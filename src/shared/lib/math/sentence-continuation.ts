/** The first rendered character must be lowercase prose; math is a boundary. */
export function startsWithLowercaseSentence(text: string): boolean {
	return /^[а-яёa-z]/u.test(text.trimStart());
}
