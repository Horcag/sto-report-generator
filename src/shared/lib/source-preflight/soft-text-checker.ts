import { ReportConfig } from '@/shared/lib/report-config';

import { createSourceTextContext } from './text-context';
import { SourcePreflightIssue } from './types';
import { issue, lineNumberAt } from './utils';

const SMALL_NUMBER_NOUNS =
	/(?:образ(?:ец|ца|цов)|труб(?:а|ы)?|эксперимент(?:а|ов)?|испытан(?:ие|ия|ий)|этап(?:а|ов)?)/i;

export function validateSoftTextRules(
	file: string,
	content: string,
	config: ReportConfig,
	issues: SourcePreflightIssue[],
): void {
	if (config.preflight.softTextRules === 'off') {
		return;
	}

	const text = createSourceTextContext(content).prose;

	for (const match of text.matchAll(
		new RegExp(String.raw`\b([1-9])\s+${SMALL_NUMBER_NOUNS.source}`, 'gi'),
	)) {
		issues.push(
			issue(
				'small-number-in-digits',
				`uses a small number in digits: "${match[0]}". STO recommends writing numbers from one to nine as words when there is no measurement unit.`,
				file,
				lineNumberAt(text, match.index ?? 0),
				'warning',
			),
		);
	}

	for (const match of text.matchAll(/\b(?:т\.д|т\.п|и т\.д|и т\.п)\./gi)) {
		issues.push(
			issue(
				'suspicious-abbreviation',
				`uses abbreviation "${match[0]}". STO discourages arbitrary abbreviations in regular text.`,
				file,
				lineNumberAt(text, match.index ?? 0),
				'warning',
			),
		);
	}

	for (const match of text.matchAll(/\bD\s*(?:=|\d)/g)) {
		issues.push(
			issue(
				'diameter-symbol-in-text',
				'uses D as a diameter symbol in regular text. STO recommends writing the word "диаметр".',
				file,
				lineNumberAt(text, match.index ?? 0),
				'warning',
			),
		);
	}

	for (const match of text.matchAll(/^Примечание\s+-\s+/gim)) {
		issues.push(
			issue(
				'note-hyphen',
				'uses hyphen after "Примечание". Use an en dash.',
				file,
				lineNumberAt(text, match.index ?? 0),
				'warning',
			),
		);
	}

	for (const match of text.matchAll(/^Примечания\s*\n\s*\d+\./gim)) {
		issues.push(
			issue(
				'note-number-dot',
				'multiple notes should use numbers without a final dot after the number.',
				file,
				lineNumberAt(text, match.index ?? 0),
				'warning',
			),
		);
	}
}
