import fs from 'node:fs';
import path from 'node:path';
import { ImageRun, TextRun } from 'docx';
import imageSize from 'image-size';
import { Tokens } from 'marked';

import { InlineDocxElement, ParserContext } from '../../types';

function resolveImagePath(href: string, context: ParserContext): string | null {
	if (/^(https?:|file:|#)/i.test(href)) {
		return null;
	}

	const candidates = path.isAbsolute(href)
		? [href]
		: [
				...(context.sourceDir
					? [path.resolve(context.sourceDir, href)]
					: []),
				path.resolve(process.cwd(), href),
			];
	return (
		candidates.find(candidate => fs.existsSync(candidate)) ??
		candidates[0] ??
		null
	);
}

/**
 * Handles image tokens and converts them to Docx ImageRun.
 */
export async function handleImage(
	token: Tokens.Image,
	context: ParserContext,
): Promise<InlineDocxElement[]> {
	const imgPath = resolveImagePath(token.href, context);

	if (!imgPath || !fs.existsSync(imgPath)) {
		console.warn(`Image not found: ${token.href}`);
		return [
			new TextRun({
				text: `[Image not found: ${token.href}]`,
				color: 'FF0000',
			}),
		];
	}

	const imgBuffer = fs.readFileSync(imgPath);
	const dimensions = imageSize(imgBuffer);
	const maxWidth = 450;

	let w = dimensions.width ?? 400;
	let h = dimensions.height ?? 300;

	if (w > maxWidth) {
		h = globalThis.Math.round(h * (maxWidth / w));
		w = maxWidth;
	}

	let ext = path.extname(imgPath).slice(1).toLowerCase();
	if (ext === 'jpeg') ext = 'jpg';

	if (ext === 'svg') {
		return [
			new ImageRun({
				data: imgBuffer,
				type: 'svg',
				fallback: { data: imgBuffer, type: 'png' },
				transformation: { width: w, height: h },
			}),
		];
	}

	return [
		new ImageRun({
			data: imgBuffer,
			type: ext as 'png' | 'jpg' | 'gif' | 'bmp',
			transformation: { width: w, height: h },
		}),
	];
}
