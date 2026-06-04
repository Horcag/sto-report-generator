import fs from 'node:fs';
import path from 'node:path';

import { unpackDocx } from '../src/shared/lib/docx-archive';
import { validateSTO } from '../src/shared/lib/sto-validator';

const brokenDir = path.join(__dirname, 'fixtures', 'validator', 'broken');
const tempRoot = path.join(process.cwd(), '.agent-work', 'validator-tests');

function normalizeOutput(output: string): string[] {
	return output
		.split('\n')
		.map(line => line.trim())
		.filter(line => line.length > 0)
		.sort((left, right) => left.localeCompare(right));
}

function formatValidatorOutput(unpackedDir: string): string {
	return validateSTO(unpackedDir)
		.filter(result => !result.passed)
		.map(result => `${result.check}: ${result.error ?? 'failed'}`)
		.join('\n');
}

function expectedPathFor(docxFile: string): string | null {
	const expectedPath = path.join(
		brokenDir,
		docxFile.replace('.docx', '.expected.txt'),
	);
	const fallbackExpectedPath = path.join(brokenDir, 'broken.expected.txt');
	if (fs.existsSync(expectedPath)) {
		return expectedPath;
	}
	return fs.existsSync(fallbackExpectedPath) ? fallbackExpectedPath : null;
}

function compareWithExpected(file: string, actualOutput: string): boolean {
	const finalExpectedPath = expectedPathFor(file);
	if (!finalExpectedPath) {
		console.log(`Warning: No expected.txt found for ${file}.`);
		console.log('Actual output was:');
		console.log(actualOutput);
		return true;
	}

	const expectedOutput = fs.readFileSync(finalExpectedPath, 'utf-8').trim();
	const actualLines = normalizeOutput(actualOutput);
	const expectedLines = normalizeOutput(expectedOutput);
	const isMatch =
		actualLines.length === expectedLines.length &&
		actualLines.every((line, index) => line === expectedLines[index]);

	if (!isMatch) {
		console.log(`\nExpected Output (${expectedLines.length} errors):`);
		console.log(expectedLines.join('\n'));
		console.log(`\nActual Output (${actualLines.length} errors):`);
		console.log(actualLines.join('\n'));
		console.log('\n---\n');
	}
	return isMatch;
}

function runTests(): void {
	console.log('Running STO Validator E2E Tests...\n');
	let passed = 0;
	let failed = 0;

	if (!fs.existsSync(brokenDir)) {
		console.log(`Directory ${brokenDir} does not exist. Skipping tests.`);
		return;
	}

	fs.mkdirSync(tempRoot, { recursive: true });
	const docxFiles = fs
		.readdirSync(brokenDir)
		.filter(file => file.endsWith('.docx') && !file.startsWith('~$'))
		.sort((left, right) => left.localeCompare(right));

	if (docxFiles.length === 0) {
		throw new Error('No broken .docx files found to test.');
	}

	for (const file of docxFiles) {
		console.log(`Testing: ${file}`);
		const docxPath = path.join(brokenDir, file);
		const unpackedDir = path.join(tempRoot, path.basename(file, '.docx'));
		unpackDocx(docxPath, unpackedDir);
		const actualOutput = formatValidatorOutput(unpackedDir).trim();

		if (compareWithExpected(file, actualOutput)) {
			console.log('PASSED\n');
			passed++;
		} else {
			console.log('FAILED\n');
			failed++;
		}
	}

	console.log(`\nTest Summary: ${passed} passed, ${failed} failed.`);
	if (failed > 0) {
		process.exit(1);
	}
}

runTests();
