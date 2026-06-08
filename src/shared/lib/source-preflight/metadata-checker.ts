import matter from 'gray-matter';

import { ReportConfig, ReportProfile } from '../report-config';
import { SourceFile, SourcePreflightIssue } from './types';
import { issue } from './utils';

const REQUIRED_METADATA_FIELDS = [
	'department',
	'subdepartment',
	'reportType',
	'degree',
	'semester',
	'specialtyCode',
	'specialtyName',
	'profileName',
	'studentName',
	'groupNumber',
	'topic',
	'supervisorName',
	'supervisorTitle',
	'city',
	'year',
] as const;

const PLACEHOLDER_PATTERNS = [
	/Фамилия Имя Отчество/i,
	/Название темы/i,
	/^0{3,}/,
	/\.\.\./,
];

const PROFILE_TITLE_PAGE_EXPECTATIONS: Record<
	ReportProfile,
	{
		reportType: RegExp;
		topicPrefix?: RegExp;
		degree?: RegExp;
	}
> = {
	nir: {
		reportType: /(?:научно-исследовательск|НИР)/i,
		topicPrefix: /научно-исследовательск/i,
		degree: /(?:бакалавр|магистр|специалист|аспирант)/i,
	},
	coursework: {
		reportType: /курсов/i,
		topicPrefix: /курсов/i,
		degree: /дисциплин/i,
	},
	lab: {
		reportType: /лабораторн/i,
		topicPrefix: /лабораторн/i,
		degree: /дисциплин/i,
	},
};

const SPECIALTY_CODE_PATTERN = /^\d{2}\.\d{2}\.\d{2}$/;

function readFirstFrontmatter(files: SourceFile[]): {
	file: string;
	data: Record<string, unknown>;
} | null {
	for (const source of files) {
		const parsed = matter(source.content);
		if (Object.keys(parsed.data).length > 0) {
			return {
				file: source.file,
				data: parsed.data as Record<string, unknown>,
			};
		}
	}
	return null;
}

function getStringField(
	data: Record<string, unknown>,
	field: string,
): string | undefined {
	const value = data[field];
	return typeof value === 'string' ? value.trim() : undefined;
}

function pushMetadataWarning(
	issues: SourcePreflightIssue[],
	code: string,
	message: string,
	file: string,
): void {
	issues.push(issue(code, message, file, undefined, 'warning'));
}

function validateProfileTitlePageMetadata(
	metadata: { file: string; data: Record<string, unknown> },
	config: ReportConfig,
	issues: SourcePreflightIssue[],
): void {
	if (!config.profileExplicit) {
		return;
	}

	const expectations = PROFILE_TITLE_PAGE_EXPECTATIONS[config.profile];
	const reportType = getStringField(metadata.data, 'reportType');
	if (reportType && !expectations.reportType.test(reportType)) {
		pushMetadataWarning(
			issues,
			'metadata-profile-report-type-mismatch',
			`metadata reportType "${reportType}" does not look compatible with profile "${config.profile}".`,
			metadata.file,
		);
	}

	const topicPrefix = getStringField(metadata.data, 'topicPrefix');
	if (
		topicPrefix &&
		expectations.topicPrefix &&
		!expectations.topicPrefix.test(topicPrefix)
	) {
		pushMetadataWarning(
			issues,
			'metadata-profile-topic-prefix-mismatch',
			`metadata topicPrefix "${topicPrefix}" does not look compatible with profile "${config.profile}".`,
			metadata.file,
		);
	}

	const degree = getStringField(metadata.data, 'degree');
	if (degree && expectations.degree && !expectations.degree.test(degree)) {
		pushMetadataWarning(
			issues,
			'metadata-profile-degree-mismatch',
			`metadata degree "${degree}" does not look compatible with profile "${config.profile}".`,
			metadata.file,
		);
	}
}

export function validateMetadata(
	files: SourceFile[],
	issues: SourcePreflightIssue[],
	config: ReportConfig,
): void {
	const metadata = readFirstFrontmatter(files);
	if (!metadata) {
		issues.push(
			issue(
				'metadata-frontmatter-missing',
				'no YAML frontmatter found. The title page requires report metadata.',
				undefined,
				undefined,
				'warning',
			),
		);
		return;
	}

	for (const field of REQUIRED_METADATA_FIELDS) {
		if (metadata.data[field] === undefined || metadata.data[field] === '') {
			issues.push(
				issue(
					'metadata-field-missing',
					`metadata field "${field}" is missing or empty. The title page may be incomplete.`,
					metadata.file,
					undefined,
					'warning',
				),
			);
		}
	}

	for (const field of ['semester', 'year'] as const) {
		const value = metadata.data[field];
		if (value !== undefined && typeof value !== 'number') {
			issues.push(
				issue(
					'metadata-field-invalid-type',
					`metadata field "${field}" must be a number.`,
					metadata.file,
				),
			);
		}
	}

	const semester = metadata.data.semester;
	if (
		typeof semester === 'number' &&
		(!Number.isInteger(semester) || semester < 1 || semester > 12)
	) {
		pushMetadataWarning(
			issues,
			'metadata-semester-out-of-range',
			'metadata field "semester" should be an integer from 1 to 12.',
			metadata.file,
		);
	}

	const year = metadata.data.year;
	if (
		typeof year === 'number' &&
		(!Number.isInteger(year) || year < 2000 || year > 2100)
	) {
		pushMetadataWarning(
			issues,
			'metadata-year-out-of-range',
			'metadata field "year" should be a realistic four-digit year.',
			metadata.file,
		);
	}

	const specialtyCode = getStringField(metadata.data, 'specialtyCode');
	if (specialtyCode && !SPECIALTY_CODE_PATTERN.test(specialtyCode)) {
		pushMetadataWarning(
			issues,
			'metadata-specialty-code-format',
			'metadata field "specialtyCode" should look like "01.03.02".',
			metadata.file,
		);
	}

	const hideSignatures = metadata.data.hideSignatures;
	if (hideSignatures !== undefined && typeof hideSignatures !== 'boolean') {
		issues.push(
			issue(
				'metadata-field-invalid-type',
				'metadata field "hideSignatures" must be a boolean.',
				metadata.file,
			),
		);
	}

	for (const field of [
		'studentName',
		'groupNumber',
		'topic',
		'supervisorName',
	] as const) {
		const value = metadata.data[field];
		if (
			typeof value === 'string' &&
			PLACEHOLDER_PATTERNS.some(pattern => pattern.test(value))
		) {
			issues.push(
				issue(
					'metadata-placeholder-value',
					`metadata field "${field}" still looks like a template placeholder.`,
					metadata.file,
					undefined,
					'warning',
				),
			);
		}
	}

	validateProfileTitlePageMetadata(metadata, config, issues);
}
