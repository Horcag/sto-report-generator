import { createLibreOfficePreview } from './libreoffice-preview';
import {
	createWordcraftPdf,
	WordcraftRenderResult,
} from './wordcraft-renderer';

export function printWordcraftResult(result: WordcraftRenderResult): void {
	console.log(`Experimental Wordcraft PDF: ${result.outputPdf}`);
	console.log(`Render manifest: ${result.manifestPath}`);
	console.log(`Wordcraft ${result.version}: ${result.pageCount} page(s)`);
	for (const warning of result.warnings) console.warn(warning);
}

export function runPreview(options: {
	inputDocx?: string;
	renderer?: string;
	pdf?: string;
	soffice?: string;
	wordcraft?: string;
}): void {
	if (!options.inputDocx) {
		throw new Error('preview command requires an input DOCX path.');
	}
	const renderer = options.renderer ?? 'libreoffice';
	if (renderer === 'wordcraft') {
		if (options.soffice)
			throw new Error('--soffice requires LibreOffice preview.');
		printWordcraftResult(
			createWordcraftPdf({
				inputDocx: options.inputDocx,
				outputPdf: options.pdf,
				executable: options.wordcraft,
			}),
		);
		return;
	}
	if (renderer !== 'libreoffice') {
		throw new Error('Preview renderers: libreoffice, wordcraft.');
	}
	if (options.wordcraft)
		throw new Error('--wordcraft requires Wordcraft preview.');
	const pdf = createLibreOfficePreview({
		inputDocx: options.inputDocx,
		outputPdf: options.pdf,
		soffice: options.soffice,
	});
	console.log(`LibreOffice preview: ${pdf}`);
	console.log(
		'Pagination is not authoritative; use accept-word for final Word/PDF acceptance.',
	);
}
