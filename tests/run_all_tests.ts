import { spawnSync } from 'node:child_process';

const tsxCliPath = require.resolve('tsx/cli');

const tests = [
	['tests/figures/planning_tests.ts'],
	['tests/figures/svg_baseline.test.ts'],
	['tests/figures/inspector.test.ts'],
	['tests/figures/document_policy_tests.ts'],
	['tests/workflow/word_acceptance_figures_test.ts'],
	['tests/source-preflight/run_source_preflight_tests.ts'],
	['tests/source-preflight/table_regressions_test.ts'],
	['tests/source-preflight/formula_punctuation_test.ts'],
	['tests/source-preflight/formula_semantics_test.ts'],
	['tests/source-preflight/regression_checks.ts', 'example'],
	['tests/source-preflight/masking_regression_test.ts'],
	['tests/source-preflight/math_environment_preflight.test.ts'],
	['tests/parser/run_parser_tests.ts'],
	['tests/parser/table_layout.test.ts'],
	['tests/parser/table_headers.test.ts'],
	['tests/parser/math_environment.test.ts'],
	['tests/parser/formula_layout.test.ts'],
	['tests/shared/run_math_converter_tests.ts'],
	['tests/shared/run_math_matrix_tests.ts'],
	['tests/shared/run_math_system_tests.ts'],
	['tests/shared/dependency_security_tests.ts'],
	['tests/shared/steiger_zod_security_test.ts'],
	['tests/validator/run_validator_tests.ts'],
	['tests/validator/formula_layout_test.ts'],
	['tests/validator/table_layout_test.ts'],
	['tests/validator/table_cells_test.ts'],
	['tests/validator/template_style_conformance_test.ts'],
	['tests/validator/dotm_style_contract_test.ts'],
	['tests/validator/template_style_application_test.ts'],
	['tests/generator/run_generated_docx_validation.ts'],
	['tests/generator/table_spacing_test.ts'],
	['tests/workflow/run_portability_tests.ts'],
	['tests/workflow/formula_punctuation_generate_test.ts'],
	['tests/workflow/run_libreoffice_preview_tests.ts'],
	['tests/workflow/run_wordcraft_fonts_tests.ts'],
	['tests/workflow/run_wordcraft_font_files_tests.ts'],
	['tests/workflow/run_wordcraft_command_tests.ts'],
	['tests/workflow/run_wordcraft_table_tests.ts'],
	['tests/workflow/run_wordcraft_layout_tests.ts'],
	['tests/workflow/run_wordcraft_sections_tests.ts'],
	['tests/workflow/run_wordcraft_release_tests.ts'],
	['tests/workflow/run_wordcraft_fields_tests.ts'],
	['tests/workflow/cli_args.test.ts'],
	['tests/workflow/run_wordcraft_renderer_tests.ts'],
	['tests/workflow/run_wordcraft_workflow_tests.ts'],
	['tests/workflow/run_ci_configuration_tests.ts'],
	['tests/workflow/run_word_acceptance_tests.ts'],
	['tests/workflow/word_pdf_quality_test.ts'],
	['tests/workflow/word_builtin_styles_test.ts'],
	['tests/workflow/run_referat_statistics_tests.ts'],
	['tests/workflow/run_word_acceptance_launcher_tests.ts'],
	['tests/workflow/word_acceptance_integrity_test.ts'],
	['tests/workflow/word_acceptance_tables_test.ts'],
	['tests/generator/title_page_metadata_test.ts'],
	['tests/generator/compact_lab_title_page_test.ts'],
	['tests/generator/front_matter_docx_test.ts'],
	['tests/scaffold/run_scaffold_tests.ts'],
	['tests/bibliography/bib-gost.test.ts'],
	['tests/bibliography/bib-areas.test.ts'],
	['tests/bibliography/bib-evidence.test.ts'],
	['tests/bibliography/bib-presentation.test.ts'],
	['tests/generator/toc_regression.ts'],
	['tests/generator/run_generator_snapshot_test.ts'],
	['tests/quality/lcov_gate.test.ts'],
];

for (const args of tests) {
	console.log(`\n> node ${tsxCliPath} ${args.join(' ')}`);
	const result = spawnSync(process.execPath, [tsxCliPath, ...args], {
		cwd: process.cwd(),
		stdio: 'inherit',
		shell: false,
	});

	if (result.error) {
		throw result.error;
	}
	if (result.status !== 0) {
		process.exit(result.status ?? 1);
	}
}

console.log('\nAll tests passed.');
