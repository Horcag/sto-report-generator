import {
	insideMath,
	paragraphElements,
	paragraphSpacingKind,
	withXml,
	WORD_NS,
	wordChild,
	wordElements,
	wordValue,
} from './xml';

export interface StrictStoInspection {
	bold: boolean;
	font: boolean;
	color: boolean;
	size: boolean;
	spacing: boolean;
	numberingFont: boolean;
}

function ancestor(element: Element, name: string): Element | null {
	for (
		let current = element.parentElement;
		current;
		current = current.parentElement
	) {
		if (current.namespaceURI === WORD_NS && current.localName === name)
			return current;
	}
	return null;
}

function attribute(
	chain: Array<Element | undefined>,
	tag: string,
	name = 'val',
): string | null {
	for (const properties of chain) {
		const element = properties && wordChild(properties, tag);
		if (element?.hasAttributeNS(WORD_NS, name))
			return element.getAttributeNS(WORD_NS, name);
		if (element && (tag === 'b' || tag === 'bCs')) return '1';
	}
	return null;
}

function enabled(value: string | null): boolean {
	return (
		value !== null && !['0', 'false', 'off'].includes(value.toLowerCase())
	);
}

function validFont(chain: Array<Element | undefined>): boolean {
	return ['ascii', 'hAnsi', 'eastAsia', 'cs'].every(name => {
		for (const properties of chain) {
			const fonts = properties && wordChild(properties, 'rFonts');
			if (!fonts) continue;
			if (
				Array.from(fonts.attributes).some(
					item =>
						item.localName.toLowerCase() ===
						`${name}Theme`.toLowerCase(),
				)
			)
				return false;
			if (fonts.hasAttributeNS(WORD_NS, name))
				return (
					fonts.getAttributeNS(WORD_NS, name) === 'Times New Roman'
				);
		}
		return false;
	});
}

function validSize(chain: Array<Element | undefined>): boolean {
	return ['sz', 'szCs'].every(name => {
		const value = Number(attribute(chain, name));
		return value >= 24 && value <= 28;
	});
}

function validColor(chain: Array<Element | undefined>): boolean {
	if (attribute(chain, 'color') !== '000000') return false;
	for (const properties of chain) {
		const color = properties && wordChild(properties, 'color');
		if (!color) continue;
		return !Array.from(color.attributes).some(item =>
			/^theme/.test(item.localName),
		);
	}
	return false;
}

/** Проверяет эффективное оформление текста, включая заголовки и колонтитулы. */
export function inspectStrictStoXml(
	parts: ReadonlyMap<string, string>,
): StrictStoInspection {
	const result: StrictStoInspection = {
		bold: true,
		font: true,
		color: true,
		size: true,
		spacing: true,
		numberingFont: true,
	};
	return withXml(parts.get('word/styles.xml') ?? '<styles/>', styles => {
		const byId = new Map(
			wordElements(styles, 'style').map(style => [
				style.getAttributeNS(WORD_NS, 'styleId'),
				style,
			]),
		);
		const defaults = wordElements(styles, 'docDefaults')[0];
		const defaultRun =
			defaults &&
			wordChild(wordChild(defaults, 'rPrDefault') ?? defaults, 'rPr');
		const defaultParagraph =
			defaults &&
			wordChild(wordChild(defaults, 'pPrDefault') ?? defaults, 'pPr');
		const styleChain = (
			id: string | null,
			property: string,
		): Array<Element | undefined> => {
			const chain: Array<Element | undefined> = [];
			const visited = new Set<string>();
			while (id && !visited.has(id)) {
				visited.add(id);
				const style = byId.get(id);
				if (!style) break;
				chain.push(wordChild(style, property));
				id = wordValue(wordChild(style, 'basedOn'));
			}
			return chain;
		};
		for (const [name, xml] of parts) {
			if (name === 'word/styles.xml') continue;
			withXml(xml, document => {
				for (const run of wordElements(document, 'r')) {
					if (
						insideMath(run) ||
						(!wordElements(run, 't').some(text =>
							text.textContent?.trim(),
						) &&
							!wordElements(run, 'fldChar').length)
					)
						continue;
					const paragraph = ancestor(run, 'p');
					const runProperties = wordChild(run, 'rPr');
					const paragraphProperties =
						paragraph && wordChild(paragraph, 'pPr');
					const paragraphStyle =
						wordValue(
							(paragraphProperties &&
								wordChild(paragraphProperties, 'pStyle')) ||
								undefined,
						) ?? 'Normal';
					const chain = [
						runProperties,
						...styleChain(
							wordValue(
								runProperties &&
									wordChild(runProperties, 'rStyle'),
							),
							'rPr',
						),
						...styleChain(paragraphStyle, 'rPr'),
						defaultRun,
					];
					result.bold &&=
						!enabled(attribute(chain, 'b')) &&
						!enabled(attribute(chain, 'bCs'));
					result.font &&= validFont(chain);
					result.color &&= validColor(chain);
					result.size &&= validSize(chain);
				}
				for (const paragraph of wordElements(document, 'p')) {
					if (
						insideMath(paragraph) ||
						!paragraphElements(paragraph, 't').some(
							text =>
								!insideMath(text) && text.textContent?.length,
						)
					)
						continue;
					const kind = paragraphSpacingKind(
						paragraph,
						parts.get('word/styles.xml') ?? '',
					);
					if (kind === 'math') continue;
					const properties = wordChild(paragraph, 'pPr');
					const id =
						wordValue(
							properties && wordChild(properties, 'pStyle'),
						) ?? 'Normal';
					const chain = [
						properties,
						...styleChain(id, 'pPr'),
						defaultParagraph,
					];
					const line = attribute(chain, 'spacing', 'line');
					result.spacing &&=
						(line === '360' ||
							(kind === 'caption' && line === '240')) &&
						(attribute(chain, 'spacing', 'lineRule') ?? 'auto') ===
							'auto';
				}
				for (const level of wordElements(document, 'lvl')) {
					const chain = [wordChild(level, 'rPr'), defaultRun];
					result.numberingFont &&=
						validFont(chain) &&
						validSize(chain) &&
						validColor(chain) &&
						!enabled(attribute(chain, 'b')) &&
						!enabled(attribute(chain, 'bCs'));
				}
			});
		}
		return result;
	});
}
