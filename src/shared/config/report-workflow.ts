export type SoftTextRulesMode = 'warning' | 'off';
export type WordPdfImageQuality = 'original' | 'print' | 'screen';

export interface ReportPreflightConfig {
	strict: boolean;
	softTextRules: SoftTextRulesMode;
}
export interface ReportPostBuildConfig {
	enabled: boolean;
	exportPdf: boolean;
	pdfImageQuality?: WordPdfImageQuality;
}
export interface ReportValidateConfig {
	enabled: boolean;
	unpackDir: string;
}

export function resolveWordPdfQuality(
	override: string | undefined,
	postBuild: unknown,
): { pdfImageQuality?: WordPdfImageQuality } {
	const configured =
		typeof postBuild === 'object' &&
		postBuild !== null &&
		'pdfImageQuality' in postBuild
			? postBuild.pdfImageQuality
			: undefined;
	const quality = override ?? configured;
	if (quality === undefined) return {};
	if (quality !== 'original' && quality !== 'print' && quality !== 'screen') {
		throw new Error(
			'Word PDF image quality must be original, print or screen.',
		);
	}
	return { pdfImageQuality: quality };
}
