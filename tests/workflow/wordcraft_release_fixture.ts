import fs from 'node:fs';
import path from 'node:path';
import {
	AlignmentType,
	Document,
	ImportedXmlComponent,
	LeaderType,
	Packer,
	Paragraph,
	TabStopType,
	TextRun,
} from 'docx';

import {
	getStoStyles,
	MARGINS,
	STO_NUMBERING,
	StoStylePreset,
} from '@/shared/config';

function equationArray(aligned: boolean): Paragraph {
	const paragraph = new Paragraph({ alignment: AlignmentType.CENTER });
	const display = new ImportedXmlComponent('m:oMathPara');
	const math = new ImportedXmlComponent('m:oMath');
	const array = new ImportedXmlComponent('m:eqArr');
	for (const variable of ['x', 'longVariable']) {
		const row = new ImportedXmlComponent('m:e');
		for (const value of [variable, '=', '123']) {
			const run = new ImportedXmlComponent('m:r');
			if (aligned && value === '=') {
				const properties = new ImportedXmlComponent('m:rPr');
				properties.push(
					new ImportedXmlComponent('m:aln', { 'm:val': '1' }),
				);
				run.push(properties);
			}
			const text = new ImportedXmlComponent('m:t');
			text.push(value);
			run.push(text);
			row.push(run);
		}
		array.push(row);
	}
	math.push(array);
	display.push(math);
	paragraph.addChildElement(display);
	return paragraph;
}

/** Public controls for release-sensitive run metrics, tabs, justification and math. */
export async function buildWordcraftReleaseFixture(
	outputDocx: string,
	stylePreset: StoStylePreset = 'samara-template-2022',
): Promise<void> {
	const children: Paragraph[] = [new Paragraph('RELEASE-RUN-METRICS-START')];
	for (const script of ['plain', 'superscript', 'subscript']) {
		children.push(
			new Paragraph({
				alignment: AlignmentType.LEFT,
				children: [
					new TextRun(`${script.toUpperCase()} BEFORE `),
					new TextRun({
						text: 'CONTROL 123 xyz',
						superScript: script === 'superscript',
						subScript: script === 'subscript',
					}),
					new TextRun(' AFTER'),
				],
			}),
		);
	}
	children.push(
		new Paragraph({
			text: 'RELEASE-TOC-TABS-START',
			pageBreakBefore: true,
		}),
	);
	for (const title of [
		'SHORT TOC ENTRY',
		'LONG TOC ENTRY ' +
			'Проверка переноса длинной строки содержания '.repeat(5),
	]) {
		children.push(
			new Paragraph({
				style: 'TOC1',
				alignment: AlignmentType.LEFT,
				tabStops: [
					{
						type: TabStopType.RIGHT,
						position: 9355,
						leader: LeaderType.DOT,
					},
				],
				children: [new TextRun(title), new TextRun('\t123')],
			}),
		);
	}
	children.push(
		new Paragraph({
			text: 'RELEASE-JUSTIFICATION-START',
			pageBreakBefore: true,
		}),
	);
	for (const [index, text] of [
		'При переносе строки расстояние между словами зависит от ширины абзаца. ',
		'В тексте есть короткие и длинные слова, числа 12345 и знаки препинания. ',
	].entries()) {
		children.push(
			new Paragraph({
				alignment: AlignmentType.JUSTIFIED,
				children: [
					new TextRun(`JUSTIFY-${index + 1} ${text.repeat(6)}`),
				],
			}),
		);
	}
	children.push(
		new Paragraph({ text: 'RELEASE-EQARR-START', pageBreakBefore: true }),
		new Paragraph('EQARR-UNALIGNED'),
		equationArray(false),
		new Paragraph('EQARR-ALIGNED'),
		equationArray(true),
		new Paragraph('RELEASE-CONTROLS-END'),
	);
	const document = new Document({
		styles: getStoStyles(stylePreset),
		numbering: STO_NUMBERING,
		sections: [
			{
				properties: {
					page: {
						size: { width: 11906, height: 16838 },
						margin: MARGINS,
					},
				},
				children,
			},
		],
	});
	fs.mkdirSync(path.dirname(path.resolve(outputDocx)), { recursive: true });
	fs.writeFileSync(outputDocx, await Packer.toBuffer(document));
}
