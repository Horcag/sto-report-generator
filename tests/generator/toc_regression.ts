import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { Document, Packer, TableOfContents } from 'docx';

import { buildReport } from '@/app/builder';
import { ReportTableOfContents } from '@/features/markdown-parser/lib/parser/handlers/report-table-of-contents';
import { getStoStyles, STO_STYLE_PRESET_NAMES } from '@/shared/config';
import { readDocxEntry } from '@/shared/lib/docx';

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

function paragraphContaining(
	xml: string,
	text: string,
	styleId?: string,
): string | undefined {
	return xml
		.match(/<w:p\b[\s\S]*?<\/w:p>/g)
		?.find(
			paragraphXml =>
				paragraphXml.includes(`>${text}<`) &&
				(!styleId ||
					paragraphXml.includes(`<w:pStyle w:val="${styleId}"`)),
		);
}

async function main(): Promise<void> {
	console.log('Running TOC Regression Test...\n');
	for (const preset of STO_STYLE_PRESET_NAMES) {
		const styles = getStoStyles(preset).paragraphStyles ?? [];
		for (let level = 1; level <= 4; level++) {
			const builtin = styles.filter(
				style => style.name === `toc ${level}`,
			);
			assert.equal(
				builtin.length,
				1,
				`${preset} has one built-in TOC style per level`,
			);
			if (preset === 'samara-template-2022') {
				assert.equal(builtin[0].id, `WordTOC${level}`);
				assert.equal(builtin[0].basedOn, `TOC${level}`);
				assert.equal(builtin[0].paragraph?.spacing?.before, 0);
				assert.equal(builtin[0].paragraph?.spacing?.after, 0);
				assert.equal(
					styles.find(style => style.id === `TOC${level}`)?.name,
					`+Оглавление ${level}`,
				);
			} else {
				assert.equal(builtin[0].id, `TOC${level}`);
			}
		}
	}
	const options = {
		hyperlink: true,
		headingStyleRange: '1-4',
		cachedEntries: [
			{ title: 'First entry', level: 1, page: 2, href: 'entry1' },
			{ title: 'Second entry', level: 2, page: 3, href: 'entry2' },
		],
	};
	const tocDocuments = await Promise.all(
		[
			new TableOfContents('', options),
			new ReportTableOfContents(options),
		].map(async toc =>
			new AdmZip(
				await Packer.toBuffer(
					new Document({ sections: [{ children: [toc] }] }),
				),
			).readAsText('word/document.xml'),
		),
	);
	const gallery =
		'<w:docPartObj><w:docPartGallery w:val="Table of Contents"/><w:docPartUnique/></w:docPartObj>';
	assert.ok(tocDocuments[1].includes(gallery));
	assert.equal(
		tocDocuments[1].replace(`<w:sdtPr>${gallery}</w:sdtPr>`, '<w:sdtPr/>'),
		tocDocuments[0],
		'gallery metadata preserves all field boundaries, instructions and cached content',
	);
	fs.rmSync(tempRoot, { recursive: true, force: true });
	fs.mkdirSync(tempRoot, { recursive: true });
	fs.writeFileSync(tempMd, testMarkdown, 'utf-8');

	await buildReport(tempMd, tempDocx);
	const currentXml = readDocxEntry(tempDocx, 'word/document.xml');
	const stylesXml = readDocxEntry(tempDocx, 'word/styles.xml');
	for (let level = 1; level <= 4; level++) {
		const builtinStyle = new RegExp(
			`<w:style\\b(?=[^>]*w:styleId="WordTOC${level}")[\\s\\S]*?<\\/w:style>`,
		).exec(stylesXml)?.[0];
		assert.ok(builtinStyle);
		assert.ok(builtinStyle.includes(`<w:name w:val="toc ${level}"`));
		assert.ok(builtinStyle.includes(`<w:basedOn w:val="TOC${level}"`));
		assert.match(
			builtinStyle,
			/<w:spacing\b(?=[^>]*w:before="0")(?=[^>]*w:after="0")/,
		);
	}
	const errors: string[] = [];

	const abstractBlock = paragraphContaining(currentXml, 'Реферат');
	assert.ok(abstractBlock?.includes('w:val="StructuralHeadingNoTOC"'));
	if (abstractBlock?.includes('w:val="StructuralHeading"')) {
		errors.push(
			'РЕФЕРАТ is using StructuralHeading and will incorrectly appear in TOC.',
		);
	}

	const tocHeadingBlock = paragraphContaining(currentXml, 'Содержание');
	assert.ok(tocHeadingBlock?.includes('w:val="TOCHeading"'));
	const tocHeadingStyle =
		/<w:style\b(?=[^>]*w:styleId="TOCHeading")[\s\S]*?<\/w:style>/.exec(
			stylesXml,
		)?.[0];
	assert.ok(tocHeadingStyle);
	assert.ok(
		tocHeadingStyle?.includes('<w:basedOn w:val="StructuralHeadingNoTOC"'),
	);
	assert.doesNotMatch(tocHeadingStyle, /<w:outlineLvl\b/);
	const tocInstruction = currentXml.match(
		/<w:instrText[^>]*>TOC [\s\S]*?<\/w:instrText>/,
	)?.[0];
	assert.ok(tocInstruction);
	assert.doesNotMatch(tocInstruction, /TOCHeading|StructuralHeadingNoTOC/);
	if (tocHeadingBlock?.includes('w:val="StructuralHeading"')) {
		errors.push(
			'СОДЕРЖАНИЕ is using StructuralHeading and will incorrectly appear in TOC.',
		);
	}

	// Cached TOC entries repeat heading text before the numbered body paragraph.
	const numberedHeadingBlock = paragraphContaining(
		currentXml,
		'Глава 1',
		'StoHeading1',
	);
	const headingStyle =
		/<w:style\b(?=[^>]*w:styleId="StoHeading1")[\s\S]*?<\/w:style>/.exec(
			stylesXml,
		)?.[0];
	if (
		!numberedHeadingBlock?.includes('<w:pStyle w:val="StoHeading1"') ||
		!headingStyle?.includes('<w:numPr>')
	) {
		errors.push('Markdown heading is missing style-linked Word numbering.');
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
