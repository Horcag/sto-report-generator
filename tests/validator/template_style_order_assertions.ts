import assert from 'node:assert/strict';

/** Independent checks of the OOXML sequence types affected by style merging. */
export function assertTemplateStyleOrder(
	styles: Element[],
	namespace: string,
): void {
	const sequences: Record<string, string[]> = {
		style: 'name aliases basedOn next link autoRedefine hidden uiPriority semiHidden unhideWhenUsed qFormat locked personal personalCompose personalReply rsid pPr rPr tblPr trPr tcPr tblStylePr'.split(
			' ',
		),
		pPr: 'pStyle keepNext keepLines pageBreakBefore framePr widowControl numPr suppressLineNumbers pBdr shd tabs suppressAutoHyphens kinsoku wordWrap overflowPunct topLinePunct autoSpaceDE autoSpaceDN bidi adjustRightInd snapToGrid spacing ind contextualSpacing mirrorIndents suppressOverlap jc textDirection textAlignment textboxTightWrap outlineLvl divId cnfStyle rPr sectPr pPrChange'.split(
			' ',
		),
		rPr: 'rStyle rFonts b bCs i iCs caps smallCaps strike dstrike outline shadow emboss imprint noProof snapToGrid vanish webHidden color spacing w kern position sz szCs highlight u effect bdr shd fitText vertAlign rtl cs em lang eastAsianLayout specVanish oMath rPrChange'.split(
			' ',
		),
	};
	for (const style of styles) {
		for (const [name, sequence] of Object.entries(sequences)) {
			const elements =
				name === 'style'
					? [style]
					: Array.from(style.getElementsByTagNameNS(namespace, name));
			for (const element of elements) {
				const ranks = Array.from(element.children)
					.filter(child => child.namespaceURI === namespace)
					.map(child => {
						const index = sequence.indexOf(child.localName);
						assert.notEqual(
							index,
							-1,
							`${style.getAttributeNS(namespace, 'styleId')} unknown ${name} child ${child.localName}`,
						);
						return index;
					});
				assert.deepEqual(
					ranks,
					[...ranks].sort((a, b) => a - b),
					`${style.getAttributeNS(namespace, 'styleId')} ${name} follows OOXML schema sequence`,
				);
			}
		}
	}
}

export function assertPortableHeadingRuns(
	styles: Element[],
	namespace: string,
): void {
	for (const id of ['StoHeading5', 'StoHeading6']) {
		const style = styles.find(
			element => element.getAttributeNS(namespace, 'styleId') === id,
		)!;
		const color = style.getElementsByTagNameNS(namespace, 'color')[0];
		assert.equal(
			color.getAttributeNS(namespace, 'val'),
			'000000',
			`${id} is explicitly black`,
		);
		for (const attribute of ['themeColor', 'themeTint', 'themeShade'])
			assert.equal(color.hasAttributeNS(namespace, attribute), false);
		const fonts = style.getElementsByTagNameNS(namespace, 'rFonts')[0];
		for (const script of ['ascii', 'hAnsi', 'eastAsia', 'cs'])
			assert.equal(
				fonts.getAttributeNS(namespace, script),
				'Times New Roman',
			);
		assert.equal(
			Array.from(fonts.attributes).some(attribute =>
				/theme/i.test(attribute.localName),
			),
			false,
			`${id} has no overriding theme font`,
		);
		for (const tag of ['i', 'iCs'])
			assert.equal(
				style
					.getElementsByTagNameNS(namespace, tag)[0]
					.getAttributeNS(namespace, 'val'),
				'false',
				`${id} ${tag} is disabled`,
			);
	}
}

/** Evaluate style toggles independently from generator options or import helpers. */
export function assertEffectiveHeadingBold(
	styles: Element[],
	namespace: string,
): void {
	const byId = new Map(
		styles.map(style => [
			style.getAttributeNS(namespace, 'styleId'),
			style,
		]),
	);
	function effective(
		id: string,
		tag: string,
		seen = new Set<string>(),
	): boolean {
		assert.ok(!seen.has(id), `Cyclic style chain at ${id}`);
		seen.add(id);
		const style = byId.get(id);
		assert.ok(style, `Missing style ${id}`);
		const parent = Array.from(style.children)
			.find(child => child.localName === 'basedOn')
			?.getAttributeNS(namespace, 'val');
		const inherited = parent ? effective(parent, tag, seen) : false;
		const run = Array.from(style.children).find(
			child => child.localName === 'rPr',
		);
		const toggle =
			run &&
			Array.from(run.children).find(child => child.localName === tag);
		const enabled =
			Boolean(toggle) &&
			!['0', 'false', 'off'].includes(
				toggle?.getAttributeNS(namespace, 'val') ?? 'true',
			);
		return toggle && !enabled ? false : inherited !== enabled;
	}
	for (const id of [
		'StoHeading1',
		'StoHeading2',
		'StoHeading3',
		'StoHeading4',
		'StoHeading5',
		'StoHeading6',
		'AppendixHeading',
		'TOCHeading',
	]) {
		for (const tag of ['b', 'bCs'])
			assert.equal(
				effective(id, tag),
				true,
				`${id} remains effectively bold (${tag}) through its native parent chain`,
			);
	}
	for (const id of [
		'StoHeading2',
		'StoHeading3',
		'StoHeading4',
		'AppendixHeading',
		'TOCHeading',
	]) {
		const style = byId.get(id)!;
		const run = Array.from(style.children).find(
			child => child.localName === 'rPr',
		);
		for (const tag of ['b', 'bCs'])
			assert.equal(
				run &&
					Array.from(run.children).some(
						child => child.localName === tag,
					),
				false,
				`${id} inherits ${tag} by omission, not an explicit false property`,
			);
	}
	for (const id of ['Normal', 'TableText'])
		for (const tag of ['b', 'bCs'])
			assert.equal(
				effective(id, tag),
				false,
				`${id} stays regular (${tag})`,
			);
}
