import fs from 'node:fs';
import path from 'node:path';
import AdmZip from 'adm-zip';

const DOCUMENT_XML_PATH = 'word/document.xml';

export function clearDirtyFieldFlags(docxBuffer: Buffer): Buffer {
	const archive = new AdmZip(docxBuffer);
	const documentXml = archive.getEntry(DOCUMENT_XML_PATH);
	if (!documentXml) {
		return docxBuffer;
	}

	const cleanedXml = documentXml
		.getData()
		.toString('utf8')
		.replace(/\s+w:dirty="(?:true|1)"/g, '');
	archive.updateFile(DOCUMENT_XML_PATH, Buffer.from(cleanedXml, 'utf8'));
	return archive.toBuffer();
}

export function unpackDocx(docxPath: string, targetDir: string): void {
	fs.rmSync(targetDir, { recursive: true, force: true });
	fs.mkdirSync(targetDir, { recursive: true });
	new AdmZip(docxPath).extractAllTo(targetDir, true);
}

export function readDocxEntry(docxPath: string, entryPath: string): string {
	const entry = new AdmZip(docxPath).getEntry(entryPath);
	if (!entry) {
		throw new Error(`${entryPath} not found in ${path.basename(docxPath)}`);
	}
	return entry.getData().toString('utf8');
}
