import {
	LabelDefinition,
	LabelDefinitions,
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
