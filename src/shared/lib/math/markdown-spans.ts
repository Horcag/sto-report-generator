/** Mask complete math/code spans and Markdown escapes without changing source offsets. */
export function maskMarkdownMathAndCode(source: string): string {
	const spans =
		/(`+)[\s\S]*?\1(?!`)|(~{3,})[\s\S]*?\2(?!~)|\$\$(?:\\[\s\S]|(?!\$\$)[\s\S])+?\$\$|\$(?:\\[\s\S]|[^$])+\$|\\[\\$`~]/g;
	return source.replace(spans, span => span.replace(/[^\r\n]/g, ' '));
}
