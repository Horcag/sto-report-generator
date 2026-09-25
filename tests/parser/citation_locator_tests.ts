import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Document, Packer } from 'docx';

import { parseMarkdownToDocx } from '@/features/markdown-parser';
import { STO_NUMBERING, STO_STYLES } from '@/shared/config';
import { readDocxEntry } from '@/shared/lib/docx-archive';

export async function runCitationLocatorTests(
	bibPath: string,
	tempRoot: string,
): Promise<void> {
	const children = await parseMarkdownToDocx(
		String.raw`Фрагмент [@second, с. 12–14], затем источник [@first] и повтор [@second, с. 18].

\begin{sto_bibliography}
\end{sto_bibliography}`,
		{ bibliography: bibPath },
		{ sourceDir: tempRoot },
	);
	const serialized = JSON.stringify(children);
	assert.match(
		serialized,
		/Фрагмент \[1, с\. 12–14\], затем источник \[2\] и повтор \[1, с\. 18\]/,
	);
	assert.equal((serialized.match(/Второй источник/g) ?? []).length, 1);

	const document = new Document({
		styles: STO_STYLES,
		numbering: STO_NUMBERING,
		sections: [{ children }],
	});
	const outputPath = path.join(tempRoot, 'located-bibliography.docx');
	fs.writeFileSync(outputPath, await Packer.toBuffer(document));
	const xml = readDocxEntry(outputPath, 'word/document.xml');
	const text = [...xml.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)]
		.map(match => match[1])
		.join('');
	assert.match(
		text,
		/Фрагмент \[1, с\. 12–14\], затем источник \[2\] и повтор \[1, с\. 18\]/,
	);

	await assert.rejects(
		() =>
			parseMarkdownToDocx(
				'Пустая отсылка [@].',
				{},
				{ sourceDir: tempRoot },
			),
		/Invalid citation \[@\]: expected a BibTeX key/,
	);
}
