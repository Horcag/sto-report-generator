import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { maskMarkdownMathAndCode } from '@/shared/lib/math/markdown-spans';
import { runSourcePreflight } from '@/shared/lib/source-preflight';
import { validateStoEnvironments } from '@/shared/lib/source-preflight/environment-checker';
import { SourcePreflightIssue } from '@/shared/lib/source-preflight/types';

function inspect(content: string): SourcePreflightIssue[] {
	const issues: SourcePreflightIssue[] = [];
	validateStoEnvironments('report.md', content, issues);
	return issues;
}

const matrix = String.raw`$$\begin{bmatrix}1&2\\3&4\end{bmatrix}$$`;
assert.deepEqual(
	inspect(String.raw`\$x \begin{itemize}bad\end{itemize}$`).map(
		item => item.code,
	),
	['unsupported-sto-environment', 'unsupported-sto-environment'],
	'escaped dollar must not hide real unsupported environments',
);
assert.deepEqual(
	inspect(String.raw`$
\begin{bmatrix}1&2\\3&4\end{bmatrix}
$`),
	[],
	'multiline single-dollar math has the same boundary as the parser',
);
assert.deepEqual(
	inspect(String.raw`Literal \\begin{itemize}bad\\end{itemize}.`),
	[],
	'escaped begin/end commands remain literal',
);

assert.deepEqual(
	inspect(matrix),
	[],
	'display matrix belongs to math, not the STO environment checker',
);
assert.deepEqual(inspect(String.raw`$\begin{matrix}1&2\end{matrix}$`), []);
assert.deepEqual(
	inspect(String.raw`$$
\begin{bmatrix}
\begin{matrix}1&2\\3&4\end{matrix}
\end{bmatrix}
$$`),
	[],
);
assert.deepEqual(inspect('`\\begin{unknown}example\\end{unknown}`'), []);
for (const fence of ['```', '~~~']) {
	assert.deepEqual(
		inspect(`${fence}latex\n\\begin{unknown}\n\\end{unknown}\n${fence}`),
		[],
	);
}
assert.deepEqual(
	inspect(String.raw`\begin{sto_list}
- Первый пункт;
- второй пункт.
\end{sto_list}`),
	[],
);
const mixed = `${matrix}\r\n\r\n\`\\begin{hidden}\`\r\n\r\n\\begin{unknown}\r\n\\end{unknown}\r\n`;
assert.deepEqual(
	inspect(mixed).map(item => ({
		code: item.code,
		line: item.line,
		file: item.file,
	})),
	[
		{ code: 'unsupported-sto-environment', line: 5, file: 'report.md' },
		{ code: 'unsupported-sto-environment', line: 6, file: 'report.md' },
	],
);
assert.deepEqual(
	inspect(`${matrix}\n\n\\begin{sto_list}\ntext\n\\end{sto_enum}`).map(
		item => ({ code: item.code, line: item.line }),
	),
	[{ code: 'mismatched-sto-environment', line: 5 }],
);
assert.deepEqual(
	inspect(`${matrix}\n\n\\begin{sto_list}`).map(item => ({
		code: item.code,
		line: item.line,
	})),
	[{ code: 'unclosed-sto-environment', line: 3 }],
);
assert.deepEqual(
	inspect(String.raw`\begin{unknown}`).map(item => item.code),
	['unsupported-sto-environment'],
);

const offsets = '😀 $\\begin{matrix}x\\end{matrix}\r\n$ \\begin{unknown}';
const masked = maskMarkdownMathAndCode(offsets);
assert.equal(masked.length, offsets.length, 'UTF16 offsets are retained');
assert.deepEqual(
	[...masked.matchAll(/[\r\n]/g)].map(match => match.index),
	[...offsets.matchAll(/[\r\n]/g)].map(match => match.index),
	'CRLF positions are retained',
);
assert.equal(
	masked.indexOf('\\begin{unknown}'),
	offsets.indexOf('\\begin{unknown}'),
);
assert.deepEqual(
	inspect('```latex\n\\begin{unknown}'),
	[],
	'unclosed code fences stay masked by the existing fence helper',
);
assert.deepEqual(
	inspect('---\nformula: \\begin{unknown}\n---\nText.'),
	[],
	'frontmatter remains outside STO checking',
);

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sto-math-preflight-'));
try {
	const example = path.join(process.cwd(), 'example');
	for (const entry of fs.readdirSync(example)) {
		if (/\.(?:md|bib)$/.test(entry) || entry === 'images')
			fs.cpSync(path.join(example, entry), path.join(directory, entry), {
				recursive: true,
			});
	}
	const main = path.join(directory, '10_main.md');
	fs.appendFileSync(main, `\n\nКонтрольная матрица:\n\n${matrix}\n`);
	const result = runSourcePreflight(directory);
	assert.equal(result.passed, true, JSON.stringify(result.issues, null, 2));
	assert.ok(
		!result.issues.some(item => item.code.includes('sto-environment')),
	);
	const invalidLine = fs.readFileSync(main, 'utf8').split('\n').length + 1;
	fs.appendFileSync(main, '\n\\begin{unknown}\n\\end{unknown}\n');
	const invalid = runSourcePreflight(directory);
	assert.equal(invalid.passed, false);
	assert.ok(
		invalid.issues.some(
			item =>
				item.code === 'unsupported-sto-environment' &&
				item.file === '10_main.md' &&
				item.line === invalidLine,
		),
	);
} finally {
	fs.rmSync(directory, { recursive: true, force: true });
}
console.log(
	'Math environment source preflight tests passed: masked formulas/code, preserved diagnostics and full example preflight.',
);
