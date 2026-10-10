import fs from 'node:fs';
import path from 'node:path';

import { buildReport } from '@/app/builder';

async function main(): Promise<void> {
	const destination = process.argv[2];
	if (!destination)
		throw new Error('Usage: build_referat_table_fixture <output_dir>');
	const root = path.resolve(destination);
	const source = path.join(root, 'source');
	fs.mkdirSync(source, { recursive: true });
	fs.copyFileSync(
		'example/00_metadata.md',
		path.join(source, '00_metadata.md'),
	);
	fs.writeFileSync(
		path.join(source, '01_referat.md'),
		'\\sto_structural_heading{РЕФЕРАТ}\n\nДокумент содержит {{PAGES}} {{PAGES_WORD}} и {{TABLES}}.\n',
	);
	const rows = Array.from(
		{ length: 64 },
		(_, i) => `| ${i + 1} | Sample item ${i + 1} | ${i * 2} |`,
	);
	fs.writeFileSync(
		path.join(source, '02_table.md'),
		[
			'\\sto_structural_heading{ВВЕДЕНИЕ}',
			'',
			'Данные представлены в таблице (@tbl:long).',
			'',
			'Таблица 1 – Проверка продолжений (@tbl:long)',
			'',
			'| Number | Description | Value |',
			'| --- | --- | --- |',
			...rows,
			'',
		].join('\n'),
	);
	await buildReport(source, path.join(root, 'raw.docx'));
	console.log(
		'Native referat fixture built: 64 table rows and managed page placeholders.',
	);
}

main().catch(error => {
	console.error(error);
	process.exitCode = 1;
});
