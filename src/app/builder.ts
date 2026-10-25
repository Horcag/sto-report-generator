import * as fs from 'fs';
import * as path from 'path';
import {
	AlignmentType,
	Document,
	Footer,
	ImportedXmlComponent,
	LineRuleType,
	Packer,
	PageNumber,
	Paragraph,
	Table,
	TextRun,
} from 'docx';

import { ReportMetadata } from '@/entities/report';
import {
	parseFrontmatter,
	parseMarkdownToDocx,
} from '@/features/markdown-parser';
import {
	DEFAULT_STO_STYLE_PRESET,
	getStoStyles,
	isStoStylePreset,
	MARGINS,
	STO_NUMBERING,
	StoStylePreset,
} from '@/shared/config';
import {
	applyDataTableSpacing,
	applyFigureDocumentPolicy,
	clearDirtyFieldFlags,
} from '@/shared/lib/docx';
import { FigurePlan } from '@/shared/lib/figures';
import { FormulaConversionError } from '@/shared/lib/math';
import { createTitlePage, createTitlePageFooter } from '@/widgets/title-page';

export interface BuildReportOptions {
	stylePreset?: StoStylePreset;
}

function getMetadataStylePreset(
	metadata: Record<string, unknown>,
): StoStylePreset | undefined {
	if (metadata.stylePreset === undefined) {
		return undefined;
	}
	if (isStoStylePreset(metadata.stylePreset)) {
		return metadata.stylePreset;
	}
	throw new Error(
		`Unsupported stylePreset "${String(metadata.stylePreset)}". Supported presets: samara-template-2022, default.`,
	);
}

/**
 * Builds the final STO-compliant report from markdown files.
 * @param inputPath Path to a markdown file or directory containing markdown files.
 * @param outputPath Path where the generated .docx file will be saved.
 */
export async function buildReport(
	inputPath: string,
	outputPath: string,
	options: BuildReportOptions = {},
): Promise<void> {
	if (!fs.existsSync(inputPath)) {
		throw new Error(`Path not found: ${inputPath}`);
	}

	let finalContent = '';
	let finalMetadata: Record<string, unknown> | null = null;
	const sourceContents: Array<{ file: string; content: string }> = [];

	const stats = fs.statSync(inputPath);
	const sourceDir = stats.isDirectory() ? inputPath : path.dirname(inputPath);

	if (stats.isDirectory()) {
		// Modular assembly: sort all .md files and merge
		const files = fs
			.readdirSync(inputPath)
			.filter(
				file =>
					file.endsWith('.md') && file.toLowerCase() !== 'readme.md',
			)
			.sort((left, right) => left.localeCompare(right));

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
				finalMetadata = metadata as unknown as Record<string, unknown>;
			}

			if (content) {
				sourceContents.push({ file: filePath, content: fileContent });
				finalContent += content + '\n\n';
			}
		}
	} else {
		// Single file mode
		const fileContent = fs.readFileSync(inputPath, 'utf8');
		const { metadata, content } = parseFrontmatter(fileContent);
		finalMetadata = metadata as unknown as Record<string, unknown>;
		finalContent = content;
		sourceContents.push({ file: inputPath, content: fileContent });
	}

	if (!finalMetadata) {
		throw new Error(
			'No metadata (frontmatter) found in input. Please ensure at least one markdown file contains a YAML block.',
		);
	}

	const reportMetadata = finalMetadata as unknown as ReportMetadata;
	const stylePreset =
		options.stylePreset ??
		getMetadataStylePreset(finalMetadata) ??
		DEFAULT_STO_STYLE_PRESET;
	const titlePage = createTitlePage(reportMetadata);
	const figurePlans: FigurePlan[] = [];
	let documentBody: Awaited<ReturnType<typeof parseMarkdownToDocx>>;
	try {
		documentBody = await parseMarkdownToDocx(finalContent, finalMetadata, {
			sourceDir,
			figurePlans,
		});
	} catch (error) {
		if (!(error instanceof FormulaConversionError)) throw error;
		const locations = sourceContents.flatMap(({ file, content }) => {
			const matches: string[] = [];
			let index = content.indexOf(error.latex);
			while (index !== -1) {
				const line = content.slice(0, index).split('\n').length;
				matches.push(`${file}:${line}`);
				index = content.indexOf(
					error.latex,
					index + error.latex.length,
				);
			}
			return matches;
		});
		throw new Error(
			`${error.message}${locations.length > 0 ? ` at ${locations.join(', ')}` : ''}`,
			{ cause: error },
		);
	}

	// Word requires a paragraph after a terminal table. Reserve a minimal one
	// instead of letting it insert a full body line on an otherwise empty page.
	if (documentBody.at(-1) instanceof Table) {
		documentBody.push(
			new Paragraph({
				spacing: {
					before: 0,
					after: 0,
					line: 20,
					lineRule: LineRuleType.EXACT,
				},
				children: [new TextRun({ text: '', size: 2 })],
			}),
		);
	}
	const doc = new Document({
		styles: getStoStyles(stylePreset),
		numbering: STO_NUMBERING,
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
								style:
									stylePreset === 'samara-template-2022'
										? 'a8'
										: 'Normal',
								alignment: AlignmentType.CENTER,
								children: [
									new TextRun({
										style:
											stylePreset ===
											'samara-template-2022'
												? 'aa'
												: undefined,
										children: [PageNumber.CURRENT],
									}),
								],
							}),
						],
					}),
					first: createTitlePageFooter(reportMetadata),
				},
				children: [...titlePage, ...documentBody],
			},
		],
	});
	const mathProperties = new ImportedXmlComponent('m:mathPr');
	mathProperties.push(
		new ImportedXmlComponent('m:brkBin', { 'm:val': 'repeat' }),
	);
	mathProperties.push(
		new ImportedXmlComponent('m:brkBinSub', { 'm:val': '--' }),
	);
	doc.Settings.addChildElement(mathProperties);

	// Ensure output directory exists
	const outputDir = path.dirname(outputPath);
	if (!fs.existsSync(outputDir)) {
		fs.mkdirSync(outputDir, { recursive: true });
	}

	const buffer = clearDirtyFieldFlags(
		applyDataTableSpacing(
			applyFigureDocumentPolicy(await Packer.toBuffer(doc), figurePlans),
		),
	);
	fs.writeFileSync(outputPath, buffer);
	fs.writeFileSync(
		outputPath.replace(/\.docx$/i, '') + '.figures.json',
		`${JSON.stringify({ schemaVersion: 1, figures: figurePlans }, null, 2)}\n`,
	);
	console.log(`Report successfully generated at ${outputPath}`);
}
