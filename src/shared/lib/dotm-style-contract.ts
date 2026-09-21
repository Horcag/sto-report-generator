import crypto from 'node:crypto';
import fs from 'node:fs';

import { readDocxEntry } from './docx-archive';

export interface DotmStyle {
	id: string;
	name: string;
	type: string;
	xml: string;
}

function attributeValue(xml: string, attribute: string): string {
	const match = new RegExp(`\\b${attribute}="([^"]+)"`).exec(xml);
	if (!match) {
		throw new Error(`Missing ${attribute} in DOTM style.`);
	}
	return match[1];
}

export function readDotmStyles(dotmPath: string): DotmStyle[] {
	const stylesXml = readDocxEntry(dotmPath, 'word/styles.xml');
	return [...stylesXml.matchAll(/<w:style\b[\s\S]*?<\/w:style>/g)].map(
		match => {
			const xml = match[0];
			const nameMatch = /<w:name\b[^>]*\bw:val="([^"]+)"/.exec(xml);
			if (!nameMatch) {
				throw new Error('DOTM style has no display name.');
			}
			return {
				id: attributeValue(xml, 'w:styleId'),
				name: nameMatch[1],
				type: attributeValue(xml, 'w:type'),
				xml,
			};
		},
	);
}

export function sha256File(filePath: string): string {
	return crypto
		.createHash('sha256')
		.update(fs.readFileSync(filePath))
		.digest('hex');
}

function normalizeStyleSemantics(xml: string): string {
	return xml
		.replace(/<w:style\b[^>]*>/, '<w:style>')
		.replace(/<w:name\b[^>]*\/>/, '')
		.replace(/\s+w:rsid[A-Za-z]+="[^"]*"/g, '')
		.replace(/<w:rsid[A-Za-z]+\b[^>]*\/>/g, '')
		.replace(/>\s+</g, '><')
		.trim();
}

export function dotmStyleSemanticsSha256(styles: DotmStyle[]): string {
	const semanticInventory = [...styles]
		.sort((left, right) => left.id.localeCompare(right.id))
		.map(
			style =>
				`${style.id}\\n${style.type}\\n${style.name}\\n${normalizeStyleSemantics(style.xml)}`,
		)
		.join('\\n');
	return crypto.createHash('sha256').update(semanticInventory).digest('hex');
}
