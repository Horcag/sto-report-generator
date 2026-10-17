import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

import { parseReportFrontmatter as matter } from '@/shared/lib/frontmatter';

const loadDependency = createRequire(__filename);

interface BracesApi {
	expand(pattern: string): string[];
	parse(pattern: string): unknown;
}
interface MicromatchApi {
	braces(pattern: string, options: { expand: boolean }): string[];
}
interface SourceMapApi {
	SourceMapConsumer: new (map: unknown) => unknown;
	SourceNode: {
		fromStringWithSourceMap(
			code: string,
			consumer: unknown,
		): {
			children: unknown[];
			toString(): string;
		};
	};
}

function testMatterCompatibility(): void {
	const parsed = matter(
		'---\nsemester: 6\nratio: 0.5\nactive: true\nitems: [first, second]\nid: "00114"\ndate: "2026-10-10"\nplainDate: 2026-10-10\ndefaults: &base\n  width: 140\n  quality: warn\nfigure:\n  <<: *base\n  width: 100\n---\nBody\n---\nStill body\n',
	);
	assert.equal(parsed.data.semester, 6);
	assert.equal(parsed.data.ratio, 0.5);
	assert.equal(parsed.data.active, true);
	assert.deepEqual(parsed.data.items, ['first', 'second']);
	assert.equal(parsed.data.id, '00114');
	assert.equal(parsed.data.date, '2026-10-10');
	assert.deepEqual(
		parsed.data.plainDate,
		new Date('2026-10-10T00:00:00.000Z'),
	);
	assert.deepEqual(parsed.data.figure, { width: 100, quality: 'warn' });
	assert.equal(parsed.content, 'Body\n---\nStill body\n');
	for (const [input, content] of [
		['', ''],
		['No header\n', 'No header\n'],
		['---\n---\nBody\n', 'Body\n'],
		['Before\n---\nx: 1\n---\nBody', 'Before\n---\nx: 1\n---\nBody'],
	]) {
		const result = matter(input);
		assert.deepEqual(result.data, {});
		assert.equal(result.content, content);
	}
	const windows = matter(
		'\uFEFF---\r\nsemester: 6\r\nactive: false\r\n---\r\nBody\r\n',
	);
	assert.deepEqual(windows.data, { semester: 6, active: false });
	assert.equal(windows.content, 'Body\r\n');
	const decimal = matter('---\nvalue: 012\n---\n');
	assert.equal(
		decimal.data.value,
		12,
		'YAML 1.2 interprets unquoted leading-zero numbers as decimal',
	);
	console.log(
		'YAML cases passed: scalars, arrays, quoted ID/date, anchor merge, BOM/CRLF, empty/no header, content boundaries; unquoted 012 is decimal 12.',
	);
}

function testBracesGuards(): void {
	const loadMicromatchDependency = createRequire(
		require.resolve('micromatch'),
	);
	const braces = loadMicromatchDependency('braces') as BracesApi;
	const micromatch = loadDependency('micromatch') as MicromatchApi;
	for (const [pattern, expected] of [
		['{a,b}', ['a', 'b']],
		['{1..3}', ['1', '2', '3']],
		['file-{a,b}-{1..2}', ['file-a-1', 'file-a-2', 'file-b-1', 'file-b-2']],
	] as Array<[string, string[]]>) {
		assert.deepEqual(braces.expand(pattern), expected);
		assert.deepEqual(
			micromatch.braces(pattern, { expand: true }),
			expected,
		);
	}
	for (const [opening, closing] of [
		['{', '}'],
		['(', ')'],
	]) {
		assert.doesNotThrow(() =>
			braces.parse(opening.repeat(100) + 'x' + closing.repeat(100)),
		);
		for (const depth of [101, 3500]) {
			const pattern = opening.repeat(depth) + 'x' + closing.repeat(depth);
			for (const evaluate of [
				() => braces.parse(pattern),
				() => braces.expand(pattern),
				() =>
					micromatch.braces(
						opening === '(' ? `{${pattern},y}` : pattern,
						{ expand: true },
					),
			])
				assert.throws(
					evaluate,
					error =>
						error instanceof SyntaxError &&
						/depth|nest/i.test(error.message),
				);
		}
	}
	console.log(
		'Braces cases passed: ordinary sets/ranges/products plus deeply nested braces and parentheses rejected through braces and micromatch.',
	);
}

function testSourceMapOffsets(): void {
	const { SourceMapConsumer, SourceNode } = loadDependency(
		'source-map-js',
	) as SourceMapApi;
	const inner = {
		version: 3,
		sources: ['a.js'],
		sourcesContent: ['a'],
		names: [],
		mappings: 'AAAA',
	};
	const indexed = (line: unknown, column: unknown, map: unknown = inner) => ({
		version: 3,
		sections: [{ offset: { line, column }, map }],
	});
	// Upstream cf7658058ceeaa8619d5ae0ec90be6905209d016: an offset must
	// not append millions of empty nodes when the generated code has two lines.
	const source = 'var x;\n';
	const node = SourceNode.fromStringWithSourceMap(
		source,
		new SourceMapConsumer(indexed(1e7, 0)),
	);
	assert.equal(node.toString(), source);
	assert.ok(
		node.children.length < 10,
		'large offsets must not manufacture empty-line nodes',
	);
	assert.throws(() => new SourceMapConsumer(indexed(1e7 + 1, 0)));
	for (const invalid of [-1, 1.5, Number.NaN, Infinity, '1', null]) {
		assert.throws(() => new SourceMapConsumer(indexed(invalid, 0)));
		assert.throws(() => new SourceMapConsumer(indexed(0, invalid)));
	}
	assert.doesNotThrow(
		() => new SourceMapConsumer(indexed(5e6, 0, indexed(5e6, 0))),
	);
	assert.throws(
		() =>
			new SourceMapConsumer(
				indexed(5e6, 0, indexed(5e6, 0, indexed(5e6, 0))),
			),
	);
	console.log(
		'Source-map cases passed: 10-million offset preserves code with <10 nodes; excessive, invalid and cumulative offsets rejected.',
	);
}

function testSourceMapInBoundedProcess(): void {
	const result = spawnSync(
		process.execPath,
		[
			'--max-old-space-size=64',
			require.resolve('tsx/cli'),
			__filename,
			'--source-map-child',
		],
		{ encoding: 'utf8', timeout: 10000, windowsHide: true },
	);
	assert.equal(
		result.error,
		undefined,
		`bounded source-map test failed: ${result.error?.message}`,
	);
	assert.equal(
		result.status,
		0,
		(result.stderr || result.stdout).slice(-3000),
	);
	assert.match(result.stdout, /Source-map cases passed/);
	process.stdout.write(result.stdout);
}

function testArchitectureGuard(): void {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sto-security-fsd-'));
	try {
		fs.mkdirSync(path.join(root, 'src', 'shared', 'lib'), {
			recursive: true,
		});
		fs.mkdirSync(path.join(root, 'src', 'features', 'example', 'lib'), {
			recursive: true,
		});
		fs.writeFileSync(
			path.join(root, 'src', 'features', 'example', 'index.ts'),
			"export { example } from './lib/example';\n",
		);
		fs.writeFileSync(
			path.join(root, 'src', 'features', 'example', 'lib', 'example.ts'),
			'export const example = 1;\n',
		);
		fs.writeFileSync(
			path.join(root, 'tsconfig.json'),
			JSON.stringify({
				compilerOptions: {
					moduleResolution: 'node',
					target: 'ES2022',
					module: 'commonjs',
				},
				include: ['src/**/*.ts'],
			}),
		);
		fs.writeFileSync(
			path.join(root, 'src', 'shared', 'lib', 'example.ts'),
			"import { example } from '../../features/example';\nexport { example };\n",
		);
		fs.mkdirSync(path.join(root, 'src', 'app'));
		fs.writeFileSync(
			path.join(root, 'src', 'app', 'main.ts'),
			"import { example } from '../features/example';\nvoid example;\n",
		);
		const manifest = path.join(
			process.cwd(),
			'node_modules',
			'steiger',
			'package.json',
		);
		const metadata = JSON.parse(fs.readFileSync(manifest, 'utf8')) as {
			bin: { steiger: string };
		};
		const cli = path.resolve(path.dirname(manifest), metadata.bin.steiger);
		const runFixture = () =>
			spawnSync(process.execPath, [cli, path.join(root, 'src')], {
				cwd: process.cwd(),
				encoding: 'utf8',
				timeout: 10000,
				windowsHide: true,
			});
		const plantedImport = path.join(
			root,
			'src',
			'shared',
			'lib',
			'example.ts',
		);
		fs.unlinkSync(plantedImport);
		const baseline = runFixture();
		assert.equal(baseline.error, undefined);
		assert.equal(baseline.status, 0, baseline.stdout + baseline.stderr);
		fs.writeFileSync(
			plantedImport,
			"import { example } from '../../features/example';\nexport { example };\n",
		);
		const result = runFixture();
		assert.equal(result.error, undefined);
		assert.notEqual(result.status, 0, 'architecture violation must fail');
		assert.match(
			result.stdout + result.stderr,
			/fsd\/(?:forbidden-imports|no-layer-imports)/,
		);
		console.log(
			'Architecture guard passed: planted shared-to-feature import is rejected by installed Steiger.',
		);
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
	}
}

if (process.argv.includes('--source-map-child')) testSourceMapOffsets();
else {
	testMatterCompatibility();
	testBracesGuards();
	testSourceMapInBoundedProcess();
	testArchitectureGuard();
	console.log('Dependency security regression tests passed.');
}
