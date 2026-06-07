import { STO_RULES } from '@/shared/config';
import {
	getStructuralHeadingOrder,
	ReportConfig,
} from '@/shared/lib/report-config';

import { SourceFile, SourcePreflightIssue } from './types';
import { issue, lineNumberAt } from './utils';

interface StructuralHeading {
	file: string;
	line: number;
	text: string;
	upperText: string;
}

function collectStructuralHeadings(files: SourceFile[]): StructuralHeading[] {
	return files.flatMap(({ file, content }) =>
		[...content.matchAll(/\\sto_structural_heading\{([^}]+)\}/g)].map(
			match => {
				const text = match[1].trim();
				return {
					file,
					line: lineNumberAt(content, match.index ?? 0),
					text,
					upperText: text.toUpperCase(),
				};
			},
		),
	);
}

function hasCitations(files: SourceFile[]): boolean {
	return files.some(({ content }) => /\[@[^\]]+]/.test(content));
}

function getRequiredStructuralHeadings(
	config: ReportConfig,
	sourceHasCitations: boolean,
): string[] {
	const required = new Set(
		config.document.requiredStructuralHeadings.map(heading =>
			heading.toUpperCase(),
		),
	);
	const shouldRequireSources =
		config.document.requireSources === true ||
		(config.document.requireSources === 'when-cited' && sourceHasCitations);
	if (shouldRequireSources) {
		required.add(STO_RULES.markdown.sourcesStructuralHeading);
	}
	return [...required];
}

export function validateDocumentStructure(
	files: SourceFile[],
	issues: SourcePreflightIssue[],
	config: ReportConfig,
): void {
	const headings = collectStructuralHeadings(files);
	const headingNames = headings.map(heading => heading.upperText);
	const sourceHasCitations = hasCitations(files);
	const requiredStructuralHeadings = getRequiredStructuralHeadings(
		config,
		sourceHasCitations,
	);

	for (const requiredHeading of requiredStructuralHeadings) {
		if (!headingNames.includes(requiredHeading)) {
			issues.push(
				issue(
					'structural-heading-missing',
					`required structural heading is missing: ${requiredHeading}.`,
				),
			);
		}
	}

	let previousIndex = -1;
	for (const expected of getStructuralHeadingOrder(config.document)) {
		const actualIndex = headingNames.indexOf(expected);
		if (actualIndex === -1) {
			continue;
		}
		if (actualIndex < previousIndex) {
			const heading = headings[actualIndex];
			issues.push(
				issue(
					'structural-heading-order',
					`structural heading "${heading.text}" is out of STO order.`,
					heading.file,
					heading.line,
				),
			);
		}
		previousIndex = Math.max(previousIndex, actualIndex);
	}

	const sourceText = files.map(({ content }) => content).join('\n');
	const applicationHeadings = headings.filter(heading =>
		/^ПРИЛОЖЕНИЕ(?:\s+[А-ЯA-Z0-9]+)?/.test(heading.upperText),
	);
	const sourcesIndex = headingNames.indexOf(
		STO_RULES.markdown.sourcesStructuralHeading,
	);
	for (const application of applicationHeadings) {
		const appIndex = headings.indexOf(application);
		if (sourcesIndex !== -1 && appIndex < sourcesIndex) {
			issues.push(
				issue(
					'application-before-sources',
					'applications must be placed after the source list.',
					application.file,
					application.line,
				),
			);
		}

		const label = application.upperText
			.replace(/^ПРИЛОЖЕНИЕ\s*/, '')
			.trim();
		if (
			label &&
			!new RegExp(`приложени[ея]\\s+${label}`, 'i').test(sourceText)
		) {
			issues.push(
				issue(
					'application-without-reference',
					`application "${application.text}" should be referenced in text before the appendix.`,
					application.file,
					application.line,
					'warning',
				),
			);
		}
	}
}
