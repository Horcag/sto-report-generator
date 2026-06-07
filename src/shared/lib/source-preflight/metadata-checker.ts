import matter from 'gray-matter';

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

export function validateMetadata(
	files: SourceFile[],
	issues: SourcePreflightIssue[],
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
}
