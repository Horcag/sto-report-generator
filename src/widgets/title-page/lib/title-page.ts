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

function isPracticeReport(metadata: ReportMetadata): boolean {
	return /практик/i.test(metadata.reportType);
}

function makeShortName(fullName: string): string {
	const parts = fullName.trim().split(/\s+/);
	if (parts.length < 2) {
		return fullName;
	}

	const [lastName, firstName, patronymic] = parts;
	const initials = [firstName, patronymic]
		.filter(Boolean)
		.map(part => `${part[0]}.`)
		.join('');

	return `${initials} ${lastName}`;
}

function getPracticeKind(metadata: ReportMetadata): string {
	if (metadata.practiceKind) {
		return metadata.practiceKind;
	}

	const match = metadata.degree.match(/Вид практики:\s*([^;]+)/i);
	return match?.[1]?.trim() || 'производственная';
}

function getPracticeType(metadata: ReportMetadata): string {
	if (metadata.practiceType) {
		return metadata.practiceType;
	}

	const match = metadata.degree.match(/тип практики:\s*(.+)$/i);
	return match?.[1]?.trim() || 'технологическая (научно-технологическая)';
}

function createPracticeSignatureParagraph(options: {
	label: string;
	name: string;
	spacingBefore?: number;
}): Paragraph[] {
	return [
		titlePageParagraph({
			spacing: {
				before: options.spacingBefore ?? 0,
				after: 0,
				line: 240,
				lineRule: 'auto',
			},
			children: [titlePageText({ text: options.label })],
		}),
		titlePageParagraph({
			indent: { left: 5000, firstLine: 0 },
			spacing: {
				before: 0,
				after: 0,
				line: 240,
				lineRule: 'auto',
			},
			children: [
				titlePageText({ text: '__________________  ' }),
				titlePageText({ text: options.name }),
			],
		}),
		titlePageParagraph({
			indent: { left: 5000, firstLine: 0 },
			spacing: {
				before: 0,
				after: 0,
				line: 240,
				lineRule: 'auto',
			},
			children: [
				titlePageText({
					text: '        (подпись)',
					italics: true,
				}),
			],
		}),
	];
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
						bold: !isPracticeReport(metadata),
					}),
				],
			}),
		],
	});
}

function createPracticeTitlePage(metadata: ReportMetadata): Paragraph[] {
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
	const organizationSupervisorTitle =
		metadata.organizationSupervisorTitle || '__________________';
	const organizationSupervisorRole =
		metadata.organizationSupervisorRole ||
		'Руководитель практики от профильной организации';

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
				t({
					text: `по программе бакалавриата по направлению подготовки`,
				}),
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
					text: metadata.practiceStartDate || '15.06.2026',
					italics: true,
				}),
				t({ text: ' г. по ' }),
				t({
					text: metadata.practiceEndDate || '02.07.2026',
					italics: true,
				}),
				t({ text: ' г.' }),
			],
		}),
		...createPracticeSignatureParagraph({
			label: `Обучающийся группы № ${metadata.groupNumber}`,
			name: studentShortName,
			spacingBefore: 360,
		}),
		...createPracticeSignatureParagraph({
			label: `${metadata.supervisorRole || 'Руководитель практики от университета'}, ${metadata.supervisorTitle}`,
			name: universitySupervisorShortName,
			spacingBefore: 240,
		}),
		...createPracticeSignatureParagraph({
			label: `${organizationSupervisorRole}, ${organizationSupervisorTitle}`,
			name: organizationSupervisorName,
			spacingBefore: 240,
		}),
		empty({ spacing: { before: 360, after: 0 } }),
		p({
			spacing: { line: 240, lineRule: 'auto' },
			children: [
				t({
					text: `Дата сдачи ${metadata.submissionDate || '01.07.2026'} г.`,
				}),
				br(),
				t({
					text: `Дата защиты ${metadata.defenseDate || '02.07.2026'} г.`,
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

export function createTitlePage(metadata: ReportMetadata): Paragraph[] {
	if (isPracticeReport(metadata)) {
		return createPracticeTitlePage(metadata);
	}

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
