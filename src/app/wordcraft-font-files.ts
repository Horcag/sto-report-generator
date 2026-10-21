import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const MAX_FONT_BYTES = 32 * 1024 * 1024;
const MAX_NAME_RECORDS = 8192;
const MAX_DECODED_NAME_BYTES = 8 * 1024 * 1024;
interface NameBudget {
	remainingBytes: number;
}
interface FontFace {
	families: string[];
	style: string;
}
export interface WordcraftFontFileSelection {
	files: string[];
	warnings: string[];
	fileSha256: Record<string, string>;
}

function normalize(value: string): string {
	return value.normalize('NFC').trim().toLocaleLowerCase('en-US');
}
function requireRange(buffer: Buffer, offset: number, length: number): void {
	if (
		!Number.isSafeInteger(offset) ||
		offset < 0 ||
		length < 0 ||
		offset + length > buffer.length
	) {
		throw new Error('font metadata offset is outside the file');
	}
}
function decodeName(
	bytes: Buffer,
	platform: number,
	encoding: number,
	budget: NameBudget,
): string | undefined {
	if (
		platform === 0 ||
		(platform === 3 && [0, 1, 10].includes(encoding)) ||
		(platform === 1 && encoding === 0)
	) {
		if (bytes.length > budget.remainingBytes)
			throw new Error(
				'font name decoding exceeds the 8 MiB per-file budget',
			);
		budget.remainingBytes -= bytes.length;
	}
	if (platform === 0 || (platform === 3 && [0, 1, 10].includes(encoding))) {
		if (bytes.length % 2)
			throw new Error('font name has an invalid UTF-16BE length');
		return Buffer.from(bytes)
			.swap16()
			.toString('utf16le')
			.replace(/\0/g, '')
			.trim();
	}
	// ASCII is also valid Mac Roman; non-ASCII legacy encodings need a real decoder.
	if (platform === 1 && encoding === 0 && bytes.every(byte => byte < 128)) {
		return bytes.toString('ascii').replace(/\0/g, '').trim();
	}
	return undefined;
}

function readFace(
	buffer: Buffer,
	offset: number,
	budget: NameBudget,
): FontFace {
	requireRange(buffer, offset, 12);
	const signature = buffer.toString('ascii', offset, offset + 4);
	if (
		buffer.readUInt32BE(offset) !== 0x00010000 &&
		!['OTTO', 'true', 'typ1'].includes(signature)
	) {
		throw new Error('unsupported SFNT signature');
	}
	const tables = buffer.readUInt16BE(offset + 4);
	if (!tables || tables > 4096) throw new Error('invalid SFNT table count');
	requireRange(buffer, offset + 12, tables * 16);
	let nameOffset = -1;
	let nameLength = 0;
	for (let index = 0; index < tables; index += 1) {
		const entry = offset + 12 + index * 16;
		const tableOffset = buffer.readUInt32BE(entry + 8);
		const tableLength = buffer.readUInt32BE(entry + 12);
		requireRange(buffer, tableOffset, tableLength);
		if (buffer.toString('ascii', entry, entry + 4) === 'name') {
			if (nameOffset !== -1) throw new Error('duplicate SFNT name table');
			nameOffset = tableOffset;
			nameLength = tableLength;
		}
	}
	if (nameOffset === -1 || nameLength < 6)
		throw new Error('font has no readable name table');
	const table = buffer.subarray(nameOffset, nameOffset + nameLength);
	if (![0, 1].includes(table.readUInt16BE(0)))
		throw new Error('unsupported font name table format');
	const count = table.readUInt16BE(2);
	const storage = table.readUInt16BE(4);
	if (count > MAX_NAME_RECORDS || storage < 6 + count * 12)
		throw new Error('invalid name record count or storage offset');
	requireRange(table, 6, count * 12);
	requireRange(table, storage, 0);
	const names: { id: number; value: string; priority: number }[] = [];
	for (let index = 0; index < count; index += 1) {
		const record = 6 + index * 12;
		const platform = table.readUInt16BE(record);
		const encoding = table.readUInt16BE(record + 2);
		const language = table.readUInt16BE(record + 4);
		const id = table.readUInt16BE(record + 6);
		const length = table.readUInt16BE(record + 8);
		const start = storage + table.readUInt16BE(record + 10);
		requireRange(table, start, length);
		if (![1, 2, 16, 17].includes(id)) continue;
		const value = decodeName(
			table.subarray(start, start + length),
			platform,
			encoding,
			budget,
		);
		if (value)
			names.push({
				id,
				value,
				priority: language === 0x0409 ? 0 : platform === 0 ? 1 : 2,
			});
	}
	names.sort((left, right) => left.priority - right.priority);
	const families = [
		...new Set(
			names
				.filter(name => [1, 16].includes(name.id))
				.map(name => name.value),
		),
	];
	const style =
		names.find(name => name.id === 17)?.value ??
		names.find(name => name.id === 2)?.value;
	if (!families.length || !style)
		throw new Error('font family or subfamily metadata is unavailable');
	return { families, style };
}

function readFaces(buffer: Buffer): FontFace[] {
	requireRange(buffer, 0, 12);
	const budget = { remainingBytes: MAX_DECODED_NAME_BYTES };
	if (buffer.toString('ascii', 0, 4) !== 'ttcf')
		return [readFace(buffer, 0, budget)];
	if (![0x00010000, 0x00020000].includes(buffer.readUInt32BE(4)))
		throw new Error('unsupported TTC version');
	const count = buffer.readUInt32BE(8);
	if (!count || count > 256) throw new Error('invalid TTC face count');
	requireRange(buffer, 12, count * 4);
	const offsets = Array.from({ length: count }, (_, index) =>
		buffer.readUInt32BE(12 + index * 4),
	);
	if (new Set(offsets).size !== offsets.length)
		throw new Error('duplicate TTC face offsets');
	return offsets.map(offset => readFace(buffer, offset, budget));
}

function readFontFile(filename: string): Buffer {
	const descriptor = fs.openSync(filename, 'r');
	try {
		const stat = fs.fstatSync(descriptor);
		if (!stat.isFile() || stat.size > MAX_FONT_BYTES)
			throw new Error('expected a font file no larger than 32 MiB');
		const buffer = Buffer.alloc(stat.size);
		let position = 0;
		while (position < buffer.length) {
			const count = fs.readSync(
				descriptor,
				buffer,
				position,
				buffer.length - position,
				position,
			);
			if (!count) throw new Error('font file changed while reading');
			position += count;
		}
		if (fs.readSync(descriptor, Buffer.alloc(1), 0, 1, position))
			throw new Error('font file grew while reading');
		return buffer;
	} finally {
		fs.closeSync(descriptor);
	}
}

/** Select explicit missing families only; metadata inspection never installs fonts. */
export function selectWordcraftFontFiles(
	files: string[],
	missingFamilies: string[],
): WordcraftFontFileSelection {
	const result: WordcraftFontFileSelection = {
		files: [],
		warnings: [],
		fileSha256: {},
	};
	const requested = new Map(
		missingFamilies.map(family => [normalize(family), family]),
	);
	if (!requested.size) return result;
	const selectedFaces = new Set<string>();
	const selectedContent = new Set<string>();
	const resolved = new Set<string>();
	for (const filename of [
		...new Set(files.map(file => path.resolve(file))),
	].sort()) {
		if (!/\.(ttf|otf|ttc)$/i.test(filename)) {
			result.warnings.push(
				`Font metadata unsupported for ${filename}; only TTF, OTF and TTC can be selected (WOFF/WOFF2 are not inspected).`,
			);
			continue;
		}
		try {
			const buffer = readFontFile(filename);
			const faces = readFaces(buffer);
			const families = new Set(
				faces.flatMap(face => face.families.map(normalize)),
			);
			if (![...families].some(family => requested.has(family))) continue;
			const digest = createHash('sha256').update(buffer).digest('hex');
			if (selectedContent.has(digest)) continue;
			const keys = faces.flatMap(face => {
				const style = normalize(face.style).replace(
					/^(normal|roman)$/,
					'regular',
				);
				return face.families.map(
					family => `${normalize(family)}\0${style}`,
				);
			});
			if (keys.some(key => selectedFaces.has(key))) {
				result.warnings.push(
					`Skipped overlapping font faces in ${filename}; a previously selected file supplies at least one family/style, so additional collection faces may remain unavailable.`,
				);
				continue;
			}
			result.files.push(filename);
			result.fileSha256[filename] = digest;
			selectedContent.add(digest);
			for (const key of keys) selectedFaces.add(key);
			for (const family of families)
				if (requested.has(family)) resolved.add(family);
			if (
				faces.length > 1 &&
				[...families].some(family => !requested.has(family))
			) {
				result.warnings.push(
					`Selected collection ${filename} also exposes unrequested families; Wordcraft must confirm its catalog after loading.`,
				);
			}
		} catch (error) {
			result.warnings.push(
				`Skipped font ${filename}: ${(error as Error).message}`,
			);
		}
	}
	for (const [key, family] of requested) {
		if (!resolved.has(key))
			result.warnings.push(
				`No usable explicit font file found for ${family}.`,
			);
	}
	return result;
}
