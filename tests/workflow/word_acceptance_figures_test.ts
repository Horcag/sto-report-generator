import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { deflateSync } from 'node:zlib';
import AdmZip from 'adm-zip';

import { compareFigureEvidence } from '@/app/word-acceptance-figures';
import { verifyAcceptedDocxIntegrity } from '@/app/word-acceptance-integrity';

import { png as makePng, pngChunk } from '../figures/planning_fixtures';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const png = makePng(1, 1);
const temporary = fs.mkdtempSync(
	path.join(os.tmpdir(), 'sto-figure-integrity-'),
);
const source = path.join(temporary, 'source.docx');
const accepted = path.join(temporary, 'accepted.docx');
function drawing(name = 'sto-figure:one', crop = '', width = 914400) {
	return `<w:p><w:r><w:drawing><wp:inline><wp:extent cx="${width}" cy="914400"/><wp:docPr id="1" name="${name}"/><a:graphic><a:blip r:embed="image"/><a14:useLocalDpi val="0"/>${crop}</a:graphic></wp:inline></w:drawing></w:r></w:p>`;
}
function write(
	target: string,
	drawings: string[],
	data = png,
	compression = true,
	mediaName = 'image.png',
	relationship = 'image',
) {
	const archive = new AdmZip();
	archive.addFile(
		'word/document.xml',
		Buffer.from(
			`<w:document xmlns:w="${W}" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:a14="http://schemas.microsoft.com/office/drawing/2010/main"><w:body>${drawings.join('').replaceAll('r:embed="image"', `r:embed="${relationship}"`)}</w:body></w:document>`,
		),
	);
	archive.addFile(
		'word/settings.xml',
		Buffer.from(
			`<w:settings xmlns:w="${W}">${compression ? '<w:doNotAutoCompressPictures/>' : ''}</w:settings>`,
		),
	);
	archive.addFile(
		'word/_rels/document.xml.rels',
		Buffer.from(
			`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="${relationship}" Target="media/${mediaName}"/></Relationships>`,
		),
	);
	archive.addFile(`word/media/${mediaName}`, data);
	archive.writeZip(target);
}
try {
	write(source, [drawing(), drawing()]);
	write(accepted, [drawing(), drawing()], png, true, 'renamed.png', 'rId99');
	let checks = compareFigureEvidence(source, accepted);
	assert.equal(checks.status, 'preserved');
	assert.deepEqual(
		checks.occurrences.map(item => item.identity),
		['sto-figure:one#1', 'sto-figure:one#2'],
	);
	assert.equal(checks.occurrences[0].source.payloads[0].pixelWidth, 1);
	assert.equal(checks.occurrences[0].source.payloads[0].effectiveDpi?.x, 1);
	write(accepted, [drawing()]);
	assert.equal(compareFigureEvidence(source, accepted).status, 'failed');
	write(accepted, [
		drawing(),
		drawing('sto-figure:one', '<a:srcRect b="100"/>'),
	]);
	assert.equal(
		compareFigureEvidence(source, accepted).occurrences[0].preserved,
		true,
	);
	assert.equal(
		compareFigureEvidence(source, accepted).occurrences[1].preserved,
		false,
	);
	write(source, [drawing()]);
	write(
		accepted,
		[drawing()],
		Buffer.concat([png, Buffer.from('recompressed')]),
	);
	assert.match(
		compareFigureEvidence(source, accepted).issues.join(),
		/payloads changed/,
	);
	const resized = Buffer.from(png);
	resized.writeUInt32BE(2, 16);
	write(accepted, [drawing()], resized);
	assert.equal(
		compareFigureEvidence(source, accepted).occurrences[0].accepted
			?.payloads[0].pixelWidth,
		2,
	);
	assert.equal(compareFigureEvidence(source, accepted).status, 'failed');
	write(accepted, [drawing('sto-figure:one', '<a:srcRect l="1000"/>')]);
	assert.match(
		compareFigureEvidence(source, accepted).issues.join(),
		/crop changed/,
	);
	write(accepted, [drawing('sto-figure:one', '', 900000)]);
	assert.match(
		compareFigureEvidence(source, accepted).issues.join(),
		/extent changed/,
	);
	write(accepted, [drawing('Picture 1')]);
	assert.match(
		compareFigureEvidence(source, accepted).issues.join(),
		/identity.*lost/,
	);
	write(accepted, [drawing()], png, false);
	assert.match(
		compareFigureEvidence(source, accepted).issues.join(),
		/compression protection/,
	);
	write(accepted, [drawing().replace('<a14:useLocalDpi val="0"/>', '')]);
	assert.equal(compareFigureEvidence(source, accepted).status, 'preserved');
	assert.deepEqual(
		compareFigureEvidence(source, accepted).occurrences[0].accepted
			?.localDpi,
		[],
	);
	write(accepted, [
		drawing().replace(
			'<w:p>',
			'<w:p><w:pPr><w:spacing w:lineRule="exact" w:line="240"/></w:pPr>',
		),
	]);
	assert.match(
		compareFigureEvidence(source, accepted).issues.join(),
		/line height clips/,
	);
	const manifest: Record<string, unknown> = { status: 'pendingCleanup' };
	assert.throws(
		() =>
			verifyAcceptedDocxIntegrity(
				source,
				accepted,
				path.join(temporary, 'manifest.json'),
				manifest,
			),
		/line height clips/,
	);
	assert.equal(manifest.status, 'failed');
	assert.equal(
		(manifest.figureChecks as { status: string }).status,
		'failed',
	);
	write(source, [drawing('Legacy image')], png, false);
	write(accepted, [drawing('Legacy image')], png, false);
	checks = compareFigureEvidence(source, accepted);
	assert.equal(checks.status, 'unknown');
	assert.equal(checks.occurrences[0].preserved, null);
	write(
		accepted,
		[
			drawing('Legacy image').replace(
				'r:embed="image"',
				'r:link="external"',
			),
		],
		png,
		false,
	);
	assert.equal(compareFigureEvidence(source, accepted).status, 'unknown');
	write(source, [drawing()]);
	write(accepted, [drawing()]);
	const brokenArchive = new AdmZip(accepted);
	brokenArchive.deleteFile('word/media/image.png');
	brokenArchive.writeZip(accepted);
	assert.match(
		compareFigureEvidence(source, accepted).issues.join(),
		/Embedded image is missing/,
	);
	const svg = Buffer.from(
		'<svg xmlns="http://www.w3.org/2000/svg" width="20" height="10"><rect width="20" height="10"/></svg>',
	);
	write(source, [drawing()], svg);
	write(accepted, [drawing()], svg);
	assert.equal(
		compareFigureEvidence(source, accepted).occurrences[0].source
			.payloads[0].kind,
		'vector',
	);
	write(
		accepted,
		[drawing()],
		Buffer.from(svg.toString().replace('rect', 'path')),
	);
	assert.match(
		compareFigureEvidence(source, accepted).issues.join(),
		/payloads changed/,
	);
	write(source, [drawing()]);
	write(accepted, [
		drawing(
			'sto-figure:one',
			'<a:srcRect l="0000" t="0" r="0" b="0"/><a:xfrm rot="000" flipH="false" flipV="0"><a:off x="000" y="0"/><a:ext cx="0914400" cy="914400"/></a:xfrm>',
		).replace('cx="914400" cy="914400"', 'cx="00914400" cy="00914400"'),
	]);
	assert.equal(compareFigureEvidence(source, accepted).status, 'preserved');
	write(accepted, [drawing('sto-figure:one', '<a:xfrm rot="1"/>')]);
	assert.match(
		compareFigureEvidence(source, accepted).issues.join(),
		/geometry changed/,
	);
	write(accepted, [drawing('sto-figure:one', '<a:xfrm flipH="true"/>')]);
	assert.match(
		compareFigureEvidence(source, accepted).issues.join(),
		/geometry changed/,
	);
	write(accepted, [drawing('sto-figure:one', '', 914401)]);
	assert.match(
		compareFigureEvidence(source, accepted).issues.join(),
		/extent changed/,
	);
	write(source, [
		drawing('sto-figure:one', '<a:srcRect l="25000" r="25000" t="50000"/>'),
	]);
	write(accepted, [
		drawing(
			'sto-figure:one',
			'<a:srcRect l="025000" r="25%" t="050000" b="000"/>',
		),
	]);
	checks = compareFigureEvidence(source, accepted);
	assert.equal(checks.status, 'preserved');
	assert.deepEqual(checks.occurrences[0].source.payloads[0].effectiveDpi, {
		x: 0.5,
		y: 0.5,
	});
	write(accepted, [drawing()]);
	checks = compareFigureEvidence(source, accepted);
	assert.match(checks.issues.join(), /crop changed/);
	assert.doesNotMatch(checks.issues.join(), /payloads changed/);
	const fallbackArchive = new AdmZip(source);
	fallbackArchive.updateFile(
		'word/document.xml',
		Buffer.from(
			fallbackArchive
				.readAsText('word/document.xml')
				.replace(
					'<a:graphic>',
					'<a:graphic xmlns:asvg="http://schemas.microsoft.com/office/drawing/2016/SVG/main"><asvg:svgBlip r:embed="vector"/>',
				),
		),
	);
	fallbackArchive.updateFile(
		'word/_rels/document.xml.rels',
		Buffer.from(
			fallbackArchive
				.readAsText('word/_rels/document.xml.rels')
				.replace(
					'</Relationships>',
					'<Relationship Id="vector" Target="media/image.svg"/></Relationships>',
				),
		),
	);
	fallbackArchive.addFile('word/media/image.svg', svg);
	fallbackArchive.writeZip(source);
	fallbackArchive.writeZip(accepted);
	checks = compareFigureEvidence(source, accepted);
	assert.equal(checks.status, 'preserved');
	assert.deepEqual(
		checks.occurrences[0].source.payloads.map(payload => payload.kind),
		['raster', 'vector'],
	);
	assert.deepEqual(checks.occurrences[0].source.payloads[0].effectiveDpi, {
		x: 0.5,
		y: 0.5,
	});
	assert.equal(checks.occurrences[0].source.payloads[1].effectiveDpi, null);
	const withDimensions = (width: number, height: number, native = false) => {
		const data = makePng(width, height);
		return native
			? Buffer.concat([
					data.subarray(0, -12),
					pngChunk('tEXt', Buffer.from('renderer\0Word preview')),
					data.subarray(-12),
				])
			: data;
	};
	fallbackArchive.updateFile(
		'word/media/image.png',
		withDimensions(1800, 900),
	);
	fallbackArchive.writeZip(source);
	for (const [width, height, expected] of [
		[2400, 1200, 'preserved'],
		[1800, 900, 'preserved'],
		[1799, 900, 'failed'],
		[1800, 899, 'failed'],
		[2400, 899, 'failed'],
		[2400, 900, 'failed'],
	] as const) {
		fallbackArchive.updateFile(
			'word/media/image.png',
			withDimensions(width, height, true),
		);
		fallbackArchive.writeZip(accepted);
		checks = compareFigureEvidence(source, accepted);
		assert.equal(checks.status, expected, `SVG preview ${width}x${height}`);
		const payload = checks.occurrences[0].payloadChecks;
		assert.equal(payload.vectorBytesPreserved, true);
		assert.equal(payload.rasterBytesPreserved, false);
		assert.equal(payload.fallbackRegenerated, expected === 'preserved');
		if (payload.fallbackRegeneration) {
			assert.equal(payload.fallbackRegeneration.source.pixelWidth, 1800);
			assert.equal(
				payload.fallbackRegeneration.accepted.pixelWidth,
				width,
			);
			assert.match(
				payload.fallbackRegeneration.reason,
				/visual PDF review is required/,
			);
		}
	}
	fallbackArchive.updateFile(
		'word/media/image.png',
		withDimensions(2400, 1200),
	);
	fallbackArchive.updateFile(
		'word/media/image.svg',
		Buffer.from(svg.toString().replace('rect', 'path')),
	);
	fallbackArchive.writeZip(accepted);
	checks = compareFigureEvidence(source, accepted);
	assert.equal(checks.status, 'failed');
	assert.equal(
		checks.occurrences[0].payloadChecks.vectorBytesPreserved,
		false,
	);
	assert.equal(
		checks.occurrences[0].payloadChecks.fallbackRegenerated,
		false,
	);
	fallbackArchive.updateFile('word/media/image.svg', svg);
	fallbackArchive.deleteFile('word/media/image.png');
	fallbackArchive.writeZip(accepted);
	assert.equal(compareFigureEvidence(source, accepted).status, 'failed');
	write(source, [drawing()], withDimensions(1800, 900));
	write(accepted, [drawing()], withDimensions(2400, 1200));
	assert.equal(compareFigureEvidence(source, accepted).status, 'failed');
	assert.equal(
		compareFigureEvidence(source, accepted).occurrences[0].payloadChecks
			.fallbackRegenerated,
		false,
	);
	// Changed previews must be fully decodable, not merely carry larger IHDR values.
	const valid = makePng(2400, 1200);
	const staleCrc = Buffer.from(valid);
	staleCrc.writeUInt32BE(2401, 16);
	const falseHeader = Buffer.from(makePng(1800, 900).subarray(16, 29));
	falseHeader.writeUInt32BE(2400);
	falseHeader.writeUInt32BE(1200, 4);
	const inconsistentPixels = Buffer.concat([
		makePng(1800, 900).subarray(0, 8),
		pngChunk('IHDR', falseHeader),
		makePng(1800, 900).subarray(33),
	]);
	const badScanlines = Buffer.alloc((2400 * 3 + 1) * 1200);
	badScanlines[0] = 5;
	const invalidFilter = Buffer.concat([
		valid.subarray(0, 33),
		pngChunk('IDAT', deflateSync(badScanlines)),
		pngChunk('IEND', Buffer.alloc(0)),
	]);
	for (const malformed of [
		staleCrc,
		valid.subarray(0, -10),
		inconsistentPixels,
		invalidFilter,
		Buffer.concat([valid, Buffer.from('native-preview')]),
	]) {
		fallbackArchive.updateFile('word/media/image.svg', svg);
		fallbackArchive.addFile('word/media/image.png', malformed);
		fallbackArchive.writeZip(accepted);
		// Rebuild an actual SVG+PNG source, not the primary-raster negative fixture.
		fallbackArchive.addFile('word/media/image.png', makePng(1800, 900));
		fallbackArchive.writeZip(source);
		checks = compareFigureEvidence(source, accepted);
		assert.equal(checks.status, 'failed');
		assert.equal(
			checks.occurrences[0].payloadChecks.fallbackRegenerated,
			false,
		);
		assert.equal(
			checks.occurrences[0].accepted?.payloads[0].pixelDataValid,
			false,
		);
		assert.ok(checks.occurrences[0].accepted?.payloads[0].validationError);
	}
	console.log(
		'Word figure integrity: 39 cases passed (duplicate occurrences, renamed relationships, raster bytes/resolution, crop, extent, lost identity, compression protection, reported localDpi, paragraph clipping, failed manifest, legacy unknown, vector hashes, equivalent XML defaults, exact extent, crop-adjusted DPI and SVG/PNG fallback regeneration matrix).',
	);
} finally {
	fs.rmSync(temporary, { recursive: true, force: true });
}
