import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { runSourcePreflight } from '@/shared/lib/source-preflight';

function writeTempReport(files: Record<string, string>): string {
	const dir = fs.mkdtempSync(
		path.join(os.tmpdir(), 'sto-appendix-warning-test-'),
	);
	for (const [name, content] of Object.entries(files)) {
		fs.writeFileSync(path.join(dir, name), content, 'utf8');
	}
	return dir;
}

const baseFiles = {
	'00_metadata.md': `---
department: "Институт информатики и кибернетики"
subdepartment: "Кафедра технической кибернетики"
reportType: "Отчет о научно-исследовательской работе"
degree: "бакалавра"
semester: 7
specialtyCode: "01.03.02"
specialtyName: "Прикладная математика и информатика"
profileName: "Анализ данных"
studentName: "Иванов Иван Иванович"
groupNumber: "6402 – 010302D"
topic: "Проверка заголовков приложений"
supervisorName: "Петров Петр Петрович"
supervisorTitle: "доцент"
city: "Самара"
year: 2026
---
`,
	'01_referat.md': `\\sto_structural_heading{РЕФЕРАТ}

\\sto_referat_characteristics{Отчет {{PAGES}} с., {{FIGURES}} рис., {{TABLES}} табл., {{SOURCES}} источн., {{APPENDICES}} прил.}

ОТЧЕТ, ПРИЛОЖЕНИЕ, СТРУКТУРА, ПРОВЕРКА, ДОКУМЕНТ

\\sto_referat_application{Результаты применимы в учебном процессе.}

Текст реферата.
`,
	'02_toc.md': `\\sto_structural_heading{СОДЕРЖАНИЕ}
`,
	'03_intro.md': `\\sto_structural_heading{ВВЕДЕНИЕ}

Текст введения.
`,
	'90_conclusion.md': `\\sto_structural_heading{ЗАКЛЮЧЕНИЕ}

Текст заключения.
`,
};

function run(): void {
	const legacyDir = writeTempReport({
		...baseFiles,
		'04_body.md': `# 1 Основной раздел

Подробные материалы приведены в приложении А.
`,
		'99_appendix.md': `\\sto_structural_heading{ПРИЛОЖЕНИЕ А}

Материалы приложения.
`,
	});
	const modernDir = writeTempReport({
		...baseFiles,
		'04_body.md': `# 1 Основной раздел

Подробные материалы приведены в \\sto_appendix_ref{А}.
`,
		'99_appendix.md': `\\sto_appendix{А}{Дополнительные материалы}

Материалы приложения.
`,
	});

	try {
		const legacyNormal = runSourcePreflight(legacyDir);
		assert.equal(
			legacyNormal.passed,
			true,
			legacyNormal.issues
				.map(i => `${i.severity}:${i.code}:${i.message}`)
				.join('; '),
		);
		const warnings = legacyNormal.issues.filter(
			i => i.code === 'structural-heading-appendix',
		);
		assert.equal(warnings.length, 1);
		assert.equal(warnings[0].severity, 'warning');
		assert.match(warnings[0].message, /\\sto_appendix/);

		const legacyStrict = runSourcePreflight(legacyDir, { strict: true });
		assert.equal(legacyStrict.passed, false);

		const modern = runSourcePreflight(modernDir, { strict: true });
		assert.equal(
			modern.issues.filter(i => i.code === 'structural-heading-appendix')
				.length,
			0,
		);
		assert.equal(
			modern.passed,
			true,
			modern.issues
				.map(i => `${i.severity}:${i.code}:${i.message}`)
				.join('; '),
		);

		console.log('Appendix heading preflight warning tests passed.');
	} finally {
		fs.rmSync(legacyDir, { recursive: true, force: true });
		fs.rmSync(modernDir, { recursive: true, force: true });
	}
}

run();
