import type { TestHarness } from './structure_reference_tests';

export function runTableReferatWarningTests({
	validFiles,
	expectNoIssue,
	expectWarning,
}: Pick<TestHarness, 'validFiles' | 'expectNoIssue' | 'expectWarning'>): void {
	const tableHeader = '| Поле | Смысл |\n|---|---|\n';
	const tableRows = (count: number) =>
		Array.from(
			{ length: count },
			(_, index) => `| Поле ${index + 1} | Значение |`,
		).join('\n');
	expectNoIssue(
		'long-table-that-may-fit-on-one-page',
		validFiles({
			'03_intro.md': `Данные приведены в таблице 1.\n\nТаблица 1 – Данные\n\n${tableHeader}${tableRows(13)}\n`,
		}),
		'table-long-unsegmented',
	);
	const longKeywords = Array.from(
		{ length: 15 },
		(_, index) => `ТЕРМИН ${index + 1} ${'ОПИСАНИЕ'.repeat(6)}`,
	).join(', ');
	expectNoIssue(
		'referat-length-excludes-statistics-and-keywords',
		validFiles({
			'01_referat.md': `\\sto_structural_heading{РЕФЕРАТ}\n\n{{PAGES}} с., {{SOURCES}} источников.\n\n${longKeywords}\n\n\\sto_referat_characteristics{Оценено распределение.}\n\n\\sto_referat_application{Для анализа.}\n`,
		}),
		'referat-length-warning',
	);
	expectWarning(
		'referat-length-counts-rendered-text',
		validFiles({
			'01_referat.md': `\\sto_structural_heading{РЕФЕРАТ}\n\n{{PAGES}} с., {{SOURCES}} источников.\n\nПЕРВЫЙ, ВТОРОЙ, ТРЕТИЙ, ЧЕТВЁРТЫЙ, ПЯТЫЙ\n\n\\sto_referat_characteristics{${'Оценено распределение. '.repeat(40)}}\n\n\\sto_referat_application{Для анализа.}\n`,
		}),
		'referat-length-warning',
	);
}
