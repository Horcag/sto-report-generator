import fs from 'node:fs';
import path from 'node:path';

import { STRICT_STO_PART } from '../strict-sto';
import { inspectStrictStoXml } from './validation';

export function strictStoChecks(unpackedDir: string) {
	const parts = new Map<string, string>();
	for (const name of fs.readdirSync(path.join(unpackedDir, 'word'))) {
		const part = `word/${name}`;
		if (STRICT_STO_PART.test(part)) {
			parts.set(
				part,
				fs.readFileSync(path.join(unpackedDir, part), 'utf8'),
			);
		}
	}
	const inspected = inspectStrictStoXml(parts);
	return [
		[
			'Strict STO Text Bold',
			inspected.bold,
			'Text, including headings, must not use bold.',
		],
		[
			'Strict STO Text Font',
			inspected.font,
			'Text must use Times New Roman. Mathematical notation is preserved.',
		],
		[
			'Strict STO Text Size',
			inspected.size,
			'Text size must be between 12 and 14 pt.',
		],
		[
			'Strict STO Text Color',
			inspected.color,
			'Text must be black, without theme color overrides.',
		],
		[
			'Strict STO Paragraph Spacing',
			inspected.spacing,
			'Text must use 1.5 line spacing; table captions and mathematical layout have separate rules.',
		],
		[
			'Strict STO Numbering Font',
			inspected.numberingFont,
			'Numbering must use Times New Roman, 12–14 pt, without bold.',
		],
	].map(([check, passed, error]) => ({
		check: check as string,
		passed: passed as boolean,
		...(passed ? {} : { error: error as string }),
	}));
}
