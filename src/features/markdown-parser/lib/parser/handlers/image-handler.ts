import fs from 'node:fs';
import { ImageRun } from 'docx';
import { Tokens } from 'marked';

import { loadFigureSettings, planFigure } from '@/shared/lib/figures';

import { InlineDocxElement, ParserContext } from '../../types';

/** Plan each occurrence before embedding the unchanged source media. */
export async function handleImage(
	token: Tokens.Image,
	context: ParserContext,
): Promise<InlineDocxElement[]> {
	const sourceDir = context.sourceDir ?? process.cwd();
	let id = context.figureIds?.get(token);
	if (!id) {
		context.figureCounter = (context.figureCounter ?? 0) + 1;
		id = `figure-${context.figureCounter}`;
	}
	const plan = planFigure(
		sourceDir,
		token.href,
		id,
		context.figureSettings ?? loadFigureSettings(sourceDir),
	);
	context.figurePlans?.push(plan);
	for (const issue of plan.issues) {
		if (issue.severity === 'error') throw new Error(issue.message);
		console.warn(issue.message);
	}
	const options = {
		data: fs.readFileSync(plan.sourcePath),
		transformation: {
			width: (plan.widthMm * 96) / 25.4,
			height: (plan.heightMm * 96) / 25.4,
		},
		altText: {
			name: `sto-figure:${id}`,
			title: token.title ?? '',
			description: token.text,
		},
	};
	return [
		new ImageRun(
			plan.type === 'svg'
				? {
						...options,
						type: 'svg',
						fallback: {
							data: fs.readFileSync(plan.fallbackPath!),
							type: 'png',
						},
					}
				: { ...options, type: plan.type },
		),
	];
}
