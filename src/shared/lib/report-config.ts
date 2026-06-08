import fs from 'node:fs';
import path from 'node:path';

import { STO_RULES } from '@/shared/config';

export const REPORT_PROFILE_NAMES = ['nir', 'coursework', 'lab'] as const;

export type ReportProfile = (typeof REPORT_PROFILE_NAMES)[number];
export type RequireSourcesMode = boolean | 'when-cited';
export type SoftTextRulesMode = 'warning' | 'off';

export interface ReportDocumentConfig {
	requiredStructuralHeadings: string[];
	optionalStructuralHeadings: string[];
	requireReferat: boolean;
	requireSources: RequireSourcesMode;
}

export interface ReportPreflightConfig {
	strict: boolean;
	softTextRules: SoftTextRulesMode;
}

export interface ReportPostBuildConfig {
	enabled: boolean;
	exportPdf: boolean;
}

export interface ReportValidateConfig {
	enabled: boolean;
	unpackDir: string;
}

export interface ReportConfig {
	profile: ReportProfile;
	profileExplicit: boolean;
	sourceDir: string;
	outputDocx: string;
	document: ReportDocumentConfig;
	preflight: ReportPreflightConfig;
	postBuild: ReportPostBuildConfig;
	validate: ReportValidateConfig;
}

export interface ReportConfigDiagnostic {
	code: string;
	message: string;
	severity: 'error' | 'warning';
	file?: string;
}

export interface ResolveReportConfigOptions {
	cwd?: string;
	outputPath?: string;
	strict?: boolean;
	postBuild?: boolean;
	validate?: boolean;
}

type RawReportDocumentConfig = Partial<ReportDocumentConfig>;
type RawReportPreflightConfig = Partial<ReportPreflightConfig>;
type RawReportPostBuildConfig = Partial<ReportPostBuildConfig>;
type RawReportValidateConfig = Partial<ReportValidateConfig>;

interface RawReportConfig {
	profile?: unknown;
	sourceDir?: unknown;
	outputDocx?: unknown;
	document?: RawReportDocumentConfig;
	preflight?: RawReportPreflightConfig;
	postBuild?: RawReportPostBuildConfig;
	validate?: RawReportValidateConfig;
}

const SOURCES_HEADING = STO_RULES.markdown.sourcesStructuralHeading;
const ABBREVIATIONS_HEADING = 'ОПРЕДЕЛЕНИЯ, ОБОЗНАЧЕНИЯ И СОКРАЩЕНИЯ';
const APPLICATION_HEADING = 'ПРИЛОЖЕНИЕ';
const KNOWN_STRUCTURAL_HEADINGS = new Set([
	...STO_RULES.documentStructure.requiredOrder,
	ABBREVIATIONS_HEADING,
	APPLICATION_HEADING,
]);

const BUILT_IN_PROFILE_DOCUMENT_CONFIGS: Record<
	ReportProfile,
	ReportDocumentConfig
> = {
	nir: {
		requiredStructuralHeadings: [
			'РЕФЕРАТ',
			'СОДЕРЖАНИЕ',
			'ВВЕДЕНИЕ',
			'ЗАКЛЮЧЕНИЕ',
		],
		optionalStructuralHeadings: [ABBREVIATIONS_HEADING, SOURCES_HEADING],
		requireReferat: true,
		requireSources: 'when-cited',
	},
	coursework: {
		requiredStructuralHeadings: [
			'РЕФЕРАТ',
			'СОДЕРЖАНИЕ',
			'ВВЕДЕНИЕ',
			'ЗАКЛЮЧЕНИЕ',
		],
		optionalStructuralHeadings: [ABBREVIATIONS_HEADING, SOURCES_HEADING],
		requireReferat: true,
		requireSources: 'when-cited',
	},
	lab: {
		requiredStructuralHeadings: ['ВВЕДЕНИЕ', 'ЗАКЛЮЧЕНИЕ'],
		optionalStructuralHeadings: ['СОДЕРЖАНИЕ', SOURCES_HEADING],
		requireReferat: false,
		requireSources: 'when-cited',
	},
};

export function isReportProfile(value: unknown): value is ReportProfile {
	return (
		typeof value === 'string' &&
		REPORT_PROFILE_NAMES.includes(value as ReportProfile)
	);
}

export function getReportProfileDocumentConfig(
	profile: ReportProfile,
): ReportDocumentConfig {
	return {
		requiredStructuralHeadings: [
			...BUILT_IN_PROFILE_DOCUMENT_CONFIGS[profile]
				.requiredStructuralHeadings,
		],
		optionalStructuralHeadings: [
			...BUILT_IN_PROFILE_DOCUMENT_CONFIGS[profile]
				.optionalStructuralHeadings,
		],
		requireReferat:
			BUILT_IN_PROFILE_DOCUMENT_CONFIGS[profile].requireReferat,
		requireSources:
			BUILT_IN_PROFILE_DOCUMENT_CONFIGS[profile].requireSources,
	};
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
	return typeof value === 'string' ? value : undefined;
}

function asBoolean(value: unknown): boolean | undefined {
	return typeof value === 'boolean' ? value : undefined;
}

function asStringArray(value: unknown): string[] | undefined {
	return Array.isArray(value) && value.every(item => typeof item === 'string')
		? [...value]
		: undefined;
}

function normalizeHeading(value: string): string {
	return value.trim().toUpperCase();
}

function isKnownStructuralHeading(value: string): boolean {
	const upper = normalizeHeading(value);
	return (
		KNOWN_STRUCTURAL_HEADINGS.has(upper) ||
		/^ПРИЛОЖЕНИЕ(?:\s+[А-ЯA-Z0-9]+)?$/.test(upper)
	);
}

function isPortablePath(value: string): boolean {
	return (
		!path.isAbsolute(value) &&
		!/^[a-zA-Z]:[\\/]/.test(value) &&
		!/^~[\\/]/.test(value)
	);
}

function pushInvalidType(
	diagnostics: ReportConfigDiagnostic[],
	field: string,
	expected: string,
	configPath?: string,
): void {
	diagnostics.push({
		code: 'report-config-invalid-type',
		file: configPath,
		message: `report.config.json field "${field}" must be ${expected}.`,
		severity: 'error',
	});
}

function validatePortablePath(
	diagnostics: ReportConfigDiagnostic[],
	field: string,
	value: unknown,
	configPath?: string,
): void {
	if (typeof value !== 'string' || isPortablePath(value)) {
		return;
	}
	diagnostics.push({
		code: 'report-config-absolute-path',
		file: configPath,
		message: `report.config.json field "${field}" uses an absolute or user-specific path. Use a portable relative path.`,
		severity: 'error',
	});
}

function validateStructuralHeadings(
	diagnostics: ReportConfigDiagnostic[],
	field: string,
	values: readonly string[],
	configPath?: string,
): void {
	for (const heading of values) {
		if (!isKnownStructuralHeading(heading)) {
			diagnostics.push({
				code: 'report-config-unknown-structural-heading',
				file: configPath,
				message: `report.config.json field "${field}" contains unknown structural heading: ${heading}.`,
				severity: 'error',
			});
		}
	}
}

function normalizeRawConfig(
	rawConfig: unknown,
	configPath?: string,
): { config: RawReportConfig; diagnostics: ReportConfigDiagnostic[] } {
	const diagnostics: ReportConfigDiagnostic[] = [];
	if (!isObject(rawConfig)) {
		return {
			config: {},
			diagnostics: [
				{
					code: 'report-config-invalid-root',
					file: configPath,
					message: 'report.config.json root must be a JSON object.',
					severity: 'error',
				},
			],
		};
	}

	const config = rawConfig as RawReportConfig;

	if (config.profile !== undefined && !isReportProfile(config.profile)) {
		diagnostics.push({
			code: 'report-config-unknown-profile',
			file: configPath,
			message: `Unknown report profile "${String(config.profile)}". Supported profiles: ${REPORT_PROFILE_NAMES.join(', ')}.`,
			severity: 'error',
		});
	}

	if (
		config.sourceDir !== undefined &&
		typeof config.sourceDir !== 'string'
	) {
		pushInvalidType(diagnostics, 'sourceDir', 'a string', configPath);
	}
	if (
		config.outputDocx !== undefined &&
		typeof config.outputDocx !== 'string'
	) {
		pushInvalidType(diagnostics, 'outputDocx', 'a string', configPath);
	}
	validatePortablePath(
		diagnostics,
		'sourceDir',
		config.sourceDir,
		configPath,
	);
	validatePortablePath(
		diagnostics,
		'outputDocx',
		config.outputDocx,
		configPath,
	);

	if (config.document !== undefined && !isObject(config.document)) {
		pushInvalidType(diagnostics, 'document', 'an object', configPath);
	}
	if (isObject(config.document)) {
		const document = config.document;
		if (
			document.requiredStructuralHeadings !== undefined &&
			!asStringArray(document.requiredStructuralHeadings)
		) {
			pushInvalidType(
				diagnostics,
				'document.requiredStructuralHeadings',
				'an array of strings',
				configPath,
			);
		}
		if (
			document.optionalStructuralHeadings !== undefined &&
			!asStringArray(document.optionalStructuralHeadings)
		) {
			pushInvalidType(
				diagnostics,
				'document.optionalStructuralHeadings',
				'an array of strings',
				configPath,
			);
		}
		if (
			document.requireReferat !== undefined &&
			typeof document.requireReferat !== 'boolean'
		) {
			pushInvalidType(
				diagnostics,
				'document.requireReferat',
				'a boolean',
				configPath,
			);
		}
		if (
			document.requireSources !== undefined &&
			typeof document.requireSources !== 'boolean' &&
			document.requireSources !== 'when-cited'
		) {
			pushInvalidType(
				diagnostics,
				'document.requireSources',
				'true, false, or "when-cited"',
				configPath,
			);
		}
		const requiredStructuralHeadings = asStringArray(
			document.requiredStructuralHeadings,
		);
		if (requiredStructuralHeadings) {
			validateStructuralHeadings(
				diagnostics,
				'document.requiredStructuralHeadings',
				requiredStructuralHeadings,
				configPath,
			);
		}
		const optionalStructuralHeadings = asStringArray(
			document.optionalStructuralHeadings,
		);
		if (optionalStructuralHeadings) {
			validateStructuralHeadings(
				diagnostics,
				'document.optionalStructuralHeadings',
				optionalStructuralHeadings,
				configPath,
			);
		}
	}

	if (config.preflight !== undefined && !isObject(config.preflight)) {
		pushInvalidType(diagnostics, 'preflight', 'an object', configPath);
	}
	if (isObject(config.preflight)) {
		const preflight = config.preflight;
		if (
			preflight.strict !== undefined &&
			typeof preflight.strict !== 'boolean'
		) {
			pushInvalidType(
				diagnostics,
				'preflight.strict',
				'a boolean',
				configPath,
			);
		}
		if (
			preflight.softTextRules !== undefined &&
			preflight.softTextRules !== 'warning' &&
			preflight.softTextRules !== 'off'
		) {
			pushInvalidType(
				diagnostics,
				'preflight.softTextRules',
				'"warning" or "off"',
				configPath,
			);
		}
	}

	if (config.postBuild !== undefined && !isObject(config.postBuild)) {
		pushInvalidType(diagnostics, 'postBuild', 'an object', configPath);
	}
	if (isObject(config.postBuild)) {
		for (const field of ['enabled', 'exportPdf'] as const) {
			if (
				config.postBuild[field] !== undefined &&
				typeof config.postBuild[field] !== 'boolean'
			) {
				pushInvalidType(
					diagnostics,
					`postBuild.${field}`,
					'a boolean',
					configPath,
				);
			}
		}
	}

	if (config.validate !== undefined && !isObject(config.validate)) {
		pushInvalidType(diagnostics, 'validate', 'an object', configPath);
	}
	if (isObject(config.validate)) {
		if (
			config.validate.enabled !== undefined &&
			typeof config.validate.enabled !== 'boolean'
		) {
			pushInvalidType(
				diagnostics,
				'validate.enabled',
				'a boolean',
				configPath,
			);
		}
		if (
			config.validate.unpackDir !== undefined &&
			typeof config.validate.unpackDir !== 'string'
		) {
			pushInvalidType(
				diagnostics,
				'validate.unpackDir',
				'a string',
				configPath,
			);
		}
		validatePortablePath(
			diagnostics,
			'validate.unpackDir',
			config.validate.unpackDir,
			configPath,
		);
	}

	return { config, diagnostics };
}

function readRawReportConfig(reportDir: string): {
	config: RawReportConfig;
	diagnostics: ReportConfigDiagnostic[];
	path?: string;
} {
	const configPath = path.join(reportDir, 'report.config.json');
	if (!fs.existsSync(configPath)) {
		return { config: {}, diagnostics: [] };
	}

	try {
		return {
			...normalizeRawConfig(
				JSON.parse(fs.readFileSync(configPath, 'utf8')),
				configPath,
			),
			path: configPath,
		};
	} catch (error) {
		return {
			config: {},
			diagnostics: [
				{
					code: 'report-config-invalid-json',
					file: configPath,
					message: `Cannot parse report.config.json: ${error instanceof Error ? error.message : String(error)}.`,
					severity: 'error',
				},
			],
			path: configPath,
		};
	}
}

function mergeDocumentConfig(
	base: ReportDocumentConfig,
	override: RawReportDocumentConfig | undefined,
): ReportDocumentConfig {
	return {
		requiredStructuralHeadings:
			asStringArray(override?.requiredStructuralHeadings) ??
			base.requiredStructuralHeadings,
		optionalStructuralHeadings:
			asStringArray(override?.optionalStructuralHeadings) ??
			base.optionalStructuralHeadings,
		requireReferat:
			asBoolean(override?.requireReferat) ?? base.requireReferat,
		requireSources:
			override?.requireSources === true ||
			override?.requireSources === false ||
			override?.requireSources === 'when-cited'
				? override.requireSources
				: base.requireSources,
	};
}

export function resolveReportConfig(
	reportDir: string,
	options: ResolveReportConfigOptions = {},
): { config: ReportConfig; diagnostics: ReportConfigDiagnostic[] } {
	const cwd = options.cwd ?? process.cwd();
	const absoluteReportDir = path.resolve(cwd, reportDir);
	const rawResult = readRawReportConfig(absoluteReportDir);
	const raw = rawResult.config;
	const rawProfile = raw.profile;
	const profileExplicit = isReportProfile(rawProfile);
	const profile = profileExplicit ? rawProfile : 'nir';
	const reportSlug = path.basename(absoluteReportDir);

	const config: ReportConfig = {
		profile,
		profileExplicit,
		sourceDir: asString(raw.sourceDir) ?? '.',
		outputDocx:
			options.outputPath ??
			asString(raw.outputDocx) ??
			`build/${reportSlug}.docx`,
		document: mergeDocumentConfig(
			getReportProfileDocumentConfig(profile),
			isObject(raw.document) ? raw.document : undefined,
		),
		preflight: {
			strict:
				options.strict ??
				(isObject(raw.preflight)
					? asBoolean(raw.preflight.strict)
					: undefined) ??
				false,
			softTextRules:
				isObject(raw.preflight) &&
				(raw.preflight.softTextRules === 'warning' ||
					raw.preflight.softTextRules === 'off')
					? raw.preflight.softTextRules
					: 'warning',
		},
		postBuild: {
			enabled:
				options.postBuild ??
				(isObject(raw.postBuild)
					? asBoolean(raw.postBuild.enabled)
					: undefined) ??
				false,
			exportPdf:
				(isObject(raw.postBuild)
					? asBoolean(raw.postBuild.exportPdf)
					: undefined) ?? true,
		},
		validate: {
			enabled:
				options.validate ??
				(isObject(raw.validate)
					? asBoolean(raw.validate.enabled)
					: undefined) ??
				false,
			unpackDir:
				(isObject(raw.validate)
					? asString(raw.validate.unpackDir)
					: undefined) ?? '.temp_docx',
		},
	};

	return {
		config,
		diagnostics: rawResult.diagnostics,
	};
}

export function resolveReportPath(reportDir: string, value: string): string {
	return path.isAbsolute(value) ? value : path.resolve(reportDir, value);
}

export function getStructuralHeadingOrder(
	config: ReportDocumentConfig,
): string[] {
	const configured = [
		...new Set([
			...config.requiredStructuralHeadings,
			...config.optionalStructuralHeadings,
			...(config.requireSources === false ? [] : [SOURCES_HEADING]),
		]),
	];
	const standardOrder = [
		...STO_RULES.documentStructure.requiredOrder,
		ABBREVIATIONS_HEADING,
		APPLICATION_HEADING,
	];
	const ordered = standardOrder.filter(heading =>
		configured.map(normalizeHeading).includes(heading),
	);
	const remaining = configured
		.map(normalizeHeading)
		.filter(heading => !ordered.includes(heading));
	return [...ordered, ...remaining];
}
