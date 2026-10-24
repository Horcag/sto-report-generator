function withoutComments(source: string): string {
	let result = '';
	for (let index = 0; index < source.length; index++) {
		if (source[index] === '\\' && index + 1 < source.length) {
			result += source.slice(index, index + 2);
			index++;
		} else if (source[index] === '%') {
			while (index < source.length && source[index] !== '\n') index++;
			if (index < source.length) result += '\n';
		} else result += source[index];
	}
	return result;
}

function isSingleEnvironment(formula: string, end: number): boolean {
	const stack: string[] = [];
	for (const token of formula.matchAll(/\\(begin|end)\{([A-Za-z*]+)\}/gu)) {
		if (token[1] === 'begin') stack.push(token[2]);
		else if (stack.pop() !== token[2]) return false;
		if (!stack.length) return token.index + token[0].length === end;
	}
	return false;
}

/** Split explicit display continuations, leaving matrix/cases rows intact. */
export function splitDisplayMathLines(source: string): string[] {
	let formula = withoutComments(source).trim();
	const candidate =
		/^\\begin\{(aligned|gathered)\}([\s\S]*)\\end\{\1\}([,;.]?)$/u.exec(
			formula,
		);
	const outer =
		candidate &&
		isSingleEnvironment(formula, formula.length - candidate[3].length)
			? candidate
			: null;
	if (outer) formula = outer[2] + outer[3];
	if (outer && /^\s*\[/u.test(formula))
		throw new Error('Display alignment options are not supported.');
	const lines: string[] = [];
	let line = '';
	let braces = 0;
	let environments = 0;
	for (let index = 0; index < formula.length; index++) {
		const rest = formula.slice(index);
		const environment = /^\\(begin|end)\{[A-Za-z*]+\}/u.exec(rest);
		if (environment) {
			environments += environment[1] === 'begin' ? 1 : -1;
			line += environment[0];
			index += environment[0].length - 1;
			continue;
		}
		if (rest.startsWith('\\\\') && braces === 0 && environments === 0) {
			if (rest[2] === '*')
				throw new Error(
					'Display nonbreaking row modifiers are not supported.',
				);
			if (/^\s*\[/u.test(rest.slice(2)))
				throw new Error(
					'Display line spacing options are not supported.',
				);
			lines.push(line.trim());
			line = '';
			index++;
			continue;
		}
		if (
			formula[index] === '\\' &&
			/[{}&]/u.test(formula[index + 1] ?? '')
		) {
			line += formula.slice(index, index + 2);
			index++;
			continue;
		}
		if (formula[index] === '{') braces++;
		if (formula[index] === '}') braces--;
		if (
			outer &&
			formula[index] === '&' &&
			braces === 0 &&
			environments === 0
		)
			continue;
		line += formula[index];
	}
	lines.push(line.trim());
	if (lines.some(value => !value))
		throw new Error('Display formula contains an empty continuation line.');
	return lines;
}
