import { inflateSync } from 'node:zlib';

function crc32(data: Buffer): number {
	let crc = 0xffffffff;
	for (const byte of data) {
		crc ^= byte;
		for (let bit = 0; bit < 8; bit++)
			crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
	}
	return (crc ^ 0xffffffff) >>> 0;
}

/** Decode PNG scanlines and verify their shape; do not accept renamed SVG bytes. */
export function validatePng(data: Buffer): void {
	if (
		!data
			.subarray(0, 8)
			.equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
	)
		throw new Error('SVG fallback must contain a real PNG');
	const chunks: Buffer[] = [];
	let header: Buffer | undefined;
	let ended = false;
	let paletteSeen = false;
	let imageDataStarted = false;
	let imageDataEnded = false;
	for (let offset = 8; offset + 12 <= data.length;) {
		const length = data.readUInt32BE(offset);
		if (offset + length + 12 > data.length)
			throw new Error('Truncated PNG fallback');
		const kind = data.toString('ascii', offset + 4, offset + 8);
		const payload = data.subarray(offset + 8, offset + 8 + length);
		if (!/^[A-Za-z]{2}[A-Z][A-Za-z]$/u.test(kind))
			throw new Error('Invalid PNG chunk type');
		if (!header && kind !== 'IHDR')
			throw new Error('PNG IHDR must be first');
		if (
			/^[A-Z]/u.test(kind) &&
			!['IHDR', 'PLTE', 'IDAT', 'IEND'].includes(kind)
		)
			throw new Error(`Unknown PNG critical chunk: ${kind}`);
		if (
			crc32(data.subarray(offset + 4, offset + 8 + length)) !==
			data.readUInt32BE(offset + 8 + length)
		)
			throw new Error('Invalid PNG chunk checksum');
		if (kind === 'IHDR') {
			if (header || offset !== 8 || length !== 13)
				throw new Error('Invalid PNG header');
			header = payload;
		}
		if (kind === 'PLTE') {
			if (
				paletteSeen ||
				imageDataStarted ||
				!header ||
				[0, 4].includes(header[9]) ||
				!length ||
				length % 3 !== 0 ||
				length > 768 ||
				(header[9] === 3 && length / 3 > 2 ** header[8])
			)
				throw new Error('Invalid PNG palette or palette order');
			paletteSeen = true;
		}
		if (kind === 'IDAT') {
			if (imageDataEnded)
				throw new Error('PNG IDAT chunks must be consecutive');
			if (header?.[9] === 3 && !paletteSeen)
				throw new Error('Indexed PNG requires PLTE before IDAT');
			imageDataStarted = true;
			chunks.push(payload);
		} else if (imageDataStarted) imageDataEnded = true;
		if (kind === 'IEND') {
			ended = true;
			if (length !== 0 || offset + 12 !== data.length)
				throw new Error('Invalid PNG end');
			break;
		}
		offset += length + 12;
	}
	if (!header || !ended || !chunks.length)
		throw new Error('Invalid PNG fallback pixel data');
	const width = header.readUInt32BE(0),
		height = header.readUInt32BE(4);
	const depth = header[8],
		color = header[9],
		interlace = header[12];
	const channels = new Map([
		[0, 1],
		[2, 3],
		[3, 1],
		[4, 2],
		[6, 4],
	]).get(color);
	const validDepths =
		color === 0 ? [1, 2, 4, 8, 16] : color === 3 ? [1, 2, 4, 8] : [8, 16];
	if (
		!width ||
		!height ||
		!channels ||
		!validDepths.includes(depth) ||
		header[10] !== 0 ||
		header[11] !== 0 ||
		interlace > 1
	)
		throw new Error('Invalid PNG pixel format');
	const decoded = inflateSync(Buffer.concat(chunks), {
		maxOutputLength: 64 * 1024 * 1024,
	});
	const passes = interlace
		? [
				[0, 0, 8, 8],
				[4, 0, 8, 8],
				[0, 4, 4, 8],
				[2, 0, 4, 4],
				[0, 2, 2, 4],
				[1, 0, 2, 2],
				[0, 1, 1, 2],
			]
		: [[0, 0, 1, 1]];
	let offset = 0;
	for (const [x, y, dx, dy] of passes) {
		const columns = Math.max(0, Math.ceil((width - x) / dx));
		const rows = Math.max(0, Math.ceil((height - y) / dy));
		if (!columns || !rows) continue;
		const stride = 1 + Math.ceil((columns * channels * depth) / 8);
		for (let row = 0; row < rows; row++) {
			if (offset >= decoded.length || decoded[offset] > 4)
				throw new Error('Invalid PNG scanline');
			offset += stride;
		}
	}
	if (offset !== decoded.length)
		throw new Error('Invalid PNG decoded pixel length');
}
