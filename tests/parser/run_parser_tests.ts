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
	fs.writeFileSync(
		bibPath,
		`@book{used,
  author={Иванов, И. И.},
  title={Использованный источник},
  publisher={Самара},
  year={2020}
}
@book{unused,
  author={Петров, П. П.},
  title={Неиспользованный источник},
  publisher={Самара},
  year={2021}
}`,
		'utf8',
	);
	const bibliographyElements = await parseMarkdownToDocx(
		String.raw`Текст с использованным источником [@used].

\begin{sto_bibliography}
\end{sto_bibliography}
`,
		{ bibliography: bibPath },
		{ sourceDir: tempRoot },
	);
	const bibliographyJson = JSON.stringify(bibliographyElements);
	assert.match(bibliographyJson, /Использованный источник/);
	assert.doesNotMatch(bibliographyJson, /Неиспользованный источник/);

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
