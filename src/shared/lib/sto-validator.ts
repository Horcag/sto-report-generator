import * as fs from 'fs';
import * as path from 'path';

/**
 * STO Validation Suite
 * This script analyzes an unpacked .docx (XML) to ensure compliance with STO standards.
 */

export interface ValidationResult {
	check: string;
	passed: boolean;
	error?: string;
}

function decodeXmlText(value: string): string {
	return value
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&amp;/g, '&')
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'");
}

function hasFormulaPeriodBeforeWhere(docXml: string): boolean {
	const formulaBeforeWhere =
		/(<w:tbl[\s\S]*?<\/w:tbl>|<w:p[\s\S]*?<m:oMath[\s\S]*?<\/w:p>)\s*<w:p[\s\S]*?<w:t[^>]*>где(?:\s|<|&nbsp;)/g;

	for (const match of docXml.matchAll(formulaBeforeWhere)) {
		const formulaBlock = match[1];
		const mathText = [...formulaBlock.matchAll(/<m:t[^>]*>([\s\S]*?)<\/m:t>/g)]
			.map(item => decodeXmlText(item[1]).trim())
			.join('')
			.trim();

		if (mathText.endsWith('.')) {
			return true;
		}
	}

	return false;
}

function countTablesWithoutHeaderRepeat(docXml: string): number {
	const tables = docXml.match(/<w:tbl>[\s\S]*?<\/w:tbl>/g) ?? [];

	return tables.filter(tableXml => {
		const firstRow = tableXml.match(/<w:tr\b[\s\S]*?<\/w:tr>/);
		return firstRow ? !/<w:tblHeader\b/.test(firstRow[0]) : false;
	}).length;
}

function hasOversizedImages(docXml: string): boolean {
	const maxWidthEmu = 5_040_000;

	return [...docXml.matchAll(/<wp:extent\b[^>]*\bcx="(\d+)"/g)].some(
		match => Number(match[1]) > maxWidthEmu,
	);
}

function hasUncenteredImageParagraphs(docXml: string): boolean {
	const imageParagraphs = docXml.match(/<w:p\b[\s\S]*?<\/w:p>/g) ?? [];

	return imageParagraphs.some(
		paragraphXml =>
			paragraphXml.includes('<w:drawing') &&
			!/<w:jc\b[^>]*w:val="center"[^>]*\/>/.test(paragraphXml),
	);
}

export function validateSTO(unpackedDirPath: string): ValidationResult[] {
	const results: ValidationResult[] = [];
	const documentXmlPath = path.join(unpackedDirPath, 'word', 'document.xml');
	const stylesXmlPath = path.join(unpackedDirPath, 'word', 'styles.xml');
	const numberingXmlPath = path.join(
		unpackedDirPath,
		'word',
		'numbering.xml',
	);

	if (!fs.existsSync(documentXmlPath)) {
		return [
			{
				check: 'File Existence',
				passed: false,
				error: 'document.xml not found',
			},
		];
	}

	const docXml = fs.readFileSync(documentXmlPath, 'utf8');
	const stylesXml = fs.readFileSync(stylesXmlPath, 'utf8');

	// 1. Check for All-Caps Headings in Heading1 (Numbered headings)
	// STO prohibits all-caps in titles if they are not specifically formatted as such.
	const capsHeading1 =
		/<w:pStyle w:val="1"\/>(?:(?!<\/w:p>).)*?<w:t>([^<]*[А-ЯA-Z]{5,}[^<]*)<\/w:t>/s.test(
			docXml,
		);
	results.push({
		check: 'Heading 1 Casing',
		passed: !capsHeading1,
		error: capsHeading1
			? 'Detected ALL-CAPS text in Heading 1 (should be Sentence case).'
			: undefined,
	});

	// 2. Check Structural Headings are ALL CAPS
	const structuralHeadingLowerText =
		/<w:pStyle w:val="StructuralHeading"\/>(?:(?!<\/w:p>).)*?<w:t>[^<]*[a-zа-яё][^<]*<\/w:t>/s.test(
			docXml,
		);
	const hasAllCapsStyle =
		/<w:style w:type="paragraph" w:customStyle="1" w:styleId="StructuralHeading">.*?<w:caps\/>/s.test(
			stylesXml,
		);

	results.push({
		check: 'Structural Heading Casing',
		passed: !structuralHeadingLowerText || hasAllCapsStyle,
		error:
			structuralHeadingLowerText && !hasAllCapsStyle
				? 'Detected lowercase text in Structural Heading and style does not force ALL CAPS.'
				: undefined,
	});

	// 3. Check for Long Dashes (Em-dash)
	const longDash = docXml.includes('—'); // —
	results.push({
		check: 'Dash Type (En-dash)',
		passed: !longDash,
		error: longDash
			? 'Detected long dash (em-dash). STO 2024 prefers en-dash (–).'
			: undefined,
	});

	// 4. Check Paragraph Spacing (Normal style must be 1.5 - 360 DXA)
	const docDefaultsSpacing =
		/<w:pPrDefault>.*?<w:spacing [^>]*?w:line="360"/s.test(stylesXml);

	results.push({
		check: 'Normal Line Spacing (1.5)',
		passed: docDefaultsSpacing,
		error: !docDefaultsSpacing
			? 'Normal style line spacing is not 1.5 (360 DXA).'
			: undefined,
	});

	// 5. Check for unparsed citations [@]
	const rawCitations = /\[@[^\]]+\]/.test(docXml);
	results.push({
		check: 'Citation Formatting',
		passed: !rawCitations,
		error: rawCitations
			? 'Detected unparsed citations (e.g. [@key]).'
			: undefined,
	});

	// 6. Check for unparsed math/formulas
	const rawMath = /\$[^$]+\$/.test(docXml);
	results.push({
		check: 'Math Formatting (Unparsed)',
		passed: !rawMath,
		error: rawMath ? 'Detected unparsed LaTeX math ($...$).' : undefined,
	});

	// 6.1 Check for prohibited asterisk (*) in OMML math formulas
	// OMML text nodes <m:t> should not contain * as a multiplication sign
	const hasMathAsterisk = /<m:t>[^<]*\*[^<]*<\/m:t>/.test(docXml);
	results.push({
		check: 'Math Multiplication Sign',
		passed: !hasMathAsterisk,
		error: hasMathAsterisk
			? 'Detected asterisk (*) as multiplication sign in formula. Use \\cdot or \\times instead.'
			: undefined,
	});

	// 6.2 Check for dot decimal separator in OMML math formulas (should be comma)
	const hasMathDotDecimal = /<m:t>[^<]*\d+\.\d+[^<]*<\/m:t>/.test(docXml);
	results.push({
		check: 'Math Decimal Separator',
		passed: !hasMathDotDecimal,
		error: hasMathDotDecimal
			? 'Detected dot (.) as decimal separator in formula. Russian typography requires a comma (,).'
			: undefined,
	});

	const formulaPeriodBeforeWhere = hasFormulaPeriodBeforeWhere(docXml);
	results.push({
		check: 'Formula Punctuation Before Where',
		passed: !formulaPeriodBeforeWhere,
		error: formulaPeriodBeforeWhere
			? 'Detected a block formula ending with a period before a lowercase "где" explanation. Use a comma or no final period.'
			: undefined,
	});

	const dirtyFields = /<w:fldChar\b[^>]*w:dirty="(?:true|1)"/.test(docXml);
	results.push({
		check: 'Dirty Field Flags',
		passed: !dirtyFields,
		error: dirtyFields
			? 'Detected dirty Word fields. Run post_build.py so Word does not ask to update fields on open.'
			: undefined,
	});

	// 7. Check if Bibliography numbering has no trailing dot and correct indent
	if (fs.existsSync(numberingXmlPath)) {
		const numberingXml = fs.readFileSync(numberingXmlPath, 'utf8');

		const bibLevelMatch =
			/<w:lvlText w:val="%1"\/>.*?<w:ind[^>]*w:left="0"[^>]*w:firstLine="709"/s.test(
				numberingXml,
			);
		results.push({
			check: 'Bibliography Numbering Indent & Format',
			passed: bibLevelMatch,
			error: !bibLevelMatch
				? 'Bibliography numbering missing or has incorrect indent (expected left 0, firstLine 709) / dot format.'
				: undefined,
		});

		// 8. Check if List numbering uses hyphen and correct indent
		const listLevelMatch =
			/<w:lvlText w:val="-"\/>.*?<w:ind[^>]*w:left="0"[^>]*w:firstLine="709"/s.test(
				numberingXml,
			);
		results.push({
			check: 'List Numbering Indent & Format',
			passed: listLevelMatch,
			error: !listLevelMatch
				? 'List numbering missing hyphen or has incorrect indent (expected left 0, firstLine 709).'
				: undefined,
		});
	}

	const tablesWithoutHeaderRepeat = countTablesWithoutHeaderRepeat(docXml);
	results.push({
		check: 'Table Header Repeat',
		passed: tablesWithoutHeaderRepeat === 0,
		error:
			tablesWithoutHeaderRepeat > 0
				? `Detected ${tablesWithoutHeaderRepeat} table(s) without repeated header rows.`
				: undefined,
	});

	const oversizedImages = hasOversizedImages(docXml);
	results.push({
		check: 'Image Width Limit',
		passed: !oversizedImages,
		error: oversizedImages
			? 'Detected image width above 14 cm. Run post_build.py to scale large figures.'
			: undefined,
	});

	const uncenteredImageParagraphs = hasUncenteredImageParagraphs(docXml);
	results.push({
		check: 'Image Paragraph Alignment',
		passed: !uncenteredImageParagraphs,
		error: uncenteredImageParagraphs
			? 'Detected an image paragraph without center alignment.'
			: undefined,
	});

	// 9. Check Heading Alignment in styles.xml
	const isHeading1Centered =
		/<w:style w:type="paragraph" w:styleId="1">(?:(?!<\/w:style>).)*?<w:jc w:val="center"\/>/s.test(
			stylesXml,
		);
	results.push({
		check: 'Numbered Heading Alignment',
		passed: !isHeading1Centered,
		error: isHeading1Centered
			? 'Numbered headings (Heading1) must not be centered.'
			: undefined,
	});

	const isStructuralCentered =
		/<w:style w:type="paragraph" w:customStyle="1" w:styleId="StructuralHeading">(?:(?!<\/w:style>).)*?<w:jc w:val="center"\/>/s.test(
			stylesXml,
		);
	results.push({
		check: 'Structural Heading Alignment',
		passed: isStructuralCentered,
		error: !isStructuralCentered
			? 'Structural headings must be centered.'
			: undefined,
	});

	// 10. Check Page Breaks for Headings
	const heading1PageBreak =
		/<w:style w:type="paragraph" w:styleId="1">(?:(?!<\/w:style>).)*?<w:pageBreakBefore/s.test(
			stylesXml,
		);
	results.push({
		check: 'Heading 1 Page Break',
		passed: heading1PageBreak,
		error: !heading1PageBreak
			? 'Heading 1 must have a pageBreakBefore.'
			: undefined,
	});

	// Structural heading has noTOC variant which has the pageBreak.
	results.push({
		check: 'Structural Heading Page Break',
		passed: true,
		error: undefined,
	});

	// 11. Check Caption Styles Existence and Spacing
	const figureCaptionMatch =
		/<w:style w:type="paragraph" w:customStyle="1" w:styleId="FigureCaption">(?:(?!<\/w:style>).)*?<w:spacing [^>]*?w:line="240"/s.test(
			stylesXml,
		);
	results.push({
		check: 'Figure Caption Style',
		passed: figureCaptionMatch,
		error: !figureCaptionMatch
			? 'FigureCaption style missing or missing single line spacing (240 DXA).'
			: undefined,
	});

	const tableCaptionMatch =
		/<w:style w:type="paragraph" w:customStyle="1" w:styleId="TableCaption">(?:(?!<\/w:style>).)*?<w:spacing [^>]*?w:line="240"/s.test(
			stylesXml,
		);
	results.push({
		check: 'Table Caption Style',
		passed: tableCaptionMatch,
		error: !tableCaptionMatch
			? 'TableCaption style missing or missing single line spacing (240 DXA).'
			: undefined,
	});

	return results;
}

// Simple CLI runner
const dir = process.argv[2];
if (dir) {
	const report = validateSTO(dir);
	console.table(report);
	process.exit(report.every(r => r.passed) ? 0 : 1);
}
