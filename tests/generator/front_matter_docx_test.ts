import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { Document, Packer, Paragraph, Table, TableCell, TableRow } from 'docx';

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
					new Table({
						rows: [
							new TableRow({
								children: [
									new TableCell({
										children: [
											new Paragraph('Первый столбец'),
										],
									}),
									new TableCell({
										children: [
											new Paragraph('Второй столбец'),
										],
									}),
								],
							}),
						],
					}),
					new Table({
						columnWidths: [1200, 2400, 1200],
						rows: [
							new TableRow({
								children: [
									new TableCell({
										children: [
											new Paragraph(
												'Планируемые результаты',
											),
										],
									}),
									new TableCell({
										children: [
											new Paragraph('Выполнение работ'),
										],
									}),
									new TableCell({
										children: [
											new Paragraph(
												'Результаты практики',
											),
										],
									}),
								],
							}),
						],
					}),
					new Table({
						columnWidths: [6015, 2220, 1119],
						rows: [
							new TableRow({
								children: [
									new TableCell({
										children: [
											new Paragraph(
												'Руководитель практики от университета, доцент кафедры технической кибернетики, к.т.н.',
											),
										],
									}),
									new TableCell({
										children: [
											new Paragraph(
												'______________________',
											),
											new Paragraph('(подпись)'),
										],
									}),
									new TableCell({
										children: [
											new Paragraph('Л.В. Логанова'),
										],
									}),
								],
							}),
							new TableRow({
								children: [
									new TableCell({
										children: [
											new Paragraph(
												'Руководитель практики от ВСО СК России по Самарскому гарнизону, руководитель отдела',
											),
										],
									}),
									new TableCell({
										children: [
											new Paragraph(
												'______________________',
											),
											new Paragraph('(подпись)'),
										],
									}),
									new TableCell({
										children: [
											new Paragraph('Г.Н. Дунаев'),
										],
									}),
								],
							}),
							new TableRow({
								children: [
									new TableCell({
										children: [
											new Paragraph(
												'Задание принял к исполнению обучающийся группы № 6302-010302D',
											),
										],
									}),
									new TableCell({
										children: [
											new Paragraph(
												'______________________',
											),
											new Paragraph('(подпись)'),
										],
									}),
									new TableCell({
										children: [
											new Paragraph('И.И. Иванов'),
										],
									}),
								],
							}),
						],
					}),
				],
			},
		],
	});
	fs.writeFileSync(outputPath, await Packer.toBuffer(doc));
}

function insertSelfClosingParagraphBeforeAssignmentTable(
	docxPath: string,
): void {
	const archive = new AdmZip(docxPath);
	const documentEntry = archive.getEntry('word/document.xml');
	assert.ok(documentEntry);

	const documentXml = documentEntry.getData().toString('utf8');
	const updatedXml = documentXml.replace(
		/(<w:tbl\b[\s\S]*?<w:t\b[^>]*>Планируемые результаты<\/w:t>)/,
		'<w:p w14:paraId="ABCDEF12"/>$1',
	);
	assert.notEqual(updatedXml, documentXml);

	archive.updateFile('word/document.xml', Buffer.from(updatedXml, 'utf8'));
	fs.writeFileSync(docxPath, archive.toBuffer());
}

function tableContaining(xml: string, text: string): string {
	const tableXml = xml
		.match(/<w:tbl\b[\s\S]*?<\/w:tbl>/g)
		?.find(table => table.includes(text));
	assert.ok(tableXml, `Expected table containing "${text}".`);
	return tableXml;
}

async function main(): Promise<void> {
	fs.rmSync(tempRoot, { recursive: true, force: true });
	fs.mkdirSync(tempRoot, { recursive: true });
	fs.writeFileSync(tempReportMd, testMarkdown, 'utf-8');
	await createFrontMatterDocx(tempFrontMatterDocx);
	insertSelfClosingParagraphBeforeAssignmentTable(tempFrontMatterDocx);

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

	const insertedFrontMatterXml = documentXml.slice(
		assignmentIndex,
		referatIndex,
	);
	const genericFrontMatterTableXml = tableContaining(
		insertedFrontMatterXml,
		'Первый столбец',
	);
	assert.ok(
		/<w:tblW w:w="\d+" w:type="dxa"\/>/.test(genericFrontMatterTableXml),
	);
	assert.equal(/<w:tcW\b/.test(genericFrontMatterTableXml), false);
	assert.equal(/<w:tblCellMar\b/.test(genericFrontMatterTableXml), false);
	const assignmentPlanTableXml = tableContaining(
		insertedFrontMatterXml,
		'Планируемые результаты',
	);
	assert.match(
		assignmentPlanTableXml,
		/<w:tblW\b(?=[^>]*w:type="auto")(?=[^>]*w:w="100")/,
	);
	assert.doesNotMatch(assignmentPlanTableXml, /<w:tblW\b[^>]*w:type="dxa"/);
	assert.match(assignmentPlanTableXml, /<w:sz w:val="24"\/>/);
	assert.doesNotMatch(insertedFrontMatterXml, /<w:p\b[^>]*\/>/);
	assert.doesNotMatch(insertedFrontMatterXml, /<w:pPr\s*\/>/);
	assert.match(
		insertedFrontMatterXml,
		/<w:p\b[^>]*w14:paraId="ABCDEF12"[^>]*><w:pPr>[\s\S]*?<w:rPr>[\s\S]*?<w:sz w:val="24"\/>/,
	);
	assert.match(
		insertedFrontMatterXml,
		/<w:ind w:left="0" w:firstLine="0"\/>/,
	);
	assert.match(insertedFrontMatterXml, /<w:tblW w:w="8854" w:type="dxa"\/>/);
	assert.match(insertedFrontMatterXml, /<w:gridCol w:w="4263"\/>/);
	assert.match(insertedFrontMatterXml, /<w:gridCol w:w="2916"\/>/);
	assert.match(insertedFrontMatterXml, /<w:gridCol w:w="1675"\/>/);
	assert.match(insertedFrontMatterXml, /<w:tcW w:w="4263" w:type="dxa"\/>/);
	assert.match(insertedFrontMatterXml, /<w:tcW w:w="2916" w:type="dxa"\/>/);
	assert.match(insertedFrontMatterXml, /<w:tcW w:w="1675" w:type="dxa"\/>/);
	assert.ok(
		insertedFrontMatterXml.includes('от университета, доцент кафедры'),
	);
	assert.ok(
		insertedFrontMatterXml.includes('технической кибернетики, к.т.н.'),
	);
	assert.ok(
		insertedFrontMatterXml.includes('от ВСО СК России по Самарскому'),
	);
	assert.ok(
		insertedFrontMatterXml.includes('гарнизону, руководитель отдела'),
	);
	assert.ok(
		insertedFrontMatterXml.includes('обучающийся группы № 6302-010302D'),
	);

	console.log('Front matter DOCX insertion test passed.');
}

main().catch(error => {
	console.error(error instanceof Error ? error.message : error);
	process.exit(1);
});
