import matter from 'gray-matter';

import { ReportMetadata } from '@/entities/report';

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
