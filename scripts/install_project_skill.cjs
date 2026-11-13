const fs = require('node:fs');
const path = require('node:path');

const PACKAGE_NAME = 'sto-report-generator';
function projectLoader(project, packageRoot) {
	const base = path
		.relative(
			path.join(project, '.agents/skills/sto-report-generator'),
			packageRoot,
		)
		.split(path.sep)
		.join('/');
	if (path.isAbsolute(base)) return null;
	return `---
name: sto-report-generator
description: Use STO Report Generator for academic report Markdown, bibliography, Russian scientific prose, and DOCX/PDF generation or validation.
---

# STO Report Generator

<!-- sto-report-generator:project-loader:v1 -->

Read and follow the installed [full skill](<${base}/.agents/skills/sto-report-generator/SKILL.md>) before working on reports.
Its relative links resolve from that full skill's directory, inside the installed package.
The [generator base](<${base}/>) contains its CLI, documentation, templates, and supporting scripts.
Read the [shared research and knowledge base](<${base}/docs/case-studies/README.md>) when comparing scientific prose or reusing recorded findings.
Use the current project's report files as input; do not edit the installed package or install its development dependencies.
For authored or explicitly edited connected Russian prose, also follow the bundled [humanizer-ru skill](<${base}/.agents/skills/humanizer-ru/SKILL.md>).
Always reread the installed full skill: npm update or reinstall can replace it while this routing file stays unchanged.
If the package or full skill is missing, report that missing local dependency instead of using a personal or global skill.
`;
}

function existsWithoutSymlink(target, kind) {
	try {
		const stat = fs.lstatSync(target);
		return !stat.isSymbolicLink() && stat[kind]();
	} catch (error) {
		if (error.code === 'ENOENT') return false;
		throw error;
	}
}

function safeAncestors(target, boundary = target) {
	for (
		let current = path.resolve(target);
		;
		current = path.dirname(current)
	) {
		if (!existsWithoutSymlink(current, 'isDirectory')) return false;
		if (current === path.resolve(boundary)) return true;
		if (current === path.dirname(current)) return false;
	}
}

function declaresPackage(metadata) {
	return [
		'dependencies',
		'devDependencies',
		'optionalDependencies',
		'peerDependencies',
	].some(field => Object.hasOwn(metadata[field] || {}, PACKAGE_NAME));
}

// npm saves a newly requested dependency only AFTER dependency postinstall.
// Inspect unpacked consumers as well, so a hoisted transitive install cannot
// mistake the command's working directory for an authorized direct project.
function hasOtherConsumer(modules, packageRoot) {
	if (!fs.existsSync(modules)) return false;
	if (!safeAncestors(modules)) return true;
	for (const entry of fs.readdirSync(modules, { withFileTypes: true })) {
		if (entry.name.startsWith('.')) continue;
		const directory = path.join(modules, entry.name);
		if (entry.isSymbolicLink()) return true;
		if (!entry.isDirectory() || directory === packageRoot) continue;
		if (entry.name.startsWith('@')) {
			if (hasOtherConsumer(directory, packageRoot)) return true;
			continue;
		}
		const manifest = path.join(directory, 'package.json');
		if (!existsWithoutSymlink(manifest, 'isFile')) return true;
		const metadata = JSON.parse(fs.readFileSync(manifest, 'utf8'));
		if (
			['dependencies', 'optionalDependencies', 'peerDependencies'].some(
				field => Object.hasOwn(metadata[field] || {}, PACKAGE_NAME),
			)
		)
			return true;
		if (hasOtherConsumer(path.join(directory, 'node_modules'), packageRoot))
			return true;
	}
	return false;
}

function installProjectSkill(
	packageRoot = path.resolve(__dirname, '..'),
	env = process.env,
) {
	if (
		env.npm_config_global === 'true' ||
		!env.npm_config_local_prefix ||
		!env.INIT_CWD
	)
		return false;
	const requestedProject = path.resolve(env.npm_config_local_prefix);
	if (!existsWithoutSymlink(requestedProject, 'isDirectory')) return false;
	const project = fs.realpathSync(requestedProject);
	if (
		project !== fs.realpathSync(env.INIT_CWD) ||
		project === path.dirname(project)
	)
		return false;
	if (
		[env.HOME, env.USERPROFILE]
			.filter(Boolean)
			.some(
				home =>
					fs.existsSync(home) && project === fs.realpathSync(home),
			)
	)
		return false;
	if (
		![project, requestedProject].some(
			root =>
				packageRoot === path.join(root, 'node_modules', PACKAGE_NAME),
		)
	)
		return false;
	packageRoot = path.join(project, 'node_modules', PACKAGE_NAME);
	if (!safeAncestors(packageRoot, project)) return false;
	const manifest = path.join(project, 'package.json');
	if (fs.existsSync(manifest) && !existsWithoutSymlink(manifest, 'isFile'))
		return false;
	const metadata = existsWithoutSymlink(manifest, 'isFile')
		? JSON.parse(fs.readFileSync(manifest, 'utf8'))
		: {};
	if (
		!declaresPackage(metadata) &&
		hasOtherConsumer(path.join(project, 'node_modules'), packageRoot)
	)
		return false;
	return activateProjectSkill(project, packageRoot);
}

function activateProjectSkill(
	project,
	packageRoot = path.resolve(__dirname, '..'),
) {
	if (!safeAncestors(project) || !safeAncestors(packageRoot)) return false;
	project = fs.realpathSync(project);
	packageRoot = fs.realpathSync(packageRoot);
	const loader = projectLoader(project, packageRoot);
	if (!loader) return false;
	const bundledSkill = path.join(
		packageRoot,
		'.agents/skills/sto-report-generator/SKILL.md',
	);
	const humanizer = path.join(
		packageRoot,
		'.agents/skills/humanizer-ru/SKILL.md',
	);
	if (
		![bundledSkill, humanizer].every(
			file =>
				existsWithoutSymlink(file, 'isFile') &&
				safeAncestors(path.dirname(file), packageRoot),
		)
	)
		return false;
	let directory = project;
	for (const name of ['.agents', 'skills', PACKAGE_NAME]) {
		directory = path.join(directory, name);
		try {
			fs.mkdirSync(directory);
		} catch (error) {
			if (error.code !== 'EEXIST') throw error;
		}
		if (!existsWithoutSymlink(directory, 'isDirectory')) return false;
	}
	const destination = path.join(directory, 'SKILL.md');
	try {
		fs.writeFileSync(destination, loader, { flag: 'wx' });
	} catch (error) {
		if (error.code !== 'EEXIST') throw error;
		// Leave foreign files and symlinks untouched, including changed loaders.
		return (
			existsWithoutSymlink(destination, 'isFile') &&
			fs.readFileSync(destination, 'utf8') === loader
		);
	}
	return true;
}

function reportSkillFiles(project) {
	if (activateProjectSkill(project))
		return ['.agents/skills/sto-report-generator/SKILL.md'];
	console.warn(
		'Report skill entry could not be created safely. Keep the report and generator on the same drive, and check for existing .agents files or symlinks.',
	);
	return [];
}

module.exports = {
	installProjectSkill,
	activateProjectSkill,
	reportSkillFiles,
	projectLoader,
};

if (require.main === module) {
	try {
		installProjectSkill();
	} catch (error) {
		console.warn(`STO project skill activation skipped: ${error.message}`);
	}
}
