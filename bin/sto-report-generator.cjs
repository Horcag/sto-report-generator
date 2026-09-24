#!/usr/bin/env node

const path = require('node:path');

const packageRoot = path.resolve(__dirname, '..');
require('tsconfig-paths').register({
	baseUrl: packageRoot,
	paths: { '@/*': ['src/*'] },
});
require('tsx/cjs');
require(path.join(packageRoot, 'src/index.ts'));
