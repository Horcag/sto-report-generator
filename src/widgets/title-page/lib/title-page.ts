import {
	AlignmentType,
	Footer,
	IParagraphOptions,
	IRunOptions,
	Paragraph,
	TabStopType,
	TextRun,
} from 'docx';

import { ReportMetadata } from '@/entities/report';
import { STO_RULES } from '@/shared/config';

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

export function createTitlePageFooter(metadata: ReportMetadata): Footer {
	return new Footer({
		children: [
			titlePageParagraph({
				alignment: AlignmentType.CENTER,
				spacing: { line: 240, lineRule: 'auto' },
				children: [
					titlePageText({
						text: `${metadata.city} ${metadata.year}`,
						bold: true,
					}),
				],
			}),
		],
	});
}

export function createTitlePage(metadata: ReportMetadata): Paragraph[] {
	const t = titlePageText;
	const br = titlePageLineBreak;
	const p = titlePageParagraph;

	const empty = (options: IParagraphOptions = {}) =>
		p({ children: [t({ text: '' })], ...options });
	const supervisorRole = metadata.supervisorRole || 'Научный руководитель';
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
		// P1: "Министерство..." - Single line spacing, Centered
		p({
			alignment: AlignmentType.CENTER,
			spacing: { line: 240, lineRule: 'auto' },
			children: organizationChildren,
		}),
		// P2: Empty
		empty({
			alignment: AlignmentType.CENTER,
			spacing: { line: 240, lineRule: 'auto' },
		}),

		// P3: Department
		p({
			alignment: AlignmentType.CENTER,
			spacing: { line: 240, lineRule: 'auto' },
			children: [t({ text: metadata.department })],
		}),

		// P4: Subdepartment
		p({
			alignment: AlignmentType.CENTER,
			spacing: { line: 240, lineRule: 'auto' },
			tabStops: [{ type: TabStopType.LEFT, position: 1680 }],
			children: [br(), t({ text: metadata.subdepartment })],
		}),

		// P5: Empty (starts 1.5 spacing - 360)
		empty({
			alignment: AlignmentType.CENTER,
			spacing: { line: 360, lineRule: 'auto' },
		}),

		// P6: Report type
		p({
			alignment: AlignmentType.CENTER,
			spacing: { line: 360, lineRule: 'auto' },
			children: [t({ text: metadata.reportType, bold: true })],
		}),

		// P7: Degree
		p({
			alignment: AlignmentType.CENTER,
			spacing: { line: 360, lineRule: 'auto' },
			children: [t({ text: metadata.degree, bold: true })],
		}),

		// P8: Semester
		p({
			alignment: AlignmentType.CENTER,
			spacing: { line: 360, lineRule: 'auto' },
			children: [t({ text: `Семестр ${metadata.semester}`, bold: true })],
		}),

		// P9: Empty
		empty({
			spacing: { line: 360, lineRule: 'auto' },
			tabStops: [{ type: TabStopType.LEFT, position: 8190 }],
		}),

		// P10: Specialty
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

		// P11: Empty
		empty({
			spacing: { line: 360, lineRule: 'auto' },
			tabStops: [
				{ type: TabStopType.LEFT, position: 1701 },
				{ type: TabStopType.LEFT, position: 9638 },
			],
		}),

		// P12: Student name
		p({
			spacing: { line: 360, lineRule: 'auto' },
			tabStops: [
				{ type: TabStopType.LEFT, position: 1701 },
				{ type: TabStopType.LEFT, position: 9638 },
			],
			children: [t({ text: `Студент ${metadata.studentName}` })],
		}),

		// P13: Group number
		p({
			spacing: { line: 360, lineRule: 'auto' },
			tabStops: [
				{ type: TabStopType.LEFT, position: 1701 },
				{ type: TabStopType.LEFT, position: 9638 },
			],
			children: [t({ text: `группы ${metadata.groupNumber}` })],
		}),

		// P14: Empty
		empty({
			spacing: { line: 360, lineRule: 'auto' },
			tabStops: [
				{ type: TabStopType.LEFT, position: 1701 },
				{ type: TabStopType.LEFT, position: 9638 },
			],
		}),

		// P15: Topic
		p({
			spacing: { line: 360, lineRule: 'auto' },
			tabStops: [{ type: TabStopType.RIGHT, position: 9638 }],
			children: [
				t({
					text: `${metadata.topicPrefix || 'Тема научно-исследовательской работы'}: «${metadata.topic}»`,
				}),
			],
		}),

		// P16: Empty
		empty({
			spacing: { line: 360, lineRule: 'auto' },
			tabStops: [{ type: TabStopType.RIGHT, position: 9638 }],
		}),

		// P17: Supervisor
		p({
			spacing: { line: 360, lineRule: 'auto' },
			tabStops: [{ type: TabStopType.RIGHT, position: 9638 }],
			children: [
				t({
					text: `${supervisorRole} ${metadata.supervisorName} ${metadata.supervisorTitle}`,
				}),
			],
		}),

		// P18: Empty spacer
		empty({
			spacing: { line: 360, lineRule: 'auto' },
		}),

		// P19: Empty centered (Back to single spacing 240)
		empty({
			alignment: AlignmentType.CENTER,
			spacing: { line: 240, lineRule: 'auto' },
		}),

		...(metadata.hideSignatures
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
					// P20-24: Supervisor Signature Block (Indented left by 5670)
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
						children: [t({ text: '“___”_____________ 20___ г.' })],
					}),
					...(gradeLine
						? [
								p({
									indent: { left: 5670, firstLine: 0 },
									spacing: { line: 240, lineRule: 'auto' },
									children: [t({ text: gradeLine })],
								}),
							]
						: []),
					empty({
						indent: { left: 5670, firstLine: 0 },
						spacing: { line: 240, lineRule: 'auto' },
					}),

					// P25-28: Student Signature Block (Indented left by 5670)
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
						children: [t({ text: '“___”_____________ 20___ г.' })],
					}),
				]),
	];
}
