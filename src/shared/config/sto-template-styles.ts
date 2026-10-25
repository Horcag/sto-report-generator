import {
	ImportedXmlComponent,
	IStylesOptions,
	StyleForParagraph,
	XmlComponent,
} from 'docx';

import templateStyles from './samara-template-2022-styles.json';
import { normalizeTemplateBold } from './sto-template-bold';
import { TemplateStyleOverlay } from './sto-template-style-overlay';

/** Source IDs are remapped once so Word sees one definition per native name. */
export const SAMARA_TEMPLATE_STYLE_IDS: Readonly<Record<string, string>> = {
	'1-': 'Normal',
	ac: 'TitlePageText',
	ab: 'TitlePageTopic',
	afc: 'StructuralHeading',
	aff0: 'StructuralHeadingNoTOC',
	aff2: 'AppendixHeading',
	'24': 'AppendixSectionHeading',
	'-': 'FigureCaption',
	'-1': 'TableCaption',
	aff1: 'TableText',
	aff4: 'ReferatKeywords',
	a0: 'Bibliography',
	af2: 'ListParagraph',
	'100': 'CenteredParagraph',
	MTDisplayEquation: 'Formula',
	'1': 'StoHeading1',
	'2': 'StoHeading2',
	'3': 'StoHeading3',
	'4': 'StoHeading4',
	'5': 'StoHeading5',
	'6': 'StoHeading6',
	'10': 'Heading1',
	'20': 'Heading2',
	'30': 'Heading3',
	'40': 'Heading4',
	'7': 'Heading7',
	'8': 'Heading8',
	'9': 'Heading9',
	'13': 'TOC1',
	'23': 'TOC2',
	'33': 'TOC3',
	'43': 'TOC4',
	'12': 'WordTOC1',
	'22': 'WordTOC2',
	'32': 'WordTOC3',
	'42': 'WordTOC4',
	af6: 'TOCHeading',
	a2: 'DefaultParagraphFont',
	af: 'Hyperlink',
};

export function templateGeneratorStyleId(sourceId: string): string {
	return SAMARA_TEMPLATE_STYLE_IDS[sourceId] ?? sourceId;
}

export function getTemplateStyleNames(): Record<string, string> {
	return Object.fromEntries(
		templateStyles.map(xml => [
			templateGeneratorStyleId(/w:styleId="([^"]+)"/.exec(xml)![1]),
			/<w:name w:val="([^"]+)"/.exec(xml)![1],
		]),
	);
}

export function importSamaraTemplateStyles(
	overrides: NonNullable<IStylesOptions['paragraphStyles']> = [],
): XmlComponent[] {
	const remapped = templateStyles.map(source =>
		source
			.replace(
				/w:styleId="([^"]+)"/,
				(_match, id: string) =>
					`w:styleId="${templateGeneratorStyleId(id)}"`,
			)
			.replace(
				/(<w:(?:basedOn|next|link)\b[^>]*w:val=")([^"]+)(")/g,
				(_match, prefix: string, id: string, suffix: string) =>
					`${prefix}${templateGeneratorStyleId(id)}${suffix}`,
			)
			// Source numbering IDs belong to the DOTM package. Supported headings
			// and bibliography receive portable numbering below; unused legacy
			// levels 7–9 and the old numbering style remain available without it.
			.replace(/<w:numPr\b[\s\S]*?<\/w:numPr>/g, ''),
	);
	const normalized = normalizeTemplateBold(
		new Map(
			remapped.map(xml => [/w:styleId="([^"]+)"/.exec(xml)![1], xml]),
		),
		overrides,
	);
	return remapped.map(xml => {
		// fromXmlString returns the document container, not its w:style child.
		const document = ImportedXmlComponent.fromXmlString(xml) as unknown as {
			root: ImportedXmlComponent[];
		};
		const id = /w:styleId="([^"]+)"/.exec(xml)![1];
		const override = normalized.get(id);
		return override
			? new TemplateStyleOverlay(
					document.root[0],
					new StyleForParagraph(override.style),
					override.inheritedBold,
				)
			: document.root[0];
	});
}
