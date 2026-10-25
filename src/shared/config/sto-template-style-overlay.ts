import {
	IContext,
	IXmlableObject,
	StyleForParagraph,
	XmlComponent,
} from 'docx';

type XmlNode = Record<string, unknown>;

// ECMA-376 CT_Style, CT_PPr and CT_RPr sequence order. Merging properties
// must not append an earlier schema element after an existing later one.
const PROPERTY_ORDER: Readonly<Record<string, readonly string[]>> = {
	'w:style':
		'name aliases basedOn next link autoRedefine hidden uiPriority semiHidden unhideWhenUsed qFormat locked personal personalCompose personalReply rsid pPr rPr tblPr trPr tcPr tblStylePr'.split(
			' ',
		),
	'w:pPr':
		'pStyle keepNext keepLines pageBreakBefore framePr widowControl numPr suppressLineNumbers pBdr shd tabs suppressAutoHyphens kinsoku wordWrap overflowPunct topLinePunct autoSpaceDE autoSpaceDN bidi adjustRightInd snapToGrid spacing ind contextualSpacing mirrorIndents suppressOverlap jc textDirection textAlignment textboxTightWrap outlineLvl divId cnfStyle rPr sectPr pPrChange'.split(
			' ',
		),
	'w:rPr':
		'rStyle rFonts b bCs i iCs caps smallCaps strike dstrike outline shadow emboss imprint noProof snapToGrid vanish webHidden color spacing w kern position sz szCs highlight u effect bdr shd fitText vertAlign rtl cs em lang eastAsianLayout specVanish oMath rPrChange'.split(
			' ',
		),
};

function schemaOrder(nodes: XmlNode[], parent: string): XmlNode[] {
	const sequence = PROPERTY_ORDER[parent];
	if (!sequence) return nodes;
	const rank = (node: XmlNode): number => {
		const key = Object.keys(node)[0];
		if (key === '_attr') return -1;
		const index = sequence.indexOf(key.replace(/^w:/, ''));
		return index < 0 ? sequence.length : index;
	};
	return nodes.sort((left, right) => rank(left) - rank(right));
}

function children(value: unknown): XmlNode[] {
	return (Array.isArray(value) ? value : [value]).filter(
		(item): item is XmlNode => typeof item === 'object' && item !== null,
	);
}

/** Overlay only explicitly supplied properties; retain the source's other attributes. */
function mergeProperties(
	source: unknown,
	overlay: unknown,
	parent: string,
): XmlNode[] {
	// An empty OOXML toggle means true. It must replace a source w:val="0",
	// rather than accidentally preserving that explicit false attribute.
	if (
		overlay !== null &&
		typeof overlay === 'object' &&
		!Array.isArray(overlay) &&
		Object.keys(overlay).length === 0
	)
		return [];
	const result = children(source).map(node => ({ ...node }));
	for (const replacement of children(overlay)) {
		const key = Object.keys(replacement)[0];
		const index = result.findIndex(node => key in node);
		if (index < 0) result.push(replacement);
		else if (key === '_attr') {
			const attributes = {
				...(result[index][key] as XmlNode),
				...(replacement[key] as XmlNode),
			};
			const incoming = replacement[key] as XmlNode;
			// OOXML's mutually exclusive indentation and font-theme attributes
			// must not defeat an explicitly supplied portable setting.
			if ('w:firstLine' in incoming) delete attributes['w:hanging'];
			if ('w:hanging' in incoming) delete attributes['w:firstLine'];
			if ('w:val' in incoming) {
				delete attributes['w:themeColor'];
				delete attributes['w:themeShade'];
				delete attributes['w:themeTint'];
			}
			for (const font of ['ascii', 'hAnsi', 'eastAsia', 'cs']) {
				if (`w:${font}` in incoming) {
					delete attributes[`w:${font}Theme`];
					delete attributes[`w:${font}theme`];
				}
			}
			result[index] = { _attr: attributes };
		} else {
			result[index] = {
				[key]: mergeProperties(
					result[index][key],
					replacement[key],
					key,
				),
			};
		}
	}
	return schemaOrder(result, parent);
}

/** The canonical style owns its metadata and graph; the generator owns portable formatting. */
export class TemplateStyleOverlay extends XmlComponent {
	constructor(
		private readonly source: XmlComponent,
		private readonly portable: StyleForParagraph,
		private readonly inheritedBold: readonly string[] = [],
	) {
		super('w:style');
	}

	public override prepForXml(context: IContext): IXmlableObject {
		const source = this.source.prepForXml(context)!;
		const portable = this.portable.prepForXml(context)!;
		// Word's native style reader treats an explicit false bold property as
		// off. Inheritance therefore requires absence in BOTH the source and the
		// overlay; retaining a native bCs=0 would also suppress the parent.
		const removeInheritedBold = (nodes: XmlNode[]) =>
			nodes.map(node =>
				'w:rPr' in node
					? {
							'w:rPr': children(node['w:rPr']).filter(
								property =>
									!this.inheritedBold.some(
										tag => `w:${tag}` in property,
									),
							),
						}
					: node,
			);
		const sourceChildren = removeInheritedBold(children(source['w:style']));
		const properties = removeInheritedBold(
			children(portable['w:style']),
		).filter(node => 'w:pPr' in node || 'w:rPr' in node);
		return {
			'w:style': mergeProperties(sourceChildren, properties, 'w:style'),
		};
	}
}
