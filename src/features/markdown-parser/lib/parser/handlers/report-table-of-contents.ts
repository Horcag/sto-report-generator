import { ImportedXmlComponent, TableOfContents } from 'docx';

/** Identify the generated TOC as a building-block control rather than generic rich text. */
export class ReportTableOfContents extends TableOfContents {
	constructor(options: ConstructorParameters<typeof TableOfContents>[1]) {
		super('', options);
		const gallery = new ImportedXmlComponent('w:docPartObj');
		gallery.push(
			new ImportedXmlComponent('w:docPartGallery', {
				'w:val': 'Table of Contents',
			}),
		);
		gallery.push(new ImportedXmlComponent('w:docPartUnique'));
		const properties = new ImportedXmlComponent('w:sdtPr');
		properties.push(gallery);
		// docx constructs sdtPr first, followed by sdtContent. Keep the field tree intact.
		this.root[0] = properties;
	}
}
