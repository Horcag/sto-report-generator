import { buildReport } from '@/app/builder';
import { scaffoldReport } from '@/app/report-scaffold';
import { generateReport, validateDocxFile } from '@/app/report-workflow';
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
	'validate-docx',
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

function printHelp(): void {
	console.log(`STO Report Generator

Usage:
  npx tsx src/index.ts build <input.md|report_dir> <output.docx>
  npx tsx src/index.ts new <slug> [--title "..."] [--dir reports/<slug>] [--no-git]
  npx tsx src/index.ts check <report_dir>
  npx tsx src/index.ts generate <report_dir> [--output build/report.docx] [--post-build] [--validate]
  npx tsx src/index.ts validate-docx <report.docx> [unpack_dir]

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
		title: optionString(args, 'title'),
		reportType: optionString(args, 'type'),
		studentName: optionString(args, 'student'),
		groupNumber: optionString(args, 'group'),
		supervisorName: optionString(args, 'supervisor'),
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

	const result = runSourcePreflight(reportDir);
	if (!result.passed) {
		throw new Error(
			result.issues.map(formatSourcePreflightIssue).join('\n'),
		);
	}
	console.log('Source preflight passed.');
}

async function runGenerate(args: ParsedArgs): Promise<void> {
	const reportDir = args.positionals[1];
	if (!reportDir) {
		throw new Error('generate command requires a report directory.');
	}

	const result = await generateReport({
		reportDir,
		outputPath: optionString(args, 'output'),
		postBuild: optionBoolean(args, 'post-build'),
		validate: optionBoolean(args, 'validate'),
	});

	console.log(`Generated ${result.outputDocx}`);
	console.log(`Post-build: ${result.postBuildRan ? 'ran' : 'skipped'}`);
	if (result.validation) {
		console.log('DOCX validation passed.');
	}
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
		case 'validate-docx':
			runValidateDocx(args);
			break;
	}
}

main().catch(error => {
	console.error(error instanceof Error ? error.message : error);
	process.exit(1);
});
