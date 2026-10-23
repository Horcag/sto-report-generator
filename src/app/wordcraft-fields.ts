import AdmZip from 'adm-zip';
import { JSDOM } from 'jsdom';

const WORD = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const DOCUMENT_XML = 'word/document.xml';

/** Let Wordcraft rebuild its TOC wrapper from the complete field in a staged copy. */
export function prepareWordcraftTocForImport(stagedDocx: string): number {
	const archive = new AdmZip(stagedDocx);
	const entry = archive.getEntry(DOCUMENT_XML);
	if (!entry)
		throw new Error(`Wordcraft TOC preparation requires ${DOCUMENT_XML}.`);
	const dom = new JSDOM(entry.getData().toString('utf8'), {
		contentType: 'text/xml',
	});
	const document = dom.window.document;
	let unwrapped = 0;
	for (const sdt of [...document.getElementsByTagNameNS(WORD, 'sdt')]) {
		const properties = [...sdt.children].find(
			child => child.namespaceURI === WORD && child.localName === 'sdtPr',
		);
		const content = [...sdt.children].find(
			child =>
				child.namespaceURI === WORD && child.localName === 'sdtContent',
		);
		const object =
			properties &&
			[...properties.children].find(
				child =>
					child.namespaceURI === WORD &&
					child.localName === 'docPartObj',
			);
		const gallery =
			object &&
			[...object.children].find(
				child =>
					child.namespaceURI === WORD &&
					child.localName === 'docPartGallery',
			);
		if (
			gallery?.getAttributeNS(WORD, 'val') !== 'Table of Contents' ||
			!content ||
			content.getElementsByTagNameNS(WORD, 'sdt').length > 0 ||
			![...content.getElementsByTagNameNS(WORD, 'instrText')].some(node =>
				/^\s*TOC(?:\s|$)/.test(node.textContent ?? ''),
			)
		)
			continue;
		// Keep the field instructions, nested fields, cached entries and paragraph
		// properties intact; only the semantic wrapper blocks Wordcraft's writer.
		sdt.replaceWith(...content.childNodes);
		unwrapped++;
	}
	if (unwrapped) {
		archive.updateFile(
			DOCUMENT_XML,
			Buffer.from(
				new dom.window.XMLSerializer().serializeToString(document),
				'utf8',
			),
		);
		archive.writeZip(stagedDocx);
	}
	dom.window.close();
	return unwrapped;
}
