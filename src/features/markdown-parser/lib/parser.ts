import * as fs from 'fs';
import * as path from 'path';
import sizeOf from 'image-size';
import { Paragraph, Table, TableCell, TableRow, TextRun, WidthType, AlignmentType, BorderStyle, Math as DocxMath, MathRun, ImageRun, TableOfContents, StyleLevel } from 'docx';
import { marked, Token, Tokens } from 'marked';
import { convertLatex2Math, mathJaxReady } from '@hungknguyen/docx-math-converter';

const stoExtension = {
	name: 'stoFlag',
	level: 'block',
	start(src: string) { return src.match(/\\sto_structural_heading\{|\\begin\{/)?.index; },
	tokenizer(src: string, tokens: any[]) {
		let rule = /^\\sto_structural_heading\{([^}]+)\}/;
		let match = rule.exec(src);
		if (match) {
			return {
				type: 'stoFlag',
				raw: match[0],
				flagType: 'structural_heading',
				text: match[1]
			};
		}
		
		rule = /^\\begin\{([^}]+)\}([\s\S]*?)\\end\{\1\}/;
		match = rule.exec(src);
		if (match) {
			const envName = match[1];
			const content = match[2];
			const blockTokens: any[] = [];
			this.lexer.blockTokens(content, blockTokens);
			return {
				type: 'stoFlag',
				raw: match[0],
				flagType: 'environment',
				envName: envName,
				tokens: blockTokens
			};
		}
	}
};

marked.use({ extensions: [stoExtension] });

export async function parseMarkdownToDocx(markdownText: string): Promise<(Paragraph | Table | TableOfContents)[]> {
	await mathJaxReady();

	// Normalize dashes: em-dash (—) -> en-dash (–)
	let normalizedText = markdownText.replace(/—/g, '–');

	const tokens = marked.lexer(normalizedText);

	// Simple citation map for this session (should ideally be persistent or external)
	const citations: string[] = [];
	const getCitationNum = (key: string) => {
		let idx = citations.indexOf(key);
		if (idx === -1) {
			citations.push(key);
			idx = citations.length - 1;
		}
		return idx + 1;
	};

	const parseInline = async (inlineTokens: any[]): Promise<any[]> => {
		const runs: any[] = [];
		for (const token of inlineTokens) {
			if (token.type === 'strong') {
				runs.push(new TextRun({ text: token.text, bold: true }));
			} else if (token.type === 'em') {
				runs.push(new TextRun({ text: token.text, italics: true }));
			} else if (token.type === 'codespan') {
				runs.push(new TextRun({ text: token.text, font: 'Courier New' }));
			} else if (token.type === 'escape') {
				runs.push(new TextRun({ text: token.text }));
			} else if (token.type === 'image') {
				const workspaceRoot = process.cwd();
				const imgPath = path.resolve(workspaceRoot, token.href);
				if (fs.existsSync(imgPath)) {
					const imgBuffer = fs.readFileSync(imgPath);
					// @ts-ignore
					const dimensions = sizeOf(imgBuffer);
					const maxWidth = 600;
					let w = dimensions.width || 500;
					let h = dimensions.height || 300;
					if (w > maxWidth) {
						h = Math.round(h * (maxWidth / w));
						w = maxWidth;
					}
					
					let ext = path.extname(imgPath).slice(1).toLowerCase();
					if (ext === 'jpeg') ext = 'jpg';
					if (ext === 'svg') {
						runs.push(new ImageRun({
							data: imgBuffer,
							type: 'svg',
							fallback: { data: imgBuffer, type: 'png' },
							transformation: { width: w, height: h },
						} as any));
					} else {
						runs.push(new ImageRun({
							data: imgBuffer,
							type: ext as any,
							transformation: { width: w, height: h },
						}));
					}
				} else {
					console.warn(`Image not found: ${imgPath}`);
					runs.push(new TextRun({ text: `[Image not found: ${token.href}]`, color: 'FF0000' }));
				}
			} else if (token.type === 'text') {
				if (token.tokens && token.tokens.length > 0) {
					runs.push(...(await parseInline(token.tokens)));
				} else {
					let text = token.raw
						.replace(/&amp;/g, '&')
						.replace(/&lt;/g, '<')
						.replace(/&gt;/g, '>')
						.replace(/&quot;/g, '"')
						.replace(/&#39;/g, "'");

					text = text.replace(/\[@([^\]]+)\]/g, (_: string, key: string) => {
						return `[${getCitationNum(key)}]`;
					});

					const mathParts = text.split(/(\$[^$]+\$)/g);
					for (const part of mathParts) {
						if (part.startsWith('$') && part.endsWith('$')) {
							const mathText = part.substring(1, part.length - 1);
							try {
								const mathEl = await convertLatex2Math(mathText);
								runs.push(mathEl);
							} catch (err) {
								runs.push(new TextRun({ text: part, italics: true }));
							}
						} else if (part.length > 0) {
							runs.push(new TextRun({ text: part }));
						}
					}
				}
			} else {
				if (token.text) {
					runs.push(new TextRun({ text: token.text }));
				}
			}
		}
		return runs;
	};

	const processTokens = async (tokensToProcess: any[], context: { isBib?: boolean } = {}): Promise<any[]> => {
		const elements: any[] = [];
		for (const token of tokensToProcess) {
			switch (token.type) {
				case 'stoFlag': {
					if (token.flagType === 'structural_heading') {
						const text = token.text.trim().toUpperCase();
						elements.push(
							new Paragraph({
								style: 'StructuralHeading',
								children: [new TextRun(text)],
							}),
						);
						if (text === 'СОДЕРЖАНИЕ') {
							elements.push(
								new TableOfContents("", {
									hyperlink: true,
									headingStyleRange: "1-4",
									stylesWithLevels: [new StyleLevel("StructuralHeading", 1)]
								})
							);
						}
					} else if (token.flagType === 'environment') {
						if (token.envName === 'sto_bibliography') {
							const bibElements = await processTokens(token.tokens, { isBib: true });
							elements.push(...bibElements);
						} else {
							// Fallback for other environments like sto_appendix
							const innerElements = await processTokens(token.tokens, context);
							elements.push(...innerElements);
						}
					}
					break;
				}
				case 'heading': {
					const headingToken = token as Tokens.Heading;
					let text = headingToken.text.trim().toLowerCase();
					text = text.replace(/[а-яa-zа-яё]/i, match => match.toUpperCase());
					elements.push(
						new Paragraph({
							style: `Heading${globalThis.Math.min(headingToken.depth, 6)}`,
							children: [new TextRun(text)],
						}),
					);
					break;
				}
				case 'paragraph': {
					const paraToken = token as Tokens.Paragraph;
					const text = paraToken.text;

					const blockMathMatch = text.match(/^\$\$([\s\S]+)\$\$$/);
					if (blockMathMatch) {
						const mathContent = blockMathMatch[1].trim();
						const numberMatch = mathContent.match(/^(.*?)\s*(\(\d+\))$/);
						let formula = mathContent;
						let eqNumber = '';
						if (numberMatch) {
							formula = numberMatch[1].trim();
							eqNumber = numberMatch[2].trim();
						}

						let formulaMath;
						try {
							formulaMath = await convertLatex2Math(formula);
						} catch (e) {
							formulaMath = new TextRun({ text: formula, italics: true });
						}

						elements.push(
							new Table({
								width: { size: 100, type: WidthType.PERCENTAGE },
								borders: {
									top: { style: BorderStyle.NONE, size: 0, color: "auto" },
									bottom: { style: BorderStyle.NONE, size: 0, color: "auto" },
									left: { style: BorderStyle.NONE, size: 0, color: "auto" },
									right: { style: BorderStyle.NONE, size: 0, color: "auto" },
									insideHorizontal: { style: BorderStyle.NONE, size: 0, color: "auto" },
									insideVertical: { style: BorderStyle.NONE, size: 0, color: "auto" },
								},
								rows: [
									new TableRow({
										children: [
											new TableCell({
												width: { size: 15, type: WidthType.PERCENTAGE },
												children: [new Paragraph("")]
											}),
											new TableCell({
												width: { size: 70, type: WidthType.PERCENTAGE },
												children: [
													new Paragraph({
														alignment: AlignmentType.CENTER,
														children: [formulaMath],
													})
												],
											}),
											new TableCell({
												width: { size: 15, type: WidthType.PERCENTAGE },
												children: [
													new Paragraph({
														alignment: AlignmentType.RIGHT,
														children: [new TextRun(eqNumber)],
													})
												],
											}),
										],
									}),
								],
							})
						);
						break;
					}

					if (context.isBib) {
						const bibMatch = text.match(/^(\d+)\.?\s+(.*)/);
						if (bibMatch) {
							const itemTokens = paraToken.tokens || [];
							const filteredTokens = itemTokens.map((t: any) => {
								if (t.type === 'text' && t.raw.startsWith(bibMatch[0])) {
									return {
										...t,
										raw: t.raw.replace(/^(\d+)\.?\s+/, ''),
										text: t.text.replace(/^(\d+)\.?\s+/, ''),
									};
								}
								return t;
							});

							elements.push(
								new Paragraph({
									style: 'Normal',
									indent: { left: 0, firstLine: 709 },
									numbering: { reference: 'bib-numbering', level: 0 },
									children: await parseInline(filteredTokens),
								}),
							);
							break;
						}
					}

					if (/^(?:Рисунок|Рис\.)\s*\d/.test(text.trim())) {
						elements.push(
							new Paragraph({
								style: 'FigureCaption',
								children: await parseInline(paraToken.tokens || []),
							}),
						);
					} else if (/^Таблица\s*\d/.test(text.trim())) {
						elements.push(
							new Paragraph({
								style: 'TableCaption',
								children: await parseInline(paraToken.tokens || []),
							}),
						);
					} else {
						elements.push(
							new Paragraph({
								style: 'Normal',
								indent: text.trim().startsWith('где') ? { firstLine: 0 } : undefined,
								children: await parseInline(paraToken.tokens || []),
							}),
						);
					}
					break;
				}
				case 'list': {
					const listToken = token as Tokens.List;
					for (const item of listToken.items) {
						elements.push(
							new Paragraph({
								style: 'Normal',
								indent: { left: 0, firstLine: 709 },
								numbering: listToken.ordered
									? { reference: 'ordered-numbering', level: 0 }
									: { reference: 'list-numbering', level: 0 },
								children: await parseInline(item.tokens || []),
							}),
						);
					}
					break;
				}
				case 'table': {
					const tableToken = token as Tokens.Table;
					const rows = [];
					for (const row of tableToken.rows) {
						const rowCells = [];
						for (const cell of row) {
							rowCells.push(new TableCell({
								children: [
									new Paragraph({
										style: 'TableText',
										children: await parseInline(cell.tokens),
									}),
								],
							}));
						}
						rows.push(new TableRow({ children: rowCells }));
					}

					const headerCells = [];
					for (const cell of tableToken.header) {
						headerCells.push(new TableCell({
							children: [
								new Paragraph({
									style: 'TableText',
									children: await parseInline(cell.tokens),
								}),
							],
						}));
					}
					const headerRow = new TableRow({ children: headerCells });

					elements.push(
						new Table({
							width: { size: 100, type: WidthType.PERCENTAGE },
							rows: [headerRow, ...rows],
						}),
					);
					break;
				}
				case 'space':
					break;
				default:
					console.warn(`Unhandled token type: ${token.type}`);
					break;
			}
		}
		return elements;
	};

	return processTokens(tokens);
}
