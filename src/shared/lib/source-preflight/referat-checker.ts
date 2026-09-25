import { STO_RULES } from '@/shared/config';
import { ReportConfig } from '@/shared/lib/report-config';

import { createSourceTextContext } from './text-context';
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

function referatTextLength(content: string, keywordsLine: number): number {
	return content
		.split('\n')
		.slice(keywordsLine)
		.join(' ')
		.replace(
			/\\sto_referat_characteristics\{([^}]*)\}/g,
			'Основные характеристики: $1',
		)
		.replace(
			/\\sto_referat_application\{([^}]*)\}/g,
			'Область применения: $1',
		)
		.replace(/\s+/g, ' ')
		.trim().length;
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

	for (const field of ['characteristics', 'application'] as const) {
		const matches = [
			...referat.content.matchAll(
				new RegExp(String.raw`\\sto_referat_${field}\{([^}]*)\}`, 'g'),
			),
		];
		if (matches.length === 0) {
			issues.push(
				issue(
					`referat-${field}-missing`,
					`referat should declare ${field} with \\sto_referat_${field}{...}.`,
					referat.file,
					undefined,
					'warning',
				),
			);
		} else if (matches.length > 1 || !matches[0][1].trim()) {
			issues.push(
				issue(
					`referat-${field}-invalid`,
					`referat ${field} must appear exactly once and contain text.`,
					referat.file,
					lineNumberAt(referat.content, matches[0].index ?? 0),
				),
			);
		}
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
	const hasAppendix = files.some(({ content }) => {
		const prose = createSourceTextContext(content).prose;
		return /\\sto_appendix\{[^}]+\}\{[^}]*\}|\\sto_structural_heading\{ПРИЛОЖЕНИЕ\s+[А-ЯЁ]\}/i.test(
			prose,
		);
	});
	if (hasAppendix && !referat.content.includes('{{APPENDICES}}')) {
		issues.push(
			issue(
				'referat-appendices-placeholder-missing',
				'referat must state the number of appendices using {{APPENDICES}}.',
				referat.file,
			),
		);
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

	if (
		keywords &&
		referatTextLength(referat.content, keywords.number) >
			STO_RULES.referat.maxTextLengthChars
	) {
		issues.push(
			issue(
				'referat-length-warning',
				`referat text is longer than ${STO_RULES.referat.maxTextLengthChars} characters; STO recommends a concise abstract.`,
				referat.file,
				keywords.number + 1,
				'warning',
			),
		);
	}
}
