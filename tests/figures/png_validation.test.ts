import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';

import { validatePng } from '@/shared/lib/figures/png';

import { pngChunk } from './planning_fixtures';

function image(
	width: number,
	height: number,
	pixels: Buffer,
	interlace = 0,
	depth = 8,
): Buffer {
	const header = Buffer.alloc(13);
	header.writeUInt32BE(width);
	header.writeUInt32BE(height, 4);
	header[8] = depth;
	header[9] = 6;
	header[12] = interlace;
	return Buffer.concat([
		Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
		pngChunk('IHDR', header),
		pngChunk('IDAT', pixels),
		pngChunk('IEND', Buffer.alloc(0)),
	]);
}

let cases = 0;
function check(name: string, run: () => void): void {
	run();
	cases++;
	console.log(`PASS ${name}`);
}

check('valid high-resolution PNG scanlines above 64 MiB', () => {
	const width = 5288;
	const height = 4737;
	const expectedBytes = (width * 4 + 1) * height;
	assert.ok(expectedBytes > 64 * 1024 * 1024);
	const compressed = deflateSync(Buffer.alloc(expectedBytes), { level: 1 });
	assert.ok(compressed.length < 1024 * 1024, 'fixture stays small in memory');
	validatePng(image(width, height, compressed));
});

for (const [name, width, height, interlace, depth] of [
	['over-budget header', 8192, 4096, 0, 8],
	['unsafe-size header', 0xffffffff, 0xffffffff, 0, 16],
	['over-budget Adam7 header', 8192, 4096, 1, 8],
] as const) {
	check(`${name} rejected before inflation`, () => {
		assert.throws(
			() =>
				imageAndValidate(
					width,
					height,
					Buffer.from('invalid zlib'),
					interlace,
					depth,
				),
			/128 MiB validation budget; resize the image/,
		);
	});
}

function imageAndValidate(
	width: number,
	height: number,
	compressed: Buffer,
	interlace = 0,
	depth = 8,
): void {
	validatePng(image(width, height, compressed, interlace, depth));
}

for (const [name, bytes] of [
	['truncated scanline', Buffer.alloc(4)],
	['extra decoded byte', Buffer.alloc(6)],
	['compressed bomb exceeds expected scanlines', Buffer.alloc(1024 * 1024)],
] as const) {
	check(name, () => {
		assert.throws(
			() => imageAndValidate(1, 1, deflateSync(bytes)),
			/Invalid PNG decoded pixel length|larger than/,
		);
	});
}

check('invalid scanline filter', () => {
	assert.throws(
		() => imageAndValidate(1, 1, deflateSync(Buffer.from([5, 0, 0, 0, 0]))),
		/Invalid PNG scanline/,
	);
});

// Adam7's seven passes for an 8x8 RGBA image, including each row's filter byte.
const passRows = [
	[1, 5],
	[1, 5],
	[1, 9],
	[2, 9],
	[2, 17],
	[4, 17],
	[4, 33],
];
const adam7 = Buffer.alloc(
	passRows.reduce((total, [rows, stride]) => total + rows * stride, 0),
);
check('valid Adam7 scanlines', () =>
	imageAndValidate(8, 8, deflateSync(adam7), 1),
);
check('empty Adam7 passes for a one-pixel image', () =>
	imageAndValidate(1, 1, deflateSync(Buffer.alloc(5)), 1),
);
check('truncated Adam7 final pass', () => {
	assert.throws(
		() => imageAndValidate(8, 8, deflateSync(adam7.subarray(0, -1)), 1),
		/Invalid PNG decoded pixel length/,
	);
});
check('invalid filter in the last Adam7 pass', () => {
	const invalid = Buffer.from(adam7);
	invalid[invalid.length - 33] = 5;
	assert.throws(
		() => imageAndValidate(8, 8, deflateSync(invalid), 1),
		/Invalid PNG scanline/,
	);
});
console.log(`PNG validation tests passed (${cases} cases).`);
