import assert from 'node:assert/strict';

import { STO_RULES } from '@/shared/config';
import { validateNumbering } from '@/shared/lib/sto-validator/numbering-xml';

function makeNumberingXml(abstractNumsXml: string, numsXml: string): string {
	return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  ${abstractNumsXml}
  ${numsXml}
</w:numbering>`;
}

const VALID_ABSTRACT_DEFS = `
  <w:abstractNum w:abstractNumId="0">
    <w:lvl w:ilvl="0">
      <w:lvlText w:val="%1"/>
      <w:ind w:left="${STO_RULES.bibliography.paragraph.leftIndentDxa}" w:hanging="${STO_RULES.bibliography.paragraph.hangingIndentDxa}"/>
    </w:lvl>
  </w:abstractNum>
  <w:abstractNum w:abstractNumId="1">
    <w:nsid w:val="10000001"/>
    <w:lvl w:ilvl="0">
      <w:lvlText w:val="${STO_RULES.typography.listMarker}"/>
      <w:ind w:left="0" w:firstLine="${STO_RULES.typography.firstLineIndentDxa}"/>
    </w:lvl>
  </w:abstractNum>
  <w:abstractNum w:abstractNumId="2">
    <w:nsid w:val="10000002"/>
    <w:lvl w:ilvl="0">
      <w:lvlText w:val="%1."/>
    </w:lvl>
  </w:abstractNum>
`;

export function runNumberingXmlTests(): void {
	assert.deepEqual(validateNumbering('<w:document/>', null), []);

	// Negative control: two distinct used numIds in document.xml share abstractNumId="2".
	const sharedDoc = `<w:document><w:body>
		<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="2"/></w:numPr></w:pPr></w:p>
		<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="3"/></w:numPr></w:pPr></w:p>
	</w:body></w:document>`;
	const sharedNumbering = makeNumberingXml(
		VALID_ABSTRACT_DEFS,
		`
			<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
			<w:num w:numId="2"><w:abstractNumId w:val="2"/></w:num>
			<w:num w:numId="3"><w:abstractNumId w:val="2"/></w:num>
		`,
	);
	const sharedResult = validateNumbering(sharedDoc, sharedNumbering).find(
		r => r.check === 'List Abstract Numbering Isolation',
	);
	assert.equal(sharedResult?.passed, false);
	assert.match(
		sharedResult?.error ?? '',
		/abstractNumId=2 shared by numId=2,3/,
	);

	// Positive control (broken.docx pattern): unused duplicate <w:num> entries in numbering.xml must pass.
	const unusedDoc = `<w:document><w:body>
		<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="0"/></w:numPr></w:pPr></w:p>
		<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="2"/></w:numPr></w:pPr></w:p>
	</w:body></w:document>`;
	const unusedResult = validateNumbering(unusedDoc, sharedNumbering).find(
		r => r.check === 'List Abstract Numbering Isolation',
	);
	assert.equal(unusedResult?.passed, true);

	// Positive control: distinct used numIds map to distinct abstractNumIds.
	const isolatedNumbering = makeNumberingXml(
		`${VALID_ABSTRACT_DEFS}
		<w:abstractNum w:abstractNumId="3">
			<w:nsid w:val="10000003"/>
			<w:lvl w:ilvl="0"><w:lvlText w:val="%1."/></w:lvl>
		</w:abstractNum>`,
		`
			<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
			<w:num w:numId="2"><w:abstractNumId w:val="2"/></w:num>
			<w:num w:numId="3"><w:abstractNumId w:val="3"/></w:num>
		`,
	);
	for (const item of validateNumbering(sharedDoc, isolatedNumbering)) {
		assert.equal(item.passed, true, `${item.check}: ${item.error}`);
	}

	// Style-linked abstractNums are allowed to be referenced by multiple numIds.
	const styleLinkedNumbering = makeNumberingXml(
		`${VALID_ABSTRACT_DEFS}
		<w:abstractNum w:abstractNumId="4"><w:styleLink w:val="Heading1"/></w:abstractNum>`,
		`
			<w:num w:numId="2"><w:abstractNumId w:val="4"/></w:num>
			<w:num w:numId="3"><w:abstractNumId w:val="4"/></w:num>
		`,
	);
	const linkedResult = validateNumbering(
		sharedDoc,
		styleLinkedNumbering,
	).find(r => r.check === 'List Abstract Numbering Isolation');
	assert.equal(linkedResult?.passed, true);
}
