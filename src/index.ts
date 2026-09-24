import { buildReport } from '@/app/builder';
import { runDoctor } from '@/app/doctor';
import { createLibreOfficePreview } from '@/app/libreoffice-preview';
import { scaffoldReport } from '@/app/report-scaffold';
import { generateReport, validateDocxFile } from '@/app/report-workflow';
import { runWordAcceptance } from '@/app/word-acceptance';
import { isStoStylePreset, StoStylePreset } from '@/shared/config';
import {
	isReportProfile,
	isReportRenderer,
	REPORT_PROFILE_NAMES,
	REPORT_RENDERERS,
	ReportProfile,
	ReportRenderer,
} from '@/shared/lib/report-config';
import {
	formatSourcePreflightIssue,
	runSourcePreflight,
} from '@/shared/lib/source-preflight';

interface ParsedArgs {
	positionals: string[];
	options: Map<string, string | boolean>;
}

const COMMANDS = new Set([
	'build',
	'new',
	'check',
	'generate',
	'audit',
	'preview',
	'accept-word',
	'validate-docx',
	'doctor',
	'help',
]);

function parseArgs(args: string[]): ParsedArgs {
	const positionals: string[] = [];
	const options = new Map<string, string | boolean>();

	for (let index = 0; index < args.length; index++) {
		const arg = args[index];
		if (!arg.startsWith('--')) {
			positionals.push(arg);
			continue;
		}

		const [rawName, inlineValue] = arg.slice(2).split('=', 2);
		if (inlineValue !== undefined) {
			options.set(rawName, inlineValue);
			continue;
		}

		const next = args[index + 1];
		if (next && !next.startsWith('--')) {
			options.set(rawName, next);
			index++;
		} else {
			options.set(rawName, true);
		}
	}

	return { positionals, options };
}

function optionString(args: ParsedArgs, name: string): string | undefined {
	const value = args.options.get(name);
	return typeof value === 'string' ? value : undefined;
}

function optionBoolean(args: ParsedArgs, name: string): boolean | undefined {
	if (!args.options.has(name)) {
		return undefined;
	}
	return args.options.get(name) !== false;
}

function optionNumber(args: ParsedArgs, name: string): number | undefined {
	const value = optionString(args, name);
	if (value === undefined) {
		return undefined;
	}
	const numberValue = Number(value);
	if (!Number.isFinite(numberValue)) {
		throw new Error(`--${name} must be a number.`);
	}
	return numberValue;
}

function optionProfile(args: ParsedArgs): ReportProfile | undefined {
	const value = optionString(args, 'profile');
	if (value === undefined) {
		return undefined;
	}
	if (!isReportProfile(value)) {
		throw new Error(
			`Supported profiles: ${REPORT_PROFILE_NAMES.join(', ')}.`,
		);
	}
	return value;
}

function optionRenderer(args: ParsedArgs): ReportRenderer | undefined {
	const value = optionString(args, 'renderer');
	if (value === undefined) {
		return undefined;
	}
	if (!isReportRenderer(value)) {
		throw new Error(`Supported renderers: ${REPORT_RENDERERS.join(', ')}.`);
	}
	return value;
}

function optionStylePreset(args: ParsedArgs): StoStylePreset | undefined {
	const value = optionString(args, 'style-preset');
	if (value === undefined) {
		return undefined;
	}
	if (!isStoStylePreset(value)) {
		throw new Error(
			'Supported style presets: samara-template-2022, default.',
		);
	}
	return value;
}

function printHelp(): void {
	console.log(`STO Report Generator

Usage:
  npx tsx src/index.ts build <input.md|report_dir> <output.docx>
  npx tsx src/index.ts new <slug> --profile nir|coursework|lab|vkr-bachelor|vkr-master [--title "..."] [--dir reports/<slug>] [--no-git]
  npx tsx src/index.ts check <report_dir> [--strict]
  npx tsx src/index.ts generate <report_dir> [--output build/report.docx] [--renderer portable|word] [--post-build] [--validate]
  npx tsx src/index.ts audit <report_dir> [--output build/report.docx] [--renderer portable|word]
  npx tsx src/index.ts preview <input.docx> [--pdf preview.pdf] [--soffice /path/to/soffice]
  npx tsx src/index.ts accept-word <input.docx> [--accepted-docx accepted.docx] [--pdf accepted.pdf] [--manifest acceptance.json] [--style-preset samara-template-2022|default]
  npx tsx src/index.ts validate-docx <report.docx> [unpack_dir]
  npx tsx src/index.ts doctor

Backward-compatible form still works:
  npx tsx src/index.ts <input.md|report_dir> <output.docx>`);
}

async function runBuild(args: ParsedArgs): Promise<void> {
	const inputPath = args.positionals[1];
	const outputPath = args.positionals[2] ?? 'test_report.docx';
	if (!inputPath) {
		throw new Error('build command requires an input path.');
	}
	await buildReport(inputPath, outputPath);
}

function runNew(args: ParsedArgs): void {
	const slug = args.positionals[1];
	if (!slug) {
		throw new Error('new command requires a report slug.');
	}

	const result = scaffoldReport({
		slug,
		dir: optionString(args, 'dir'),
		profile: optionProfile(args),
		title: optionString(args, 'title'),
		reportType: optionString(args, 'type'),
		department: optionString(args, 'department'),
		subdepartment: optionString(args, 'subdepartment'),
		specialtyCode: optionString(args, 'specialty-code'),
		specialtyName: optionString(args, 'specialty-name'),
		profileName: optionString(args, 'profile-name'),
		semester: optionNumber(args, 'semester'),
		year: optionNumber(args, 'year'),
		studentName: optionString(args, 'student'),
		groupNumber: optionString(args, 'group'),
		supervisorName: optionString(args, 'supervisor'),
		hideSignatures: optionBoolean(args, 'hide-signatures'),
		initGit: !args.options.has('no-git'),
	});

	console.log(`Report scaffold created at ${result.targetDir}`);
	console.log(`Files: ${result.files.join(', ')}`);
	console.log(
		`Local git: ${result.gitInitialized ? 'initialized' : 'skipped'}`,
	);
}

function runCheck(args: ParsedArgs): void {
	const reportDir = args.positionals[1];
	if (!reportDir) {
		throw new Error('check command requires a report directory.');
	}

	const result = runSourcePreflight(reportDir, {
		strict: optionBoolean(args, 'strict') ?? false,
	});
	if (!result.passed) {
		throw new Error(
			result.issues.map(formatSourcePreflightIssue).join('\n'),
		);
	}
	const warnings = result.issues.filter(item => item.severity === 'warning');
	for (const warning of warnings) {
		console.warn(formatSourcePreflightIssue(warning));
	}
	console.log(
		warnings.length > 0
			? `Source preflight passed with ${warnings.length} warning(s).`
			: 'Source preflight passed.',
	);
}

async function runGenerate(args: ParsedArgs): Promise<void> {
	const reportDir = args.positionals[1];
	if (!reportDir) {
		throw new Error('generate command requires a report directory.');
	}
	const renderer = optionRenderer(args);
	const postBuild = optionBoolean(args, 'post-build');
	if (renderer === 'portable' && postBuild === true) {
		throw new Error(
			'--post-build is the legacy Word COM renderer path. Use --renderer word for Word/PDF post-build, or omit --post-build for --renderer portable.',
		);
	}

	const result = await generateReport({
		reportDir,
		outputPath: optionString(args, 'output'),
		renderer,
		postBuild,
		validate: optionBoolean(args, 'validate'),
	});

	console.log(`Generated ${result.outputDocx}`);
	console.log(`Renderer: ${result.renderer}`);
	console.log(`Post-build: ${result.postBuildRan ? 'ran' : 'skipped'}`);
	if (result.renderer === 'portable') {
		console.log('PDF pagination: not authoritative in portable renderer.');
	}
	if (result.validation) {
		console.log('DOCX validation passed.');
	}
}

async function runAudit(args: ParsedArgs): Promise<void> {
	const reportDir = args.positionals[1];
	if (!reportDir) {
		throw new Error('audit command requires a report directory.');
	}
	const renderer = optionRenderer(args) ?? 'portable';

	const result = await generateReport({
		reportDir,
		outputPath: optionString(args, 'output'),
		renderer,
		validate: true,
	});
	const warnings = result.preflight.issues.filter(
		item => item.severity === 'warning',
	);
	for (const warning of warnings) {
		console.warn(formatSourcePreflightIssue(warning));
	}
	console.log(`Audit generated ${result.outputDocx}`);
	console.log(
		warnings.length > 0
			? `Source preflight passed with ${warnings.length} warning(s).`
			: 'Source preflight passed.',
	);
	console.log(`Renderer: ${result.renderer}`);
	console.log(`Post-build: ${result.postBuildRan ? 'ran' : 'skipped'}`);
	console.log('DOCX validation passed.');
}

function runAcceptWord(args: ParsedArgs): void {
	const inputDocx = args.positionals[1];
	if (!inputDocx) {
		throw new Error('accept-word command requires an input DOCX path.');
	}
	runWordAcceptance({
		inputDocx,
		acceptedDocx: optionString(args, 'accepted-docx'),
		pdf: optionString(args, 'pdf'),
		manifest: optionString(args, 'manifest'),
		stylePreset: optionStylePreset(args),
	});
}

function runPreview(args: ParsedArgs): void {
	const inputDocx = args.positionals[1];
	if (!inputDocx) {
		throw new Error('preview command requires an input DOCX path.');
	}
	const pdf = createLibreOfficePreview({
		inputDocx,
		outputPdf: optionString(args, 'pdf'),
		soffice: optionString(args, 'soffice'),
	});
	console.log(`LibreOffice preview: ${pdf}`);
	console.log(
		'Pagination is not authoritative; use accept-word for final Word/PDF acceptance.',
	);
}

function runValidateDocx(args: ParsedArgs): void {
	const docxPath = args.positionals[1];
	const unpackDir =
		args.positionals[2] ?? '.agent-work/validate-docx-unpacked';
	if (!docxPath) {
		throw new Error('validate-docx command requires a DOCX path.');
	}

	const results = validateDocxFile(docxPath, unpackDir);
	console.table(results);
	if (!results.every(result => result.passed)) {
		process.exit(1);
	}
}

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));
	const commandOrInput = args.positionals[0];
	if (
		!commandOrInput ||
		commandOrInput === 'help' ||
		args.options.has('help')
	) {
		printHelp();
		return;
	}

	if (!COMMANDS.has(commandOrInput)) {
		await buildReport(
			commandOrInput,
			args.positionals[1] ?? 'test_report.docx',
		);
		return;
	}

	switch (commandOrInput) {
		case 'build':
			await runBuild(args);
			break;
		case 'new':
			runNew(args);
			break;
		case 'check':
			runCheck(args);
			break;
		case 'generate':
			await runGenerate(args);
			break;
		case 'audit':
			await runAudit(args);
			break;
		case 'accept-word':
			runAcceptWord(args);
			break;
		case 'preview':
			runPreview(args);
			break;
		case 'validate-docx':
			runValidateDocx(args);
			break;
		case 'doctor':
			runDoctor();
			break;
	}
}

main().catch(error => {
	console.error(error instanceof Error ? error.message : error);
	process.exit(1);
});
