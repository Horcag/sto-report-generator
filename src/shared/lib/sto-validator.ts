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

	// 1. Check for All-Caps Headings in Heading1 (Numbered headings)
	// STO prohibits all-caps in titles if they are not specifically formatted as such.
	const capsHeading1 =
		/<w:pStyle w:val="Heading1"\/>.*?<w:t>([^<]*[А-ЯA-Z]{5,}[^<]*)<\/w:t>/s.test(
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
	// StructuralHeadings should be uppercase
	// Note: The w:t tag content should be uppercase. We find all StructuralHeadings and see if any have lowercase.
	const structuralHeadingLowerCase =
		/<w:pStyle w:val="StructuralHeading"\/>.*?<w:t>[^<]*[a-zа-яё][^<]*<\/w:t>/s.test(
			docXml,
		);
	results.push({
		check: 'Structural Heading Casing',
		passed: !structuralHeadingLowerCase,
		error: structuralHeadingLowerCase
			? 'Detected lowercase text in Structural Heading (must be ALL CAPS).'
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
	const stylesXml = fs.readFileSync(stylesXmlPath, 'utf8');

	// Check if Normal style explicitly defines 1.5 spacing
	let normalSpacing =
		/<w:style w:type="paragraph" w:styleId="Normal">.*?<w:spacing [^>]*?w:line="360"/s.test(
			stylesXml,
		);

	// If not in Normal style, check if it's set in docDefaults (which Normal inherits if w:default="1")
	if (!normalSpacing) {
		const hasDocDefaultsSpacing =
			/<w:pPrDefault>.*?<w:spacing [^>]*?w:line="360"/s.test(stylesXml);
		const isNormalDefault =
			/<w:style w:type="paragraph" w:styleId="Normal" w:default="1">/.test(
				stylesXml,
			);
		if (hasDocDefaultsSpacing && isNormalDefault) {
			normalSpacing = true;
		}
	}

	results.push({
		check: 'Normal Line Spacing (1.5)',
		passed: normalSpacing,
		error: !normalSpacing
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
		check: 'Math Formatting',
		passed: !rawMath,
		error: rawMath ? 'Detected unparsed LaTeX math ($...$).' : undefined,
	});

	// 7. Check if Bibliography numbering has no trailing dot and correct indent
	if (fs.existsSync(numberingXmlPath)) {
		const numberingXml = fs.readFileSync(numberingXmlPath, 'utf8');

		// Find bib-numbering (text="%1") and list-numbering (text="-")
		// In the same level, we expect <w:ind w:left="1069" w:hanging="360"/>
		const bibLevelMatch =
			/<w:lvlText w:val="%1"\/>.*?<w:ind[^>]*w:left="1069"[^>]*w:hanging="360"/s.test(
				numberingXml,
			);
		results.push({
			check: 'Bibliography Numbering Indent & Format',
			passed: bibLevelMatch,
			error: !bibLevelMatch
				? 'Bibliography numbering missing or has incorrect indent (expected left 1069, hanging 360) / dot format.'
				: undefined,
		});

		// 8. Check if List numbering uses hyphen and correct indent
		const listLevelMatch =
			/<w:lvlText w:val="-"\/>.*?<w:ind[^>]*w:left="1069"[^>]*w:hanging="360"/s.test(
				numberingXml,
			);
		results.push({
			check: 'List Numbering Indent & Format',
			passed: listLevelMatch,
			error: !listLevelMatch
				? 'List numbering missing hyphen or has incorrect indent (expected left 1069, hanging 360).'
				: undefined,
		});
	}

	// 9. Check Heading Alignment in styles.xml
	// Heading1 (Numbered) should not be centered (or left by default). StructuralHeading should be centered.
	const isHeading1Centered =
		/<w:style w:type="paragraph" w:styleId="Heading1">(?:(?!<\/w:style>).)*?<w:jc w:val="center"\/>/s.test(
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
		/<w:style w:type="paragraph" w:styleId="StructuralHeading">(?:(?!<\/w:style>).)*?<w:jc w:val="center"\/>/s.test(
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
		/<w:style w:type="paragraph" w:styleId="Heading1">(?:(?!<\/w:style>).)*?<w:pageBreakBefore/s.test(
			stylesXml,
		);
	results.push({
		check: 'Heading 1 Page Break',
		passed: heading1PageBreak,
		error: !heading1PageBreak
			? 'Heading 1 must have a pageBreakBefore.'
			: undefined,
	});

	const structuralPageBreak =
		/<w:style w:type="paragraph" w:styleId="StructuralHeading">(?:(?!<\/w:style>).)*?<w:pageBreakBefore/s.test(
			stylesXml,
		);
	results.push({
		check: 'Structural Heading Page Break',
		passed: structuralPageBreak,
		error: !structuralPageBreak
			? 'Structural headings must have a pageBreakBefore.'
			: undefined,
	});

	// 11. Check Caption Styles Existence and Spacing
	const figureCaptionMatch =
		/<w:style w:type="paragraph" w:styleId="FigureCaption">(?:(?!<\/w:style>).)*?<w:spacing [^>]*?w:line="240"/s.test(
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
		/<w:style w:type="paragraph" w:styleId="TableCaption">(?:(?!<\/w:style>).)*?<w:spacing [^>]*?w:line="240"/s.test(
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
