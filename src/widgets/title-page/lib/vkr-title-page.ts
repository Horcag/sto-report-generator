import { AlignmentType, IParagraphOptions, Paragraph, TextRun } from 'docx';

import { ReportMetadata } from '@/entities/report';
import { STO_RULES } from '@/shared/config';

function shortName(fullName: string): string {
	const parts = fullName.trim().split(/\s+/);
	if (parts.length < 2) return fullName;
	const [lastName, firstName, patronymic] = parts;
	const initials = [firstName, patronymic]
		.filter(Boolean)
		.map(part => `${part[0]}.`)
		.join('');
	return `${initials} ${lastName}`;
}

function titlePageText(text: string): TextRun {
	return new TextRun({ text, size: 24, font: 'Times New Roman' });
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

export function createVkrTitlePage(metadata: ReportMetadata): Paragraph[] {
	const p = (text: string, options: IParagraphOptions = {}) =>
		titlePageParagraph({
			alignment: AlignmentType.CENTER,
			spacing: { line: 240, lineRule: 'auto' },
			children: [titlePageText(text)],
			...options,
		});
	const level =
		metadata.reportProfile === 'vkr-master'
			? 'уровень магистратуры'
			: 'уровень бакалавриата';
	const supervisorName = shortName(metadata.supervisorName);
	const studentName = shortName(metadata.studentName);
	const controllerName = metadata.normControllerName
		? shortName(metadata.normControllerName)
		: '________________';
	const signature = (role: string, name: string) =>
		p(`${role}  ________________________  ${name}`, {
			alignment: AlignmentType.LEFT,
			spacing: { before: 120, line: 240, lineRule: 'auto' },
		});

	return [
		...(
			metadata.organizationLines ?? STO_RULES.titlePage.organizationLines
		).map(line => p(line)),
		p(''),
		p(metadata.department),
		p(metadata.subdepartment),
		p(''),
		p(''),
		p('ВЫПУСКНАЯ КВАЛИФИКАЦИОННАЯ РАБОТА', {
			spacing: { before: 360, after: 180, line: 240, lineRule: 'auto' },
		}),
		p(metadata.topic),
		p(''),
		p('по направлению подготовки'),
		p(`${metadata.specialtyCode} ${metadata.specialtyName} (${level})`),
		p(`направленность (профиль) «${metadata.profileName}»`),
		p(''),
		p(''),
		signature('Обучающийся', studentName),
		signature(
			`Руководитель ВКР, ${metadata.supervisorTitle}`,
			supervisorName,
		),
		signature(
			metadata.normControllerTitle || 'Нормоконтролёр',
			controllerName,
		),
		p(
			`УТВЕРЖДАЮ: заведующий кафедрой ${metadata.vkrApprovalName || '________________'}`,
			{
				pageBreakBefore: true,
				alignment: AlignmentType.RIGHT,
			},
		),
		p(
			`ЗАДАНИЕ НА ВЫПУСКНУЮ КВАЛИФИКАЦИОННУЮ РАБОТУ ${metadata.reportProfile === 'vkr-master' ? 'МАГИСТРА' : 'БАКАЛАВРА'}`,
			{
				spacing: {
					before: 360,
					after: 240,
					line: 240,
					lineRule: 'auto',
				},
			},
		),
		p(
			`Обучающемуся группы ${metadata.groupNumber} ${metadata.studentName}`,
			{
				alignment: AlignmentType.LEFT,
			},
		),
		p(`Тема ВКР: ${metadata.topic}`, { alignment: AlignmentType.LEFT }),
		p(
			`Утверждена приказом по университету от ${metadata.vkrOrderDate || '__________'} № ${metadata.vkrOrderNumber || '__________'}.`,
			{
				alignment: AlignmentType.LEFT,
			},
		),
		p(`Исходные данные: ${metadata.vkrInitialData || '________________'}`, {
			alignment: AlignmentType.LEFT,
		}),
		p(
			`Перечень вопросов, подлежащих разработке в ВКР: ${metadata.vkrQuestions || '________________'}`,
			{
				alignment: AlignmentType.LEFT,
			},
		),
		p(''),
		signature('Руководитель ВКР', supervisorName),
		signature('Задание принял к исполнению', studentName),
		p(
			`Дата выдачи и принятия задания: ${metadata.vkrAssignmentDate || '__________'}`,
			{
				alignment: AlignmentType.LEFT,
			},
		),
	];
}
