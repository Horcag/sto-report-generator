const { createHash } = require('node:crypto');
const fs = require('node:fs');
const { createRequire } = require('node:module');
const path = require('node:path');

const STEIGER_VERSION = '0.7.0';
const CHUNK = 'dist/chunk-Q6YAZP6J.mjs';
const ORIGINAL_SHA256 =
	'7ec721213feb6b2a08d23590c490794a5208e926d8131b07ebb26cea7f3aef3e';
const PATCHED_SHA256 =
	'9ca4f7d0cb44a6e23f906274afd27e45bb7c1372f4261a2152801bf25659d120';
// Zod v4 function factories are not schemas. Keep both result forms validated
// without forcing synchronous rules to become asynchronous.
const FUNCTION_SCHEMA = `z.custom((value) => typeof value === "function", { message: "Expected function" }).transform((check) => function(...args) {
              const result = check.apply(this, args);
              if (result && typeof result.then === "function" && typeof result.catch === "function") {
                return Promise.resolve(result).then((value) => ruleResultScheme.parse(value));
              }
              return ruleResultScheme.parse(result);
            })`;

function sha256(source) {
	return createHash('sha256').update(source).digest('hex');
}

function patchSource(source, version) {
	if (version !== STEIGER_VERSION) {
		throw new Error(
			`Unsupported Steiger version: ${version}; expected ${STEIGER_VERSION}`,
		);
	}
	const hash = sha256(source);
	if (hash === PATCHED_SHA256) return source;
	if (hash !== ORIGINAL_SHA256) {
		throw new Error(`Unexpected Steiger preimage: ${hash}`);
	}
	// Enum records became exhaustive in v4. Install the parsed plugin functions
	// so runtime calls use their result validators instead of the original checks.
	const patched = source
		.replace('rules: z.record(', 'rules: z.partialRecord(')
		.replace(
			'z.function().args().returns(z.union([z.promise(ruleResultScheme), ruleResultScheme]))',
			FUNCTION_SCHEMA,
		)
		.replace(
			'const plugins = rawConfig.filter(isPlugin);',
			'const plugins = validatedConfig.filter(isPlugin);',
		);
	if (sha256(patched) !== PATCHED_SHA256) {
		throw new Error('Steiger patch did not produce the expected source');
	}
	return patched;
}

function dependencyVersion(requireFromSteiger, name) {
	let directory = path.dirname(requireFromSteiger.resolve(name));
	while (directory !== path.dirname(directory)) {
		const manifest = path.join(directory, 'package.json');
		if (fs.existsSync(manifest)) {
			const metadata = JSON.parse(fs.readFileSync(manifest, 'utf8'));
			if (metadata.name === name) return metadata.version;
		}
		directory = path.dirname(directory);
	}
	throw new Error(`Cannot identify installed ${name}`);
}

function patchInstallation(root = path.resolve(__dirname, '../..')) {
	const packageDirectory = path.join(root, 'node_modules/steiger');
	const manifestPath = path.join(packageDirectory, 'package.json');
	// Production installs omit this development-only linter.
	if (!fs.existsSync(packageDirectory)) return false;
	const metadata = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
	const requireFromSteiger = createRequire(manifestPath);
	for (const [name, expected] of [
		['zod', '4.6.6'],
		['zod-validation-error', '4.0.2'],
	]) {
		const version = dependencyVersion(requireFromSteiger, name);
		if (version !== expected)
			throw new Error(
				`Unexpected ${name} version: ${version}; expected ${expected}`,
			);
	}
	const chunkPath = path.join(packageDirectory, CHUNK);
	const source = fs.readFileSync(chunkPath, 'utf8');
	const patched = patchSource(source, metadata.version);
	if (source !== patched) fs.writeFileSync(chunkPath, patched);
	return true;
}

module.exports = {
	patchInstallation,
	patchSource,
	ORIGINAL_SHA256,
	PATCHED_SHA256,
	CHUNK,
};

if (require.main === module) patchInstallation();
