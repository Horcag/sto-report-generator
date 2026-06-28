import fs from 'node:fs';
import path from 'node:path';

import { buildReport } from '@/app/builder';
import { readDocxEntry } from '@/shared/lib/docx-archive';

const tempRoot = path.join(process.cwd(), '.agent-work', 'toc-test');
const tempMd = path.join(tempRoot, 'toc_test.md');
const tempDocx = path.join(tempRoot, 'toc_test.docx');

const testMarkdown = String.raw`---
title: Тест ТОС
---

\sto_structural_heading{РЕФЕРАТ}

\sto_structural_heading{СОДЕРЖАНИЕ}

\sto_structural_heading{ВВЕДЕНИЕ}

# Глава 1

\sto_structural_heading{ЗАКЛЮЧЕНИЕ}

\sto_structural_heading{СПИСОК ИСПОЛЬЗОВАННЫХ ИСТОЧНИКОВ}
`;

function paragraphContaining(xml: string, text: string): string | undefined {
	return xml
		.match(/<w:p\b[\s\S]*?<\/w:p>/g)
		?.find(paragraphXml => paragraphXml.includes(`>${text}<`));
}

async function main(): Promise<void> {
	console.log('Running TOC Regression Test...\n');
	fs.rmSync(tempRoot, { recursive: true, force: true });
	fs.mkdirSync(tempRoot, { recursive: true });
	fs.writeFileSync(tempMd, testMarkdown, 'utf-8');

	await buildReport(tempMd, tempDocx);
	const currentXml = readDocxEntry(tempDocx, 'word/document.xml');
	const errors: string[] = [];

	const abstractBlock = paragraphContaining(currentXml, 'РЕФЕРАТ');
	if (abstractBlock?.includes('w:val="StructuralHeading"')) {
		errors.push(
			'РЕФЕРАТ is using StructuralHeading and will incorrectly appear in TOC.',
		);
	}

	const tocHeadingBlock = paragraphContaining(currentXml, 'СОДЕРЖАНИЕ');
	if (tocHeadingBlock?.includes('w:val="StructuralHeading"')) {
		errors.push(
			'СОДЕРЖАНИЕ is using StructuralHeading and will incorrectly appear in TOC.',
		);
	}

	const numberedHeadingBlock = paragraphContaining(currentXml, 'Глава 1');
	if (!numberedHeadingBlock?.includes('<w:numPr>')) {
		errors.push('Markdown heading is missing Word numbering.');
	}

	for (const heading of [
		'ВВЕДЕНИЕ',
		'ЗАКЛЮЧЕНИЕ',
		'СПИСОК ИСПОЛЬЗОВАННЫХ ИСТОЧНИКОВ',
	]) {
		if (currentXml.includes(`>${heading}<`)) {
			errors.push(
				`Heading "${heading}" found in ALL CAPS in XML; StructuralHeading style should handle visual caps.`,
			);
		}
	}

	fs.rmSync(tempRoot, { recursive: true, force: true });
	if (errors.length > 0) {
		console.error('\nTOC Regression Test failed:');
		for (const error of errors) {
			console.error(`  - ${error}`);
		}
		process.exit(1);
	}

	console.log('TOC regression test passed.');
}

main().catch(error => {
	console.error(error instanceof Error ? error.message : error);
	process.exit(1);
});
