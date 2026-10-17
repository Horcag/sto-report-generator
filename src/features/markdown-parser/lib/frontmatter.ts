import { ReportMetadata } from '@/entities/report';
import { parseReportFrontmatter as matter } from '@/shared/lib/frontmatter';

export interface ParsedMarkdown {
	metadata: ReportMetadata;
	content: string;
}

export function parseFrontmatter(
	markdownWithFrontmatter: string,
): ParsedMarkdown {
	const { data, content } = matter(markdownWithFrontmatter);

	return {
		metadata: data as ReportMetadata,
		content: content.trim(),
	};
}
