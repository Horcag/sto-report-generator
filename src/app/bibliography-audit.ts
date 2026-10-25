import fs from 'node:fs';
import path from 'node:path';

import { formatBibItem } from '@/features/markdown-parser';
import {
	resolveReportConfig,
	resolveReportPath,
} from '@/shared/lib/report-config';
import {
	BIBLIOGRAPHY_EVIDENCE_FILE,
	bibliographyEntryHash,
	bibliographyPathFromMetadata,
	collectAllCitationKeys,
	readBibEntrySources,
	SourcePreflightIssue,
	validateBibliography,
} from '@/shared/lib/source-preflight';

export function auditBibliography(reportDir: string, requireEvidence = false) {
	const absoluteDir = path.resolve(reportDir);
	const resolved = resolveReportConfig(absoluteDir);
	const sourceDir = resolveReportPath(absoluteDir, resolved.config.sourceDir);
	const files = fs
		.readdirSync(sourceDir)
		.filter(
			file => file.endsWith('.md') && file.toLowerCase() !== 'readme.md',
		)
		.sort((a, b) => a.localeCompare(b))
		.map(file => ({
			file,
			content: fs.readFileSync(path.join(sourceDir, file), 'utf8'),
		}));
	const issues: SourcePreflightIssue[] = [...resolved.diagnostics];
	validateBibliography(
		files,
		sourceDir,
		process.cwd(),
		resolved.config,
		issues,
		requireEvidence,
	);
	const citationKeys = collectAllCitationKeys(files);
	let entries: ReturnType<typeof readBibEntrySources> = [];
	let bibPath: string | undefined;
	try {
		bibPath = bibliographyPathFromMetadata(files, sourceDir, process.cwd());
		if (fs.existsSync(bibPath)) entries = readBibEntrySources(bibPath);
	} catch {
		// The validator already reports parse/path failures with source locations.
	}
	const inventory = citationKeys.flatMap(key =>
		entries
			.filter(entry => entry.key === key)
			.map(entry => {
				let formatted: string | undefined;
				try {
					formatted = formatBibItem({
						citationKey: key,
						entryType: entry.entryType,
						entryTags: Object.fromEntries(
							Object.entries(entry.tags).map(([field, value]) => [
								field,
								value ?? '',
							]),
						),
					});
				} catch (error) {
					issues.push({
						code: 'bibliography-description-invalid',
						file: path.basename(bibPath!),
						line: entry.line,
						message: String(error),
						severity: 'error',
					});
				}
				return {
					key,
					type: entry.entryType,
					fields: entry.tags,
					formatted,
					entryHash: bibliographyEntryHash(entry),
					searchQueries: [
						`"${(entry.tags.title ?? '').replace(/[{}]/g, '')}" publisher bibliographic metadata`,
						`"${(entry.tags.title ?? '').replace(/[{}]/g, '')}" DOI Crossref`,
					],
				};
			}),
	);
	return {
		passed: issues.length === 0,
		citationOrder: citationKeys,
		evidenceFile: bibPath
			? path.join(path.dirname(bibPath), BIBLIOGRAPHY_EVIDENCE_FILE)
			: undefined,
		issues,
		entries: inventory,
	};
}
