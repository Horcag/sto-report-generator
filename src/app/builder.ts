import * as fs from 'fs';
import * as path from 'path';

import {
	AlignmentType,
	Document,
	Footer,
	Packer,
	PageNumber,
	Paragraph,
	TextRun,
} from 'docx';

import { createTitlePage } from '@/widgets/title-page';
import {
	parseFrontmatter,
	parseMarkdownToDocx,
} from '@/features/markdown-parser';
import { ReportMetadata } from '@/entities/report';
import { MARGINS, STO_NUMBERING, STO_STYLES } from '@/shared/config';

/**
 * Builds the final STO-compliant report from markdown files.
 * @param inputPath Path to a markdown file or directory containing markdown files.
 * @param outputPath Path where the generated .docx file will be saved.
 */
export async function buildReport(
	inputPath: string,
	outputPath: string,
): Promise<void> {
	if (!fs.existsSync(inputPath)) {
		throw new Error(`Path not found: ${inputPath}`);
	}

	let finalContent = '';
	let finalMetadata: Record<string, unknown> | null = null;

	const stats = fs.statSync(inputPath);

	if (stats.isDirectory()) {
		// Modular assembly: sort all .md files and merge
		const files = fs
			.readdirSync(inputPath)
			.filter(f => f.endsWith('.md'))
			.sort();

		for (const file of files) {
			const filePath = path.join(inputPath, file);
			const fileContent = fs.readFileSync(filePath, 'utf8');
			const { metadata, content } = parseFrontmatter(fileContent);

			// Take metadata from the first file that has it
			if (
				!finalMetadata &&
				metadata &&
				Object.keys(metadata).length > 0
			) {
				finalMetadata = metadata as Record<string, unknown>;
			}

			if (content) {
				finalContent += content + '\n\n';
			}
		}
	} else {
		// Single file mode
		const fileContent = fs.readFileSync(inputPath, 'utf8');
		const { metadata, content } = parseFrontmatter(fileContent);
		finalMetadata = metadata as Record<string, unknown>;
		finalContent = content;
	}

	if (!finalMetadata) {
		throw new Error(
			'No metadata (frontmatter) found in input. Please ensure at least one markdown file contains a YAML block.',
		);
	}

	const titlePage = createTitlePage(
		finalMetadata as unknown as ReportMetadata,
	);
	const documentBody = await parseMarkdownToDocx(finalContent, finalMetadata);

	const doc = new Document({
		styles: STO_STYLES,
		numbering: STO_NUMBERING,
		features: {
			updateFields: true,
		},
		sections: [
			{
				properties: {
					page: {
						margin: MARGINS,
						pageNumbers: {
							start: 1,
						},
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
						children: [new Paragraph('')],
					}),
				},
				children: [...titlePage, ...documentBody],
			},
		],
	});

	// Ensure output directory exists
	const outputDir = path.dirname(outputPath);
	if (!fs.existsSync(outputDir)) {
		fs.mkdirSync(outputDir, { recursive: true });
	}

	const buffer = await Packer.toBuffer(doc);
	fs.writeFileSync(outputPath, buffer);
	console.log(`Report successfully generated at ${outputPath}`);
}
