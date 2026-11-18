import AdmZip from 'adm-zip';
import { JSDOM } from 'jsdom';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function directChild(element: Element, localName: string): Element | undefined {
	return [...element.children].find(
		child => child.namespaceURI === W && child.localName === localName,
	);
}

function getWordAttr(element: Element, localName: string): string | null {
	return (
		element.getAttributeNS(W, localName) ??
		element.getAttribute(`w:${localName}`)
	);
}

function setWordAttr(element: Element, localName: string, value: string): void {
	if (
		element.hasAttributeNS(W, localName) ||
		!element.hasAttribute(`w:${localName}`)
	) {
		element.setAttributeNS(W, `w:${localName}`, value);
	} else {
		element.setAttribute(`w:${localName}`, value);
	}
}

function allocateHexId(usedHex: Set<string>, seed: { value: number }): string {
	while (true) {
		const candidate = seed.value
			.toString(16)
			.toUpperCase()
			.padStart(8, '0');
		seed.value += 1;
		if (!usedHex.has(candidate)) {
			usedHex.add(candidate);
			return candidate;
		}
	}
}

function ensureFirstChildNsid(
	document: Document,
	abstractNum: Element,
	hexValue: string,
): void {
	let nsid = directChild(abstractNum, 'nsid');
	if (!nsid) {
		nsid = document.createElementNS(W, 'w:nsid');
	}
	setWordAttr(nsid, 'val', hexValue);
	if (abstractNum.firstElementChild !== nsid) {
		abstractNum.insertBefore(nsid, abstractNum.firstElementChild);
	}
}

function serializeWithXmlDeclaration(originalXml: string, dom: JSDOM): string {
	const declaration = originalXml.match(/^<\?xml[^?]*\?>\r?\n?/u)?.[0] ?? '';
	const serializer = new dom.window.XMLSerializer();
	return (
		declaration +
		serializer.serializeToString(dom.window.document.documentElement)
	);
}

/** Split `<w:abstractNum>` shared across multiple `<w:num>` instances so independent lists reset numbering in non-Word viewers. */
export function splitSharedAbstractNumbering(numberingXml: string): string {
	const dom = new JSDOM(numberingXml, { contentType: 'text/xml' });
	try {
		const document = dom.window.document;
		const numbering = document.getElementsByTagNameNS(W, 'numbering')[0];
		if (!numbering) {
			return numberingXml;
		}

		const abstractNums = new Map<string, Element>();
		const usedHex = new Set<string>();
		let maxAbstractNumId = -1;

		for (const child of [...numbering.children]) {
			if (child.namespaceURI !== W || child.localName !== 'abstractNum') {
				continue;
			}
			const id = getWordAttr(child, 'abstractNumId');
			if (id !== null) {
				abstractNums.set(id, child);
				if (/^\d+$/u.test(id)) {
					maxAbstractNumId = Math.max(
						maxAbstractNumId,
						Number.parseInt(id, 10),
					);
				}
			}
			for (const tagName of ['nsid', 'tmpl'] as const) {
				const hex = directChild(child, tagName);
				const val = hex ? getWordAttr(hex, 'val') : null;
				if (val) {
					usedHex.add(val.toUpperCase());
				}
			}
		}

		const numsByAbstract = new Map<string, Element[]>();
		for (const child of [...numbering.children]) {
			if (child.namespaceURI !== W || child.localName !== 'num') {
				continue;
			}
			const ref = directChild(child, 'abstractNumId');
			const targetId = ref ? getWordAttr(ref, 'val') : null;
			if (!targetId) {
				continue;
			}
			const bucket = numsByAbstract.get(targetId) ?? [];
			bucket.push(child);
			numsByAbstract.set(targetId, bucket);
		}

		const insertAnchor =
			[...numbering.children].find(
				child =>
					child.namespaceURI === W &&
					(child.localName === 'num' ||
						child.localName === 'numIdMacAtCleanup'),
			) ?? null;

		const hexSeed = { value: 0x10000001 };
		let changed = false;

		for (const [abstractId, nums] of numsByAbstract.entries()) {
			if (nums.length <= 1) {
				continue;
			}
			const original = abstractNums.get(abstractId);
			if (
				!original ||
				directChild(original, 'styleLink') ||
				directChild(original, 'numStyleLink')
			) {
				continue;
			}

			const existingNsid = directChild(original, 'nsid');
			const existingNsidVal = existingNsid
				? getWordAttr(existingNsid, 'val')
				: null;
			if (!existingNsid || !existingNsidVal) {
				ensureFirstChildNsid(
					document,
					original,
					allocateHexId(usedHex, hexSeed),
				);
			} else if (original.firstElementChild !== existingNsid) {
				original.insertBefore(existingNsid, original.firstElementChild);
			}

			for (const extraNum of nums.slice(1)) {
				const clone = original.cloneNode(true) as Element;
				maxAbstractNumId += 1;
				const nextId = String(maxAbstractNumId);
				setWordAttr(clone, 'abstractNumId', nextId);
				ensureFirstChildNsid(
					document,
					clone,
					allocateHexId(usedHex, hexSeed),
				);
				const cloneTmpl = directChild(clone, 'tmpl');
				if (cloneTmpl) {
					setWordAttr(
						cloneTmpl,
						'val',
						allocateHexId(usedHex, hexSeed),
					);
				}
				numbering.insertBefore(clone, insertAnchor);
				const numRef = directChild(extraNum, 'abstractNumId');
				if (numRef) {
					setWordAttr(numRef, 'val', nextId);
				}
				changed = true;
			}
		}

		return changed
			? serializeWithXmlDeclaration(numberingXml, dom)
			: numberingXml;
	} finally {
		dom.window.close();
	}
}

/** Ensure independent numbering instances in a DOCX package do not share a non-style-linked `<w:abstractNum>`. */
export function normalizeDocxNumbering(buffer: Buffer): Buffer {
	const archive = new AdmZip(buffer);
	const entry = archive.getEntry('word/numbering.xml');
	if (!entry) {
		return buffer;
	}
	const xml = entry.getData().toString('utf8');
	const normalized = splitSharedAbstractNumbering(xml);
	if (normalized === xml) {
		return buffer;
	}
	archive.updateFile('word/numbering.xml', Buffer.from(normalized, 'utf8'));
	return archive.toBuffer();
}
