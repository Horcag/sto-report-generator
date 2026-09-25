import { AlignmentType, Footer, Paragraph, TextRun } from 'docx';

import { ReportMetadata } from '@/entities/report';

function isPracticeReport(metadata: ReportMetadata): boolean {
	return /практик/i.test(metadata.reportType);
}

export function makeShortName(fullName: string): string {
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

export function getPracticeKind(metadata: ReportMetadata): string {
	if (metadata.practiceKind) {
		return metadata.practiceKind;
	}

	const match = metadata.degree.match(/Вид практики:\s*([^;]+)/i);
	return match?.[1]?.trim() || '__________________';
}

export function getPracticeType(metadata: ReportMetadata): string {
	if (metadata.practiceType) {
		return metadata.practiceType;
	}

	const match = metadata.degree.match(/тип практики:\s*(.+)$/i);
	return match?.[1]?.trim() || '__________________';
}

export function createTitlePageFooter(metadata: ReportMetadata): Footer {
	return new Footer({
		children: [
			new Paragraph({
				alignment: AlignmentType.CENTER,
				spacing: { line: 240, lineRule: 'auto' },
				children: [
					new TextRun({
						size: 24,
						font: 'Times New Roman',
						text: `${metadata.city} ${metadata.year}`,
						bold: !isPracticeReport(metadata),
					}),
				],
			}),
		],
	});
}
