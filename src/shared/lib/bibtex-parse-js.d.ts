declare module '@orcid/bibtex-parse-js' {
	interface BibtexEntry {
		citationKey: string;
		entryType: string;
		entryTags: Record<string, string | undefined>;
	}

	export function toJSON(input: string): BibtexEntry[];
}
