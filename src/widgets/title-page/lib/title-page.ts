import {
	AlignmentType,
	IParagraphOptions,
	ITextRunOptions,
	Paragraph,
	TabStopType,
	TextRun,
} from 'docx';

import { ReportMetadata } from '@/entities/report';

export function createTitlePage(metadata: ReportMetadata): Paragraph[] {
	// Helper to ensure 12pt (24 half-points) and Times New Roman
	const t = (options: ITextRunOptions) =>
		new TextRun({ size: 24, font: 'Times New Roman', ...options });
	const br = (options: ITextRunOptions = {}) =>
		new TextRun({ size: 24, break: 1, ...options });

	// Helper for paragraphs to reset default indents from "Normal" style and disable justification stretch
	const p = (options: IParagraphOptions) => {
		const { spacing, ...rest } = options;
		return new Paragraph({
			style: 'TitlePageText',
			indent: { firstLine: 0, left: 0 },
			alignment: AlignmentType.LEFT, // Explicitly left to stop justified stretching
			spacing: { before: 0, after: 0, ...spacing },
			...rest,
		});
	};

	const empty = (options: IParagraphOptions = {}) =>
		p({ children: [t({ text: '' })], ...options });

	return [
		// P1: "Министерство..." - Single line spacing, Centered
		p({
			alignment: AlignmentType.CENTER,
			spacing: { line: 240, lineRule: 'auto' },
			children: [
				t({
					text: 'Министерство науки и высшего образования Российской Федерации',
				}),
				br(),
				t({
					text: 'Федеральное государственное автономное образовательное',
				}),
				br(),
				t({ text: 'учреждение высшего образования' }),
				br(),
				t({
					text: '«Самарский национальный исследовательский университет ',
				}),
				br(),
				t({ text: 'имени академика С.П. Королева»' }),
			],
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
				t({ text: '\t' }),
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
					text: `${metadata.supervisorRole || 'Научный руководитель'} ${metadata.supervisorName} ${metadata.supervisorTitle}`,
				}),
				t({ text: '\t' }),
			],
		}),

		// P18: Empty with tab
		p({
			spacing: { line: 360, lineRule: 'auto' },
			tabStops: [{ type: TabStopType.RIGHT, position: 9638 }],
			children: [t({ text: '\t' })],
		}),

		// P19: Empty centered (Back to single spacing 240)
		empty({
			alignment: AlignmentType.CENTER,
			spacing: { line: 240, lineRule: 'auto' },
		}),

		...(metadata.hideSignatures ? [
			empty({ alignment: AlignmentType.CENTER, spacing: { line: 240, lineRule: 'auto' } }),
			empty({ alignment: AlignmentType.CENTER, spacing: { line: 240, lineRule: 'auto' } }),
			empty({ alignment: AlignmentType.CENTER, spacing: { line: 240, lineRule: 'auto' } }),
			empty({ alignment: AlignmentType.CENTER, spacing: { line: 240, lineRule: 'auto' } }),
			empty({ alignment: AlignmentType.CENTER, spacing: { line: 240, lineRule: 'auto' } }),
			empty({ alignment: AlignmentType.CENTER, spacing: { line: 240, lineRule: 'auto' } }),
			empty({ alignment: AlignmentType.CENTER, spacing: { line: 240, lineRule: 'auto' } }),
			empty({ alignment: AlignmentType.CENTER, spacing: { line: 240, lineRule: 'auto' } }),
			empty({ alignment: AlignmentType.CENTER, spacing: { line: 240, lineRule: 'auto' } }),
		] : [
			// P20-24: Supervisor Signature Block (Indented left by 5670)
			p({
				indent: { left: 5670, firstLine: 0 },
				spacing: { line: 240, lineRule: 'auto' },
				children: [t({ text: metadata.supervisorRole || 'Научный руководитель' })],
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
					t({ text: '                    (подпись)', italics: true }),
				],
			}),
			p({
				indent: { left: 5670, firstLine: 0 },
				spacing: { line: 240, lineRule: 'auto' },
				children: [t({ text: '“___”_____________ 20___ г.' })],
			}),
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
					t({ text: '                    (подпись)', italics: true }),
				],
			}),
			p({
				indent: { left: 5670, firstLine: 0 },
				spacing: { line: 240, lineRule: 'auto' },
				children: [t({ text: '“___”_____________ 20___ г.' })],
			}),
		]),

		// Empty paragraphs to push to bottom
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

		// P33: City and Year
		p({
			alignment: AlignmentType.CENTER,
			spacing: { line: 240, lineRule: 'auto' },
			children: [
				t({ text: `${metadata.city} ${metadata.year}`, bold: true }),
			],
		}),
	];
}
