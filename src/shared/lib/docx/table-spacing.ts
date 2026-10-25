import AdmZip from 'adm-zip';
import { JSDOM } from 'jsdom';

import { STO_RULES } from '../../config';
import { isMathLayoutTable } from '../sto-validator/math-layout-table';
import { getEffectiveBodyParagraphAttribute } from './styles';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

/** Layout convention illustrated in the teaching guide, not a mandated blank line. */
export function normalizeDataTableSpacing(
	xml: string,
	stylesXml: string,
): string {
	const dom = new JSDOM(xml, { contentType: 'text/xml' });
	try {
		const document = dom.window.document;
		const body = document.getElementsByTagNameNS(W, 'body')[0];
		if (!body) return xml;
		const elements = [...body.children];
		const text = (element: Element) =>
			[...element.getElementsByTagNameNS(W, 't')]
				.map(node => node.textContent ?? '')
				.join('')
				.trim();
		const start = elements.findIndex(
			element => text(element) === 'РЕФЕРАТ',
		);
		let changed = false;
		for (const [index, table] of elements.entries()) {
			if (
				index < start ||
				table.namespaceURI !== W ||
				table.localName !== 'tbl' ||
				isMathLayoutTable(table.outerHTML)
			)
				continue;
			// Labs can omit the referat: avoid touching uncaptioned title/signature tables.
			if (
				start < 0 &&
				!/^Таблица\s|^Продолжение таблицы\s/u.test(
					elements[index - 1] ? text(elements[index - 1]) : '',
				)
			)
				continue;
			const next = elements[index + 1];
			if (
				!next ||
				next.namespaceURI !== W ||
				next.localName !== 'p' ||
				/^Продолжение таблицы\s/u.test(text(next)) ||
				(!text(next) &&
					!next.getElementsByTagNameNS(W, 'drawing').length)
			)
				continue;
			const style =
				next
					.getElementsByTagNameNS(W, 'pStyle')[0]
					?.getAttributeNS(W, 'val') ?? 'Normal';
			const effective = (name: string) =>
				getEffectiveBodyParagraphAttribute(
					next.outerHTML,
					stylesXml,
					null,
					style,
					'spacing',
					name,
				);
			// Preserve author-controlled line-based/automatic spacing and larger gaps.
			if (
				Number(effective('before')) >=
					STO_RULES.tables.afterSpacingDxa ||
				Number(effective('beforeLines')) > 0 ||
				['1', 'true', 'on'].includes(
					effective('beforeAutospacing') ?? '',
				)
			)
				continue;
			let properties = [...next.children].find(
				node => node.localName === 'pPr',
			);
			if (!properties) {
				properties = document.createElementNS(W, 'w:pPr');
				next.insertBefore(properties, next.firstChild);
			}
			if (
				style === 'Normal' &&
				/w:styleId="TableFollowingText"/.test(stylesXml)
			) {
				let marker = [...properties.children].find(
					node => node.localName === 'pStyle',
				);
				if (!marker) {
					marker = document.createElementNS(W, 'w:pStyle');
					properties.insertBefore(marker, properties.firstChild);
				}
				marker.setAttributeNS(W, 'w:val', 'TableFollowingText');
			}
			let spacing = [...properties.children].find(
				node => node.localName === 'spacing',
			);
			if (!spacing) {
				spacing = document.createElementNS(W, 'w:spacing');
				// CT_PPr puts spacing before ind, jc and the later paragraph properties.
				const later = [
					'ind',
					'contextualSpacing',
					'mirrorIndents',
					'suppressOverlap',
					'jc',
					'textDirection',
					'textAlignment',
					'textboxTightWrap',
					'outlineLvl',
					'divId',
					'cnfStyle',
					'rPr',
					'sectPr',
					'pPrChange',
				];
				properties.insertBefore(
					spacing,
					[...properties.children].find(node =>
						later.includes(node.localName),
					) ?? null,
				);
			}
			spacing.setAttributeNS(
				W,
				'w:before',
				String(STO_RULES.tables.afterSpacingDxa),
			);
			changed = true;
		}
		return changed ? dom.serialize() : xml;
	} finally {
		dom.window.close();
	}
}

export function applyDataTableSpacing(buffer: Buffer): Buffer {
	const archive = new AdmZip(buffer);
	const entry = archive.getEntry('word/document.xml');
	if (!entry) throw new Error('Table spacing requires word/document.xml.');
	const xml = entry.getData().toString('utf8');
	const normalized = normalizeDataTableSpacing(
		xml,
		archive.getEntry('word/styles.xml')?.getData().toString('utf8') ?? '',
	);
	if (normalized === xml) return buffer;
	archive.updateFile('word/document.xml', Buffer.from(normalized));
	return archive.toBuffer();
}
