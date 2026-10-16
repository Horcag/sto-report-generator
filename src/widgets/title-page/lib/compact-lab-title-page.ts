import {
	AlignmentType,
	LeaderType,
	Paragraph,
	Tab,
	TabStopType,
	TextRun,
} from 'docx';

import { ReportMetadata } from '@/entities/report';
import { STO_RULES } from '@/shared/config';

import { makeShortName } from './title-page-metadata';

// Paragraph indent and tab stops in the supplied compact laboratory template.
const SIGNATURE_INDENT = 1240;

function line(
	text: string,
	before = 0,
	alignment: (typeof AlignmentType)[keyof typeof AlignmentType] = AlignmentType.CENTER,
	left = 0,
): Paragraph {
	return new Paragraph({
		style: 'TitlePageText',
		alignment,
		indent: { firstLine: 0, left },
		spacing: { before, after: 0, line: 240, lineRule: 'auto' },
		children: text.split('\n').map(
			(part, index) =>
				new TextRun({
					text: part,
					break: index > 0 ? 1 : 0,
					font: 'Times New Roman',
					size: 24,
				}),
		),
	});
}

function signatureBlock(label: string, name: string): Paragraph[] {
	return [
		new Paragraph({
			style: 'TitlePageText',
			alignment: AlignmentType.LEFT,
			indent: { firstLine: 0, left: SIGNATURE_INDENT },
			spacing: { before: 0, after: 0, line: 240, lineRule: 'auto' },
			keepNext: true,
			tabStops: [
				{
					type: TabStopType.LEFT,
					position: 6840,
					leader: LeaderType.UNDERSCORE,
				},
				{ type: TabStopType.LEFT, position: 6960 },
			],
			children: [
				new TextRun({
					font: 'Times New Roman',
					size: 24,
					children: [label, new Tab(), new Tab(), name],
				}),
			],
		}),
		new Paragraph({
			style: 'TitlePageText',
			alignment: AlignmentType.LEFT,
			indent: { firstLine: 0, left: SIGNATURE_INDENT },
			spacing: { before: 0, after: 0, line: 240, lineRule: 'auto' },
			tabStops: [{ type: TabStopType.LEFT, position: 5220 }],
			children: [
				new TextRun({
					font: 'Times New Roman',
					size: 16,
					italics: true,
					children: [new Tab(), '(подпись)'],
				}),
			],
		}),
	];
}

export function createCompactLabTitlePage(
	metadata: ReportMetadata,
): Paragraph[] {
	const shortName = (name: string): string =>
		makeShortName(name).replace(/\.([А-ЯЁ])/gu, '. $1');
	const degree = metadata.degree.replace(
		/^(по\s+(?:курсу|дисциплине))\s+/iu,
		'$1\n',
	);
	const supervisorRole = metadata.supervisorRole || 'Проверил';
	return [
		...(
			metadata.organizationLines ?? STO_RULES.titlePage.organizationLines
		).map(text => line(text)),
		line(metadata.department, 240),
		line(metadata.subdepartment),
		line(metadata.reportType, 1440),
		line(degree, 720),
		line(
			`Группа ${metadata.groupNumber}`,
			960,
			AlignmentType.LEFT,
			SIGNATURE_INDENT,
		),
		...signatureBlock(
			'Студент',
			metadata.studentShortName || shortName(metadata.studentName),
		),
		line(
			metadata.supervisorTitle
				? `${supervisorRole.replace(/,$/u, '')},`
				: supervisorRole,
			480,
			AlignmentType.LEFT,
			SIGNATURE_INDENT,
		),
		...signatureBlock(
			metadata.supervisorTitle,
			metadata.universitySupervisorShortName ||
				shortName(metadata.supervisorName),
		),
	];
}
