import AdmZip from 'adm-zip';
import { JSDOM } from 'jsdom';

import { FigurePlan } from '../figures';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const WP =
	'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';

/** Preserve original media; cropping changes only the DrawingML visible rectangle. */
export function applyFigureDocumentPolicy(
	buffer: Buffer,
	plans: readonly FigurePlan[],
): Buffer {
	const archive = new AdmZip(buffer);
	const settingsEntry = archive.getEntry('word/settings.xml');
	const documentEntry = archive.getEntry('word/document.xml');
	if (!settingsEntry || !documentEntry)
		throw new Error(
			'Figure policy requires DOCX settings and document parts.',
		);
	const settingsXml = settingsEntry.getData().toString('utf8');
	const documentXml = documentEntry.getData().toString('utf8');
	const settingsDom = new JSDOM(settingsXml, {
		contentType: 'text/xml',
	});
	const documentDom = new JSDOM(documentXml, {
		contentType: 'text/xml',
	});
	try {
		const settings = settingsDom.window.document;
		let compression = settings.getElementsByTagNameNS(
			W,
			'doNotAutoCompressPictures',
		)[0];
		if (!compression) {
			compression = settings.createElementNS(
				W,
				'w:doNotAutoCompressPictures',
			);
			// Settings children have a schema order; this belongs before forceUpgrade.
			const following = [...settings.documentElement.children].find(
				child =>
					[
						'forceUpgrade',
						'captions',
						'readModeInkLockDown',
						'smartTagType',
						'schemaLibrary',
						'shapeDefaults',
						'doNotEmbedSmartTags',
						'decimalSymbol',
						'listSeparator',
					].includes(child.localName),
			);
			settings.documentElement.insertBefore(
				compression,
				following ?? null,
			);
		}
		compression.setAttributeNS(W, 'w:val', 'true');
		const document = documentDom.window.document;
		const used = new Set<string>();
		for (const drawing of document.getElementsByTagNameNS(W, 'drawing')) {
			const identity = drawing
				.getElementsByTagNameNS(WP, 'docPr')[0]
				?.getAttribute('name');
			if (!identity?.startsWith('sto-figure:')) continue;
			const id = identity.slice('sto-figure:'.length);
			const plan = plans.find(item => item.id === id);
			if (!plan || used.has(id))
				throw new Error(`Missing or duplicate figure plan: ${id}`);
			used.add(id);
			const fill = drawing.getElementsByTagNameNS(PIC, 'blipFill')[0];
			if (!fill) throw new Error(`Missing figure image fill: ${id}`);
			let rectangle = fill.getElementsByTagNameNS(A, 'srcRect')[0];
			if (!rectangle) {
				rectangle = document.createElementNS(A, 'a:srcRect');
				fill.insertBefore(
					rectangle,
					fill.getElementsByTagNameNS(A, 'stretch')[0] ?? null,
				);
			}
			for (const [attribute, side] of [
				['l', 'left'],
				['r', 'right'],
				['t', 'top'],
				['b', 'bottom'],
			] as const)
				rectangle.setAttribute(
					attribute,
					String(Math.round(plan.crop[side] * 1000)),
				);
		}
		if (used.size !== plans.length)
			throw new Error('Figure plans do not match embedded occurrences.');
		archive.updateFile(
			'word/settings.xml',
			Buffer.from(
				(settingsXml.match(/^<\?xml[^?]*\?>/u)?.[0] ?? '') +
					new settingsDom.window.XMLSerializer().serializeToString(
						settings,
					),
			),
		);
		if (plans.length)
			archive.updateFile(
				'word/document.xml',
				Buffer.from(
					(documentXml.match(/^<\?xml[^?]*\?>/u)?.[0] ?? '') +
						new documentDom.window.XMLSerializer().serializeToString(
							document,
						),
				),
			);
		return archive.toBuffer();
	} finally {
		settingsDom.window.close();
		documentDom.window.close();
	}
}
