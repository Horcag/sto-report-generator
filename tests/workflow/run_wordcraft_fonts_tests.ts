import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import AdmZip from 'adm-zip';

import {
	preflightWordcraftFonts,
	readWordcraftFontDirectory,
	wordcraftFontCommands,
} from '@/app/wordcraft-fonts';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sto-fonts-test-'));
const source = path.join(directory, 'fonts.docx');
const w = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const m = 'http://schemas.openxmlformats.org/officeDocument/2006/math';
let assertions = 0;
function check(condition: unknown): void {
	assert.ok(condition);
	assertions += 1;
}
try {
	const archive = new AdmZip();
	archive.addFile(
		'word/document.xml',
		Buffer.from(
			`<w:document xmlns:w="${w}" xmlns:m="${m}"><w:body><w:p><w:pPr><w:pStyle w:val="Body"/></w:pPr><w:r><w:t>Текст</w:t></w:r><w:r><w:rPr><w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/></w:rPr><w:t>code</w:t></w:r><m:oMath><m:r><m:t>x</m:t></m:r></m:oMath></w:p></w:body></w:document>`,
		),
	);
	archive.addFile(
		'word/styles.xml',
		Buffer.from(
			`<w:styles xmlns:w="${w}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/></w:rPr></w:rPrDefault></w:docDefaults><w:style w:type="paragraph" w:styleId="Normal" w:default="1"><w:rPr><w:rFonts w:asciiTheme="minorHAnsi" w:hAnsiTheme="minorHAnsi"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Body"><w:basedOn w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Unused"><w:rPr><w:rFonts w:ascii="Unused Family"/></w:rPr></w:style></w:styles>`,
		),
	);
	archive.addFile(
		'word/theme/theme1.xml',
		Buffer.from(
			'<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:themeElements><a:fontScheme><a:minorFont><a:latin typeface="Times New Roman"/></a:minorFont></a:fontScheme></a:themeElements></a:theme>',
		),
	);
	archive.writeZip(source);
	const original = fs.readFileSync(source);
	const report = preflightWordcraftFonts(
		source,
		'font.add: {"families":["Courier New"]}\nfont.list: {"families":["times new roman","Courier New"]}',
	);
	check(
		report.requiredFamilies.join(',') ===
			'Cambria Math,Courier New,Times New Roman',
	);
	check(report.missingFamilies.join(',') === 'Cambria Math');
	check(report.unverifiedRequirements.length === 0);
	check(
		report.warnings.length === 1 &&
			report.warnings[0].includes('substitute'),
	);
	check(fs.readFileSync(source).equals(original));
	archive.addFile(
		'word/settings.xml',
		Buffer.from(
			`<w:settings xmlns:w="${w}" xmlns:m="${m}"><m:mathPr><m:mathFont m:val="Custom Math"/></m:mathPr></w:settings>`,
		),
	);
	archive.writeZip(source);
	check(
		preflightWordcraftFonts(
			source,
			'{"families":[]}',
		).requiredFamilies.includes('Custom Math'),
	);
	const customCatalog = ['Times New Roman', 'Courier New', 'Custom Math'];
	const customOnly = preflightWordcraftFonts(
		source,
		JSON.stringify({ families: customCatalog }),
	);
	check(customOnly.missingFamilies.join(',') === 'Cambria Math');
	check(
		customOnly.unverifiedRequirements.some(requirement =>
			requirement.includes(
				'ignores the configured math font Custom Math',
			),
		),
	);
	const bothMathFonts = preflightWordcraftFonts(
		source,
		JSON.stringify({ families: [...customCatalog, 'Cambria Math'] }),
	);
	check(bothMathFonts.missingFamilies.length === 0);
	check(bothMathFonts.unverifiedRequirements.length === 1);
	for (const configured of ['Cambria Math', '']) {
		archive.updateFile(
			'word/settings.xml',
			Buffer.from(
				`<w:settings xmlns:w="${w}" xmlns:m="${m}"><m:mathPr><m:mathFont m:val="${configured}"/></m:mathPr></w:settings>`,
			),
		);
		archive.writeZip(source);
		const standardMath = preflightWordcraftFonts(
			source,
			JSON.stringify({
				families: ['Times New Roman', 'Courier New', 'Cambria Math'],
			}),
		);
		check(standardMath.missingFamilies.length === 0);
		check(standardMath.unverifiedRequirements.length === 0);
	}
	archive.deleteFile('word/theme/theme1.xml');
	archive.writeZip(source);
	check(
		preflightWordcraftFonts(source, '{"families":[]}').warnings.some(
			warning => warning.includes('could not resolve theme'),
		),
	);
	archive.addFile(
		'word/header1.xml',
		Buffer.from(
			`<w:hdr xmlns:w="${w}"><w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/></w:tblPr><w:tr><w:tc><w:p><w:r><w:rPr><w:rFonts w:ascii="Header Font" w:hAnsi="Header Font"/></w:rPr><w:t>Header</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:hdr>`,
		),
	);
	archive.writeZip(source);
	const headerReport = preflightWordcraftFonts(source, '{"families":[]}');
	check(headerReport.requiredFamilies.includes('Header Font'));
	check(
		headerReport.unverifiedRequirements.some(requirement =>
			requirement.includes('conditional table style'),
		),
	);
	check(
		headerReport.warnings.some(warning =>
			warning.includes('conditional table style'),
		),
	);
	archive.deleteFile('word/styles.xml');
	archive.writeZip(source);
	check(
		preflightWordcraftFonts(source, '{"families":[]}').warnings.some(
			warning => warning.includes('engine defaults'),
		),
	);
	for (const value of [
		'invalid',
		'{"fonts":[]}',
		'{"families":[null]}',
		'null',
	]) {
		assert.throws(
			() => preflightWordcraftFonts(source, value),
			/font.list/,
		);
		assertions += 1;
	}
	check(wordcraftFontCommands().length === 0);
	check(readWordcraftFontDirectory().length === 0);
	assert.throws(
		() => readWordcraftFontDirectory(path.join(directory, 'missing')),
		/font directory/,
	);
	assert.throws(() => readWordcraftFontDirectory(source), /font directory/);
	assert.throws(() => readWordcraftFontDirectory(''), /font directory/);
	assertions += 3;
	const fontsDirectory = path.join(directory, 'fonts');
	fs.mkdirSync(fontsDirectory);
	assert.throws(
		() => readWordcraftFontDirectory(fontsDirectory),
		/no supported font files/,
	);
	assertions += 1;
	for (const name of [
		'z.woff2',
		'A.TTF',
		'b.otf',
		'collection.ttc',
		'web.woff',
		'ignore.txt',
	])
		fs.writeFileSync(path.join(fontsDirectory, name), 'fixture');
	fs.mkdirSync(path.join(fontsDirectory, 'nested.ttf'));
	check(
		readWordcraftFontDirectory(fontsDirectory)
			.map(file => path.basename(file))
			.join(',') === 'A.TTF,b.otf,collection.ttc,web.woff,z.woff2',
	);
	const font = path.join(directory, 'example font.ttf');
	fs.writeFileSync(font, 'fixture');
	check(
		wordcraftFontCommands([font, font]).join(',') ===
			`--cmd,font.add=${JSON.stringify({ path: font })}`,
	);
	for (const file of [
		'',
		source,
		path.join(directory, 'missing.ttf'),
		directory,
	]) {
		assert.throws(() => wordcraftFontCommands([file]), /font file/);
		assertions += 1;
	}
	const simpleReport = (
		properties: string,
		styles = '',
		content = '<w:t>Text</w:t>',
	) => {
		const simple = new AdmZip();
		simple.addFile(
			'word/document.xml',
			Buffer.from(
				`<w:document xmlns:w="${w}" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><w:body><w:p><w:r><w:rPr>${properties}</w:rPr>${content}</w:r></w:p></w:body></w:document>`,
			),
		);
		if (styles)
			simple.addFile(
				'word/styles.xml',
				Buffer.from(`<w:styles xmlns:w="${w}">${styles}</w:styles>`),
			);
		simple.writeZip(source);
		return preflightWordcraftFonts(source, '{"families":["Available"]}');
	};
	const prior = (family: string) =>
		`<w:rPrChange w:id="1" w:author="author" w:date="2026-10-21T00:00:00Z"><w:rPr><w:rFonts w:ascii="${family}"/></w:rPr></w:rPrChange>`;
	const currentMissing = simpleReport(
		'<w:rFonts w:ascii="Missing"/>' + prior('Available'),
	);
	check(currentMissing.requiredFamilies.join(',') === 'Missing');
	check(currentMissing.missingFamilies.join(',') === 'Missing');
	const currentAvailable = simpleReport(
		'<w:rFonts w:ascii="Available"/>' + prior('Missing'),
	);
	check(currentAvailable.requiredFamilies.join(',') === 'Available');
	check(currentAvailable.missingFamilies.length === 0);
	check(currentAvailable.unverifiedRequirements.length === 0);
	const defaults =
		'<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Available"/>' +
		prior('Missing') +
		'</w:rPr></w:rPrDefault></w:docDefaults>';
	check(
		simpleReport('', defaults).requiredFamilies.join(',') === 'Available',
	);
	const inherited =
		'<w:style w:type="paragraph" w:styleId="Normal" w:default="1"><w:basedOn w:val="Base"/></w:style><w:style w:type="paragraph" w:styleId="Base"><w:rPr><w:rFonts w:ascii="Available"/>' +
		prior('Missing') +
		'</w:rPr></w:style>';
	check(
		simpleReport('', inherited).requiredFamilies.join(',') === 'Available',
	);
	const unusedScriptThemes = simpleReport(
		'<w:rFonts w:ascii="Available" w:eastAsiaTheme="majorEastAsia" w:csTheme="minorBidi"/>',
	);
	check(unusedScriptThemes.unverifiedRequirements.length === 0);
	check(unusedScriptThemes.warnings.length === 0);
	check(
		simpleReport(
			'<w:rFonts w:asciiTheme="minorHAnsi"/>',
		).unverifiedRequirements.some(requirement =>
			requirement.includes('could not resolve theme'),
		),
	);
	const unresolvedDefaults =
		'<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:asciiTheme="minorHAnsi"/></w:rPr></w:rPrDefault></w:docDefaults>';
	check(
		simpleReport('<w:rFonts w:ascii="Available"/>', unresolvedDefaults)
			.unverifiedRequirements.length === 0,
	);
	check(
		simpleReport(
			'',
			'',
			'<w:drawing><a:t>Drawing</a:t></w:drawing>',
		).unverifiedRequirements.some(requirement =>
			requirement.includes('DrawingML'),
		),
	);
	const forcedComplex = simpleReport(
		'<w:rFonts w:ascii="Available" w:cs="Missing"/><w:cs/>',
	);
	check(forcedComplex.requiredFamilies.join(',') === 'Missing');
	check(forcedComplex.missingFamilies.join(',') === 'Missing');
	const inheritedComplex =
		'<w:style w:type="paragraph" w:styleId="Normal" w:default="1"><w:rPr><w:rFonts w:ascii="Available" w:cs="Missing"/><w:cs/></w:rPr></w:style>';
	check(
		simpleReport('', inheritedComplex).missingFamilies.join(',') ===
			'Missing',
	);
	const disabledComplex = simpleReport('<w:cs w:val="0"/>', inheritedComplex);
	check(disabledComplex.requiredFamilies.join(',') === 'Available');
	check(disabledComplex.missingFamilies.length === 0);
	const defaultComplex =
		'<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Available" w:cs="Missing"/><w:cs/></w:rPr></w:rPrDefault></w:docDefaults>';
	check(
		simpleReport('', defaultComplex).missingFamilies.join(',') ===
			'Missing',
	);
	check(
		simpleReport(
			'<w:rFonts w:ascii="Available"/>' +
				prior('Missing').replace(
					'<w:rFonts w:ascii="Missing"/>',
					'<w:rFonts w:cs="Missing"/><w:cs/>',
				),
		).unverifiedRequirements.length === 0,
	);
} finally {
	fs.rmSync(directory, { recursive: true, force: true });
}
console.log(`Wordcraft font tests passed (${assertions} assertions).`);
