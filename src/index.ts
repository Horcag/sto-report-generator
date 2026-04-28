import { buildReport } from '@/app/builder';

const inputPath = process.argv[2];
const outputPath = process.argv[3] || 'test_report.docx';

if (!inputPath) {
	console.error('Error: Please provide an input markdown file path.');
	console.error(
		'Usage: npm start <input_markdown_file.md> [output_report.docx]',
	);
	process.exit(1);
}

buildReport(inputPath, outputPath).catch(console.error);
