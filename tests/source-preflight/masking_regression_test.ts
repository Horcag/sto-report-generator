import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { runSourcePreflight } from '@/shared/lib/source-preflight';

const tempRoot = path.join(
	process.cwd(),
	'.agent-work',
	'source-preflight-masking-tests',
);

function writeReport(name: string, files: Record<string, string>): string {
	const dir = path.join(tempRoot, name);
	fs.rmSync(dir, { recursive: true, force: true });
	fs.mkdirSync(dir, { recursive: true });
	for (const [file, content] of Object.entries(files)) {
		const filePath = path.join(dir, file);
		fs.mkdirSync(path.dirname(filePath), { recursive: true });
		fs.writeFileSync(filePath, content, 'utf8');
	}
	return dir;
}

function run(): void {
	const reportDir = writeReport('html-comments-and-br', {
		'report.config.json': JSON.stringify(
			{
				profile: 'lab',
				sourceDir: '.',
				outputDocx: 'build/lab.docx',
				document: {
					requiredStructuralHeadings: ['ВВЕДЕНИЕ', 'ЗАКЛЮЧЕНИЕ'],
					optionalStructuralHeadings: [
						'СОДЕРЖАНИЕ',
						'СПИСОК ИСПОЛЬЗОВАННЫХ ИСТОЧНИКОВ',
					],
					requireReferat: false,
					requireSources: 'when-cited',
				},
				preflight: {
					strict: false,
					softTextRules: 'warning',
				},
			},
			null,
			2,
		),
		'00_metadata.md': `---
department: "Институт информатики и кибернетики"
subdepartment: "Кафедра технической кибернетики"
reportType: "Лабораторная работа"
degree: "по дисциплине «Название дисциплины»"
semester: 6
specialtyCode: "01.03.02"
specialtyName: "Прикладная математика и информатика"
profileName: "Искусственный интеллект и компьютерные науки"
studentName: "Иванов Иван Иванович"
groupNumber: "6300 – 010302D"
topic: "Лабораторная работа"
supervisorName: "Петров Петр Петрович"
supervisorTitle: "доцент"
city: "Самара"
year: 2026
---
`,
		'03_intro.md': `\\sto_structural_heading{ВВЕДЕНИЕ}

Цель лабораторной работы – проверить профиль.

В таблице 1 представлены данные.

<!-- widths: 20, 80 -->
Таблица 1 – Пример таблицы с комментариями и переносами
| Заголовок 1 | Заголовок 2 |
| :--- | :--- |
| Данные 1 | Данные с тегом<br>новой строки |
`,
		'90_conclusion.md': `\\sto_structural_heading{ЗАКЛЮЧЕНИЕ}

Выводы представлены корректно.
`,
	});

	const result = runSourcePreflight(reportDir);
	assert.equal(
		result.passed,
		true,
		result.issues.map(item => `${item.code}:${item.message}`).join(', '),
	);

	console.log('Source preflight masking regression test passed.');
}

run();
