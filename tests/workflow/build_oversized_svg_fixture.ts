import fs from 'node:fs';
import path from 'node:path';

import { buildReport } from '@/app/builder';

import { png } from '../figures/planning_fixtures';

async function main(): Promise<void> {
	const destination = process.argv[2];
	if (!destination)
		throw new Error('Usage: build_oversized_svg_fixture <output_dir>');
	const root = path.resolve(destination);
	const source = path.join(root, 'source');
	fs.mkdirSync(source, { recursive: true });
	fs.copyFileSync(
		'example/00_metadata.md',
		path.join(source, '00_metadata.md'),
	);
	fs.writeFileSync(
		path.join(source, '01_referat.md'),
		'\\sto_structural_heading{РЕФЕРАТ}\n\nДокумент содержит {{PAGES}} {{PAGES_WORD}}.\n',
	);
	fs.writeFileSync(
		path.join(source, '02_image.md'),
		'![Vector](scheme.svg)\n\nРисунок 1 – Vector (@fig:large)\n',
	);
	fs.writeFileSync(
		path.join(source, 'scheme.svg'),
		'<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="600" viewBox="0 0 1200 600"><rect width="1200" height="600" fill="black"/></svg>',
	);
	fs.writeFileSync(path.join(source, 'scheme.png'), png(4000, 2000));
	fs.writeFileSync(
		path.join(source, 'figures.json'),
		JSON.stringify({ defaults: {}, figures: { large: { widthMm: 140 } } }),
	);
	await buildReport(source, path.join(root, 'raw.docx'));
	console.log(
		'Native rejection fixture built: unchanged SVG with oversized 4000x2000 PNG fallback.',
	);
}

main().catch(error => {
	console.error(error);
	process.exitCode = 1;
});
