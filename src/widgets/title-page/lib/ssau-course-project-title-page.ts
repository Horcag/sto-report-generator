import {
	AlignmentType,
	BorderStyle,
	Paragraph,
	Table,
	TableCell,
	TableLayoutType,
	TableRow,
	TextRun,
	WidthType,
} from 'docx';

import { ReportMetadata } from '@/entities/report';

import { makeShortName } from './title-page-metadata';

// Reproduces the structure of the teacher's "Титульник v1.1.docx".
// The city and year are rendered by the title-page footer.
function line(text: string, before = 0, after = 0): Paragraph {
	return new Paragraph({
		style: 'TitlePageText',
		alignment: AlignmentType.CENTER,
		indent: { firstLine: 0, left: 0 },
		spacing: { before, after, line: 240, lineRule: 'auto' },
		children: [new TextRun({ text, font: 'Times New Roman', size: 24 })],
	});
}

function shortName(name: string): string {
	const trimmed = name.trim();
	const surnameFirst = trimmed.match(/^(.+?)\s+([А-ЯЁ])\.\s*([А-ЯЁ])\.$/u);
	if (surnameFirst) {
		return `${surnameFirst[2]}. ${surnameFirst[3]}. ${surnameFirst[1]}`;
	}
	return makeShortName(trimmed).replace(/\.([А-ЯЁ])/gu, '. $1');
}

function signatureRow(label: string, name: string): TableRow {
	const widths = [2100, 4450, 3078];
	const cell = (text: string, width: number) =>
		new TableCell({
			width: { size: width, type: WidthType.DXA },
			children: [
				new Paragraph({
					style: 'TitlePageText',
					spacing: {
						before: 0,
						after: 0,
						line: 240,
						lineRule: 'auto',
					},
					children: [
						new TextRun({
							text,
							font: 'Times New Roman',
							size: 24,
						}),
					],
				}),
			],
		});
	return new TableRow({
		children: [
			cell(label, widths[0]),
			cell('__________________________________', widths[1]),
			cell(name, widths[2]),
		],
	});
}

export function createSsauCourseProjectTitlePage(
	metadata: ReportMetadata,
): Array<Paragraph | Table> {
	const discipline = metadata.degree
		.replace(/^по дисциплине\s*/iu, '')
		.trim();
	const studentName = metadata.studentShortName
		? metadata.studentShortName
		: shortName(metadata.studentName);
	const supervisorName = shortName(metadata.supervisorName);
	const noBorders = {
		top: { style: BorderStyle.NONE, size: 0, color: 'auto' },
		bottom: { style: BorderStyle.NONE, size: 0, color: 'auto' },
		left: { style: BorderStyle.NONE, size: 0, color: 'auto' },
		right: { style: BorderStyle.NONE, size: 0, color: 'auto' },
		insideHorizontal: { style: BorderStyle.NONE, size: 0, color: 'auto' },
		insideVertical: { style: BorderStyle.NONE, size: 0, color: 'auto' },
	};

	return [
		line('Министерство науки и высшего образования Российской Федерации'),
		line('ФЕДЕРАЛЬНОЕ ГОСУДАРСТВЕННОЕ АВТОНОМНОЕ'),
		line('ОБРАЗОВАТЕЛЬНОЕ УЧРЕЖДЕНИЕ ВЫСШЕГО ОБРАЗОВАНИЯ'),
		line('«САМАРСКИЙ НАЦИОНАЛЬНЫЙ ИССЛЕДОВАТЕЛЬСКИЙ'),
		line('УНИВЕРСИТЕТ ИМЕНИ АКАДЕМИКА С.П. КОРОЛЕВА»'),
		line('(САМАРСКИЙ УНИВЕРСИТЕТ)', 0, 1600),
		line(metadata.department, 0, 360),
		line(metadata.subdepartment, 0, 1300),
		line('ОТЧЁТ'),
		line('ПО КУРСОВОМУ ПРОЕКТУ', 0, 240),
		line('по дисциплине'),
		line(discipline, 0, 5100),
		new Table({
			width: { size: 9628, type: WidthType.DXA },
			columnWidths: [2100, 4450, 3078],
			layout: TableLayoutType.FIXED,
			borders: noBorders,
			rows: [
				signatureRow('Исполнитель', studentName),
				signatureRow('Руководитель', supervisorName),
			],
		}),
	];
}
