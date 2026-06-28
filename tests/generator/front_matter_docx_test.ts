import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Document, Packer, Paragraph } from 'docx';

import { buildReport } from '@/app/builder';
import {
	insertDocxBodyBeforeText,
	readDocxEntry,
} from '@/shared/lib/docx-archive';

const tempRoot = path.join(process.cwd(), '.agent-work', 'front-matter-test');
const tempReportMd = path.join(tempRoot, 'report.md');
const tempTargetDocx = path.join(tempRoot, 'report.docx');
const tempFrontMatterDocx = path.join(tempRoot, 'assignment.docx');

const testMarkdown = String.raw`---
title: Тест
reportType: "Титульный тест"
degree: "тестовая работа"
semester: 6
specialtyCode: "01.03.02"
specialtyName: "Прикладная математика и информатика"
profileName: "Искусственный интеллект и компьютерные науки"
department: "Институт информатики и кибернетики"
subdepartment: "Кафедра технической кибернетики"
studentName: "Иванов Иван Иванович"
groupNumber: "6300-010302D"
topic: "Тестовая тема"
supervisorRole: "Проверил"
supervisorName: "Петров Петр Петрович"
supervisorTitle: "доцент"
city: "Самара"
year: 2026
---

\sto_structural_heading{РЕФЕРАТ}

Основной реферат.

\sto_structural_heading{СОДЕРЖАНИЕ}

\sto_structural_heading{ВВЕДЕНИЕ}

Основной текст.

\sto_structural_heading{ЗАКЛЮЧЕНИЕ}
`;

async function createFrontMatterDocx(outputPath: string): Promise<void> {
	const doc = new Document({
		sections: [
			{
				children: [
					new Paragraph('Задание по практике'),
					new Paragraph('Содержимое задания.'),
				],
			},
		],
	});
	fs.writeFileSync(outputPath, await Packer.toBuffer(doc));
}

async function main(): Promise<void> {
	fs.rmSync(tempRoot, { recursive: true, force: true });
	fs.mkdirSync(tempRoot, { recursive: true });
	fs.writeFileSync(tempReportMd, testMarkdown, 'utf-8');
	await createFrontMatterDocx(tempFrontMatterDocx);

	await buildReport(tempReportMd, tempTargetDocx);
	insertDocxBodyBeforeText({
		targetDocxPath: tempTargetDocx,
		sourceDocxPath: tempFrontMatterDocx,
		beforeText: 'Реферат',
	});

	const documentXml = readDocxEntry(tempTargetDocx, 'word/document.xml');
	fs.rmSync(tempRoot, { recursive: true, force: true });

	const titleIndex = documentXml.indexOf('Титульный тест');
	const assignmentIndex = documentXml.indexOf('Задание по практике');
	const referatIndex = documentXml.indexOf('Реферат');

	assert.ok(titleIndex >= 0);
	assert.ok(assignmentIndex > titleIndex);
	assert.ok(referatIndex > assignmentIndex);
	assert.ok(documentXml.includes('<w:br w:type="page"/>'));
	assert.equal(documentXml.match(/<w:sectPr\b/g)?.length, 1);

	console.log('Front matter DOCX insertion test passed.');
}

main().catch(error => {
	console.error(error instanceof Error ? error.message : error);
	process.exit(1);
});
