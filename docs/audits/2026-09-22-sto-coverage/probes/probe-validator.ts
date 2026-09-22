import fs from 'node:fs';
import path from 'node:path';

import { buildReport } from '../../../../src/app/builder';
import { unpackDocx } from '../../../../src/shared/lib/docx-archive';
import { validateSTO } from '../../../../src/shared/lib/sto-validator';

async function main() {
	const root = path.resolve('.agent-work/published-sto-audit');
	fs.mkdirSync(root, { recursive: true });
	const docx = path.join(root, 'probe-baseline.docx');
	const unpacked = path.join(root, 'probe-unpacked');
	fs.rmSync(unpacked, { recursive: true, force: true });
	await buildReport('example', docx);
	unpackDocx(docx, unpacked);

	const docPath = path.join(unpacked, 'word/document.xml');
	const original = fs.readFileSync(docPath, 'utf8');
	const baseline = validateSTO(unpacked);
	const paragraphs = original.match(/<w:p\b[\s\S]*?<\/w:p>/g) ?? [];
	const target = paragraphs.find(paragraph =>
		paragraph.includes('Настоящий документ'),
	);
	if (!target)
		throw new Error('Expected demonstration body paragraph not found');

	const cases = [
		['body-left-1twip', '<w:ind w:left="1" w:firstLine="709"/>'],
		['body-right-1twip', '<w:ind w:right="1" w:firstLine="709"/>'],
		['body-first-line-minus-1twip', '<w:ind w:firstLine="708"/>'],
		[
			'body-line-minus-1unit',
			'<w:spacing w:line="359" w:lineRule="auto"/>',
		],
		['body-after-1twip', '<w:spacing w:after="1"/>'],
		['body-left-10mm', '<w:ind w:left="567" w:firstLine="709"/>'],
		['body-right-10mm', '<w:ind w:right="567" w:firstLine="709"/>'],
		['body-first-line-0', '<w:ind w:firstLine="0"/>'],
		['body-line-single', '<w:spacing w:line="240" w:lineRule="auto"/>'],
		['body-after-24pt', '<w:spacing w:after="480"/>'],
	];
	const results: unknown[] = [
		{
			case: 'baseline',
			checks: baseline.length,
			failed: baseline.filter(check => !check.passed),
		},
	];

	try {
		for (const [name, property] of cases) {
			const withoutConflict = target.replace(
				/<w:(?:ind|spacing)\b[^>]*\/>/g,
				'',
			);
			const changed = withoutConflict.includes('<w:pPr>')
				? withoutConflict.replace('</w:pPr>', property + '</w:pPr>')
				: withoutConflict.replace(
						'<w:p>',
						'<w:p><w:pPr>' + property + '</w:pPr>',
					);
			if (changed === target)
				throw new Error('Mutation did not change XML');
			fs.writeFileSync(docPath, original.replace(target, changed));
			const checks = validateSTO(unpacked);
			results.push({
				case: name,
				injectedProperty: property,
				checks: checks.length,
				failed: checks.filter(check => !check.passed),
			});
		}
	} finally {
		fs.writeFileSync(docPath, original);
	}

	fs.writeFileSync(
		path.join(root, 'validator-probes.json'),
		JSON.stringify(results, null, 2),
	);
	console.log(JSON.stringify(results, null, 2));
}

main().catch(error => {
	console.error(error);
	process.exitCode = 1;
});
