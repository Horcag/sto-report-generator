import fs from 'node:fs';
import { JSDOM } from 'jsdom';

import { readDocxEntry } from '@/shared/lib/docx-archive';

const WORD_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function stableParagraphs(xml: string): string[] {
	const document = new JSDOM(xml, { contentType: 'text/xml' }).window
		.document;
	const body = document.getElementsByTagNameNS(WORD_NS, 'body')[0];
	if (!body) throw new Error('Word document is missing its body.');
	return [...body.children]
		.flatMap(element => {
			if (element.namespaceURI !== WORD_NS) return [];
			if (element.localName === 'p') return [element];
			if (element.localName === 'tbl')
				return [...element.getElementsByTagNameNS(WORD_NS, 'p')];
			return [];
		})
		.filter(
			paragraph =>
				!paragraph.getElementsByTagNameNS(WORD_NS, 'fldChar').length &&
				!paragraph.getElementsByTagNameNS(WORD_NS, 'fldSimple').length,
		)
		.map(paragraph =>
			[...paragraph.getElementsByTagNameNS(WORD_NS, 't')]
				.map(text => text.textContent ?? '')
				.join('')
				.replace(/\s+/g, ' ')
				.trim(),
		)
		.filter(text => text.length > 0 && !text.includes('{{'));
}

export function assertPreservedParagraphOrder(
	sourceXml: string,
	acceptedXml: string,
): void {
	const source = stableParagraphs(sourceXml);
	const accepted = stableParagraphs(acceptedXml);
	let next = 0;
	for (const paragraph of source) {
		const position = accepted.indexOf(paragraph, next);
		if (position < 0) {
			throw new Error(
				`Word acceptance changed or reordered document text: ${paragraph.slice(0, 80)}`,
			);
		}
		next = position + 1;
	}
}

export function assertAcceptedDocxIntegrity(
	inputDocx: string,
	acceptedDocx: string,
): void {
	assertPreservedParagraphOrder(
		readDocxEntry(inputDocx, 'word/document.xml'),
		readDocxEntry(acceptedDocx, 'word/document.xml'),
	);
}

export function verifyAcceptedDocxIntegrity(
	inputDocx: string,
	acceptedDocx: string,
	manifestPath: string,
	manifest: Record<string, unknown>,
	onCleanupVerified: () => void,
): void {
	try {
		assertAcceptedDocxIntegrity(inputDocx, acceptedDocx);
	} catch (error) {
		manifest.status = 'failed';
		manifest.failure = {
			stage: 'contentIntegrity',
			message: error instanceof Error ? error.message : String(error),
		};
		fs.writeFileSync(
			manifestPath,
			`${JSON.stringify(manifest, null, 2)}\n`,
			'utf8',
		);
		onCleanupVerified();
		throw error;
	}
}
