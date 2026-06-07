import { ReportConfig } from '../report-config';

export type SourcePreflightSeverity = 'error' | 'warning';

export interface SourcePreflightIssue {
	code: string;
	file?: string;
	line?: number;
	message: string;
	severity: SourcePreflightSeverity;
}

export interface SourcePreflightResult {
	reportDir: string;
	sourceDir: string;
	issues: SourcePreflightIssue[];
	passed: boolean;
	config: ReportConfig;
}

export interface SourcePreflightOptions {
	cwd?: string;
	strict?: boolean;
	config?: ReportConfig;
}

export interface SourceFile {
	file: string;
	content: string;
}

export interface LabelDefinition {
	file: string;
	line: number;
	kind: 'fig' | 'tab' | 'eq';
}

export type LabelDefinitions = Map<string, LabelDefinition>;
