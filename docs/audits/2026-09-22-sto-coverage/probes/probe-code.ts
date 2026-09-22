import fs from 'node:fs';
import path from 'node:path';
import { Document, Packer } from 'docx';

import { parseMarkdownToDocx } from '../../../../src/features/markdown-parser';
import { STO_NUMBERING, STO_STYLES } from '../../../../src/shared/config';
import { readDocxEntry } from '../../../../src/shared/lib/docx-archive';

async function main() {
	const root = path.resolve('.agent-work/published-sto-audit');
	fs.mkdirSync(root, { recursive: true });
	const input =
		'const escaped = "&amp;";\nconst url = "https://example.org";\n    return escaped;';
	const children = await parseMarkdownToDocx(
		'```js\n' + input + '\n```',
		{},
		{ sourceDir: process.cwd() },
	);
	const doc = new Document({
		styles: STO_STYLES,
		numbering: STO_NUMBERING,
		sections: [{ children }],
	});
	const output = path.join(root, 'code-probe.docx');
	fs.writeFileSync(output, await Packer.toBuffer(doc));
	const xml = readDocxEntry(output, 'word/document.xml');
	const text = [...xml.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)]
		.map(match =>
			match[1]
				.replaceAll('&lt;', '<')
				.replaceAll('&gt;', '>')
				.replaceAll('&quot;', '"')
				.replaceAll('&apos;', "'")
				.replaceAll('&amp;', '&'),
		)
		.join('\n');
	const result = {
		input,
		outputText: text,
		codeTextPreserved: input === text,
		hasInsertedZeroWidthSpace: text.includes('\u200b'),
	};
	fs.writeFileSync(
		path.join(root, 'code-probe.json'),
		JSON.stringify(result, null, 2),
	);
	console.log(JSON.stringify(result, null, 2));
}

main().catch(error => {
	console.error(error);
	process.exitCode = 1;
});
