const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const {
	installProjectSkill,
	activateProjectSkill,
	projectLoader,
} = require('../../install_project_skill.cjs');

const installer = path.resolve(__dirname, '../../install_project_skill.cjs');
const skillPath = '.agents/skills/sto-report-generator/SKILL.md';
function fixture(t) {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sto skill test '));
	t.after(() => fs.rmSync(root, { recursive: true, force: true }));
	return root;
}
function write(file, content) {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, content);
}
function packageFiles(directory) {
	write(path.join(directory, skillPath), 'full skill version one\n');
	write(
		path.join(directory, 'docs/case-studies/README.md'),
		'knowledge base\n',
	);
	write(
		path.join(directory, '.agents/skills/humanizer-ru/SKILL.md'),
		'editor\n',
	);
}
function installed(t, metadata = {}) {
	const root = fixture(t);
	const packageRoot = path.join(root, 'node_modules/sto-report-generator');
	write(path.join(root, 'package.json'), JSON.stringify(metadata));
	packageFiles(packageRoot);
	return {
		root,
		packageRoot,
		env: { INIT_CWD: root, npm_config_local_prefix: root },
	};
}
function npm(cwd, args) {
	const cli = process.env.npm_execpath;
	const result = spawnSync(
		cli
			? process.execPath
			: process.platform === 'win32'
				? 'npm.cmd'
				: 'npm',
		cli ? [cli, ...args] : args,
		{
			cwd,
			encoding: 'utf8',
			timeout: 60000,
			env: {
				...process.env,
				npm_config_audit: 'false',
				npm_config_fund: 'false',
			},
		},
	);
	assert.equal(
		result.status,
		0,
		result.error?.message || result.stdout + result.stderr,
	);
	return result.stdout;
}

test('first direct install creates a stable relative loader; updates read current full skill', t => {
	const { root, packageRoot, env } = installed(t);
	assert.equal(installProjectSkill(packageRoot, env), true);
	const file = path.join(root, skillPath);
	const loader = fs.readFileSync(file, 'utf8');
	assert.equal(loader, projectLoader(root, packageRoot));
	assert.ok(!loader.includes(root));
	assert.ok(
		loader.includes(
			'../../../node_modules/sto-report-generator/.agents/skills/sto-report-generator/SKILL.md',
		),
	);
	write(path.join(packageRoot, skillPath), 'full skill version two\n');
	assert.equal(installProjectSkill(packageRoot, env), true);
	assert.equal(fs.readFileSync(file, 'utf8'), loader);
});

test('new local install without a project manifest can activate', t => {
	const { root, packageRoot, env } = installed(t);
	fs.unlinkSync(path.join(root, 'package.json'));
	assert.equal(installProjectSkill(packageRoot, env), true);
});

test('declared direct dependency can also have a transitive consumer', t => {
	const { root, packageRoot, env } = installed(t, {
		devDependencies: { 'sto-report-generator': '*' },
	});
	write(
		path.join(root, 'node_modules/parent/package.json'),
		JSON.stringify({ dependencies: { 'sto-report-generator': '*' } }),
	);
	assert.equal(installProjectSkill(packageRoot, env), true);
});

for (const field of [
	'dependencies',
	'optionalDependencies',
	'peerDependencies',
]) {
	test(`hoisted ${field} consumer is excluded before npm saves the root manifest`, t => {
		const { root, packageRoot, env } = installed(t);
		write(
			path.join(root, 'node_modules/@scope/parent/package.json'),
			JSON.stringify({ [field]: { 'sto-report-generator': '*' } }),
		);
		assert.equal(installProjectSkill(packageRoot, env), false);
		assert.ok(!fs.existsSync(path.join(root, '.agents')));
	});
}

test('foreign files, symlink directories, global, home, and mismatched cwd stay untouched', t => {
	const { root, packageRoot, env } = installed(t);
	assert.equal(
		installProjectSkill(packageRoot, { ...env, npm_config_global: 'true' }),
		false,
	);
	assert.equal(
		installProjectSkill(packageRoot, { ...env, HOME: root }),
		false,
	);
	assert.equal(
		installProjectSkill(packageRoot, {
			...env,
			INIT_CWD: path.dirname(root),
		}),
		false,
	);
	assert.equal(installProjectSkill(root, env), false);
	write(path.join(root, skillPath), 'user skill\n');
	assert.equal(installProjectSkill(packageRoot, env), false);
	assert.equal(
		fs.readFileSync(path.join(root, skillPath), 'utf8'),
		'user skill\n',
	);
	const externalSkill = path.join(root, 'user-skill.md');
	write(externalSkill, 'external user skill\n');
	fs.unlinkSync(path.join(root, skillPath));
	fs.symlinkSync(externalSkill, path.join(root, skillPath));
	assert.equal(installProjectSkill(packageRoot, env), false);
	assert.equal(
		fs.readFileSync(externalSkill, 'utf8'),
		'external user skill\n',
	);
	fs.rmSync(path.join(root, '.agents'), { recursive: true });
	const outside = path.join(root, 'outside');
	fs.mkdirSync(outside);
	fs.symlinkSync(outside, path.join(root, '.agents'), 'junction');
	assert.equal(installProjectSkill(packageRoot, env), false);
	assert.deepEqual(fs.readdirSync(outside), []);
});

test('an OS-style ancestor alias is allowed but a linked node_modules is rejected', t => {
	const { root, packageRoot, env } = installed(t);
	const aliasRoot = fixture(t);
	const alias = path.join(aliasRoot, 'system alias');
	fs.symlinkSync(path.dirname(root), alias, 'junction');
	const requested = path.join(alias, path.basename(root));
	assert.equal(
		installProjectSkill(packageRoot, {
			...env,
			INIT_CWD: requested,
			npm_config_local_prefix: requested,
		}),
		true,
	);
	fs.renameSync(
		path.join(root, 'node_modules'),
		path.join(root, 'actual modules'),
	);
	fs.symlinkSync(
		path.join(root, 'actual modules'),
		path.join(root, 'node_modules'),
		'junction',
	);
	assert.equal(installProjectSkill(packageRoot, env), false);
});

test('report folder gets its own relative entry even outside the package checkout', t => {
	const root = fixture(t);
	const packageRoot = path.join(root, 'generator checkout');
	packageFiles(packageRoot);
	const report = path.join(root, 'my report');
	fs.mkdirSync(report);
	assert.equal(activateProjectSkill(report, packageRoot), true);
	const content = fs.readFileSync(path.join(report, skillPath), 'utf8');
	assert.ok(content.includes('../../../../generator checkout/'));
	for (const match of content.matchAll(/\]\(<([^>]+)>\)/g)) {
		assert.ok(
			fs.existsSync(
				path.resolve(
					report,
					'.agents/skills/sto-report-generator',
					match[1],
				),
			),
			match[1],
		);
	}
});

test(
	'real npm tgz lifecycle distinguishes new direct, transitive, and optional installs',
	{ timeout: 60000 },
	t => {
		const root = fixture(t);
		const source = path.join(root, 'source');
		packageFiles(source);
		write(path.join(source, 'installer.cjs'), fs.readFileSync(installer));
		write(
			path.join(source, 'probe.cjs'),
			`const fs = require('node:fs'); const path = require('node:path');
const project = process.env.npm_config_local_prefix;
const manifest = path.join(project, 'package.json');
const before = fs.existsSync(manifest) ? JSON.parse(fs.readFileSync(manifest, 'utf8')) : {};
const activated = require('./installer.cjs').installProjectSkill(__dirname);
fs.writeFileSync(path.join(project, 'receipt.json'), JSON.stringify({declaredBefore: !!before.dependencies?.['sto-report-generator'], activated}));`,
		);
		write(
			path.join(source, 'package.json'),
			JSON.stringify({
				name: 'sto-report-generator',
				version: '1.0.0',
				scripts: { postinstall: 'node probe.cjs' },
			}),
		);
		npm(source, ['pack', '--pack-destination', root]);
		const tarball = path.join(root, 'sto-report-generator-1.0.0.tgz');
		for (const mode of [
			'direct',
			'direct-empty',
			'dependencies',
			'optionalDependencies',
		]) {
			const consumer = path.join(root, `consumer ${mode}`);
			write(
				path.join(consumer, 'package.json'),
				JSON.stringify({ name: 'consumer', version: '1.0.0' }),
			);
			let requested = tarball;
			if (mode === 'direct-empty')
				fs.unlinkSync(path.join(consumer, 'package.json'));
			if (!mode.startsWith('direct')) {
				const parent = path.join(root, `parent ${mode}`);
				write(
					path.join(parent, 'package.json'),
					JSON.stringify({
						name: `parent-${mode.toLowerCase()}`,
						version: '1.0.0',
						[mode]: { 'sto-report-generator': `file:${tarball}` },
					}),
				);
				npm(parent, ['pack', '--pack-destination', root]);
				requested = path.join(
					root,
					`parent-${mode.toLowerCase()}-1.0.0.tgz`,
				);
			}
			npm(consumer, ['install', requested]);
			const receipt = JSON.parse(
				fs.readFileSync(path.join(consumer, 'receipt.json'), 'utf8'),
			);
			assert.equal(receipt.declaredBefore, false);
			assert.equal(receipt.activated, mode.startsWith('direct'), mode);
			assert.equal(
				fs.existsSync(path.join(consumer, skillPath)),
				mode.startsWith('direct'),
				mode,
			);
		}
	},
);
