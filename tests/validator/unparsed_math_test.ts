import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { validateSTO } from '@/shared/lib/sto-validator';

export function runUnparsedMathTests(): void {
	const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'sto-raw-math-'));
	const word = path.join(fixture, 'word');
	fs.mkdirSync(word);
	const namespaces =
		'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
	const run = (text: string, code = false) =>
		`<w:r>${code ? '<w:rPr><w:rFonts w:ascii="Courier New"/></w:rPr>' : ''}<w:t>${text}</w:t></w:r>`;
	const paragraph = (runs: string) => `<w:p>${runs}</w:p>`;
	const cases: [string, string, boolean][] = [
		['unparsed prose', paragraph(run('Formula $x+y$.')), false],
		[
			'display across paragraphs',
			paragraph(run('$$')) + paragraph(run('x=1')) + paragraph(run('$$')),
			false,
		],
		['shell PID literal', paragraph(run('echo $$', true)), true],
		['split Word runs', paragraph(run('$x') + run('+y$')), false],
		['shell block', paragraph(run('echo "$run" > "$output"', true)), true],
		[
			'inline shell',
			paragraph(run('Use ') + run('$run/$output', true)),
			true,
		],
		[
			'prose following inline code',
			paragraph(run('$run $output', true) + run(' Formula $x$.')),
			false,
		],
		[
			'table formula',
			`<w:tbl><w:tr><w:tc>${paragraph(run('$x$'))}</w:tc></w:tr></w:tbl>`,
			false,
		],
		[
			'separate paragraphs',
			paragraph(run('Cost $5')) + paragraph(run('Cost $6')),
			true,
		],
		[
			'XML attributes',
			'<w:p w:rsidR="$tag$"><w:r><w:t>Text</w:t></w:r></w:p>',
			true,
		],
	];
	try {
		fs.writeFileSync(
			path.join(word, 'styles.xml'),
			`<w:styles ${namespaces}/>`,
		);
		for (const [name, body, passed] of cases) {
			fs.writeFileSync(
				path.join(word, 'document.xml'),
				`<w:document ${namespaces}><w:body>${body}</w:body></w:document>`,
			);
			const check = validateSTO(fixture).find(
				result => result.check === 'Math Formatting (Unparsed)',
			);
			assert.ok(check, `Unparsed math check must execute: ${name}`);
			assert.equal(check.passed, passed, name);
		}
		console.log(`Unparsed math regressions: ${cases.length} cases passed.`);
	} finally {
		fs.rmSync(fixture, { recursive: true, force: true });
	}
}

if (require.main === module) runUnparsedMathTests();
