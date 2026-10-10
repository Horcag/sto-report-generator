import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { deflateSync } from 'node:zlib';

import {
	FigureSettings,
	planFigure,
	validateFigureSettings,
} from '@/shared/lib/figures';

import { png, pngChunk } from './planning_fixtures';

export function runPngValidationTests(
	root: string,
	defaults: FigureSettings,
): void {
	const missingPalette = Buffer.from(
		'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAMAAAAoyzS7AAAACklEQVR4nGNgAAAAAgABSK+kcQAAAABJRU5ErkJggg==',
		'base64',
	);
	const indexedHeader = Buffer.from(missingPalette.subarray(16, 29));
	indexedHeader[8] = 1;
	const signature = missingPalette.subarray(0, 8);
	const headerChunk = pngChunk('IHDR', indexedHeader);
	const pixels = deflateSync(Buffer.from([0, 0]));
	const dataChunk = pngChunk('IDAT', pixels);
	const palette = pngChunk('PLTE', Buffer.from([0, 0, 0, 255, 255, 255]));
	const end = pngChunk('IEND', Buffer.alloc(0));
	const rejectPng = (name: string, data: Buffer, message: RegExp): void => {
		fs.writeFileSync(path.join(root, name), data);
		assert.throws(() => planFigure(root, name, 'bad', defaults), message);
	};
	rejectPng('missing-palette.png', missingPalette, /requires PLTE/);
	rejectPng(
		'palette-too-large.png',
		Buffer.concat([
			signature,
			headerChunk,
			pngChunk('PLTE', Buffer.alloc(9)),
			dataChunk,
			end,
		]),
		/Invalid PNG palette/,
	);
	rejectPng(
		'palette-invalid-length.png',
		Buffer.concat([
			signature,
			headerChunk,
			pngChunk('PLTE', Buffer.alloc(4)),
			dataChunk,
			end,
		]),
		/Invalid PNG palette/,
	);
	rejectPng(
		'palette-after-data.png',
		Buffer.concat([
			signature,
			png(1, 1).subarray(8, 33),
			png(1, 1).subarray(33, -12),
			palette,
			end,
		]),
		/palette order/,
	);
	rejectPng(
		'unknown-critical.png',
		Buffer.concat([
			signature,
			headerChunk,
			pngChunk('FAKE', Buffer.alloc(0)),
			palette,
			dataChunk,
			end,
		]),
		/Unknown PNG critical/,
	);
	rejectPng(
		'not-first-header.png',
		Buffer.concat([
			signature,
			pngChunk('tEXt', Buffer.from('x')),
			headerChunk,
			palette,
			dataChunk,
			end,
		]),
		/IHDR must be first/,
	);
	rejectPng(
		'duplicate-header.png',
		Buffer.concat([
			signature,
			headerChunk,
			headerChunk,
			palette,
			dataChunk,
			end,
		]),
		/Invalid PNG header/,
	);
	rejectPng(
		'split-idat.png',
		Buffer.concat([
			signature,
			headerChunk,
			palette,
			pngChunk('IDAT', pixels.subarray(0, 2)),
			pngChunk('tEXt', Buffer.from('x')),
			pngChunk('IDAT', pixels.subarray(2)),
			end,
		]),
		/must be consecutive/,
	);
	rejectPng(
		'after-end.png',
		Buffer.concat([
			signature,
			headerChunk,
			palette,
			dataChunk,
			end,
			pngChunk('tEXt', Buffer.from('x')),
		]),
		/Invalid PNG end/,
	);
	fs.writeFileSync(
		path.join(root, 'valid-indexed.png'),
		Buffer.concat([
			signature,
			headerChunk,
			palette,
			pngChunk('IDAT', pixels.subarray(0, 2)),
			pngChunk('IDAT', pixels.subarray(2)),
			end,
		]),
	);
	assert.equal(
		planFigure(root, 'valid-indexed.png', 'indexed', defaults).intrinsicPx
			.width,
		1,
	);
	for (const id of ['__proto__', 'constructor', 'prototype']) {
		assert.throws(
			() =>
				validateFigureSettings(JSON.parse(`{"figures":{"${id}":{}}}`)),
			/reserved figure ID/,
		);
		assert.throws(
			() => planFigure(root, 'wide.png', id, defaults),
			/reserved figure ID/,
		);
	}
}
