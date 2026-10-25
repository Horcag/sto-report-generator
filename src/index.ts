import { runBibliographyCommand } from '@/app/bibliography-command';
import { buildReport } from '@/app/builder';
import {
	optionBoolean,
	optionNumber,
	optionString,
	parseArgs,
	ParsedArgs,
} from '@/app/cli-args';
import { printHelp } from '@/app/cli-help';
import { printWordcraftResult, runPreview } from '@/app/cli-preview';
import { runDoctor } from '@/app/doctor';
import { runFigureCommand } from '@/app/figure-command';
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

const COMMANDS = new Set([
	'build',
	'new',
	'check',
	'bibliography',
	'generate',
	'audit',
	'preview',
	'accept-word',
	'validate-docx',
	'doctor',
	'figures',
	'help',
]);

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
		strict: optionBoolean(args, 'strict'),
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
	console.log(
		'Editorial step: review Russian prose with humanizer-ru before final build (docs/report-authoring.md).',
	);
}

async function runGenerate(args: ParsedArgs): Promise<void> {
	const reportDir = args.positionals[1];
	if (!reportDir) {
		throw new Error('generate command requires a report directory.');
	}
	const renderer = optionRenderer(args);
	const postBuild = optionBoolean(args, 'post-build');
	if (renderer && renderer !== 'word' && postBuild === true) {
		throw new Error(
			'--post-build is the legacy Word COM renderer path. Use --renderer word for Word/PDF post-build, or omit --post-build for portable/wordcraft.',
		);
	}

	const result = await generateReport({
		reportDir,
		outputPath: optionString(args, 'output'),
		renderer,
		postBuild,
		validate: optionBoolean(args, 'validate'),
		outputPdf: optionString(args, 'pdf'),
		wordcraftExecutable: optionString(args, 'wordcraft'),
		wordcraftFontDirectory: optionString(args, 'font-dir'),
		strictFonts: optionBoolean(args, 'strict-fonts'),
	});

	console.log(`Generated ${result.outputDocx}`);
	console.log(`Renderer: ${result.renderer}`);
	console.log(`Post-build: ${result.postBuildRan ? 'ran' : 'skipped'}`);
	if (result.wordcraft) printWordcraftResult(result.wordcraft);
	if (result.renderer === 'portable') {
		console.log('PDF pagination: not authoritative in portable renderer.');
	}
	if (result.validation) {
		console.log('DOCX validation passed.');
	}
	console.log(
		'Editorial step: review Russian prose with humanizer-ru before submission (docs/report-authoring.md).',
	);
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
		outputPdf: optionString(args, 'pdf'),
		wordcraftExecutable: optionString(args, 'wordcraft'),
		wordcraftFontDirectory: optionString(args, 'font-dir'),
		strictFonts: optionBoolean(args, 'strict-fonts'),
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
	if (result.wordcraft) printWordcraftResult(result.wordcraft);
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
		backgroundOnly: optionBoolean(args, 'background-only'),
		stylePreset: optionStylePreset(args),
	});
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
		case 'bibliography':
			runBibliographyCommand(args);
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
			runPreview({
				inputDocx: args.positionals[1],
				renderer: optionString(args, 'renderer'),
				pdf: optionString(args, 'pdf'),
				soffice: optionString(args, 'soffice'),
				wordcraft: optionString(args, 'wordcraft'),
				fontDirectory: optionString(args, 'font-dir'),
				strictFonts: optionBoolean(args, 'strict-fonts'),
			});
			break;
		case 'validate-docx':
			runValidateDocx(args);
			break;
		case 'doctor':
			runDoctor();
			break;
		case 'figures':
			runFigureCommand(args);
			break;
	}
}

main().catch(error => {
	console.error(error instanceof Error ? error.message : error);
	process.exit(1);
});
