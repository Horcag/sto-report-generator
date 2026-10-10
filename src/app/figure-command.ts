import fs from 'node:fs';

import {
	importFigureSettings,
	runFigureInspector,
	updateFigureSettings,
} from './figure-inspector';

export interface FigureCommandArgs {
	positionals: string[];
	options: ReadonlyMap<string, string | boolean>;
}

export function runFigureCommand(args: FigureCommandArgs): void {
	const option = (name: string): string | undefined => {
		const value = args.options.get(name);
		return typeof value === 'string' ? value : undefined;
	};
	const action = args.positionals[1];
	const reportDir = args.positionals[2];
	if (!reportDir || !['inspect', 'preview', 'set'].includes(action))
		throw new Error(
			'figures requires inspect|preview|set and a report directory.',
		);
	if (action === 'set') {
		const settings = option('settings');
		if (settings) {
			importFigureSettings(
				reportDir,
				JSON.parse(fs.readFileSync(settings, 'utf8')),
			);
			console.log('Figure settings imported and verified.');
			return;
		}
		const id = option('id');
		const spec = option('spec');
		if (!id || !spec)
			throw new Error('figures set requires --id and --spec JSON.');
		updateFigureSettings(reportDir, id, JSON.parse(spec));
		console.log(`Figure ${id} settings saved and verified.`);
		return;
	}
	const result = runFigureInspector({
		reportDir,
		mode: action === 'preview' ? 'preview' : 'inspect',
		outputPath: option('output'),
		json: args.options.has('json'),
	});
	console.log(JSON.stringify(result, null, 2));
}
