import * as fs from 'fs';
import * as path from 'path';

import { Document, Packer, Footer, Paragraph, AlignmentType, TextRun, PageNumber } from 'docx';

import { createTitlePage } from '@/widgets/title-page';
import {
	parseFrontmatter,
	parseMarkdownToDocx,
} from '@/features/markdown-parser';
import { MARGINS, STO_NUMBERING, STO_STYLES } from '@/shared/config';

export async function buildReport(
	inputPath: string,
	outputPath: string,
): Promise<void> {
	if (!fs.existsSync(inputPath)) {
		throw new Error(`Path not found: ${inputPath}`);
	}

	let finalContent = '';
	let finalMetadata: any = null;

	const stats = fs.statSync(inputPath);

	if (stats.isDirectory()) {
		// Modular assembly: sort all .md files and merge
		const files = fs
			.readdirSync(inputPath)
			.filter((f) => f.endsWith('.md'))
			.sort();

		for (const file of files) {
			const filePath = path.join(inputPath, file);
			const fileContent = fs.readFileSync(filePath, 'utf8');
			const { metadata, content } = parseFrontmatter(fileContent);

			// Take metadata from the first file that has it
			if (!finalMetadata && Object.keys(metadata).length > 0) {
				finalMetadata = metadata;
			}

			if (content) {
				finalContent += content + '\n\n';
			}
		}
	} else {
		// Single file mode
		const fileContent = fs.readFileSync(inputPath, 'utf8');
		const { metadata, content } = parseFrontmatter(fileContent);
		finalMetadata = metadata;
		finalContent = content;
	}

	if (!finalMetadata) {
		throw new Error('No metadata (frontmatter) found in input.');
	}

	const titlePage = createTitlePage(finalMetadata);
	const documentBody = await parseMarkdownToDocx(finalContent);

	const doc = new Document({
		styles: STO_STYLES,
		numbering: STO_NUMBERING,
		sections: [
			{
				properties: {
					page: {
						margin: MARGINS,
						pageNumbers: {
							start: 1,
						}
					},
					titlePage: true,
				},
				footers: {
					default: new Footer({
						children: [
							new Paragraph({
								alignment: AlignmentType.CENTER,
								children: [
									new TextRun({
										children: [PageNumber.CURRENT],
									}),
								],
							}),
						],
					}),
					first: new Footer({
						children: [new Paragraph("")]
					}),
				},
				children: [...titlePage, ...documentBody],
			},
		],
	});

	const buffer = await Packer.toBuffer(doc);
	fs.writeFileSync(outputPath, buffer);
	console.log(`Report successfully generated at ${outputPath}`);
}
