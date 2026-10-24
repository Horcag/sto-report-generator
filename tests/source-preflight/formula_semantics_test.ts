import assert from 'node:assert/strict';

import { validateSourceFormulas } from '@/shared/lib/source-preflight/formula-checker';
import {
	collectLabelDefinitions,
	validateUnknownReferences,
	validateUnusedEquationLabels,
} from '@/shared/lib/source-preflight/reference-checker';
import {
	LabelDefinitions,
	SourcePreflightIssue,
} from '@/shared/lib/source-preflight/types';

export function runFormulaSemanticsTests(): void {
	const cases: [string, string, string[]][] = [
		['inline decimal dot', '$3.14$', ['formula-decimal-dot']],
		['display decimal dot', '$$3.14$$', ['formula-decimal-dot']],
		['inline decimal comma', '$3{,}14$', []],
		[
			'inline multiplication star',
			'$a*b$',
			['formula-forbidden-multiplication-sign'],
		],
		[
			'display multiplication star',
			'$$a*b$$',
			['formula-forbidden-multiplication-sign'],
		],
		['inline LaTeX multiplication', String.raw`$a\cdot b$`, []],
		[
			'bold vector scalar product',
			String.raw`$$\mathbf{a}\cdot\mathbf{b}$$`,
			[],
		],
		[
			'arrow vector scalar product',
			String.raw`$$\vec{a}\cdot\vec{b}$$`,
			[],
		],
		[
			'explicit vector scalar product',
			String.raw`$$\stovec{a}\cdot\stovec{b}$$`,
			[],
		],
		[
			'parenthesized factor',
			String.raw`$$a\cdot(b+c)$$`,
			['formula-redundant-cdot'],
		],
		[
			'sized parenthesized factor',
			String.raw`$$a\cdot\left(b+c\right)$$`,
			['formula-redundant-cdot'],
		],
		['label inside display', '$$x=y (@eq:value)$$', []],
		[
			'multiline display with surrounding blanks',
			'Текст.\n\n$$\nx=y\n$$\n\nТекст.',
			[],
		],
		[
			'display without surrounding blanks',
			'Текст.\n$$x=y$$\nТекст.',
			['formula-missing-surrounding-blank-line'],
		],
		[
			'fraction factor',
			String.raw`$$a\cdot\frac{b}{c}$$`,
			['formula-redundant-cdot'],
		],
		[
			'TeX relation continuation',
			String.raw`$$a\leq\\b$$`,
			['formula-line-break-operator-not-repeated'],
		],
		[
			'TeX approximate continuation',
			String.raw`$$a\approx\\b$$`,
			['formula-line-break-operator-not-repeated'],
		],
		[
			'aligned repeated operator',
			String.raw`$$\begin{aligned}a&=b+\\&+c\end{aligned}$$`,
			[],
		],
		[
			'cases rows are not equation continuations',
			String.raw`$$f=\begin{cases}a+,&x>0\\b,&x<0\end{cases}$$`,
			[],
		],
		[
			'empty continuation',
			String.raw`$$a=b\\$$`,
			['formula-empty-continuation'],
		],
		['label before display', '(@eq:value)\n\n$$x=y$$', []],
		['label after display', '$$x=y$$\n\n(@eq:value)', []],
		['label between displays', '$$x=y$$\n\n(@eq:value)\n\n$$a=b$$', []],
		[
			'label inside inline math between displays',
			'$$x=y$$\n\n$x (@eq:value)$\n\n$$a=b$$',
			[],
		],
		[
			'multiple display labels',
			'$$x=y (@eq:first)$$\n\nТекст.\n\n$$a=b (@eq:second)$$',
			[],
		],
		[
			'code and comments stay literal',
			'`$3.14*a$ (@eq:code)`\n\n<!-- $2.71*b$ (@eq:comment) -->',
			[],
		],
	];
	const relevant = new Set([
		'formula-decimal-dot',
		'formula-forbidden-multiplication-sign',
		'formula-redundant-cdot',
		'formula-line-break-operator-not-repeated',
		'formula-empty-continuation',
		'formula-missing-surrounding-blank-line',
	]);
	const references = 'По формуле (@eq:value).\n\n$$x=y (@eq:value)$$';
	const definitions: LabelDefinitions = new Map();
	const referenceIssues: SourcePreflightIssue[] = [];
	collectLabelDefinitions(
		'math.md',
		references,
		definitions,
		referenceIssues,
	);
	validateUnknownReferences(
		'math.md',
		references,
		definitions,
		referenceIssues,
	);
	validateUnusedEquationLabels(
		[{ file: 'math.md', content: references }],
		definitions,
		referenceIssues,
	);
	assert.equal(
		definitions.size,
		1,
		'parenthesized text reference is not another definition',
	);
	assert.deepEqual(referenceIssues, []);
	const orphanDefinitions: LabelDefinitions = new Map();
	const orphanIssues: SourcePreflightIssue[] = [];
	collectLabelDefinitions(
		'math.md',
		'(@eq:orphan)',
		orphanDefinitions,
		orphanIssues,
	);
	validateUnknownReferences(
		'math.md',
		'(@eq:orphan)',
		orphanDefinitions,
		orphanIssues,
	);
	assert.equal(
		orphanDefinitions.size,
		0,
		'orphan text references cannot define formulas',
	);
	assert.equal(orphanIssues[0]?.code, 'unknown-reference-label');
	for (const [name, content, expected] of cases) {
		const issues: SourcePreflightIssue[] = [];
		validateSourceFormulas('10_math.md', content, issues);
		assert.deepEqual(
			issues
				.filter(item => relevant.has(item.code))
				.map(item => item.code),
			expected,
			name,
		);
	}
	const issues: SourcePreflightIssue[] = [];
	validateSourceFormulas('10_math.md', 'Текст.\n\n$3.14$\n\n$a*b$', issues);
	assert.deepEqual(
		issues.map(({ code, file, line }) => ({ code, file, line })),
		[
			{ code: 'formula-decimal-dot', file: '10_math.md', line: 3 },
			{
				code: 'formula-forbidden-multiplication-sign',
				file: '10_math.md',
				line: 5,
			},
		],
		'inline diagnostics retain source file and line',
	);
	console.log(
		`Formula source semantics regressions: ${cases.length + 3} cases passed.`,
	);
}

if (require.main === module) runFormulaSemanticsTests();
