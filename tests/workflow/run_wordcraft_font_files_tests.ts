import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { selectWordcraftFontFiles } from '@/app/wordcraft-font-files';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sto-font-files-'));
let assertions = 0;
function check(
	condition: unknown,
	message = 'Expected condition to hold',
): void {
	assert.ok(condition, message);
	assertions += 1;
}
function font(
	family: string,
	style = 'Regular',
	base = 0,
	extra: [number, string][] = [],
): Buffer {
	const records: [number, string][] = [[1, family], [2, style], ...extra];
	const strings = records.map(([, value]) =>
		Buffer.from(value, 'utf16le').swap16(),
	);
	const storage = 6 + records.length * 12;
	const names = Buffer.alloc(
		storage + strings.reduce((sum, bytes) => sum + bytes.length, 0),
	);
	names.writeUInt16BE(records.length, 2);
	names.writeUInt16BE(storage, 4);
	let position = 0;
	for (let index = 0; index < records.length; index += 1) {
		const offset = 6 + index * 12;
		names.writeUInt16BE(3, offset);
		names.writeUInt16BE(1, offset + 2);
		names.writeUInt16BE(0x0409, offset + 4);
		names.writeUInt16BE(records[index][0], offset + 6);
		names.writeUInt16BE(strings[index].length, offset + 8);
		names.writeUInt16BE(position, offset + 10);
		strings[index].copy(names, storage + position);
		position += strings[index].length;
	}
	const header = Buffer.alloc(28);
	header.writeUInt32BE(0x00010000);
	header.writeUInt16BE(1, 4);
	header.write('name', 12, 'ascii');
	header.writeUInt32BE(base + 28, 20);
	header.writeUInt32BE(names.length, 24);
	return Buffer.concat([header, names]);
}
function collection(faces: [string, string][]): Buffer {
	const header = Buffer.alloc(12 + 4 * faces.length);
	header.write('ttcf', 0, 'ascii');
	header.writeUInt32BE(0x00010000, 4);
	header.writeUInt32BE(faces.length, 8);
	let position = header.length;
	const buffers = faces.map(([family, style], index) => {
		header.writeUInt32BE(position, 12 + 4 * index);
		const buffer = font(family, style, position);
		position += buffer.length;
		return buffer;
	});
	return Buffer.concat([header, ...buffers]);
}
function write(name: string, bytes: Buffer): string {
	const file = path.join(directory, name);
	fs.writeFileSync(file, bytes);
	return file;
}
try {
	const regular = write('regular.ttf', font('Fixture'));
	const bold = write('bold.otf', font('Fixture', 'Bold'));
	const other = write('other.ttf', font('Unrequested'));
	const selected = selectWordcraftFontFiles(
		[regular, bold, other],
		['fixture'],
	);
	check(selected.files.join(',') === [bold, regular].sort().join(','));
	check(selected.warnings.length === 0);
	check(
		selected.fileSha256[regular] ===
			createHash('sha256').update(fs.readFileSync(regular)).digest('hex'),
	);
	check(Object.keys(selected.fileSha256).length === 2);
	check(
		selectWordcraftFontFiles(
			[path.join(directory, 'does-not-exist.ttf')],
			[],
		).warnings.length === 0,
	);
	check(
		selectWordcraftFontFiles([regular], ['Absent']).warnings.some(warning =>
			warning.includes('No usable explicit font file found for Absent'),
		),
	);
	const unicode = write('unicode.ttf', font('Шрифт', 'Обычный'));
	check(selectWordcraftFontFiles([unicode], ['ШРИФТ']).files[0] === unicode);
	const typographic = write(
		'typographic.ttf',
		font('Legacy Family', 'Legacy Style', 0, [
			[16, 'Typographic Family'],
			[17, 'Regular'],
		]),
	);
	check(
		selectWordcraftFontFiles([typographic], ['Typographic Family'])
			.files[0] === typographic,
	);
	check(
		selectWordcraftFontFiles([typographic], ['Legacy Family']).files[0] ===
			typographic,
	);
	const duplicate = write('duplicate.ttf', fs.readFileSync(regular));
	check(
		selectWordcraftFontFiles([regular, duplicate, regular], ['Fixture'])
			.files.length === 1,
	);
	const sameFace = write(
		'same-face.ttf',
		Buffer.concat([font('Fixture'), Buffer.from('different bytes')]),
	);
	const dedup = selectWordcraftFontFiles([regular, sameFace], ['Fixture']);
	check(dedup.files.length === 1 && dedup.files[0] === regular);
	check(
		dedup.warnings.some(warning =>
			warning.includes('overlapping font faces'),
		),
	);
	const roman = write('roman.ttf', font('Fixture', 'Roman'));
	check(
		selectWordcraftFontFiles([regular, roman], ['Fixture']).files.length ===
			1,
	);
	const ttc = write(
		'collection.ttc',
		collection([
			['Cambria', 'Regular'],
			['Cambria Math', 'Regular'],
		]),
	);
	const collectionResult = selectWordcraftFontFiles([ttc], ['Cambria Math']);
	check(collectionResult.files[0] === ttc);
	check(
		collectionResult.warnings.some(warning =>
			warning.includes('unrequested families'),
		),
	);
	const first = write('a-first.ttf', font('Fixture'));
	const overlap = write(
		'b-overlap.ttc',
		collection([
			['Fixture', 'Regular'],
			['Missing Math', 'Regular'],
		]),
	);
	const overlapResult = selectWordcraftFontFiles(
		[overlap, first],
		['Fixture', 'Missing Math'],
	);
	check(overlapResult.files.length === 1 && overlapResult.files[0] === first);
	check(
		overlapResult.warnings.some(warning =>
			warning.includes('additional collection faces'),
		),
	);
	check(
		overlapResult.warnings.some(warning =>
			warning.includes(
				'No usable explicit font file found for Missing Math',
			),
		),
	);
	const web = write('font.woff2', Buffer.from('webfont'));
	check(
		selectWordcraftFontFiles([web], ['Fixture']).warnings.some(warning =>
			warning.includes('WOFF/WOFF2 are not inspected'),
		),
	);
	const overlappingNames = (count: number): Buffer => {
		const storage = 6 + count * 12;
		const length = 65534;
		const buffer = Buffer.alloc(28 + storage + length);
		buffer.writeUInt32BE(0x00010000);
		buffer.writeUInt16BE(1, 4);
		buffer.write('name', 12, 'ascii');
		buffer.writeUInt32BE(28, 20);
		buffer.writeUInt32BE(storage + length, 24);
		buffer.writeUInt16BE(count, 30);
		buffer.writeUInt16BE(storage, 32);
		for (let index = 0; index < count; index++) {
			const record = 34 + index * 12;
			buffer.writeUInt16BE(3, record);
			buffer.writeUInt16BE(1, record + 2);
			buffer.writeUInt16BE(0x0409, record + 4);
			buffer.writeUInt16BE(index === count - 1 ? 2 : 1, record + 6);
			buffer.writeUInt16BE(length, record + 8);
		}
		Buffer.from('Fixture', 'utf16le')
			.swap16()
			.copy(buffer, 28 + storage);
		return buffer;
	};
	const oversizedNames = write(
		'overlapping-names.ttf',
		overlappingNames(140),
	);
	const nameBudgetResult = selectWordcraftFontFiles(
		[oversizedNames],
		['Fixture'],
	);
	check(nameBudgetResult.files.length === 0);
	check(
		nameBudgetResult.warnings.some(warning =>
			warning.includes('8 MiB per-file budget'),
		),
	);
	const sharedNames = overlappingNames(70);
	const sharedHeader = sharedNames.subarray(0, 28);
	sharedHeader.writeUInt32BE(76, 20);
	const ttcHeader = Buffer.alloc(20);
	ttcHeader.write('ttcf');
	ttcHeader.writeUInt32BE(0x00010000, 4);
	ttcHeader.writeUInt32BE(2, 8);
	ttcHeader.writeUInt32BE(20, 12);
	ttcHeader.writeUInt32BE(48, 16);
	const sharedTtc = write(
		'shared-name-budget.ttc',
		Buffer.concat([
			ttcHeader,
			sharedHeader,
			sharedHeader,
			sharedNames.subarray(28),
		]),
	);
	const ttcBudgetResult = selectWordcraftFontFiles([sharedTtc], ['Fixture']);
	check(ttcBudgetResult.files.length === 0);
	check(
		ttcBudgetResult.warnings.some(warning =>
			warning.includes('8 MiB per-file budget'),
		),
	);
	const duplicateOffsets = collection([
		['Fixture', 'Regular'],
		['Other', 'Regular'],
	]);
	duplicateOffsets.writeUInt32BE(duplicateOffsets.readUInt32BE(12), 16);
	const duplicateTtc = write('duplicate-offsets.ttc', duplicateOffsets);
	const duplicateTtcResult = selectWordcraftFontFiles(
		[duplicateTtc],
		['Fixture'],
	);
	check(duplicateTtcResult.files.length === 0);
	check(
		duplicateTtcResult.warnings.some(warning =>
			warning.includes('duplicate TTC face offsets'),
		),
	);
	const malformed: [string, Buffer][] = [
		['truncated.ttf', Buffer.alloc(4)],
		['signature.ttf', Buffer.alloc(12)],
		['ttc-count.ttc', Buffer.from('ttcf0001ffffffff', 'ascii')],
	];
	const badTable = font('Fixture');
	badTable.writeUInt32BE(0xffffffff, 20);
	malformed.push(['table-range.ttf', badTable]);
	const badName = font('Fixture');
	badName.writeUInt16BE(0xffff, 28 + 6 + 10);
	malformed.push(['name-range.ttf', badName]);
	const oddName = font('Fixture');
	oddName.writeUInt16BE(1, 28 + 6 + 8);
	malformed.push(['name-odd.ttf', oddName]);
	const badStorage = font('Fixture');
	badStorage.writeUInt16BE(0, 28 + 4);
	malformed.push(['name-storage.ttf', badStorage]);
	const badNameCount = font('Fixture');
	badNameCount.writeUInt16BE(0xffff, 28 + 2);
	malformed.push(['name-count.ttf', badNameCount]);
	const noFamily = font('Fixture');
	noFamily.writeUInt16BE(4, 28 + 6 + 6);
	malformed.push(['no-family.ttf', noFamily]);
	const missingFile = path.join(directory, 'missing.ttf');
	const large = write('large.ttf', Buffer.alloc(0));
	fs.truncateSync(large, 32 * 1024 * 1024 + 1);
	for (const filename of [
		...malformed.map(([name, bytes]) => write(name, bytes)),
		missingFile,
		large,
	]) {
		const result = selectWordcraftFontFiles([filename], ['Fixture']);
		check(
			result.files.length === 0 &&
				result.warnings.some(warning =>
					warning.includes('Skipped font'),
				),
			filename,
		);
		check(
			result.warnings.some(warning =>
				warning.includes('No usable explicit font file found'),
			),
			filename,
		);
	}
	const otf = font('OTF Family');
	otf.write('OTTO', 0, 'ascii');
	check(
		selectWordcraftFontFiles([write('sfnt.otf', otf)], ['OTF Family']).files
			.length === 1,
	);
	check(
		fs.readFileSync(regular).equals(font('Fixture')),
		'source font bytes preserved',
	);
} finally {
	fs.rmSync(directory, { recursive: true, force: true });
}
console.log(
	`Wordcraft font file selection tests passed (${assertions} assertions).`,
);
