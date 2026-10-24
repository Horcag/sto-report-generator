import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Document, Packer } from 'docx';
import { JSDOM } from 'jsdom';

import { parseMarkdownToDocx } from '@/features/markdown-parser';
import { STO_NUMBERING, STO_STYLES } from '@/shared/config';
import { readDocxEntry } from '@/shared/lib/docx';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

async function run(): Promise<void> {
	const temporary = fs.mkdtempSync(
		path.join(os.tmpdir(), 'sto-table-headers-'),
	);
	let cases = 0;
	try {
		for (const separator of [
			'| --- | --- | --- |',
			'| :--- | :---: | ---: |',
			'| ---: | :--- | :---: |',
			'| :---: | ---: | :--- |',
		]) {
			const children = await parseMarkdownToDocx(
				`Таблица 1 – Сравнение\n\n| Модель | Значение<br>метрики | Год |\n${separator}\n| GRU | 0,123 | 2025 |`,
				{},
				{ sourceDir: temporary },
			);
			const document = new Document({
				styles: STO_STYLES,
				numbering: STO_NUMBERING,
				sections: [{ children }],
			});
			const output = path.join(temporary, 'table.docx');
			fs.writeFileSync(output, await Packer.toBuffer(document));
			const dom = new JSDOM(readDocxEntry(output, 'word/document.xml'), {
				contentType: 'text/xml',
			});
			try {
				const table = dom.window.document.getElementsByTagNameNS(
					W,
					'tbl',
				)[0];
				const rows = [...table.getElementsByTagNameNS(W, 'tr')];
				assert.equal(rows.length, 2);
				const alignments = rows.map(row =>
					[...row.getElementsByTagNameNS(W, 'jc')].map(element =>
						element.getAttributeNS(W, 'val'),
					),
				);
				assert.deepEqual(
					alignments[0],
					['center', 'center', 'center'],
					`All headers must be centered independently of ${separator}`,
				);
				const expectedDataAlignments = separator
					.split('|')
					.slice(1, -1)
					.map(cell => {
						const marker = cell.trim();
						return marker.endsWith(':')
							? marker.startsWith(':')
								? 'center'
								: 'right'
							: 'left';
					});
				assert.deepEqual(alignments[1], expectedDataAlignments);
				assert.equal(
					rows[0].getElementsByTagNameNS(W, 'tblHeader').length,
					1,
				);
				assert.equal(
					rows[1].getElementsByTagNameNS(W, 'tblHeader').length,
					0,
				);
				assert.equal(rows[0].getElementsByTagNameNS(W, 'br').length, 1);
				assert.equal(
					table.getElementsByTagNameNS(W, 'cantSplit').length,
					2,
				);
				assert.equal(table.getElementsByTagNameNS(W, 'b').length, 0);
				cases++;
			} finally {
				dom.window.close();
			}
		}
	} finally {
		fs.rmSync(temporary, { recursive: true, force: true });
	}
	console.log(
		`Table header generation: ${cases} alignment matrices passed (header, data, repeat, breaks, row splitting).`,
	);
}

run().catch(error => {
	console.error(error);
	process.exitCode = 1;
});
