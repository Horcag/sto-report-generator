import {
	LabelDefinition,
	LabelDefinitions,
	SourceFile,
	SourcePreflightIssue,
} from './types';
import { issue, lineNumberAt } from './utils';

function addLabelDefinition(
	definitions: LabelDefinitions,
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

export function collectLabelDefinitions(
	file: string,
	content: string,
	definitions: LabelDefinitions,
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

export function validateUnknownReferences(
	file: string,
	content: string,
	definitions: LabelDefinitions,
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

function isDefinitionReference(
	content: string,
	index: number,
	rawReference: string,
): boolean {
	return (
		content[index - 1] === '(' &&
		content[index + rawReference.length] === ')'
	);
}

export function validateUnusedEquationLabels(
	files: SourceFile[],
	definitions: LabelDefinitions,
	issues: SourcePreflightIssue[],
): void {
	const usedEquationLabels = new Set<string>();

	for (const { content } of files) {
		for (const match of content.matchAll(/@eq:([a-zA-Z0-9_-]+)/g)) {
			const index = match.index ?? 0;
			if (isDefinitionReference(content, index, match[0])) {
				continue;
			}
			usedEquationLabels.add(`eq:${match[1]}`);
		}
	}

	for (const [key, definition] of definitions.entries()) {
		if (!key.startsWith('eq:') || usedEquationLabels.has(key)) {
			continue;
		}

		issues.push(
			issue(
				'unused-equation-label',
				`numbered formula @${key} is not referenced in text. STO numbering is intended for formulas that are cited.`,
				definition.file,
				definition.line,
				'warning',
			),
		);
	}
}

/** Checks displayed object numbers and the first textual reference in source order. */
export function validateObjectReferences(
	files: SourceFile[],
	issues: SourcePreflightIssue[],
): void {
	const main = { fig: 0, tab: 0, eq: 0, note: 0 };
	const appendixCounters = new Map<string, typeof main>();
	let appendix: string | undefined;
	let precedingText = '';
	const allText = files.map(({ content }) => content).join('\n');
	const knownNumbers = new Set<string>();

	for (const { file, content } of files) {
		const lines = content.split('\n');
		let inMathBlock = false;
		for (let index = 0; index < lines.length; index++) {
			const line = lines[index].trim();
			const heading =
				/^\\sto_structural_heading\{ПРИЛОЖЕНИЕ\s+([А-Я])\}/i.exec(line);
			const explicitAppendix =
				/^\\sto_appendix\{([А-Я])\}\{[^}]+\}/i.exec(line);
			if (heading || explicitAppendix)
				appendix = (heading ?? explicitAppendix)![1].toUpperCase();
			const counters = appendix
				? (appendixCounters.get(appendix) ?? {
						fig: 0,
						tab: 0,
						eq: 0,
						note: 0,
					})
				: main;
			if (appendix) appendixCounters.set(appendix, counters);

			const caption =
				/^(Рисунок|Рис\.|Таблица)\s+([А-Я]\.\d+|\d+)\s+–\s+/i.exec(
					line,
				);
			if (caption) {
				const label = /\(@(fig|tab):([a-zA-Z0-9_-]+)\)\s*$/.exec(line);
				const kind = /^Таблица/i.test(caption[1]) ? 'tab' : 'fig';
				if (label && kind !== label[1]) {
					issues.push(
						issue(
							'object-label-kind',
							`caption label @${label[1]}:${label[2]} has the wrong object kind.`,
							file,
							index + 1,
						),
					);
				} else {
					counters[kind]++;
					const expected = appendix
						? `${appendix}.${counters[kind]}`
						: String(counters[kind]);
					if (caption[2] !== expected) {
						issues.push(
							issue(
								appendix
									? 'application-object-numbering'
									: 'object-number-sequence',
								`expected ${caption[1]} ${expected}, found ${caption[2]}.`,
								file,
								index + 1,
							),
						);
					}
					knownNumbers.add(`${kind}:${caption[2]}`);
					const textPattern =
						kind === 'fig'
							? '(?:рисун(?:ок|к[а-я]*)|рис\\.)'
							: 'таблиц[а-я]*';
					const reference = new RegExp(
						`${textPattern}\\s+${caption[2].replace('.', '\\.')}(?!\\d|\\.\\d)`,
						'i',
					);
					const labelledReference = label
						? new RegExp(`@${kind}:${label[2]}(?![a-zA-Z0-9_-])`)
						: undefined;
					if (
						!reference.test(precedingText) &&
						!labelledReference?.test(precedingText)
					) {
						issues.push(
							issue(
								kind === 'fig'
									? 'figure-before-reference'
									: 'table-before-reference',
								`${caption[1]} ${caption[2]} appears before its first reference.`,
								file,
								index + 1,
							),
						);
					}
				}
			}

			const formulaLabels = [
				...line.matchAll(/\(@eq:([a-zA-Z0-9_-]+)\)/g),
			];
			for (const formula of formulaLabels) {
				if (!line.includes('$$') && !inMathBlock) continue;
				counters.eq++;
				const expected = appendix
					? `${appendix}.${counters.eq}`
					: String(counters.eq);
				knownNumbers.add(`eq:${expected}`);
				if (
					!new RegExp(`@eq:${formula[1]}(?![a-zA-Z0-9_-])`).test(
						precedingText,
					)
				) {
					issues.push(
						issue(
							'formula-before-reference',
							`formula (${expected}) appears before its first reference.`,
							file,
							index + 1,
						),
					);
				}
			}
			if ((line.match(/\$\$/g)?.length ?? 0) % 2 === 1)
				inMathBlock = !inMathBlock;

			const note = /^Примечание\s+(\d+)\s+–\s+/i.exec(line);
			if (note) {
				counters.note++;
				const expected = String(counters.note);
				knownNumbers.add(`note:${note[1]}`);
				if (note[1] !== expected)
					issues.push(
						issue(
							'note-number-sequence',
							`expected Примечание ${expected}, found ${note[1]}.`,
							file,
							index + 1,
						),
					);
				if (
					!new RegExp(
						`примечани[а-я]*\\s+${note[1]}(?!\\d)`,
						'i',
					).test(precedingText)
				) {
					issues.push(
						issue(
							'note-before-reference',
							`Примечание ${note[1]} appears before its first reference.`,
							file,
							index + 1,
						),
					);
				}
			}
			precedingText += `${line}\n`;
		}
	}

	for (const match of allText.matchAll(
		/(?:рисун(?:ок|к[а-я]*)|рис\.|таблиц[а-я]*|формул[а-я]*|примечани[а-я]*)\s+([А-Я]\.\d+|\d+)(?!\d|\.\d)/gi,
	)) {
		const before = allText.slice(0, match.index).split('\n').at(-1) ?? '';
		if (/^(?:Рисунок|Рис\.|Таблица|Примечание)\s+/i.test(before)) continue;
		const kind = /^(?:рис|Рис)/i.test(match[0])
			? 'fig'
			: /^таб/i.test(match[0])
				? 'tab'
				: /^примеч/i.test(match[0])
					? 'note'
					: 'eq';
		if (!knownNumbers.has(`${kind}:${match[1]}`)) {
			issues.push(
				issue(
					'unknown-object-number',
					`${match[0]} does not have a matching object.`,
					undefined,
				),
			);
		}
	}
}
