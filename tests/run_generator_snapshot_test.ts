import fs from 'node:fs';
import path from 'node:path';

import { buildReport } from '../src/app/builder';
import { readDocxEntry } from '../src/shared/lib/docx-archive';

const projectRoot = path.join(__dirname, '..');
const sampleDir = path.join(projectRoot, 'example');
const tempRoot = path.join(projectRoot, '.agent-work', 'snapshot-test');
const tempOutput = path.join(tempRoot, 'temp_output.docx');
const snapshotFile = path.join(
	__dirname,
	'fixtures',
	'generator',
	'snapshot.xml',
);

function formatXml(xml: string): string {
	return xml.replaceAll(/>\s*</g, '>\n<').trim();
}

function firstDifference(expectedXml: string, actualXml: string): string {
	const expectedLines = expectedXml.split('\n');
	const actualLines = actualXml.split('\n');
	const maxLines = Math.max(expectedLines.length, actualLines.length);

	for (let index = 0; index < maxLines; index++) {
		if (expectedLines[index] !== actualLines[index]) {
			return [
				`Expected (Line ${index + 1}): ${expectedLines[index] || '<EOF>'}`,
				`Actual   (Line ${index + 1}): ${actualLines[index] || '<EOF>'}`,
			].join('\n');
		}
	}
	return 'No line difference found.';
}

async function main(): Promise<void> {
	console.log('Running Generator Snapshot Test...\n');
	const updateSnapshot = process.argv.includes('--update');

	fs.rmSync(tempRoot, { recursive: true, force: true });
	fs.mkdirSync(tempRoot, { recursive: true });
	await buildReport(sampleDir, tempOutput);

	const formattedXml = formatXml(
		readDocxEntry(tempOutput, 'word/document.xml'),
	);
	fs.rmSync(tempRoot, { recursive: true, force: true });

	if (updateSnapshot || !fs.existsSync(snapshotFile)) {
		fs.writeFileSync(snapshotFile, formattedXml, 'utf-8');
		console.log(`Snapshot saved to ${snapshotFile}`);
		return;
	}

	const expectedXml = fs.readFileSync(snapshotFile, 'utf-8');
	if (formattedXml === expectedXml) {
		console.log('Generator snapshot test passed.');
		return;
	}

	console.error('Generated document does not match snapshot.');
	console.error(
		'If this change was intentional, run: npm run test:generator -- --update',
	);
	console.error('\nFirst difference:');
	console.error(firstDifference(expectedXml, formattedXml));
	process.exit(1);
}

main().catch(error => {
	console.error(error instanceof Error ? error.message : error);
	process.exit(1);
});
