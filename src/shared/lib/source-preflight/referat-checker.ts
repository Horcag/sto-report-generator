import { STO_RULES } from '@/shared/config';
import { ReportConfig } from '@/shared/lib/report-config';

import { SourceFile, SourcePreflightIssue } from './types';
import { issue, lineNumberAt } from './utils';

function findKeywordsLine(
	content: string,
): { line: string; number: number } | null {
	const lines = content.split('\n');
	for (let index = 0; index < lines.length; index++) {
		const trimmed = lines[index].trim();
		if (
			trimmed.includes(',') &&
			/[А-ЯЁ]/.test(trimmed) &&
			trimmed === trimmed.toUpperCase()
		) {
			return { line: trimmed, number: index + 1 };
		}
	}
	return null;
}

export function validateReferat(
	files: SourceFile[],
	issues: SourcePreflightIssue[],
	config: ReportConfig,
): void {
	const referat = files.find(
		({ file }) => file === STO_RULES.referat.fileName,
	);
	if (!referat) {
		if (!config.document.requireReferat) {
			return;
		}
		issues.push(
			issue(
				'referat-file-missing',
				`required referat file is missing: ${STO_RULES.referat.fileName}.`,
			),
		);
		return;
	}

	const requiredStatisticPlaceholders =
		STO_RULES.referat.requiredStatisticPlaceholders ??
		STO_RULES.referat.statisticPlaceholders;

	for (const placeholder of requiredStatisticPlaceholders) {
		if (!referat.content.includes(placeholder)) {
			issues.push(
				issue(
					'referat-stat-placeholder-missing',
					`referat statistic line must contain ${placeholder}.`,
					referat.file,
				),
			);
		}
	}

	const keywords = findKeywordsLine(referat.content);
	if (!keywords) {
		issues.push(
			issue(
				'referat-keywords-missing',
				'referat must contain 5-15 uppercase keywords separated by commas.',
				referat.file,
				undefined,
				'warning',
			),
		);
	} else {
		const cleanedLine = keywords.line.replace(/[.]$/, '');
		const words = cleanedLine
			.split(',')
			.map(item => item.trim())
			.filter(Boolean);
		if (
			words.length < STO_RULES.referat.keywordCount.min ||
			words.length > STO_RULES.referat.keywordCount.max
		) {
			issues.push(
				issue(
					'referat-keyword-count',
					`referat keyword count must be ${STO_RULES.referat.keywordCount.min}-${STO_RULES.referat.keywordCount.max}; found ${words.length}.`,
					referat.file,
					keywords.number,
				),
			);
		}
		if (keywords.line.endsWith('.')) {
			issues.push(
				issue(
					'referat-keywords-final-period',
					'referat keyword line must not end with a final dot.',
					referat.file,
					keywords.number,
					'warning',
				),
			);
		}
	}

	for (const marker of STO_RULES.referat.semanticMarkers) {
		if (!new RegExp(marker, 'i').test(referat.content)) {
			issues.push(
				issue(
					'referat-semantic-marker-missing',
					`referat does not contain an expected semantic marker: ${marker}.`,
					referat.file,
					undefined,
					'warning',
				),
			);
		}
	}

	if (referat.content.length > STO_RULES.referat.maxTextLengthChars) {
		issues.push(
			issue(
				'referat-length-warning',
				`referat source is longer than ${STO_RULES.referat.maxTextLengthChars} characters; STO recommends a concise abstract.`,
				referat.file,
				lineNumberAt(
					referat.content,
					STO_RULES.referat.maxTextLengthChars,
				),
				'warning',
			),
		);
	}
}
