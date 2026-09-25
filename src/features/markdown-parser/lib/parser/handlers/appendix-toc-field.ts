import { TextRun, XmlComponent } from 'docx';

import { AppendixHeading, appendixTocText } from '@/shared/config';

class FieldCharacter extends XmlComponent {
	constructor(type: 'begin' | 'end') {
		super('w:fldChar');
		this.root.push({ _attr: { 'w:fldCharType': type } });
	}
}

class FieldInstructionText extends XmlComponent {
	constructor(instruction: string) {
		super('w:instrText');
		this.root.push({ _attr: { 'xml:space': 'preserve' } });
		this.root.push(instruction);
	}
}

/** A complex TC field keeps the TOC label separate from the visible appendix heading. */
export function appendixTocFieldRuns(appendix: AppendixHeading): TextRun[] {
	const instruction = ` TC "${appendixTocText(appendix)}" \\f A \\l 1 `;
	return [
		new TextRun({ children: [new FieldCharacter('begin')] }),
		new TextRun({ children: [new FieldInstructionText(instruction)] }),
		new TextRun({ children: [new FieldCharacter('end')] }),
	];
}
