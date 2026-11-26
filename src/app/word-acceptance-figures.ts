import { createHash } from 'node:crypto';
import path from 'node:path';
import AdmZip from 'adm-zip';
import imageSize from 'image-size';
import { JSDOM } from 'jsdom';

import {
	directXmlChildren,
	hasXmlAncestor,
	MARKUP_COMPATIBILITY_NS,
} from '@/shared/lib/docx';

import {
	compareFigurePayloads,
	FigurePayloadChecks,
	inspectRasterValidity,
	PayloadEvidence,
} from './word-acceptance-figure-payloads';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const WP =
	'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const A14 = 'http://schemas.microsoft.com/office/drawing/2010/main';
const SVG = 'http://schemas.microsoft.com/office/drawing/2016/SVG/main';
const WPG = 'http://schemas.microsoft.com/office/word/2010/wordprocessingGroup';
const WPS = 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape';
const WPC =
	'http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas';
const EMU_PER_INCH = 914400;

interface FigureEvidence {
	identity: string;
	managed: boolean;
	kind: 'image' | 'shapes';
	placement: 'inline' | 'anchor';
	extent: { cx: string | null; cy: string | null };
	geometry: Record<string, string | null>[];
	crop: Record<string, string | null>[];
	localDpi: (string | null)[];
	paragraphClipsImage: boolean;
	shapeCount?: number;
	shapeTexts?: string[];
	payloads: PayloadEvidence[];
	payloadIssues: string[];
}
interface DocumentFigures {
	compressionDisabled: boolean;
	occurrences: FigureEvidence[];
}
export interface FigureChecks {
	status: 'preserved' | 'unknown' | 'failed';
	compression: { source: boolean; accepted: boolean };
	occurrences: {
		identity: string;
		managed: boolean;
		source: FigureEvidence;
		accepted: FigureEvidence | null;
		preserved: boolean | null;
		issues: string[];
		payloadChecks: FigurePayloadChecks;
	}[];
	issues: string[];
}

function xml(archive: AdmZip, name: string): Document | null {
	const entry = archive.getEntry(name);
	return entry
		? new JSDOM(entry.getData().toString('utf8'), {
				contentType: 'text/xml',
			}).window.document
		: null;
}
function numeric(
	value: string | null,
	fallback: string | null = null,
): string | null {
	if (value === null) return fallback;
	const number = value.endsWith('%')
		? Number(value.slice(0, -1)) * 1000
		: Number(value);
	return Number.isFinite(number) ? String(number) : value;
}
function cropAttributes(element?: Element) {
	return Object.fromEntries(
		['l', 't', 'r', 'b'].map(name => [
			name,
			numeric(element?.getAttribute(name) ?? null, '0'),
		]),
	);
}
function transformAttributes(
	element: Element | undefined,
	extent: FigureEvidence['extent'],
) {
	const size = element?.getElementsByTagNameNS(A, 'ext')[0];
	const offset = element?.getElementsByTagNameNS(A, 'off')[0];
	const flip = (name: string) =>
		['1', 'true', 'on'].includes(element?.getAttribute(name) ?? '0')
			? '1'
			: '0';
	return {
		rot: numeric(element?.getAttribute('rot') ?? null, '0'),
		flipH: flip('flipH'),
		flipV: flip('flipV'),
		cx: numeric(size?.getAttribute('cx') ?? null, extent.cx),
		cy: numeric(size?.getAttribute('cy') ?? null, extent.cy),
		x: numeric(offset?.getAttribute('x') ?? null, '0'),
		y: numeric(offset?.getAttribute('y') ?? null, '0'),
	};
}
function payloadEvidence(
	data: Buffer,
	extent: FigureEvidence['extent'],
	crop: FigureEvidence['crop'],
): PayloadEvidence {
	let dimensions: ReturnType<typeof imageSize> | null = null;
	try {
		dimensions = imageSize(data);
	} catch {
		// Unknown payloads remain hash checked; no invented raster resolution.
	}
	const vector =
		dimensions?.type === 'svg' ||
		/^\s*(?:<\?xml[^>]*>\s*)?<svg\b/.test(data.toString('utf8', 0, 256));
	const rasterDimensions = dimensions !== null && !vector ? dimensions : null;
	const cx = Number(extent.cx);
	const cy = Number(extent.cy);
	const visibleX = 1 - (Number(crop[0].l) + Number(crop[0].r)) / 100000;
	const visibleY = 1 - (Number(crop[0].t) + Number(crop[0].b)) / 100000;
	return {
		sha256: createHash('sha256').update(data).digest('hex'),
		bytes: data.length,
		...inspectRasterValidity(data, dimensions?.type),
		kind: vector ? 'vector' : rasterDimensions ? 'raster' : 'unknown',
		pixelWidth: rasterDimensions ? rasterDimensions.width : null,
		pixelHeight: rasterDimensions ? rasterDimensions.height : null,
		effectiveDpi:
			rasterDimensions && cx > 0 && cy > 0
				? {
						x:
							(rasterDimensions.width * visibleX * EMU_PER_INCH) /
							cx,
						y:
							(rasterDimensions.height *
								visibleY *
								EMU_PER_INCH) /
							cy,
					}
				: null,
	};
}

export function readFigureEvidence(docxPath: string): DocumentFigures {
	const archive = new AdmZip(docxPath);
	const document = xml(archive, 'word/document.xml');
	if (!document)
		throw new Error('Word document is missing word/document.xml.');
	const settings = xml(archive, 'word/settings.xml');
	const policy = settings?.getElementsByTagNameNS(
		W,
		'doNotAutoCompressPictures',
	)[0];
	const compressionDisabled =
		!!policy &&
		['1', 'true', 'on'].includes(policy.getAttributeNS(W, 'val') ?? '1');
	const relationships = xml(archive, 'word/_rels/document.xml.rels');
	const targets = new Map(
		[...(relationships?.getElementsByTagNameNS(REL, 'Relationship') ?? [])]
			.filter(item => item.getAttribute('TargetMode') !== 'External')
			.map(item => [
				item.getAttribute('Id'),
				item.getAttribute('Target'),
			]),
	);
	const counts = new Map<string, number>();
	const occurrences: FigureEvidence[] = [];
	for (const drawing of document.getElementsByTagNameNS(W, 'drawing')) {
		if (hasXmlAncestor(drawing, [[MARKUP_COMPATIBILITY_NS, 'Fallback']]))
			continue;
		const blips = [
			...drawing.getElementsByTagNameNS(A, 'blip'),
			...drawing.getElementsByTagNameNS(SVG, 'svgBlip'),
		];
		const isShapeDrawing =
			drawing.getElementsByTagNameNS(WPG, 'wgp').length > 0 ||
			drawing.getElementsByTagNameNS(WPC, 'wpc').length > 0 ||
			drawing.getElementsByTagNameNS(WPS, 'wsp').length > 0;
		if (!blips.length && !isShapeDrawing) continue;
		const name =
			drawing
				.getElementsByTagNameNS(WP, 'docPr')[0]
				?.getAttribute('name') ?? '';
		const managed = name.startsWith('sto-figure:');
		const baseIdentity = managed
			? name
			: `unmanaged:${occurrences.length + 1}`;
		const occurrence = (counts.get(baseIdentity) ?? 0) + 1;
		counts.set(baseIdentity, occurrence);
		const extent = drawing.getElementsByTagNameNS(WP, 'extent')[0];
		let paragraph: Element | null = drawing.parentElement;
		while (
			paragraph &&
			!(paragraph.namespaceURI === W && paragraph.localName === 'p')
		)
			paragraph = paragraph.parentElement;
		const spacing = directXmlChildren(
			directXmlChildren(paragraph, W, 'pPr')[0],
			W,
			'spacing',
		)[0];
		const exactLine = spacing?.getAttributeNS(W, 'lineRule') === 'exact';
		const lineHeightEmu = Number(spacing?.getAttributeNS(W, 'line')) * 635;
		const kind: FigureEvidence['kind'] = isShapeDrawing
			? 'shapes'
			: 'image';
		const evidence: FigureEvidence = {
			identity: `${baseIdentity}#${occurrence}`,
			managed,
			kind,
			placement: drawing.getElementsByTagNameNS(WP, 'inline').length
				? 'inline'
				: 'anchor',
			extent: {
				cx: numeric(extent?.getAttribute('cx') ?? null),
				cy: numeric(extent?.getAttribute('cy') ?? null),
			},
			geometry: [],
			crop: [...drawing.getElementsByTagNameNS(A, 'srcRect')].map(item =>
				cropAttributes(item),
			),
			localDpi: [
				...drawing.getElementsByTagNameNS(A14, 'useLocalDpi'),
			].map(item => item.getAttribute('val')),
			paragraphClipsImage:
				drawing.getElementsByTagNameNS(WP, 'inline').length > 0 &&
				exactLine &&
				lineHeightEmu < Number(extent?.getAttribute('cy')),
			...(kind === 'shapes'
				? {
						shapeCount: drawing.getElementsByTagNameNS(WPS, 'wsp')
							.length,
						shapeTexts: [
							...drawing.getElementsByTagNameNS(W, 'txbxContent'),
						].map(box =>
							[...box.getElementsByTagNameNS(W, 't')]
								.map(t => t.textContent ?? '')
								.join('')
								.replace(/\s+/g, ' ')
								.trim(),
						),
					}
				: {}),
			payloads: [],
			payloadIssues: [],
		};
		if (!evidence.crop.length) evidence.crop.push(cropAttributes());
		if (kind === 'shapes') {
			if (blips.length > 0) {
				evidence.payloadIssues.push(
					'Vector shape group unexpectedly contains embedded image blips.',
				);
			}
			const topXfrm = drawing.getElementsByTagNameNS(A, 'xfrm')[0];
			evidence.geometry = [transformAttributes(topXfrm, evidence.extent)];
			occurrences.push(evidence);
			continue;
		}
		const transforms = [...drawing.getElementsByTagNameNS(A, 'xfrm')];
		evidence.geometry = (transforms.length ? transforms : [undefined]).map(
			item => transformAttributes(item, evidence.extent),
		);
		for (const blip of blips) {
			const target = targets.get(blip.getAttributeNS(R, 'embed'));
			if (!target) {
				evidence.payloadIssues.push(
					'Image has no embedded relationship (missing or external).',
				);
				continue;
			}
			const entryName = target.startsWith('/')
				? target.slice(1)
				: path.posix.normalize(path.posix.join('word', target));
			const entry = archive.getEntry(entryName);
			if (!entry) {
				evidence.payloadIssues.push('Embedded image is missing.');
				continue;
			}
			evidence.payloads.push(
				payloadEvidence(
					entry.getData(),
					evidence.extent,
					evidence.crop,
				),
			);
		}
		occurrences.push(evidence);
	}
	return { compressionDisabled, occurrences };
}

export function compareFigureEvidence(
	inputDocx: string,
	acceptedDocx: string,
): FigureChecks {
	const source = readFigureEvidence(inputDocx);
	const accepted = readFigureEvidence(acceptedDocx);
	const issues: string[] = [];
	const managed = source.occurrences.filter(item => item.managed);
	if (
		managed.length &&
		(!source.compressionDisabled || !accepted.compressionDisabled)
	)
		issues.push('Document picture compression protection is missing.');
	const occurrences = source.occurrences.map(before => {
		const after =
			accepted.occurrences.find(
				item => item.identity === before.identity,
			) ?? null;
		const changes: string[] = [];
		const payloadChecks = compareFigurePayloads(
			before.payloads,
			after?.payloads ?? null,
		);
		if (before.managed) {
			changes.push(
				...before.payloadIssues.map(issue => `Source: ${issue}`),
				...(after?.payloadIssues ?? []),
			);
			if (!after)
				changes.push('Managed figure identity or occurrence was lost.');
			else {
				for (const key of [
					'kind',
					'placement',
					'extent',
					'geometry',
					'crop',
					'shapeCount',
					'shapeTexts',
				] as const) {
					if (
						JSON.stringify(before[key]) !==
						JSON.stringify(after[key])
					)
						changes.push(`Figure ${key} changed.`);
				}
				if (before.kind === 'image' && !payloadChecks.preserved)
					changes.push('Figure payloads changed.');
				if (after.paragraphClipsImage)
					changes.push(
						'Accepted paragraph line height clips the image.',
					);
			}
			if (!(Number(before.extent.cx) > 0 && Number(before.extent.cy) > 0))
				changes.push('Source figure extent is invalid.');
			issues.push(
				...changes.map(message => `${before.identity}: ${message}`),
			);
		}
		return {
			identity: before.identity,
			managed: before.managed,
			source: before,
			accepted: after,
			preserved: before.managed ? changes.length === 0 : null,
			issues: changes,
			payloadChecks,
		};
	});
	if (
		managed.length &&
		accepted.occurrences.filter(item => item.managed).length !==
			managed.length
	)
		issues.push('Managed figure occurrence count changed.');
	return {
		status: issues.length
			? 'failed'
			: source.occurrences.some(item => !item.managed)
				? 'unknown'
				: 'preserved',
		compression: {
			source: source.compressionDisabled,
			accepted: accepted.compressionDisabled,
		},
		occurrences,
		issues,
	};
}
