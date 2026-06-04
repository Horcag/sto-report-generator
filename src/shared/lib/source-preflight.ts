import fs from 'fs';
import path from 'path';

import { STO_RULES } from '../config';

export interface SourcePreflightIssue {
	code: string;
	file?: string;
	line?: number;
	message: string;
}

export interface SourcePreflightResult {
	reportDir: string;
	issues: SourcePreflightIssue[];
	passed: boolean;
}

export interface SourcePreflightOptions {
	cwd?: string;
}

interface LabelDefinition {
	file: string;
	line: number;
	kind: 'fig' | 'tab' | 'eq';
}

function lineNumberAt(content: string, index: number): number {
	return content.slice(0, index).split('\n').length;
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripEnvironmentBlocks(content: string, envNames: string[]): string {
	let result = content;
	for (const envName of envNames) {
		const pattern = new RegExp(
			String.raw`\\begin\{${escapeRegExp(envName)}\}[\s\S]*?\\end\{${escapeRegExp(envName)}\}`,
			'g',
		);
		result = result.replace(pattern, match =>
			'\n'.repeat(match.split('\n').length - 1),
		);
	}
	return result;
}

function issue(
	code: string,
	message: string,
	file?: string,
	line?: number,
): SourcePreflightIssue {
	return { code, file, line, message };
}

function validateStoEnvironments(
	file: string,
	content: string,
	issues: SourcePreflightIssue[],
): void {
	const supported = new Set(STO_RULES.markdown.supportedEnvironments);
	const stack: { envName: string; line: number }[] = [];
	const tokenMatches = [...content.matchAll(/\\(begin|end)\{([^}]+)\}/g)];

	for (const match of tokenMatches) {
		const command = match[1];
		const envName = match[2];
		const line = lineNumberAt(content, match.index ?? 0);

		if (!supported.has(envName)) {
			issues.push(
				issue(
					'unsupported-sto-environment',
					`unsupported STO environment "${envName}". Supported: ${STO_RULES.markdown.supportedEnvironments.join(', ')}.`,
					file,
					line,
				),
			);
			continue;
		}

		if (command === 'begin') {
			stack.push({ envName, line });
			continue;
		}

		const opening = stack.pop();
		if (!opening) {
			issues.push(
				issue(
					'unmatched-sto-environment-close',
					`closing \\end{${envName}} has no matching \\begin{${envName}}.`,
					file,
					line,
				),
			);
			continue;
		}

		if (opening.envName !== envName) {
			issues.push(
				issue(
					'mismatched-sto-environment',
					`closes \\begin{${opening.envName}} from L${opening.line} with \\end{${envName}}.`,
					file,
					line,
				),
			);
		}
	}

	for (const opening of stack) {
		issues.push(
			issue(
				'unclosed-sto-environment',
				`\\begin{${opening.envName}} has no matching \\end{${opening.envName}}.`,
				file,
				opening.line,
			),
		);
	}
}

function validateSourcePunctuation(
	file: string,
	content: string,
	issues: SourcePreflightIssue[],
): void {
	const lines = content.split('\n');
	const captionPattern = new RegExp(
		`^(?:${STO_RULES.validation.figureCaptionPrefix}|${STO_RULES.validation.tableCaptionPrefix})\\s+\\d+\\s+–\\s+`,
	);
	const captionWithFinalDotPattern = new RegExp(
		`^(?:${STO_RULES.validation.figureCaptionPrefix}|${STO_RULES.validation.tableCaptionPrefix})\\s+\\d+\\s+–\\s+[\\s\\S]*\\.\\s*(?:\\(@(?:fig|tab):[a-zA-Z0-9_-]+\\))?$`,
	);

	for (let i = 0; i < lines.length; i++) {
		const trimmed = lines[i].trim();
		const line = i + 1;

		if (/^где\s*:/.test(trimmed)) {
			issues.push(
				issue(
					'where-colon',
					'uses "где:". STO formula explanations start with "где" without a colon.',
					file,
					line,
				),
			);
		}

		if (captionWithFinalDotPattern.test(trimmed)) {
			issues.push(
				issue(
					'caption-final-period',
					'table and figure captions must not end with a final dot.',
					file,
					line,
				),
			);
		}

		if (captionPattern.test(trimmed) && !/\s–\s/.test(trimmed)) {
			issues.push(
				issue(
					'caption-missing-en-dash-separator',
					'table and figure captions must use " – " between number and caption text.',
					file,
					line,
				),
			);
		}
	}
}

function validateImageExists(
	file: string,
	content: string,
	reportDir: string,
	cwd: string,
	issues: SourcePreflightIssue[],
): void {
	const imageMatches = [...content.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)];
	for (const match of imageMatches) {
		const imagePath = match[1].trim();
		if (/^(https?:|file:|#)/i.test(imagePath)) {
			continue;
		}

		const candidates = path.isAbsolute(imagePath)
			? [imagePath]
			: [
					path.resolve(reportDir, imagePath),
					path.resolve(cwd, imagePath),
				];
		if (!candidates.some(candidate => fs.existsSync(candidate))) {
			issues.push(
				issue(
					'missing-image',
					`image file does not exist: ${imagePath}`,
					file,
					lineNumberAt(content, match.index ?? 0),
				),
			);
		}
	}
}

function addLabelDefinition(
	definitions: Map<string, LabelDefinition>,
	issues: SourcePreflightIssue[],
	label: string,
	definition: LabelDefinition,
): void {
	const key = `${definition.kind}:${label}`;
	const previous = definitions.get(key);
	if (previous) {
		issues.push(
			issue(
				'duplicate-label',
				`${definition.kind} label @${key} duplicates label from ${previous.file}:L${previous.line}.`,
				definition.file,
				definition.line,
			),
		);
		return;
	}
	definitions.set(key, definition);
}

function collectLabelDefinitions(
	file: string,
	content: string,
	definitions: Map<string, LabelDefinition>,
	issues: SourcePreflightIssue[],
): void {
	for (const match of content.matchAll(/\(@(fig|tab):([a-zA-Z0-9_-]+)\)/g)) {
		addLabelDefinition(definitions, issues, match[2], {
			file,
			line: lineNumberAt(content, match.index ?? 0),
			kind: match[1] as 'fig' | 'tab',
		});
	}

	for (const match of content.matchAll(/\(@eq:([a-zA-Z0-9_-]+)\)/g)) {
		addLabelDefinition(definitions, issues, match[1], {
			file,
			line: lineNumberAt(content, match.index ?? 0),
			kind: 'eq',
		});
	}
}

function validateUnknownReferences(
	file: string,
	content: string,
	definitions: Map<string, LabelDefinition>,
	issues: SourcePreflightIssue[],
): void {
	for (const match of content.matchAll(/@(fig|tab|eq):([a-zA-Z0-9_-]+)/g)) {
		const key = `${match[1]}:${match[2]}`;
		if (!definitions.has(key)) {
			issues.push(
				issue(
					'unknown-reference-label',
					`reference @${key} does not have a matching definition.`,
					file,
					lineNumberAt(content, match.index ?? 0),
				),
			);
		}
	}
}

function validateTableAndFigureOrder(
	files: { file: string; content: string }[],
	issues: SourcePreflightIssue[],
): void {
	let textSoFar = '';

	for (const { file, content } of files) {
		const lines = content.split('\n');
		for (let i = 0; i < lines.length; i++) {
			const line = lines[i].trim();
			const tableMatch = /^Таблица\s+(\d+)\s+–/i.exec(line);
			if (tableMatch) {
				const tableNum = tableMatch[1];
				const refRegex = new RegExp(
					`(?:таблиц[а-я]{1,3}|таблица)\\s+${tableNum}`,
					'i',
				);
				if (!refRegex.test(textSoFar)) {
					issues.push(
						issue(
							'table-before-reference',
							`Table ${tableNum} appears before being referenced in text. Found: "${line}"`,
							file,
							i + 1,
						),
					);
				}
			}

			const figMatch = /^Рисунок\s+(\d+)\s+–/i.exec(line);
			if (figMatch) {
				const figNum = figMatch[1];
				const refRegex = new RegExp(
					`(?:рисунк[а-я]{1,3}|рисунок)\\s+${figNum}`,
					'i',
				);
				if (!refRegex.test(textSoFar)) {
					issues.push(
						issue(
							'figure-before-reference',
							`Figure ${figNum} appears before being referenced in text. Found: "${line}"`,
							file,
							i + 1,
						),
					);
				}
			}

			textSoFar += `${line}\n`;
		}
	}
}

export function formatSourcePreflightIssue(item: SourcePreflightIssue): string {
	const location = item.file
		? item.line
			? `[${item.file}:L${item.line}]`
			: `[${item.file}]`
		: '[project]';
	return `FAIL: ${location} ${item.message}`;
}

export function runSourcePreflight(
	reportDir: string,
	options: SourcePreflightOptions = {},
): SourcePreflightResult {
	const cwd = options.cwd ?? process.cwd();
	const absoluteReportDir = path.resolve(cwd, reportDir);
	const issues: SourcePreflightIssue[] = [];

	if (!fs.existsSync(absoluteReportDir)) {
		issues.push(
			issue('report-dir-not-found', `Directory not found: ${reportDir}`),
		);
		return { reportDir: absoluteReportDir, issues, passed: false };
	}

	const mdFiles = fs
		.readdirSync(absoluteReportDir)
		.filter(
			file => file.endsWith('.md') && file.toLowerCase() !== 'readme.md',
		)
		.sort((left, right) => left.localeCompare(right));

	if (mdFiles.length === 0) {
		issues.push(issue('no-markdown-files', 'No Markdown files found.'));
		return { reportDir: absoluteReportDir, issues, passed: false };
	}

	const files = mdFiles.map(file => ({
		file,
		content: fs.readFileSync(path.join(absoluteReportDir, file), 'utf8'),
	}));
	const definitions = new Map<string, LabelDefinition>();

	for (const { file, content } of files) {
		validateStoEnvironments(file, content, issues);
		validateSourcePunctuation(file, content, issues);
		collectLabelDefinitions(file, content, definitions, issues);
	}

	for (const { file, content } of files) {
		for (const marker of STO_RULES.validation.forbiddenLiteralMarkers) {
			if (content.includes(marker)) {
				issues.push(
					issue(
						'forbidden-marker',
						`contains "${marker}" marker.`,
						file,
					),
				);
			}
		}

		if (content.includes(STO_RULES.typography.forbiddenDash)) {
			issues.push(
				issue(
					'forbidden-dash',
					`contains em-dash (${STO_RULES.typography.forbiddenDash}). Use en-dash (${STO_RULES.typography.recommendedDash}) in STO reports.`,
					file,
				),
			);
		}

		if (content.includes('\t')) {
			issues.push(
				issue(
					'tab-character',
					'contains tab characters. Use spaces only.',
					file,
				),
			);
		}

		if (/\[0\]/.test(content)) {
			issues.push(
				issue(
					'zero-citation',
					'contains citation [0]. Source numbering starts from [1].',
					file,
				),
			);
		}

		const manualCitationPattern = new RegExp(
			STO_RULES.validation.manualCitationNumberPattern,
			'g',
		);
		for (const match of content.matchAll(manualCitationPattern)) {
			issues.push(
				issue(
					'manual-source-citation',
					`contains manual source citation ${match[0]}. Use BibTeX cite keys like [@key] so numbering stays automatic.`,
					file,
					lineNumberAt(content, match.index ?? 0),
				),
			);
		}

		if (
			!STO_RULES.validation.allowedBoldMarkdownFiles.includes(file) &&
			/\*\*[^*]+\*\*/.test(content)
		) {
			issues.push(
				issue(
					'forbidden-bold-markdown',
					`contains bold markdown. Bold is allowed only in ${STO_RULES.validation.allowedBoldMarkdownFiles.join(', ')}.`,
					file,
				),
			);
		}

		const contentWithoutStoLists = stripEnvironmentBlocks(
			content,
			STO_RULES.markdown.listEnvironments,
		);
		const rawListMatches = [
			...contentWithoutStoLists.matchAll(
				/^(?:\s*[-*+]\s+|\s*\d+\.\s+)/gm,
			),
		];
		for (const match of rawListMatches) {
			issues.push(
				issue(
					'raw-markdown-list',
					'contains a raw Markdown list. Use \\begin{sto_list}...\\end{sto_list} or \\begin{sto_enum}...\\end{sto_enum}.',
					file,
					lineNumberAt(contentWithoutStoLists, match.index ?? 0),
				),
			);
		}

		const rawEquationNumberMatches = [
			...content.matchAll(/\$\$[\s\S]*?\(\d+\)\s*\$\$/g),
		];
		for (const match of rawEquationNumberMatches) {
			issues.push(
				issue(
					'hard-coded-formula-number',
					'contains a hard-coded formula number. Use automatic labels like (@eq:formula_id).',
					file,
					lineNumberAt(content, match.index ?? 0),
				),
			);
		}

		for (const match of content.matchAll(/\(@eq:([a-zA-Z0-9_-]+)\)/g)) {
			const before = content.lastIndexOf('$$', match.index ?? 0);
			const after = content.indexOf(
				'$$',
				(match.index ?? 0) + match[0].length,
			);
			if (before === -1 || after === -1) {
				issues.push(
					issue(
						'formula-label-outside-block',
						`formula label @eq:${match[1]} is outside a block formula.`,
						file,
						lineNumberAt(content, match.index ?? 0),
					),
				);
			}
		}

		const metricMatches = content.match(
			/(?:ROC-AUC|PR-AUC|F1-score|CV)(?:\s*[:=]\s*)(\d+\.\d+)/gi,
		);
		if (metricMatches) {
			for (const match of metricMatches) {
				issues.push(
					issue(
						'decimal-dot-in-metric',
						`contains decimal dot in metric: ${match}. Use comma instead.`,
						file,
					),
				);
			}
		}

		validateImageExists(file, content, absoluteReportDir, cwd, issues);
		validateUnknownReferences(file, content, definitions, issues);
	}

	const referat = files.find(({ file }) => file === '01_referat.md');
	if (referat) {
		const missingPlaceholders = [
			'{{PAGES}}',
			'{{FIGURES}}',
			'{{TABLES}}',
			'{{SOURCES}}',
		].some(placeholder => !referat.content.includes(placeholder));
		if (missingPlaceholders) {
			const figureRefs = files.reduce((acc, { content }) => {
				const matches = content.match(/!\[.*?\]\(.*?\)/g) ?? [];
				return acc + matches.length;
			}, 0);
			const abstractFiguresMatch = referat.content.match(/(\d+)\s+рис/);
			if (
				abstractFiguresMatch &&
				Number(abstractFiguresMatch[1]) !== figureRefs
			) {
				issues.push(
					issue(
						'abstract-figure-count-drift',
						`Abstract says ${abstractFiguresMatch[1]} figures, but found ${figureRefs} in source images. Use {{FIGURES}} placeholder.`,
						'01_referat.md',
					),
				);
			}
		}
	}

	validateTableAndFigureOrder(files, issues);

	return {
		reportDir: absoluteReportDir,
		issues,
		passed: issues.length === 0,
	};
}
