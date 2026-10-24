import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(__dirname, '../..');
const steigerDirectory = path.join(root, 'node_modules/steiger');
const requireFromSteiger = createRequire(
	path.join(steigerDirectory, 'package.json'),
);
const { z } = requireFromSteiger('zod') as typeof import('zod');
const loadDependency = createRequire(__filename);
const { patchSource, patchInstallation, CHUNK } = loadDependency(
	'../../scripts/quality/patch_steiger_zod.cjs',
) as {
	patchSource: (source: string, version: string) => string;
	patchInstallation: (root: string) => boolean;
	CHUNK: string;
};

interface ValidatedPlugin {
	ruleDefinitions: Array<{ check: (...args: unknown[]) => unknown }>;
}

async function testConfigurationAndRules(fixture: string): Promise<void> {
	const { processConfiguration, linter } = await import('steiger');
	const configure = (input: unknown) =>
		processConfiguration(
			input as Parameters<typeof processConfiguration>[0],
			root,
		);
	const actualConfig = await import(
		pathToFileURL(path.join(root, 'steiger.config.mjs')).href
	);
	assert.doesNotThrow(() => configure(actualConfig.default));
	const config = (check: unknown) => [
		{
			meta: { name: 'security', version: '1.0.0' },
			ruleDefinitions: [
				{ name: 'security/result', check },
				{ name: 'security/unused', check: () => ({ diagnostics: [] }) },
			],
		},
		{ rules: { 'security/result': ['error', { enabled: true }] } },
	];
	const validatedCheck = (check: unknown) => {
		const parsed = configure(config(check));
		const plugin = parsed.find(
			item => 'ruleDefinitions' in item,
		) as ValidatedPlugin;
		return plugin.ruleDefinitions[0].check;
	};
	for (const input of [
		{},
		[config(() => ({ diagnostics: [] }))[0]],
		config('not callable'),
		[
			config(() => ({ diagnostics: [] }))[0],
			{ rules: { unknown: 'error' } },
		],
	])
		assert.throws(() => configure(input));

	const receiver = { marker: true };
	const args = [
		{ type: 'folder', path: fixture, children: [] },
		{ enabled: true },
	];
	const syncCheck = validatedCheck(function (
		this: unknown,
		...received: unknown[]
	) {
		assert.equal(this, receiver);
		assert.deepEqual(received, args);
		return { diagnostics: [] };
	});
	assert.deepEqual(syncCheck.apply(receiver, args), { diagnostics: [] });
	const asynchronous = validatedCheck(async () => ({ diagnostics: [] }))();
	assert.ok(asynchronous instanceof Promise);
	assert.deepEqual(await asynchronous, { diagnostics: [] });
	for (const invalid of [undefined, {}, { diagnostics: 'wrong' }]) {
		assert.throws(() => validatedCheck(() => invalid)(), z.ZodError);
		await assert.rejects(
			validatedCheck(async () => invalid)() as Promise<unknown>,
			z.ZodError,
		);
	}
	const sentinel = new Error('rule failure');
	assert.throws(
		() =>
			validatedCheck(() => {
				throw sentinel;
			})(),
		error => error === sentinel,
	);
	await assert.rejects(
		validatedCheck(() => Promise.reject(sentinel))() as Promise<unknown>,
		error => error === sentinel,
	);
	for (const check of [() => ({}), async () => ({})]) {
		configure(config(check));
		await assert.rejects(linter.run(fixture), /diagnostics/);
	}
	for (const check of [
		() => ({ diagnostics: [] }),
		async () => ({ diagnostics: [] }),
	]) {
		configure(config(check));
		assert.deepEqual(await linter.run(fixture), []);
	}
	console.log(
		'Steiger configuration and rule checks passed: partial configs, callable arguments, sync/async results, runtime validation, and propagated errors.',
	);
}

function testArrayBound(): void {
	assert.equal(
		z.core.version.major,
		4,
		'the actual Steiger dependency must load Zod v4',
	);
	const input = new Array(3);
	for (let index = 0; index < input.length; index++) {
		Object.defineProperty(input, index, {
			get() {
				throw new Error('oversized array element was visited');
			},
		});
	}
	const result = z.array(z.string()).max(2).safeParse(input);
	assert.equal(result.success, false);
	if (!result.success) assert.equal(result.error.issues[0].code, 'too_big');
	console.log(
		'Zod security check passed: oversized array rejected before element access.',
	);
}

function testInstallPatch(fixture: string): void {
	const source = fs.readFileSync(path.join(steigerDirectory, CHUNK), 'utf8');
	assert.equal(patchSource(source, '0.7.0'), source);
	assert.equal(patchInstallation(root), true);
	assert.equal(
		fs.readFileSync(path.join(steigerDirectory, CHUNK), 'utf8'),
		source,
	);
	assert.throws(
		() => patchSource(source, '0.8.0'),
		/Unsupported Steiger version/,
	);
	assert.throws(
		() => patchSource(source + '\n', '0.7.0'),
		/Unexpected Steiger preimage/,
	);
	assert.equal(
		patchInstallation(fixture),
		false,
		'production installs omit Steiger',
	);
	console.log(
		'Install patch checks passed: idempotence, version mismatch, and modified preimage rejection.',
	);
}

function testArchitectureGuard(fixture: string): void {
	const src = path.join(fixture, 'src');
	fs.mkdirSync(path.join(src, 'shared/lib'), { recursive: true });
	fs.mkdirSync(path.join(src, 'features/example/lib'), { recursive: true });
	fs.writeFileSync(
		path.join(src, 'features/example/lib/example.ts'),
		'export const example = 1;\n',
	);
	fs.writeFileSync(
		path.join(src, 'features/example/index.ts'),
		"export { example } from './lib/example';\n",
	);
	fs.mkdirSync(path.join(src, 'app'));
	fs.writeFileSync(
		path.join(src, 'app/main.ts'),
		"import { example } from '../features/example';\nvoid example;\n",
	);
	fs.writeFileSync(
		path.join(fixture, 'tsconfig.json'),
		JSON.stringify({
			compilerOptions: { moduleResolution: 'node' },
			include: ['src/**/*.ts'],
		}),
	);
	const run = () =>
		spawnSync(
			process.execPath,
			[path.join(steigerDirectory, 'dist/cli.mjs'), src],
			{ cwd: root, encoding: 'utf8', timeout: 10000, windowsHide: true },
		);
	const baseline = run();
	assert.equal(baseline.error, undefined);
	assert.equal(baseline.status, 0, baseline.stdout + baseline.stderr);
	fs.writeFileSync(
		path.join(src, 'shared/lib/violation.ts'),
		"import { example } from '../../features/example';\nexport { example };\n",
	);
	const violation = run();
	assert.equal(violation.error, undefined);
	assert.notEqual(violation.status, 0);
	assert.match(
		violation.stdout + violation.stderr,
		/fsd\/(?:forbidden-imports|no-layer-imports)/,
	);
	console.log(
		'Architecture guard passed: installed Steiger rejects a shared-to-feature import.',
	);
}

async function main(): Promise<void> {
	const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'sto-steiger-zod-'));
	try {
		fs.writeFileSync(
			path.join(fixture, 'example.ts'),
			'export const example = 1;\n',
		);
		testInstallPatch(fixture);
		testArrayBound();
		await testConfigurationAndRules(fixture);
		testArchitectureGuard(fixture);
	} finally {
		fs.rmSync(fixture, { recursive: true, force: true });
		assert.equal(fs.existsSync(fixture), false);
	}
	console.log('Steiger/Zod security regression tests passed.');
}

main().catch(error => {
	console.error(error);
	process.exitCode = 1;
});
