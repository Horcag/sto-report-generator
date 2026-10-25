export function printHelp(): void {
	console.log(`STO Report Generator

Usage:
  npx tsx src/index.ts build <input.md|report_dir> <output.docx>
  npx tsx src/index.ts new <slug> --profile nir|coursework|lab|vkr-bachelor|vkr-master [--title "..."] [--dir reports/<slug>] [--no-git]
  npx tsx src/index.ts check <report_dir> [--strict]
  npx tsx src/index.ts bibliography <report_dir> [--require-evidence] [--json]
  npx tsx src/index.ts generate <report_dir> [--output build/report.docx] [--renderer portable|word|wordcraft] [--post-build] [--validate] [--wordcraft /path/to/wordcraft-cli] [--pdf report.wordcraft.pdf]
  npx tsx src/index.ts audit <report_dir> [--output build/report.docx] [--renderer portable|word|wordcraft] [--wordcraft /path/to/wordcraft-cli] [--pdf report.wordcraft.pdf]
  npx tsx src/index.ts preview <input.docx> [--renderer libreoffice|wordcraft] [--pdf preview.pdf] [--soffice /path/to/soffice] [--wordcraft /path/to/wordcraft-cli]
  npx tsx src/index.ts accept-word <input.docx> [--accepted-docx accepted.docx] [--pdf accepted.pdf] [--manifest acceptance.json] [--pdf-image-quality original|print|screen] [--background-only] [--style-preset samara-template-2022|default]
  npx tsx src/index.ts validate-docx <report.docx> [unpack_dir]
  npx tsx src/index.ts doctor
  npx tsx src/index.ts figures inspect <report_dir> [--json]
  npx tsx src/index.ts figures preview <report_dir> [--output build/figures.html]
  npx tsx src/index.ts figures set <report_dir> --id <figure_id> --spec '<JSON>'
  npx tsx src/index.ts figures set <report_dir> --settings <figures.json>

Word acceptance: --background-only disables interactive Word fallback.
PDF images: original (default) preserves source resolution and requires ExportAsFixedFormat2;
print/screen explicitly allow Word downsampling. Actual image DPI depends on source and placement.

Wordcraft font controls: --font-dir /path/to/fonts (or WORDCRAFT_FONT_DIR), --strict-fonts.
Wordcraft is experimental; it requires wordcraft-cli 0.10.0 and uv/Python.
It produces a separate PDF and diagnostic JSON, preserving the generated DOCX.

Backward-compatible form still works:
  npx tsx src/index.ts <input.md|report_dir> <output.docx>`);
}
