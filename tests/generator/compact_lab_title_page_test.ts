import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { JSDOM } from 'jsdom';

import { buildReport } from '@/app/builder';
import { readDocxEntry, unpackDocx } from '@/shared/lib/docx';
import { resolveReportConfig } from '@/shared/lib/report-config';
import { validateMetadata } from '@/shared/lib/source-preflight/metadata-checker';
import { SourcePreflightIssue } from '@/shared/lib/source-preflight/types';
import { validateSTO } from '@/shared/lib/sto-validator';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sto-compact-lab-'));
const metadata = {
	organizationLines: ['Тестовое министерство', 'Тестовый университет'],
	department: 'Тестовый институт',
	subdepartment: 'Тестовая кафедра',
	reportProfile: 'lab',
	titlePageVariant: 'compact-lab',
	reportType: 'ЛАБОРАТОРНАЯ РАБОТА №2',
	degree: 'по курсу «Тестовая дисциплина»',
	studentName: 'Иванов Иван Иванович',
	groupNumber: '6402-010302D',
	supervisorRole: 'Проверил',
	supervisorTitle: 'доцент',
	supervisorName: 'Петров Петр Петрович',
	city: 'Тестовый город',
	year: 2026,
};
const markdown = (data: Record<string, unknown>): string =>
	`---\n${JSON.stringify(data)}\n---\n`;

async function main(): Promise<void> {
	try {
		const config = {
			...resolveReportConfig(directory).config,
			profile: 'lab' as const,
			profileExplicit: true,
		};
		const issues: SourcePreflightIssue[] = [];
		validateMetadata(
			[{ file: '00_metadata.md', content: markdown(metadata) }],
			issues,
			config,
		);
		assert.deepEqual(
			issues,
			[],
			'Compact labs require only displayed fields',
		);
		const mismatch: SourcePreflightIssue[] = [];
		validateMetadata(
			[{ file: '00_metadata.md', content: markdown(metadata) }],
			mismatch,
			{ ...config, profile: 'nir' },
		);
		assert.ok(
			mismatch.some(
				issue =>
					issue.code ===
					'metadata-title-page-variant-profile-mismatch',
			),
		);

		for (const [
			studentName,
			supervisorName,
			student,
			supervisor,
			degreePrefix,
		] of [
			[
				'Иванов Иван Иванович',
				'Петров Петр Петрович',
				'И. И. Иванов',
				'П. П. Петров',
				'по курсу',
			],
			[
				'Сидорова Анна Олеговна',
				'Смирнов Алексей Андреевич',
				'А. О. Сидорова',
				'А. А. Смирнов',
				'по дисциплине',
			],
		]) {
			const source = path.join(directory, 'title.md');
			const output = path.join(directory, 'title.docx');
			fs.writeFileSync(
				source,
				markdown({
					...metadata,
					studentName,
					supervisorName,
					degree: `${degreePrefix} «Тестовая дисциплина»`,
					semester: 6,
					specialtyCode: '01.03.02',
					specialtyName: 'Ненужное направление',
					profileName: 'Ненужный профиль',
					topic: 'Ненужная тема НИР',
				}),
			);
			await buildReport(source, output);
			const xml = readDocxEntry(output, 'word/document.xml');
			const document = new JSDOM(xml, { contentType: 'application/xml' })
				.window.document;
			const text = document.documentElement.textContent!;
			for (const value of [
				...metadata.organizationLines,
				metadata.department,
				metadata.subdepartment,
				metadata.reportType,
				degreePrefix,
				'«Тестовая дисциплина»',
				`Группа ${metadata.groupNumber}`,
				'Студент',
				'Проверил,',
				'доцент',
				student,
				supervisor,
			]) {
				assert.ok(text.includes(value), `Missing title text: ${value}`);
			}
			assert.equal((text.match(/\(подпись\)/g) ?? []).length, 2);
			for (const excluded of [
				'Семестр',
				'01.03.02',
				'Ненужное направление',
				'Ненужный профиль',
				'Ненужная тема НИР',
				'Научный руководитель',
				'Тестовый город 2026',
			]) {
				assert.ok(
					!text.includes(excluded),
					`Unexpected title text: ${excluded}`,
				);
			}
			assert.ok(!xml.includes('<w:pageBreakBefore/>'));
			assert.equal(document.getElementsByTagName('w:tbl').length, 0);
			const signatureParagraphs = Array.from(
				document.getElementsByTagName('w:p'),
			).filter(
				paragraph =>
					paragraph.textContent?.includes(student) ||
					paragraph.textContent?.includes(supervisor),
			);
			assert.equal(signatureParagraphs.length, 2);
			for (const paragraph of signatureParagraphs) {
				assert.equal(paragraph.getElementsByTagName('w:tab').length, 4);
				assert.deepEqual(
					Array.from(
						paragraph.getElementsByTagName('w:tabs')[0].children,
					).map(tab => tab.getAttribute('w:pos')),
					['6840', '6960'],
				);
			}
			const paragraphs = Array.from(document.getElementsByTagName('w:p'));
			const paragraphText = paragraphs.map(
				paragraph => paragraph.textContent,
			);
			const groupIndex = paragraphText.indexOf(
				`Группа ${metadata.groupNumber}`,
			);
			assert.ok(groupIndex >= 0);
			assert.equal(
				paragraphs[groupIndex]
					.getElementsByTagName('w:jc')[0]
					?.getAttribute('w:val'),
				'left',
			);
			assert.equal(
				paragraphs[groupIndex]
					.getElementsByTagName('w:ind')[0]
					?.getAttribute('w:left'),
				'0',
			);
			assert.ok(paragraphText[groupIndex + 1]?.startsWith('Студент'));
			assert.equal(paragraphText[groupIndex + 2], '(подпись)');
			assert.equal(paragraphText[groupIndex + 3], 'Проверил,');
			assert.ok(paragraphText[groupIndex + 4]?.startsWith('доцент'));
			assert.equal(paragraphText[groupIndex + 5], '(подпись)');
			const degreeParagraph = paragraphs.find(
				paragraph =>
					paragraph.textContent ===
					`${degreePrefix}«Тестовая дисциплина»`,
			);
			assert.ok(
				degreeParagraph,
				'Degree prefix and title form an independent centered block',
			);
			assert.equal(
				degreeParagraph.getElementsByTagName('w:br').length,
				1,
			);
			assert.equal(
				degreeParagraph
					.getElementsByTagName('w:jc')[0]
					?.getAttribute('w:val'),
				'center',
			);
			for (const paragraph of signatureParagraphs) {
				assert.equal(
					paragraph
						.getElementsByTagName('w:tabs')[0]
						.children[0].getAttribute('w:leader'),
					'underscore',
				);
			}
			const captions = paragraphs.filter(
				paragraph => paragraph.textContent === '(подпись)',
			);
			assert.equal(captions.length, 2);
			for (const caption of captions) {
				const tab =
					caption.getElementsByTagName('w:tabs')[0].children[0];
				assert.equal(tab.getAttribute('w:val'), 'center');
				assert.equal(tab.getAttribute('w:pos'), '4070');
				assert.equal(caption.getElementsByTagName('w:i').length, 1);
			}
			const unpacked = path.join(directory, 'unpacked');
			unpackDocx(output, unpacked);
			assert.deepEqual(
				validateSTO(unpacked).filter(result => !result.passed),
				[],
				'Compact title must pass the generated DOCX validator',
			);

			const stylesPath = path.join(unpacked, 'word', 'styles.xml');
			const documentPath = path.join(unpacked, 'word', 'document.xml');
			const remappedStyles = fs
				.readFileSync(stylesPath, 'utf8')
				.replace('w:styleId="TitlePageText"', 'w:styleId="af0"');
			const remappedDocument = xml.replaceAll(
				'<w:pStyle w:val="TitlePageText"/>',
				'<w:pStyle w:val="af0"/>',
			);
			assert.ok(remappedStyles.includes('w:styleId="af0"'));
			assert.ok(!remappedStyles.includes('w:styleId="TitlePageText"'));
			assert.ok(remappedDocument.includes('<w:pStyle w:val="af0"/>'));
			assert.ok(
				!remappedDocument.includes('<w:pStyle w:val="TitlePageText"/>'),
			);
			fs.writeFileSync(stylesPath, remappedStyles);
			fs.writeFileSync(documentPath, remappedDocument);
			assert.deepEqual(
				validateSTO(unpacked).filter(result => !result.passed),
				[],
				'Word-renamed title style must retain allowed signature tabs',
			);
			const bodyTab =
				'<w:p><w:pPr><w:pStyle w:val="Normal"/></w:pPr>' +
				'<w:r><w:t>Текст</w:t><w:tab/><w:t>отчёта</w:t></w:r></w:p>';
			fs.writeFileSync(
				documentPath,
				remappedDocument.replace('</w:body>', `${bodyTab}</w:body>`),
			);
			const tabCheck = validateSTO(unpacked).find(
				result => result.check === 'Tab Characters',
			);
			assert.ok(tabCheck, 'Tab Characters check must execute');
			assert.equal(
				tabCheck.passed,
				false,
				'Ordinary body tabs remain forbidden',
			);

			for (const run of document.getElementsByTagName('w:r')) {
				assert.equal(
					run.getElementsByTagName('w:sz')[0]?.getAttribute('w:val'),
					run.textContent === '(подпись)' ? '16' : '24',
				);
				assert.equal(
					run
						.getElementsByTagName('w:rFonts')[0]
						?.getAttribute('w:ascii'),
					'Times New Roman',
				);
			}
			for (const paragraph of document.getElementsByTagName('w:p')) {
				assert.equal(
					paragraph
						.getElementsByTagName('w:spacing')[0]
						?.getAttribute('w:line'),
					'240',
				);
			}
			const footer = new AdmZip(output)
				.getEntries()
				.filter(entry => /^word\/footer\d+\.xml$/.test(entry.entryName))
				.map(entry => entry.getData().toString('utf8'))
				.join('');
			assert.ok(footer.includes('Тестовый город 2026'));
		}
		console.log(
			'Compact lab title tests passed: metadata, two identities, signatures, typography, footer.',
		);
	} finally {
		fs.rmSync(directory, { recursive: true, force: true });
	}
}

main().catch(error => {
	console.error(error);
	process.exitCode = 1;
});
