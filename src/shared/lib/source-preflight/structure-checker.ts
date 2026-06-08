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
	sourceIndex: number;
	text: string;
	upperText: string;
}

function collectStructuralHeadings(files: SourceFile[]): StructuralHeading[] {
	const headings: StructuralHeading[] = [];
	let sourceOffset = 0;

	for (const { file, content } of files) {
		for (const match of content.matchAll(
			/\\sto_structural_heading\{([^}]+)\}/g,
		)) {
			const text = match[1].trim();
			headings.push({
				file,
				line: lineNumberAt(content, match.index ?? 0),
				sourceIndex: sourceOffset + (match.index ?? 0),
				text,
				upperText: text.toUpperCase(),
			});
		}
		sourceOffset += content.length + 1;
	}

	return headings;
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

const APPLICATION_LABELS = [
	'А',
	'Б',
	'В',
	'Г',
	'Д',
	'Е',
	'Ж',
	'И',
	'К',
	'Л',
	'М',
	'Н',
	'П',
	'Р',
	'С',
	'Т',
	'У',
	'Ф',
	'Х',
	'Ц',
	'Ш',
	'Щ',
	'Э',
	'Ю',
	'Я',
] as const;

function getApplicationLabel(heading: StructuralHeading): string {
	return heading.upperText.replace(/^ПРИЛОЖЕНИЕ\s*/, '').trim();
}

function validateApplicationHeadings(
	headings: StructuralHeading[],
	sourceText: string,
	issues: SourcePreflightIssue[],
): void {
	const applicationHeadings = headings.filter(heading =>
		/^ПРИЛОЖЕНИЕ(?:\s+[А-ЯA-Z0-9]+)?/.test(heading.upperText),
	);
	const headingNames = headings.map(heading => heading.upperText);
	const sourcesIndex = headingNames.indexOf(
		STO_RULES.markdown.sourcesStructuralHeading,
	);
	const seenLabels = new Set<string>();
	let previousLabelIndex = -1;

	for (let index = 0; index < applicationHeadings.length; index++) {
		const application = applicationHeadings[index];
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

		const label = getApplicationLabel(application);
		if (!label) {
			issues.push(
				issue(
					'application-label-missing',
					'application heading should include a Russian letter, for example "ПРИЛОЖЕНИЕ А".',
					application.file,
					application.line,
					'warning',
				),
			);
			continue;
		}

		if (seenLabels.has(label)) {
			issues.push(
				issue(
					'application-label-duplicate',
					`application label "${label}" is duplicated.`,
					application.file,
					application.line,
				),
			);
		}
		seenLabels.add(label);

		const labelIndex = APPLICATION_LABELS.indexOf(
			label as (typeof APPLICATION_LABELS)[number],
		);
		if (labelIndex === -1) {
			issues.push(
				issue(
					'application-label-format',
					`application label "${label}" should be a single allowed Russian uppercase letter.`,
					application.file,
					application.line,
					'warning',
				),
			);
		} else if (labelIndex <= previousLabelIndex) {
			issues.push(
				issue(
					'application-label-order',
					'applications should follow Russian letter order without going backwards.',
					application.file,
					application.line,
					'warning',
				),
			);
		}
		previousLabelIndex = Math.max(previousLabelIndex, labelIndex);

		const sourceTextBeforeApplication = sourceText.slice(
			0,
			application.sourceIndex,
		);
		if (
			!new RegExp(`приложени[ея]\\s+${label}`, 'i').test(
				sourceTextBeforeApplication,
			)
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

		const nextApplication = applicationHeadings[index + 1];
		const applicationBody = sourceText.slice(
			application.sourceIndex,
			nextApplication?.sourceIndex ?? sourceText.length,
		);
		if (/^(?:Рисунок|Таблица)\s+\d+\s+–/im.test(applicationBody)) {
			issues.push(
				issue(
					'application-object-numbering',
					`objects inside ${application.text} should be numbered with the application letter, for example "${label}.1".`,
					application.file,
					application.line,
					'warning',
				),
			);
		}
		if (/\(@eq:[a-zA-Z0-9_-]+\)/.test(applicationBody)) {
			issues.push(
				issue(
					'application-formula-numbering',
					`formulas inside ${application.text} need application-local numbering such as "(${label}.1)"; verify numbering manually until appendix numbering is automated.`,
					application.file,
					application.line,
					'warning',
				),
			);
		}
	}
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
	validateApplicationHeadings(headings, sourceText, issues);
}
