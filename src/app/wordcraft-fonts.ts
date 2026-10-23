import fs from 'node:fs';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { JSDOM } from 'jsdom';

const WORD = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const DRAWING = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const MATH = 'http://schemas.openxmlformats.org/officeDocument/2006/math';
const FONT_SLOTS = ['ascii', 'hAnsi', 'eastAsia', 'cs'] as const;
const EAST_ASIAN =
	/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Bopomofo}]/u;
const COMPLEX_SCRIPT =
	/[\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Syriac}\p{Script=Thaana}\p{Script=Devanagari}\p{Script=Bengali}\p{Script=Gurmukhi}\p{Script=Gujarati}\p{Script=Oriya}\p{Script=Tamil}\p{Script=Telugu}\p{Script=Kannada}\p{Script=Malayalam}\p{Script=Sinhala}\p{Script=Thai}\p{Script=Lao}\p{Script=Tibetan}\p{Script=Myanmar}\p{Script=Khmer}]/u;

export interface WordcraftFontReport {
	requiredFamilies: string[];
	availableFamilies: string[];
	missingFamilies: string[];
	unverifiedRequirements: string[];
	loadedFiles?: { path: string; sha256: string }[];
	selectionWarnings?: string[];
	warnings: string[];
}

/** Inspect the engine's catalog, never the host's fontconfig substitution result. */
export function preflightWordcraftFonts(
	sourceDocx: string,
	fontListOutput: string,
): WordcraftFontReport {
	const payload = (
		fontListOutput
			.split(/\r?\n/)
			.find(line => line.startsWith('font.list:')) ?? fontListOutput
	)
		.trim()
		.replace(/^font\.list:\s*/, '');
	let catalog: { families?: unknown };
	try {
		catalog = JSON.parse(payload) as { families?: unknown };
	} catch {
		throw new Error('Wordcraft font.list returned invalid JSON.');
	}
	if (
		!catalog ||
		!Array.isArray(catalog.families) ||
		!catalog.families.every(
			family => typeof family === 'string' && family.trim(),
		)
	) {
		throw new Error(
			'Wordcraft font.list did not return available font families.',
		);
	}
	const availableFamilies = [...new Set(catalog.families as string[])].sort();
	const available = new Set(availableFamilies.map(normalizeFamily));
	const required = new Set<string>();
	const warnings = new Set<string>();
	const unverifiedRequirements = new Set<string>();
	const unverified = (message: string): void => {
		unverifiedRequirements.add(message);
		warnings.add(message);
	};
	const archive = new AdmZip(sourceDocx);
	const readXml = (name: string): Document | undefined => {
		const entry = archive.getEntry(name);
		return entry
			? new JSDOM(entry.getData().toString('utf8'), {
					contentType: 'text/xml',
				}).window.document
			: undefined;
	};
	const styles = readXml('word/styles.xml');
	const theme = readXml('word/theme/theme1.xml');
	const styleMap = new Map(
		Array.from(styles?.getElementsByTagNameNS(WORD, 'style') ?? []).map(
			style => [style.getAttributeNS(WORD, 'styleId'), style],
		),
	);
	const defaultStyle = Array.from(styleMap.values()).find(
		style =>
			style.getAttributeNS(WORD, 'type') === 'paragraph' &&
			['1', 'true', 'on'].includes(
				style.getAttributeNS(WORD, 'default') ?? '',
			),
	);
	const descendants = (
		element: Element | Document | undefined,
		name: string,
	): Element[] =>
		Array.from(element?.getElementsByTagNameNS(WORD, name) ?? []);
	const direct = (element: Element | undefined, name: string): Element[] =>
		Array.from(element?.children ?? []).filter(
			node => node.namespaceURI === WORD && node.localName === name,
		);
	const styleProperties = (
		id: string | null,
		seen = new Set<string>(),
	): Element[] => {
		if (!id || seen.has(id)) return [];
		seen.add(id);
		const style = styleMap.get(id);
		if (!style) return [];
		return [
			...styleProperties(
				direct(style, 'basedOn')[0]?.getAttributeNS(WORD, 'val') ??
					null,
				seen,
			),
			...direct(style, 'rPr'),
		];
	};
	const defaults = descendants(styles, 'docDefaults').flatMap(defaults =>
		direct(defaults, 'rPrDefault').flatMap(part => direct(part, 'rPr')),
	);
	const recordFonts = (properties: Element[], text: string): void => {
		const declarations = properties.flatMap(property =>
			direct(property, 'rFonts'),
		);
		const forcedComplex = properties.reduce((enabled, property) => {
			const marker = direct(property, 'cs')[0];
			return marker
				? !['0', 'false', 'off'].includes(
						marker.getAttributeNS(WORD, 'val') ?? '',
					)
				: enabled;
		}, false);
		const usedSlots = new Set<string>();
		for (const character of text) {
			usedSlots.add(
				forcedComplex
					? 'cs'
					: character.codePointAt(0)! < 128
						? 'ascii'
						: EAST_ASIAN.test(character)
							? 'eastAsia'
							: COMPLEX_SCRIPT.test(character)
								? 'cs'
								: 'hAnsi',
			);
		}
		for (const slot of FONT_SLOTS) {
			if (!usedSlots.has(slot)) continue;
			let family: string | null = null;
			let unresolvedTheme: string | null = null;
			for (const declaration of declarations) {
				const themed = declaration.getAttributeNS(WORD, `${slot}Theme`);
				const explicit = declaration.getAttributeNS(WORD, slot);
				if (themed) {
					const group = themed.startsWith('major')
						? 'majorFont'
						: themed.startsWith('minor')
							? 'minorFont'
							: '';
					const script = /EastAsia$/.test(themed)
						? 'ea'
						: /Bidi$/.test(themed)
							? 'cs'
							: 'latin';
					const themeGroup = theme?.getElementsByTagNameNS(
						DRAWING,
						group,
					)[0];
					family =
						themeGroup
							?.getElementsByTagNameNS(DRAWING, script)[0]
							?.getAttribute('typeface') || null;
					unresolvedTheme = family ? null : themed;
				} else if (explicit) {
					family = explicit;
					unresolvedTheme = null;
				}
			}
			if (family) required.add(family);
			else if (unresolvedTheme)
				unverified(
					`Wordcraft font preflight could not resolve theme font ${unresolvedTheme}; font substitution may occur.`,
				);
			else
				unverified(
					'Wordcraft font preflight found text without a resolvable font family; engine defaults remain unverified.',
				);
		}
	};
	for (const entry of archive.getEntries()) {
		if (
			!/^word\/(document|header\d+|footer\d+|footnotes|endnotes|comments)\.xml$/.test(
				entry.entryName,
			)
		)
			continue;
		const document = readXml(entry.entryName);
		if (descendants(document, 'tblStyle').length) {
			unverified(
				'Wordcraft font preflight does not resolve conditional table style fonts; table font substitution remains unverified.',
			);
		}
		for (const symbol of descendants(document, 'sym')) {
			const family = symbol.getAttributeNS(WORD, 'font');
			if (family) required.add(family);
		}
		if (document?.getElementsByTagNameNS(DRAWING, 't').length) {
			unverified(
				'Wordcraft font preflight does not resolve DrawingML text fonts; drawing font substitution remains unverified.',
			);
		}
		for (const run of descendants(document, 'r')) {
			const text = descendants(run, 't')
				.map(node => node.textContent)
				.join('');
			if (!text) continue;
			let paragraph: Element | null = run.parentElement;
			while (
				paragraph &&
				!(
					paragraph.namespaceURI === WORD &&
					paragraph.localName === 'p'
				)
			)
				paragraph = paragraph.parentElement;
			const paragraphStyle =
				direct(
					direct(paragraph ?? undefined, 'pPr')[0],
					'pStyle',
				)[0]?.getAttributeNS(WORD, 'val') ??
				defaultStyle?.getAttributeNS(WORD, 'styleId') ??
				null;
			const runStyle =
				direct(direct(run, 'rPr')[0], 'rStyle')[0]?.getAttributeNS(
					WORD,
					'val',
				) ?? null;
			recordFonts(
				[
					...defaults,
					...styleProperties(paragraphStyle),
					...styleProperties(runStyle),
					...direct(run, 'rPr'),
				],
				text,
			);
		}
		if (document?.getElementsByTagNameNS(MATH, 'oMath').length) {
			required.add('Cambria Math');
			const configured = readXml('word/settings.xml')
				?.getElementsByTagNameNS(MATH, 'mathFont')[0]
				?.getAttributeNS(MATH, 'val')
				?.trim();
			if (configured) {
				required.add(configured);
				if (
					normalizeFamily(configured) !==
					normalizeFamily('Cambria Math')
				)
					unverified(
						`Wordcraft ignores the configured math font ${configured} and uses Cambria Math; the requested mathematical font remains unverified.`,
					);
			}
		}
	}
	const requiredFamilies = [...required].sort();
	const missingFamilies = requiredFamilies.filter(
		family => !available.has(normalizeFamily(family)),
	);
	for (const family of missingFamilies) {
		warnings.add(
			`Wordcraft font unavailable: ${family}; the engine may substitute another family, changing glyphs, line breaks and pagination.`,
		);
	}
	return {
		requiredFamilies,
		availableFamilies,
		missingFamilies,
		unverifiedRequirements: [...unverifiedRequirements],
		warnings: [...warnings],
	};
}

function normalizeFamily(family: string): string {
	return family.trim().toLocaleLowerCase('en-US');
}

/** Explicit files are loaded only in each headless CLI process, never installed. */
export function wordcraftFontCommands(fontFiles: string[] = []): string[] {
	return [
		...new Set(
			fontFiles.map(filename => {
				if (!filename.trim())
					throw new Error(
						'Wordcraft font file path must not be empty.',
					);
				const resolved = path.resolve(filename);
				if (
					!/\.(ttf|otf|ttc|woff|woff2)$/i.test(resolved) ||
					!fs.existsSync(resolved) ||
					!fs.statSync(resolved).isFile()
				) {
					throw new Error(
						`Expected an existing Wordcraft font file: ${resolved}`,
					);
				}
				return resolved;
			}),
		),
	].flatMap(filename => [
		'--cmd',
		`font.add=${JSON.stringify({ path: filename })}`,
	]);
}

/** Read only the explicitly selected folder; never search global font directories. */
export function readWordcraftFontDirectory(directory?: string): string[] {
	if (directory === undefined) return [];
	const resolved = path.resolve(directory);
	if (
		!directory.trim() ||
		!fs.existsSync(resolved) ||
		!fs.statSync(resolved).isDirectory()
	) {
		throw new Error(
			`Expected an existing Wordcraft font directory: ${resolved}`,
		);
	}
	const files = fs
		.readdirSync(resolved)
		.filter(name => /\.(ttf|otf|ttc|woff|woff2)$/i.test(name))
		.map(name => path.join(resolved, name))
		.filter(filename => fs.statSync(filename).isFile())
		.sort();
	if (!files.length)
		throw new Error(
			`Wordcraft font directory contains no supported font files: ${resolved}`,
		);
	return files;
}
