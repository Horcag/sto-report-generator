import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const brokenDir = path.join(__dirname, 'fixtures', 'validator', 'broken');
const validatorScript = path.join(
	__dirname,
	'..',
	'src',
	'validator',
	'sto_validator.py',
);

function runTests() {
	console.log('Running STO Validator E2E Tests...\n');
	let passed = 0;
	let failed = 0;

	if (!fs.existsSync(brokenDir)) {
		console.log(`Directory ${brokenDir} does not exist. Skipping tests.`);
		return;
	}

	const files = fs.readdirSync(brokenDir);
	const docxFiles = files.filter(
		f => f.endsWith('.docx') && !f.startsWith('~$'),
	);

	if (docxFiles.length === 0) {
		console.log('No broken .docx files found to test.');
		return;
	}

	for (const file of docxFiles) {
		const docxPath = path.join(brokenDir, file);
		const expectedPath = path.join(
			brokenDir,
			file.replace('.docx', '.expected.txt'),
		);

		// Use broken.expected.txt if the specific one doesn't exist (based on user's current naming)
		const fallbackExpectedPath = path.join(
			brokenDir,
			'broken.expected.txt',
		);
		const finalExpectedPath = fs.existsSync(expectedPath)
			? expectedPath
			: fs.existsSync(fallbackExpectedPath)
				? fallbackExpectedPath
				: null;

		console.log(`Testing: ${file}`);

		let actualOutput = '';
		try {
			// Using uv to run python to ensure dependencies like lxml are available
			actualOutput = execSync(
				`uv run --with lxml python "${validatorScript}" "${docxPath}"`,
				{ encoding: 'utf-8' },
			).trim();
		} catch (error: any) {
			actualOutput = (error.stdout || '').toString().trim();
			// It's okay if it exits with 0 or 1, we just want the output
		}

		if (!finalExpectedPath) {
			console.log(
				`⚠️  Warning: No expected.txt found for ${file}. Skipping comparison.`,
			);
			console.log('Actual output was:');
			console.log(actualOutput);
			console.log('---');
			continue;
		}

		const expectedOutput = fs
			.readFileSync(finalExpectedPath, 'utf-8')
			.trim();

		// Simple line-by-line comparison, ignoring trailing spaces
		const actualLines = actualOutput
			.split('\n')
			.map(l => l.trim())
			.filter(l => l.length > 0)
			.sort();
		const expectedLines = expectedOutput
			.split('\n')
			.map(l => l.trim())
			.filter(l => l.length > 0)
			.sort();

		let isMatch = actualLines.length === expectedLines.length;
		if (isMatch) {
			for (let i = 0; i < actualLines.length; i++) {
				if (actualLines[i] !== expectedLines[i]) {
					isMatch = false;
					break;
				}
			}
		}

		if (isMatch) {
			console.log(`✅ PASSED\n`);
			passed++;
		} else {
			console.log(`❌ FAILED`);
			console.log(`\nExpected Output (${expectedLines.length} errors):`);
			console.log(expectedLines.join('\n'));
			console.log(`\nActual Output (${actualLines.length} errors):`);
			console.log(actualLines.join('\n'));
			console.log('\n---\n');
			failed++;
		}
	}

	console.log(`\nTest Summary: ${passed} passed, ${failed} failed.`);
	if (failed > 0) {
		process.exit(1);
	}
}

runTests();
