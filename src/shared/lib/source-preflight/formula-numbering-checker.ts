/** Conservative editorial check; explicit systems and simple numeric bindings need no warning. */
export function hasNumberedDefinitionGroup(formula: string): boolean {
	if (!/\(@eq:[a-zA-Z0-9_-]+\)\s*$/.test(formula)) return false;
	if (/\\begin\s*\{/.test(formula)) return false;

	const expression = formula.replace(/\s*\(@eq:[a-zA-Z0-9_-]+\)\s*$/, '');
	const segments: Array<{ text: string; equals: number }> = [];
	const stack: string[] = [];
	let start = 0;
	let equals = -1;
	for (let index = 0; index < expression.length; index++) {
		const char = expression[index];
		if (char === '\\') {
			const command = /^\\(?:[A-Za-z]+|.)/.exec(expression.slice(index));
			if (command?.[0] === '\\{') stack.push('{');
			if (command?.[0] === '\\}' && stack.pop() !== '{') return false;
			if (command) index += command[0].length - 1;
			continue;
		}
		if ('({['.includes(char)) stack.push(char);
		else if (')}]'.includes(char)) {
			if (stack.pop() !== { ')': '(', '}': '{', ']': '[' }[char])
				return false;
		}
		if (stack.length) continue;
		if (char === '=' && equals < 0) equals = index - start;
		if (
			(char === ',' || char === ';') &&
			!(
				char === ',' &&
				/\d/.test(expression[index - 1] ?? '') &&
				/\d/.test(expression[index + 1] ?? '')
			)
		) {
			segments.push({ text: expression.slice(start, index), equals });
			start = index + 1;
			equals = -1;
		}
	}
	if (stack.length) return false;
	segments.push({ text: expression.slice(start), equals });
	return (
		segments.filter(segment => {
			if (segment.equals < 0) return false;
			const clean = (value: string) =>
				value.replace(/\\(?:q?quad|[,;!: ])|\\\\|&/g, '').trim();
			const left = clean(segment.text.slice(0, segment.equals));
			const right = clean(segment.text.slice(segment.equals + 1));
			return (
				left.length > 0 &&
				right.length > 0 &&
				!/^[+-]?\d+(?:[,.]\d+)?\.?$/.test(right.replace(/[{}]/g, ''))
			);
		}).length > 1
	);
}
