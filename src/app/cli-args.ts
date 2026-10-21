export interface ParsedArgs {
	positionals: string[];
	options: Map<string, string | boolean>;
}

export function parseArgs(args: string[]): ParsedArgs {
	const positionals: string[] = [];
	const options = new Map<string, string | boolean>();

	for (let index = 0; index < args.length; index++) {
		const arg = args[index];
		if (!arg.startsWith('--')) {
			positionals.push(arg);
			continue;
		}

		const [rawName, inlineValue] = arg.slice(2).split('=', 2);
		if (inlineValue !== undefined) {
			options.set(rawName, inlineValue);
			continue;
		}

		const next = args[index + 1];
		if (next && !next.startsWith('--')) {
			options.set(rawName, next);
			index++;
		} else {
			options.set(rawName, true);
		}
	}

	return { positionals, options };
}

export function optionString(
	args: ParsedArgs,
	name: string,
): string | undefined {
	const value = args.options.get(name);
	return typeof value === 'string' ? value : undefined;
}

export function optionBoolean(
	args: ParsedArgs,
	name: string,
): boolean | undefined {
	if (!args.options.has(name)) {
		return undefined;
	}
	return args.options.get(name) !== false;
}

export function optionNumber(
	args: ParsedArgs,
	name: string,
): number | undefined {
	const value = optionString(args, name);
	if (value === undefined) {
		return undefined;
	}
	const numberValue = Number(value);
	if (!Number.isFinite(numberValue)) {
		throw new Error(`--${name} must be a number.`);
	}
	return numberValue;
}
