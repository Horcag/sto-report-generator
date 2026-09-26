import {
	AlignmentType,
	BorderStyle,
	HeightRule,
	IParagraphOptions,
	IRunOptions,
	Paragraph,
	Table,
	TableCell,
	TableLayoutType,
	TableRow,
	TabStopType,
	TextRun,
	VerticalAlignTable,
	WidthType,
} from 'docx';

import { ReportMetadata } from '@/entities/report';
import { STO_RULES } from '@/shared/config';

import { createSsauCourseProjectTitlePage } from './ssau-course-project-title-page';
import {
	createTitlePageFooter,
	getPracticeKind,
	getPracticeType,
	makeShortName,
} from './title-page-metadata';
import { createVkrTitlePage } from './vkr-title-page';

export { createTitlePageFooter };

function titlePageText(options: IRunOptions): TextRun {
	return new TextRun({ size: 24, font: 'Times New Roman', ...options });
}

function titlePageLineBreak(options: IRunOptions = {}): TextRun {
	return new TextRun({ size: 24, break: 1, ...options });
}

function titlePageParagraph(options: IParagraphOptions): Paragraph {
	const { spacing, ...rest } = options;
	return new Paragraph({
		style: 'TitlePageText',
		indent: { firstLine: 0, left: 0 },
		alignment: AlignmentType.LEFT,
		spacing: { before: 0, after: 0, ...spacing },
		...rest,
	});
}

function isPracticeReport(metadata: ReportMetadata): boolean {
	return /практик/i.test(metadata.reportType);
}

interface PracticeSignatureRow {
	labelLines: string[];
	name: string;
}

const NO_TABLE_BORDERS = {
	top: { style: BorderStyle.NONE, size: 0, color: 'auto' },
	bottom: { style: BorderStyle.NONE, size: 0, color: 'auto' },
	left: { style: BorderStyle.NONE, size: 0, color: 'auto' },
	right: { style: BorderStyle.NONE, size: 0, color: 'auto' },
	insideHorizontal: { style: BorderStyle.NONE, size: 0, color: 'auto' },
	insideVertical: { style: BorderStyle.NONE, size: 0, color: 'auto' },
};
const PRACTICE_SIGNATURE_ROW_MIN_HEIGHT_DXA = 880;

function createPracticeSignatureCell(
	children: Paragraph[],
	width: number,
): TableCell {
	return new TableCell({
		width: { size: width, type: WidthType.DXA },
		verticalAlign: VerticalAlignTable.CENTER,
		children,
	});
}

function createSignatureLineCell(width: number): TableCell {
	return createPracticeSignatureCell(
		[
			titlePageParagraph({
				alignment: AlignmentType.CENTER,
				spacing: { line: 240, lineRule: 'auto' },
				children: [titlePageText({ text: '______________________' })],
			}),
			titlePageParagraph({
				alignment: AlignmentType.CENTER,
				spacing: { line: 240, lineRule: 'auto' },
				children: [
					titlePageText({
						text: '(подпись)',
						italics: true,
						size: 16,
					}),
				],
			}),
		],
		width,
	);
}

function createPracticeSignatureTable(rows: PracticeSignatureRow[]): Table {
	const columnWidths = [4644, 2977, 2007];
	return new Table({
		width: { size: 9628, type: WidthType.DXA },
		columnWidths,
		layout: TableLayoutType.FIXED,
		borders: NO_TABLE_BORDERS,
		alignment: AlignmentType.LEFT,
		rows: rows.map(
			row =>
				new TableRow({
					height: {
						value: PRACTICE_SIGNATURE_ROW_MIN_HEIGHT_DXA,
						rule: HeightRule.ATLEAST,
					},
					children: [
						createPracticeSignatureCell(
							row.labelLines.map(line =>
								titlePageParagraph({
									spacing: {
										line: 240,
										lineRule: 'auto',
									},
									children: [titlePageText({ text: line })],
								}),
							),
							columnWidths[0],
						),
						createSignatureLineCell(columnWidths[1]),
						createPracticeSignatureCell(
							[
								titlePageParagraph({
									spacing: {
										line: 240,
										lineRule: 'auto',
									},
									children: [
										titlePageText({ text: row.name }),
									],
								}),
							],
							columnWidths[2],
						),
					],
				}),
		),
	});
}

function createPracticeSignatureBlock(
	rows: PracticeSignatureRow[],
	spacingBefore = 360,
): Array<Paragraph | Table> {
	return [
		titlePageParagraph({
			spacing: {
				before: spacingBefore,
				after: 0,
				line: 240,
				lineRule: 'auto',
			},
			children: [titlePageText({ text: '' })],
		}),
		createPracticeSignatureTable(rows),
	];
}

function createPracticeTitlePage(
	metadata: ReportMetadata,
): Array<Paragraph | Table> {
	const t = titlePageText;
	const br = titlePageLineBreak;
	const p = titlePageParagraph;
	const empty = (options: IParagraphOptions = {}) =>
		p({ children: [t({ text: '' })], ...options });
	const organizationLines =
		metadata.organizationLines ?? STO_RULES.titlePage.organizationLines;
	const organizationChildren = organizationLines.flatMap((line, index) => [
		...(index > 0 ? [br()] : []),
		t({ text: line }),
	]);
	const studentShortName =
		metadata.studentShortName || makeShortName(metadata.studentName);
	const universitySupervisorShortName =
		metadata.universitySupervisorShortName ||
		makeShortName(metadata.supervisorName);
	const organizationSupervisorName =
		metadata.organizationSupervisorName || '__________________';
	const universitySupervisorRole =
		metadata.supervisorRole || 'Руководитель практики от университета';
	const organizationSupervisorRole =
		metadata.organizationSupervisorRole ||
		'Руководитель практики от организации';
	const programLine = metadata.educationLevel
		? `по программе ${metadata.educationLevel} по направлению подготовки`
		: 'по направлению подготовки';

	return [
		p({
			alignment: AlignmentType.CENTER,
			spacing: { line: 240, lineRule: 'auto' },
			children: organizationChildren,
		}),
		empty({
			alignment: AlignmentType.CENTER,
			spacing: { line: 240, lineRule: 'auto' },
		}),
		p({
			alignment: AlignmentType.CENTER,
			spacing: { line: 240, lineRule: 'auto' },
			children: [t({ text: metadata.department })],
		}),
		p({
			alignment: AlignmentType.CENTER,
			spacing: { line: 240, lineRule: 'auto' },
			children: [t({ text: metadata.subdepartment })],
		}),
		empty({
			alignment: AlignmentType.CENTER,
			spacing: { before: 1080, after: 0 },
		}),
		p({
			alignment: AlignmentType.CENTER,
			spacing: { line: 240, lineRule: 'auto' },
			children: [t({ text: 'ОТЧЕТ ПО ПРАКТИКЕ', bold: true, size: 28 })],
		}),
		empty({
			alignment: AlignmentType.CENTER,
			spacing: { before: 180, after: 0 },
		}),
		p({
			alignment: AlignmentType.CENTER,
			spacing: { line: 240, lineRule: 'auto' },
			children: [
				t({ text: 'Вид практики: ' }),
				t({ text: getPracticeKind(metadata), italics: true }),
				br(),
				t({ text: 'Тип практики: ' }),
				t({ text: getPracticeType(metadata), italics: true }),
			],
		}),
		empty({
			alignment: AlignmentType.CENTER,
			spacing: { before: 180, after: 0 },
		}),
		p({
			alignment: AlignmentType.CENTER,
			spacing: { line: 240, lineRule: 'auto' },
			children: [
				t({ text: programLine }),
				br(),
				t({
					text: `${metadata.specialtyCode} ${metadata.specialtyName},`,
				}),
				br(),
				t({ text: `профиль «${metadata.profileName}»` }),
			],
		}),
		empty({
			alignment: AlignmentType.CENTER,
			spacing: { before: 180, after: 0 },
		}),
		p({
			alignment: AlignmentType.CENTER,
			spacing: { line: 240, lineRule: 'auto' },
			children: [
				t({ text: 'Сроки прохождения практики: с ' }),
				t({
					text: metadata.practiceStartDate || '____________',
					italics: true,
				}),
				t({ text: ' г. по ' }),
				t({
					text: metadata.practiceEndDate || '____________',
					italics: true,
				}),
				t({ text: ' г.' }),
			],
		}),
		...createPracticeSignatureBlock(
			[
				{
					labelLines: [
						`Обучающийся группы № ${metadata.groupNumber}`,
					],
					name: studentShortName,
				},
				{
					labelLines: [
						universitySupervisorRole,
						metadata.supervisorTitle,
					],
					name: universitySupervisorShortName,
				},
				{
					labelLines: [
						organizationSupervisorRole,
						metadata.organizationSupervisorTitle ?? '',
					].filter(Boolean),
					name: organizationSupervisorName,
				},
			],
			360,
		),
		empty({ spacing: { before: 360, after: 0 } }),
		p({
			spacing: { line: 240, lineRule: 'auto' },
			children: [
				t({
					text: `Дата сдачи ${metadata.submissionDate || '____________'} г.`,
				}),
				br(),
				t({
					text: `Дата защиты ${metadata.defenseDate || '____________'} г.`,
				}),
			],
		}),
		empty({ spacing: { before: 180, after: 0 } }),
		p({
			spacing: { line: 240, lineRule: 'auto' },
			children: [
				t({
					text:
						metadata.gradeLine || 'Оценка ________________________',
				}),
			],
		}),
	];
}

export function createTitlePage(
	metadata: ReportMetadata,
): Array<Paragraph | Table> {
	if (metadata.titlePageVariant === 'ssau-course-project-v1.1') {
		return createSsauCourseProjectTitlePage(metadata);
	}
	if (
		metadata.reportProfile === 'vkr-bachelor' ||
		metadata.reportProfile === 'vkr-master'
	) {
		return createVkrTitlePage(metadata);
	}
	if (isPracticeReport(metadata)) {
		return createPracticeTitlePage(metadata);
	}

	const t = titlePageText;
	const br = titlePageLineBreak;
	const p = titlePageParagraph;

	const empty = (options: IParagraphOptions = {}) =>
		p({ children: [t({ text: '' })], ...options });
	const isLab =
		metadata.reportProfile === 'lab' ||
		/лабораторн/i.test(metadata.reportType);
	const hasLabReviewer =
		!isLab ||
		(Boolean(metadata.supervisorName.trim()) &&
			metadata.supervisorName.trim() !== 'Фамилия Имя Отчество');
	const supervisorRole =
		metadata.supervisorRole ||
		(isLab ? 'Проверил' : 'Научный руководитель');
	const gradeLine =
		metadata.gradeLine ??
		(metadata.grade !== undefined
			? `Оценка ${metadata.grade || '________________________'}`
			: undefined);
	const organizationLines =
		metadata.organizationLines ?? STO_RULES.titlePage.organizationLines;
	const organizationChildren = organizationLines.flatMap((line, index) => [
		...(index > 0 ? [br()] : []),
		t({ text: line }),
	]);

	return [
		p({
			alignment: AlignmentType.CENTER,
			spacing: { line: 240, lineRule: 'auto' },
			children: organizationChildren,
		}),
		empty({
			alignment: AlignmentType.CENTER,
			spacing: { line: 240, lineRule: 'auto' },
		}),
		p({
			alignment: AlignmentType.CENTER,
			spacing: { line: 240, lineRule: 'auto' },
			children: [t({ text: metadata.department })],
		}),
		p({
			alignment: AlignmentType.CENTER,
			spacing: { line: 240, lineRule: 'auto' },
			tabStops: [{ type: TabStopType.LEFT, position: 1680 }],
			children: [br(), t({ text: metadata.subdepartment })],
		}),
		empty({
			alignment: AlignmentType.CENTER,
			spacing: { line: 360, lineRule: 'auto' },
		}),
		p({
			alignment: AlignmentType.CENTER,
			spacing: { line: 360, lineRule: 'auto' },
			children: [t({ text: metadata.reportType, bold: true })],
		}),
		p({
			alignment: AlignmentType.CENTER,
			spacing: { line: 360, lineRule: 'auto' },
			children: [t({ text: metadata.degree, bold: true })],
		}),
		p({
			alignment: AlignmentType.CENTER,
			spacing: { line: 360, lineRule: 'auto' },
			children: [t({ text: `Семестр ${metadata.semester}`, bold: true })],
		}),
		empty({
			spacing: { line: 360, lineRule: 'auto' },
			tabStops: [{ type: TabStopType.LEFT, position: 8190 }],
		}),
		p({
			spacing: { line: 360, lineRule: 'auto' },
			tabStops: [{ type: TabStopType.LEFT, position: 8190 }],
			children: [
				t({
					text: `Направление подготовки: ${metadata.specialtyCode} ${metadata.specialtyName}: `,
				}),
				br(),
				t({ text: `Профиль – «${metadata.profileName}» ` }),
			],
		}),
		empty({
			spacing: { line: 360, lineRule: 'auto' },
			tabStops: [
				{ type: TabStopType.LEFT, position: 1701 },
				{ type: TabStopType.LEFT, position: 9638 },
			],
		}),
		p({
			spacing: { line: 360, lineRule: 'auto' },
			tabStops: [
				{ type: TabStopType.LEFT, position: 1701 },
				{ type: TabStopType.LEFT, position: 9638 },
			],
			children: [t({ text: `Студент ${metadata.studentName}` })],
		}),
		p({
			spacing: { line: 360, lineRule: 'auto' },
			tabStops: [
				{ type: TabStopType.LEFT, position: 1701 },
				{ type: TabStopType.LEFT, position: 9638 },
			],
			children: [t({ text: `группы ${metadata.groupNumber}` })],
		}),
		empty({
			spacing: { line: 360, lineRule: 'auto' },
			tabStops: [
				{ type: TabStopType.LEFT, position: 1701 },
				{ type: TabStopType.LEFT, position: 9638 },
			],
		}),
		p({
			spacing: { line: 360, lineRule: 'auto' },
			tabStops: [{ type: TabStopType.RIGHT, position: 9638 }],
			children: [
				t({
					text: `${metadata.topicPrefix || 'Тема научно-исследовательской работы'}: «${metadata.topic}»`,
				}),
			],
		}),
		empty({
			spacing: { line: 360, lineRule: 'auto' },
			tabStops: [{ type: TabStopType.RIGHT, position: 9638 }],
		}),
		...(hasLabReviewer
			? [
					p({
						spacing: { line: 360, lineRule: 'auto' },
						tabStops: [{ type: TabStopType.RIGHT, position: 9638 }],
						children: [
							t({
								text: [
									supervisorRole,
									metadata.supervisorName,
									metadata.supervisorTitle,
								]
									.filter(Boolean)
									.join(' '),
							}),
						],
					}),
				]
			: []),
		empty({
			spacing: { line: 360, lineRule: 'auto' },
		}),
		empty({
			alignment: AlignmentType.CENTER,
			spacing: { line: 240, lineRule: 'auto' },
		}),

		...(isLab
			? []
			: metadata.hideSignatures
				? [
						empty({
							alignment: AlignmentType.CENTER,
							spacing: { line: 240, lineRule: 'auto' },
						}),
						empty({
							alignment: AlignmentType.CENTER,
							spacing: { line: 240, lineRule: 'auto' },
						}),
						empty({
							alignment: AlignmentType.CENTER,
							spacing: { line: 240, lineRule: 'auto' },
						}),
						empty({
							alignment: AlignmentType.CENTER,
							spacing: { line: 240, lineRule: 'auto' },
						}),
						empty({
							alignment: AlignmentType.CENTER,
							spacing: { line: 240, lineRule: 'auto' },
						}),
						empty({
							alignment: AlignmentType.CENTER,
							spacing: { line: 240, lineRule: 'auto' },
						}),
						empty({
							alignment: AlignmentType.CENTER,
							spacing: { line: 240, lineRule: 'auto' },
						}),
						empty({
							alignment: AlignmentType.CENTER,
							spacing: { line: 240, lineRule: 'auto' },
						}),
						empty({
							alignment: AlignmentType.CENTER,
							spacing: { line: 240, lineRule: 'auto' },
						}),
					]
				: [
						p({
							indent: { left: 5670, firstLine: 0 },
							spacing: { line: 240, lineRule: 'auto' },
							children: [t({ text: supervisorRole })],
						}),
						p({
							indent: { left: 5670, firstLine: 0 },
							spacing: { line: 240, lineRule: 'auto' },
							children: [t({ text: '________________________' })],
						}),
						p({
							indent: { left: 5670, firstLine: 0 },
							spacing: { line: 240, lineRule: 'auto' },
							children: [
								t({
									text: '                    (подпись)',
									italics: true,
								}),
							],
						}),
						p({
							indent: { left: 5670, firstLine: 0 },
							spacing: { line: 240, lineRule: 'auto' },
							children: [
								t({ text: '“___”_____________ 20___ г.' }),
							],
						}),
						...(gradeLine
							? [
									p({
										indent: { left: 5670, firstLine: 0 },
										spacing: {
											line: 240,
											lineRule: 'auto',
										},
										children: [t({ text: gradeLine })],
									}),
								]
							: []),
						empty({
							indent: { left: 5670, firstLine: 0 },
							spacing: { line: 240, lineRule: 'auto' },
						}),
						p({
							indent: { left: 5670, firstLine: 0 },
							spacing: { line: 240, lineRule: 'auto' },
							children: [t({ text: 'Студент' })],
						}),
						p({
							indent: { left: 5670, firstLine: 0 },
							spacing: { line: 240, lineRule: 'auto' },
							children: [t({ text: '________________________' })],
						}),
						p({
							indent: { left: 5670, firstLine: 0 },
							spacing: { line: 240, lineRule: 'auto' },
							children: [
								t({
									text: '                    (подпись)',
									italics: true,
								}),
							],
						}),
						p({
							indent: { left: 5670, firstLine: 0 },
							spacing: { line: 240, lineRule: 'auto' },
							children: [
								t({ text: '“___”_____________ 20___ г.' }),
							],
						}),
					]),
	];
}
