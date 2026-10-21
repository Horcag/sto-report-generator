import assert from 'node:assert/strict';
import AdmZip from 'adm-zip';
import { Document, Packer } from 'docx';
import { JSDOM } from 'jsdom';
import { Lexer, Marked, TokenizerThis } from 'marked';

import { parseMarkdownToDocx } from '@/features/markdown-parser';
import {
	mathExtension,
	stoExtension,
} from '@/features/markdown-parser/lib/utils/extensions';

async function run(): Promise<void> {
	const mathChildren = await parseMarkdownToDocx(
		String.raw`Inline $\frac{x}{y}$ text.

$$\frac{x+1}{y-1} (7)$$`,
		{},
	);
	const mathBytes = await Packer.toBuffer(
		new Document({ sections: [{ children: mathChildren }] }),
	);
	const mathDocument = new JSDOM(
		new AdmZip(mathBytes).readAsText('word/document.xml'),
		{ contentType: 'text/xml' },
	).window.document;
	const equations = [...mathDocument.getElementsByTagName('m:oMath')];
	assert.equal(equations.length, 2, 'both formulas survive conversion');
	assert.equal(
		equations[0].parentElement?.tagName,
		'w:p',
		'inline stays inline',
	);
	const display = equations[1].parentElement;
	assert.equal(display?.tagName, 'm:oMathPara', 'block uses display OMML');
	assert.equal(
		display?.getElementsByTagName('m:jc')[0]?.getAttribute('m:val'),
		'center',
	);
	assert.equal(mathDocument.getElementsByTagName('w:tbl').length, 1);
	assert.ok(
		[...mathDocument.getElementsByTagName('w:t')].some(
			run => run.textContent === '(7)',
		),
		'equation label remains separate from display math',
	);
	const cases = [
		String.raw`$
\begin{bmatrix}1&2\\3&4\end{bmatrix}
$`,
		String.raw`$$\begin{bmatrix}1&2\\3&4\end{bmatrix}$$`,
		String.raw`$$
\begin{bmatrix}
1&2\\
3&4
\end{bmatrix}
$$`,
		String.raw`$\begin{bmatrix}1&2\\3&4\end{bmatrix}$`,
		String.raw`Текст $\begin{bmatrix}1&2\\3&4\end{bmatrix}$ после.`,
		String.raw`$$\begin{bmatrix}\begin{matrix}1&2\\3&4\end{matrix}\end{bmatrix}$$`,
	];
	for (const markdown of cases) {
		const children = await parseMarkdownToDocx(markdown, {});
		const bytes = await Packer.toBuffer(
			new Document({ sections: [{ children }] }),
		);
		const xml = new AdmZip(bytes).readAsText('word/document.xml');
		assert.match(xml, /<m:m>/, 'matrix reaches the formula converter');
		assert.doesNotMatch(xml, /Unsupported|\\begin|\$\$/);
	}
	const lexer = new Marked({ extensions: [stoExtension, mathExtension] });
	for (const markdown of [
		String.raw`\begin{itemize}bad\end{itemize}`,
		String.raw`Текст \begin{bmatrix}bad\end{bmatrix}`,
		String.raw`x\begin{itemize}bad\end{itemize}$`,
		String.raw`$$x$$ \begin{itemize}bad\end{itemize}`,
		String.raw`$\begin{itemize}bad\end{itemize}`,
		String.raw`\$x \begin{itemize}bad\end{itemize}$`,
		String.raw`\begin{sto_list}\begin{itemize}bad\end{itemize}\end{sto_list}`,
	]) {
		assert.throws(
			() => lexer.lexer(markdown),
			/Unsupported STO environment/,
			markdown,
		);
	}
	for (const markdown of [
		'```latex\n\\begin{itemize}literal\\end{itemize}\n```',
		'~~~latex\n\\begin{itemize}literal\\end{itemize}\n~~~',
		'Literal `\\begin{itemize}literal\\end{itemize}`.',
		'Literal `` `\\begin{itemize}literal\\end{itemize}` ``.',
		String.raw`Literal \\begin{itemize}literal\\end{itemize}.`,
	]) {
		assert.doesNotThrow(() => lexer.lexer(markdown), markdown);
	}
	const tokens = lexer.lexer(String.raw`$$\begin{bmatrix}1&2\end{bmatrix}$$

\sto_structural_heading{РЕФЕРАТ}`);
	assert.ok(
		tokens.some(token => token.type === 'stoFlag'),
		'real macro after math still recognized',
	);
	const source = String.raw`$\begin{bmatrix}x\end{bmatrix}$`;
	let observedClippedCallback = false;
	const instrumented = new Marked({
		extensions: [
			{
				...stoExtension,
				start(this: TokenizerThis, src: string) {
					observedClippedCallback ||= src === source.slice(1);
					return stoExtension.start.call(this, src);
				},
			},
			mathExtension,
		],
	});
	instrumented.lexer(source);
	assert.ok(
		observedClippedCallback,
		'installed Marked18 uses the clipping relationship guarded by the adapter',
	);
	const callbackContext: TokenizerThis = { lexer: new Lexer() };
	stoExtension.tokenizer.call(callbackContext, source, []);
	assert.equal(
		stoExtension.start.call(callbackContext, source.slice(1)),
		undefined,
		'Marked18 clipped callback preserves leading inline math',
	);
	const unrelated = String.raw`text \begin{itemize}bad\end{itemize}`;
	stoExtension.tokenizer.call({ lexer: new Lexer() }, unrelated, []);
	assert.equal(
		stoExtension.start.call(callbackContext, source.slice(1)),
		undefined,
		'lexer contexts remain isolated',
	);
	assert.equal(
		stoExtension.start.call(callbackContext, unrelated),
		unrelated.indexOf('\\begin'),
		'unrelated callback source does not reuse cached context',
	);
	console.log(
		'Math environment boundary tests passed: inline/display matrices, nested math, literal code and unsupported STO blocks.',
	);
}

run().catch(error => {
	console.error(error);
	process.exitCode = 1;
});
