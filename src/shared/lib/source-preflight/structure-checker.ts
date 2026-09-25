import { APPENDIX_LABELS, STO_RULES } from '@/shared/config';
import {
	getStructuralHeadingOrder,
	ReportConfig,
} from '@/shared/lib/report-config';

import { createSourceTextContext } from './text-context';
import { SourceFile, SourcePreflightIssue } from './types';
import { issue, lineNumberAt } from './utils';

interface StructuralHeading {
	file: string;
	line: number;
	sourceIndex: number;
	text: string;
	upperText: string;
	appendixTitle?: string;
}

interface AppendixReference {
	label: string;
	file: string;
	line: number;
	sourceIndex: number;
}

function collectStructuralHeadings(files: SourceFile[]): StructuralHeading[] {
	const headings: StructuralHeading[] = [];
	let sourceOffset = 0;

	for (const { file, content } of files) {
		const searchable = createSourceTextContext(content).prose;
		for (const match of searchable.matchAll(
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
		for (const match of searchable.matchAll(
			/\\sto_appendix\{([^}]+)\}\{([^}]*)\}/g,
		)) {
			const text = `ПРИЛОЖЕНИЕ ${match[1].trim()}`;
			headings.push({
				file,
				line: lineNumberAt(content, match.index ?? 0),
				sourceIndex: sourceOffset + (match.index ?? 0),
				text,
				upperText: text.toUpperCase(),
				appendixTitle: match[2].trim(),
			});
		}
		sourceOffset += content.length + 1;
	}

	return headings.sort((left, right) => left.sourceIndex - right.sourceIndex);
}

function collectAppendixReferences(files: SourceFile[]): AppendixReference[] {
	const references: AppendixReference[] = [];
	let sourceOffset = 0;
	for (const { file, content } of files) {
		const searchable = createSourceTextContext(content).prose;
		for (const match of searchable.matchAll(
			/\\sto_appendix_ref\{([^}]*)\}/g,
		)) {
			references.push({
				label: match[1].trim().toUpperCase(),
				file,
				line: lineNumberAt(content, match.index ?? 0),
				sourceIndex: sourceOffset + (match.index ?? 0),
			});
		}
		sourceOffset += content.length + 1;
	}
	return references;
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

function getApplicationLabel(heading: StructuralHeading): string {
	return heading.upperText.replace(/^ПРИЛОЖЕНИЕ\s*/, '').trim();
}

function validateApplicationHeadings(
	headings: StructuralHeading[],
	sourceText: string,
	references: AppendixReference[],
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
	const declaredLabels = new Set(
		applicationHeadings.map(heading => getApplicationLabel(heading)),
	);
	for (const reference of references) {
		if (!declaredLabels.has(reference.label)) {
			issues.push(
				issue(
					'application-reference-unknown',
					`appendix reference "${reference.label}" has no declared appendix.`,
					reference.file,
					reference.line,
				),
			);
		}
	}

	for (let index = 0; index < applicationHeadings.length; index++) {
		const application = applicationHeadings[index];
		const title = application.appendixTitle;
		if (
			title !== undefined &&
			(!title || title.endsWith('.') || title.includes('"'))
		) {
			issues.push(
				issue(
					'application-title-format',
					'appendix title must be nonempty and have no final period.',
					application.file,
					application.line,
				),
			);
		}
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
					application.appendixTitle === undefined
						? 'warning'
						: 'error',
				),
			);
			continue;
		}
		if (index === 0 && label !== 'А') {
			issues.push(
				issue(
					'application-label-order',
					'the first and only appendix must be А.',
					application.file,
					application.line,
				),
			);
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

		const labelIndex = APPENDIX_LABELS.indexOf(
			label as (typeof APPENDIX_LABELS)[number],
		);
		if (labelIndex === -1) {
			issues.push(
				issue(
					'application-label-format',
					`application label "${label}" should be a single allowed Russian uppercase letter.`,
					application.file,
					application.line,
					'error',
				),
			);
		} else if (labelIndex !== previousLabelIndex + 1) {
			issues.push(
				issue(
					'application-label-order',
					'applications should follow Russian letter order without going backwards.',
					application.file,
					application.line,
					'error',
				),
			);
		}
		previousLabelIndex = Math.max(previousLabelIndex, labelIndex);

		const labelReferences = references.filter(
			reference => reference.label === label,
		);
		const hasExplicitReferenceBefore = labelReferences.some(
			reference => reference.sourceIndex < application.sourceIndex,
		);
		const firstLateReference = labelReferences.find(
			reference => reference.sourceIndex > application.sourceIndex,
		);
		if (!hasExplicitReferenceBefore && firstLateReference) {
			issues.push(
				issue(
					'application-reference-after-heading',
					`appendix "${label}" must be referenced before its heading.`,
					firstLateReference.file,
					firstLateReference.line,
				),
			);
		}
		const hasLegacyReferenceBefore =
			application.appendixTitle === undefined &&
			new RegExp(`приложени[еяи]\\s+${label}`, 'i').test(
				sourceText.slice(0, application.sourceIndex),
			);
		if (
			!hasExplicitReferenceBefore &&
			!firstLateReference &&
			!hasLegacyReferenceBefore
		) {
			issues.push(
				issue(
					'application-without-reference',
					`application "${application.text}" should be referenced in text before the appendix.`,
					application.file,
					application.line,
					application.appendixTitle === undefined
						? 'warning'
						: 'error',
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

	for (const heading of headings) {
		if (heading.appendixTitle === undefined && heading.text.endsWith('.')) {
			issues.push(
				issue(
					'structural-heading-final-period',
					'structural headings must not end with a period.',
					heading.file,
					heading.line,
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

	const sourceText = files
		.map(({ content }) => createSourceTextContext(content).prose)
		.join('\n');
	validateApplicationHeadings(
		headings,
		sourceText,
		collectAppendixReferences(files),
		issues,
	);
}
