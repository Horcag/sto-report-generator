import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import AdmZip from 'adm-zip';

import { buildReport } from '@/app/builder';
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
	fs.rmSync(tempRoot, { recursive: true, force: true });

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

	console.log('Title page metadata test passed.');
}

main().catch(error => {
	console.error(error instanceof Error ? error.message : error);
	process.exit(1);
});
