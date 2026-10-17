import fsd from '@feature-sliced/steiger-plugin';
import { defineConfig } from 'steiger';

export default defineConfig([
	...fsd.configs.recommended,
	{
		ignores: ['**/*.test.ts', '**/__fixtures__/**', '**/fixtures/**'],
	},
	{
		files: ['./src/shared/**'],
		rules: {
			'fsd/public-api': 'off',
		},
	},
	{
		files: ['./src/index.ts'],
		rules: {
			'fsd/no-segmentless-slices': 'off',
			'fsd/public-api': 'off',
		},
	},
]);
