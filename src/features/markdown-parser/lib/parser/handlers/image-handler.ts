import * as fs from 'fs';
import * as path from 'path';

import { ImageRun, TextRun } from 'docx';
import imageSize from 'image-size';
import { Tokens } from 'marked';

import { InlineDocxElement } from '../../types';

/**
 * Handles image tokens and converts them to Docx ImageRun.
 */
export async function handleImage(
	token: Tokens.Image,
): Promise<InlineDocxElement[]> {
	const workspaceRoot = process.cwd();
	const imgPath = path.resolve(workspaceRoot, token.href);

	if (!fs.existsSync(imgPath)) {
		console.warn(`Image not found: ${imgPath}`);
		return [
			new TextRun({
				text: `[Image not found: ${token.href}]`,
				color: 'FF0000',
			}),
		];
	}

	const imgBuffer = fs.readFileSync(imgPath);
	const dimensions = imageSize(imgBuffer);
	const maxWidth = 600;

	let w = dimensions.width ?? 500;
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
