import fs from 'node:fs';
import AdmZip from 'adm-zip';

import {
	isStrictStoProperty,
	normalizeStrictStoXml,
} from './strict-sto/typography';

export { isStrictStoProperty } from './strict-sto/typography';

export const STRICT_STO_PART =
	/^word\/(?:document|styles|numbering|header\d*|footer\d*|footnotes|endnotes)\.xml$/;

export function isStrictStoDocx(filePath: string): boolean {
	const entry = new AdmZip(filePath).getEntry('docProps/custom.xml');
	return !!entry && isStrictStoProperty(entry.getData().toString('utf8'));
}

export function normalizeStrictStoBuffer(buffer: Buffer): Buffer {
	const archive = new AdmZip(buffer);
	const stylesXml =
		archive.getEntry('word/styles.xml')?.getData().toString('utf8') ?? '';
	for (const entry of archive.getEntries()) {
		if (!STRICT_STO_PART.test(entry.entryName)) continue;
		archive.updateFile(
			entry.entryName,
			Buffer.from(
				normalizeStrictStoXml(
					entry.getData().toString('utf8'),
					stylesXml,
				),
			),
		);
	}
	return archive.toBuffer();
}

export function enforceStrictStoDocx(filePath: string): void {
	if (!isStrictStoDocx(filePath))
		throw new Error('Strict STO document marker is missing.');
	fs.writeFileSync(
		filePath,
		normalizeStrictStoBuffer(fs.readFileSync(filePath)),
	);
}
