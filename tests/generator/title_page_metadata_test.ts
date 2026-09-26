import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import AdmZip from 'adm-zip';

import { buildReport } from '@/app/builder';
import { scaffoldReport } from '@/app/report-scaffold';
import { readDocxEntry } from '@/shared/lib/docx-archive';

const tempRoot = path.join(process.cwd(), '.agent-work', 'title-page-test');
const tempMd = path.join(tempRoot, 'title_page.md');
const tempDocx = path.join(tempRoot, 'title_page.docx');

const testMarkdown = String.raw`---
organizationLines:
  - "Тестовое министерство"
  - "Тестовый университет"
department: "Институт информатики и кибернетики"
subdepartment: "Кафедра технической кибернетики"
reportType: "Отчёт по курсовой работе"
degree: "по дисциплине «Тестовая дисциплина»"
semester: 6
specialtyCode: "01.03.02"
specialtyName: "Прикладная математика и информатика"
profileName: "Искусственный интеллект и компьютерные науки"
studentName: "Иванов Иван Иванович"
groupNumber: "6300 – 010302D"
topicPrefix: "Тема курсовой работы"
topic: "Тестовая тема"
supervisorRole: "Проверил"
supervisorName: "Петров Петр Петрович"
supervisorTitle: "доцент"
gradeLine: "Оценка ________________________"
city: "Самара"
year: 2026
---
`;

async function main(): Promise<void> {
	fs.rmSync(tempRoot, { recursive: true, force: true });
	fs.mkdirSync(tempRoot, { recursive: true });
	fs.writeFileSync(tempMd, testMarkdown, 'utf-8');

	await buildReport(tempMd, tempDocx);
	const documentXml = readDocxEntry(tempDocx, 'word/document.xml');
	const footerXml = new AdmZip(tempDocx)
		.getEntries()
		.filter(entry => /^word\/footer\d+\.xml$/.test(entry.entryName))
		.map(entry => entry.getData().toString('utf-8'))
		.join('\n');
	assert.ok(documentXml.includes('Проверил'));
	assert.ok(documentXml.includes('Оценка ________________________'));
	assert.ok(documentXml.includes('Тестовое министерство'));
	assert.ok(documentXml.includes('Тестовый университет'));
	assert.ok(!documentXml.includes('Научный руководитель'));
	assert.ok(
		!documentXml.includes(
			'Министерство науки и высшего образования Российской Федерации',
		),
	);
	assert.ok(!documentXml.includes('Самара 2026'));
	assert.ok(footerXml.includes('Самара 2026'));

	const courseProjectMd = path.join(tempRoot, 'course-project.md');
	const courseProjectDocx = path.join(tempRoot, 'course-project.docx');
	fs.writeFileSync(
		courseProjectMd,
		testMarkdown
			.replace(
				'reportType: "Отчёт по курсовой работе"',
				'reportType: "ОТЧЁТ ПО КУРСОВОМУ ПРОЕКТУ"\nreportProfile: "coursework"\ntitlePageVariant: "ssau-course-project-v1.1"',
			)
			.replace(
				'supervisorName: "Петров Петр Петрович"',
				'supervisorName: "Петров П. П."',
			),
		'utf8',
	);
	await buildReport(courseProjectMd, courseProjectDocx);
	const courseProjectXml = readDocxEntry(
		courseProjectDocx,
		'word/document.xml',
	);
	assert.ok(courseProjectXml.includes('ПО КУРСОВОМУ ПРОЕКТУ'));
	assert.ok(courseProjectXml.includes('И. И. Иванов'));
	assert.ok(courseProjectXml.includes('П. П. Петров'));
	assert.ok(courseProjectXml.includes('Исполнитель'));
	assert.ok(!courseProjectXml.includes('Семестр 6'));
	assert.ok(!courseProjectXml.includes('Тестовая тема'));
	assert.ok(!courseProjectXml.includes('Оценка ________________________'));
	assert.ok(!courseProjectXml.includes('6300 – 010302D'));
	const courseProjectFooterXml = new AdmZip(courseProjectDocx)
		.getEntries()
		.filter(entry => /^word\/footer\d+\.xml$/.test(entry.entryName))
		.map(entry => entry.getData().toString('utf-8'))
		.join('\n');
	assert.ok(courseProjectFooterXml.includes('Самара 2026'));
	assert.ok(!courseProjectFooterXml.includes('<w:b/>'));

	const practiceMd = path.join(tempRoot, 'practice.md');
	const practiceDocx = path.join(tempRoot, 'practice.docx');
	fs.writeFileSync(
		practiceMd,
		testMarkdown
			.replace('Отчёт по курсовой работе', 'Отчет по практике')
			.replace(
				'supervisorRole: "Проверил"',
				'supervisorRole: "Руководитель практики от университета"\norganizationSupervisorRole: "Руководитель практики от организации"\norganizationSupervisorName: "Сидорова С. С."\norganizationSupervisorTitle: "начальник отдела"\npracticeKind: "учебная"\npracticeType: "ознакомительная"\neducationLevel: "бакалавриата"',
			),
		'utf8',
	);
	await buildReport(practiceMd, practiceDocx);
	const practiceXml = readDocxEntry(practiceDocx, 'word/document.xml');
	assert.ok(practiceXml.includes('Руководитель практики от организации'));
	assert.ok(practiceXml.includes('начальник отдела'));
	assert.ok(practiceXml.includes('по программе бакалавриата'));
	assert.ok(practiceXml.includes('учебная'));
	assert.ok(practiceXml.includes('ознакомительная'));
	assert.ok(practiceXml.includes('Дата сдачи ____________ г.'));
	assert.ok(!practiceXml.includes('ВСО СК России'));
	assert.ok(!practiceXml.includes('01.07.2026'));
	assert.ok(!practiceXml.includes('15.06.2026'));

	const labDir = path.join(tempRoot, 'lab');
	scaffoldReport({
		slug: 'lab',
		dir: labDir,
		profile: 'lab',
		initGit: false,
	});
	const labDocx = path.join(tempRoot, 'lab.docx');
	await buildReport(labDir, labDocx);
	const labXml = readDocxEntry(labDocx, 'word/document.xml');
	assert.ok(labXml.includes('Отчёт по лабораторной работе'));
	assert.ok(!labXml.includes('Научный руководитель'));
	assert.ok(!labXml.includes('Проверил'));
	assert.ok(!labXml.includes('(подпись)'));

	const labMetadataPath = path.join(labDir, '00_metadata.md');
	const labMetadata = fs.readFileSync(labMetadataPath, 'utf8');
	fs.writeFileSync(
		labMetadataPath,
		labMetadata.replace(
			'supervisorName: ""',
			'supervisorName: "Иванова Ирина Ивановна"',
		),
	);
	await buildReport(labDir, labDocx);
	const reviewedLabXml = readDocxEntry(labDocx, 'word/document.xml');
	assert.ok(reviewedLabXml.includes('Проверил Иванова Ирина Ивановна'));
	assert.ok(!reviewedLabXml.includes('Научный руководитель'));
	assert.ok(!reviewedLabXml.includes('(подпись)'));

	for (const profile of ['vkr-bachelor', 'vkr-master'] as const) {
		const vkrDir = path.join(tempRoot, profile);
		scaffoldReport({
			slug: profile,
			dir: vkrDir,
			profile,
			initGit: false,
		});
		const vkrDocx = path.join(tempRoot, `${profile}.docx`);
		await buildReport(vkrDir, vkrDocx);
		const vkrXml = readDocxEntry(vkrDocx, 'word/document.xml');
		assert.ok(vkrXml.includes('ВЫПУСКНАЯ КВАЛИФИКАЦИОННАЯ РАБОТА'));
		assert.ok(
			vkrXml.includes(
				profile === 'vkr-master'
					? 'уровень магистратуры'
					: 'уровень бакалавриата',
			),
		);
		assert.ok(vkrXml.includes('Нормоконтролёр'));
		assert.ok(vkrXml.includes('Исходные данные:'));
		assert.ok(
			vkrXml.includes('Перечень вопросов, подлежащих разработке в ВКР:'),
		);
		assert.ok(vkrXml.includes('Задание принял к исполнению'));
		assert.ok(vkrXml.includes('<w:pageBreakBefore/>'));
		assert.ok(!vkrXml.includes('Семестр 6'));
	}
	fs.rmSync(tempRoot, { recursive: true, force: true });

	console.log('Title page metadata test passed.');
}

main().catch(error => {
	console.error(error instanceof Error ? error.message : error);
	process.exit(1);
});
