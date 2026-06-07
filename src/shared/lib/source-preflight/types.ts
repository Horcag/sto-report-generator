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
	issues: SourcePreflightIssue[];
	passed: boolean;
}

export interface SourcePreflightOptions {
	cwd?: string;
	strict?: boolean;
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
