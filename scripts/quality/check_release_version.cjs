const fs = require('node:fs');
const path = require('node:path');

function validateRelease(metadata, lock, changelog, tag = '') {
	const version = metadata.version;
	if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) {
		throw new Error(
			`Expected a stable MAJOR.MINOR.PATCH version: ${version}`,
		);
	}
	if (lock.version !== version || lock.packages?.['']?.version !== version) {
		throw new Error('package.json and package-lock.json versions differ');
	}
	if (tag && tag !== `v${version}`) {
		throw new Error(`Release tag ${tag} must equal v${version}`);
	}
	const latestHeading = changelog
		.split(/\r?\n/)
		.find(line => /^## \d/.test(line));
	if (latestHeading !== `## ${version}`) {
		throw new Error(
			`CHANGELOG.md must contain a release heading: ## ${version}`,
		);
	}
	return version;
}

module.exports = { validateRelease };

if (require.main === module) {
	const root = path.resolve(__dirname, '../..');
	const read = file => fs.readFileSync(path.join(root, file), 'utf8');
	try {
		const version = validateRelease(
			JSON.parse(read('package.json')),
			JSON.parse(read('package-lock.json')),
			read('CHANGELOG.md'),
			process.env.RELEASE_TAG || '',
		);
		console.log(`Release metadata verified: ${version}`);
	} catch (error) {
		console.error(error.message);
		process.exitCode = 1;
	}
}
