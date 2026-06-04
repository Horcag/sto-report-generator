import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { parseMarkdownToDocx } from '@/features/markdown-parser';

const tempRoot = path.join(process.cwd(), '.agent-work', 'parser-tests');

async function expectRejects(
	markdown: string,
	expectedMessage: RegExp,
): Promise<void> {
	await assert.rejects(
		() => parseMarkdownToDocx(markdown, {}, { sourceDir: tempRoot }),
		expectedMessage,
	);
}

async function main(): Promise<void> {
	fs.rmSync(tempRoot, { recursive: true, force: true });
	fs.mkdirSync(tempRoot, { recursive: true });

	await parseMarkdownToDocx(
		String.raw`\begin{sto_list}
- корректный пункт
\end{sto_list}
`,
		{},
		{ sourceDir: tempRoot },
	);

	await expectRejects(
		String.raw`\begin{itemize}
- bad
\end{itemize}
`,
		/Unsupported STO environment/,
	);

	await expectRejects(
		String.raw`\begin{sto_list}
- bad
\end{sto_enum}
`,
		/Unsupported STO environment block/,
	);

	await expectRejects(
		String.raw`\begin{sto_list}
- bad
`,
		/Unclosed STO environment/,
	);

	const bibPath = path.join(tempRoot, 'references.bib');
	fs.writeFileSync(bibPath, '', 'utf8');
	await assert.rejects(
		() =>
			parseMarkdownToDocx(
				String.raw`Текст с отсутствующим источником [@missing].

\begin{sto_bibliography}
\end{sto_bibliography}
`,
				{ bibliography: bibPath },
				{ sourceDir: tempRoot },
			),
		/Citation source not found/,
	);

	console.log('Parser tests passed.');
}

main().catch(error => {
	console.error(error instanceof Error ? error.message : error);
	process.exit(1);
});
