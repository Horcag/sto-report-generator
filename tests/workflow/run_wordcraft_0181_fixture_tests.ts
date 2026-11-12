import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { JSDOM } from 'jsdom';

import {
	buildWordcraft0181LineNumberFixture,
	buildWordcraft0181MathFixture,
	buildWordcraft0181ProtectedFieldFixture,
	WORDCRAFT_0181_MATH_CASES,
} from './wordcraft_0181_fixture';

const WORD = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const MATH = 'http://schemas.openxmlformats.org/officeDocument/2006/math';
const RELS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const nodes = (
	element: Document | Element,
	name: string,
	namespace = WORD,
): Element[] => [...element.getElementsByTagNameNS(namespace, name)];
const value = (element: Element, name: string) =>
	element.getAttributeNS(WORD, name);

async function main(): Promise<void> {
	const directory = fs.mkdtempSync(
		path.join(os.tmpdir(), 'sto-wordcraft-0181-'),
	);
	let cases = 0;
	async function inspect(
		name: string,
		build: (output: string) => Promise<void>,
		check: (
			document: Document,
			settings: Document,
			styles: Document,
		) => void,
	): Promise<void> {
		const output = path.join(directory, `${name}.docx`);
		await build(output);
		const archive = new AdmZip(output);
		assert.ok(fs.statSync(output).size < 50_000, 'bounded public fixture');
		const windows: JSDOM[] = [];
		const parse = (part: string) => {
			const dom = new JSDOM(archive.readAsText(part), {
				contentType: 'text/xml',
			});
			windows.push(dom);
			return dom.window.document;
		};
		try {
			const document = parse('word/document.xml');
			const settings = parse('word/settings.xml');
			const styles = parse('word/styles.xml');
			const styleIds = nodes(styles, 'style').map(node =>
				value(node, 'styleId'),
			);
			assert.equal(
				new Set(styleIds).size,
				styleIds.length,
				'unique style ids',
			);
			const settingsOrder = [...settings.documentElement.children].map(
				node => node.localName,
			);
			for (const name of ['trackRevisions', 'documentProtection']) {
				if (settingsOrder.includes(name))
					assert.ok(
						settingsOrder.indexOf(name) <
							settingsOrder.indexOf('defaultTabStop'),
						`${name} precedes defaultTabStop`,
					);
			}
			for (const properties of nodes(document, 'pPr')) {
				const order = [...properties.children].map(
					node => node.localName,
				);
				if (order.includes('pageBreakBefore'))
					assert.ok(
						order.indexOf('pageBreakBefore') <
							order.indexOf('spacing'),
						'pageBreakBefore precedes spacing',
					);
			}
			for (const part of [
				'_rels/.rels',
				'word/_rels/document.xml.rels',
			]) {
				const relationships = nodes(parse(part), 'Relationship', RELS);
				assert.equal(
					new Set(relationships.map(node => node.getAttribute('Id')))
						.size,
					relationships.length,
					'unique package relationship ids',
				);
				for (const relationship of relationships) {
					assert.notEqual(
						relationship.getAttribute('TargetMode'),
						'External',
					);
					const target = relationship.getAttribute('Target');
					assert.ok(target);
					const resolved = path.posix.normalize(
						path.posix.join(
							part === '_rels/.rels' ? '' : 'word',
							target,
						),
					);
					assert.ok(
						archive.getEntry(resolved),
						`relationship target exists: ${resolved}`,
					);
				}
			}
			for (const part of ['[Content_Types].xml', 'docProps/core.xml'])
				assert.ok(archive.getEntry(part));
			assert.equal(nodes(document, 'sectPr').length, 1);
			assert.equal(value(nodes(document, 'pgSz')[0], 'w'), '12240');
			assert.equal(value(nodes(document, 'pgSz')[0], 'h'), '15840');
			for (const side of ['top', 'bottom', 'left', 'right'])
				assert.equal(value(nodes(document, 'pgMar')[0], side), '1440');
			for (const font of nodes(document, 'rFonts'))
				assert.ok(
					['Arial', 'Cambria Math'].includes(
						value(font, 'ascii') ?? '',
					),
				);
			assert.equal(nodes(document, 'b').length, 0);
			assert.equal(nodes(document, 'drawing').length, 0);
			assert.equal(nodes(document, 'headerReference').length, 0);
			check(document, settings, styles);
			cases++;
			console.log(
				`PASS 0181 ${name}: controlled XML/package only; renderer acceptance is separate`,
			);
		} finally {
			for (const dom of windows) dom.window.close();
		}
	}
	try {
		for (const nested of [false, true])
			await inspect(
				`math-${nested ? 'defensive-nested' : 'outer'}`,
				output => buildWordcraft0181MathFixture(output, nested),
				(document, settings) => {
					const expected = WORDCRAFT_0181_MATH_CASES.filter(
						item => nested || !item.nested,
					);
					const paragraphs = nodes(document, 'p');
					assert.equal(paragraphs.length, expected.length);
					assert.equal(nodes(settings, 'trackRevisions').length, 1);
					const revisionIds = [
						...nodes(document, 'ins'),
						...nodes(document, 'del'),
					].map(node => value(node, 'id'));
					assert.equal(new Set(revisionIds).size, revisionIds.length);
					for (const [index, item] of expected.entries()) {
						const paragraph = paragraphs[index];
						const math = nodes(paragraph, 'oMath', MATH);
						assert.equal(math.length, 1);
						assert.equal(
							nodes(math[0], 't', MATH)[0].textContent,
							item.text,
						);
						assert.equal(
							nodes(paragraph, 'oMathPara', MATH).length,
							item.display ? 1 : 0,
						);
						for (const revision of ['ins', 'del'])
							assert.equal(
								nodes(paragraph, revision).length,
								item.revision === revision ? 1 : 0,
							);
						if (item.revision) {
							const revision = nodes(paragraph, item.revision)[0];
							assert.equal(value(revision, 'author'), 'Fixture');
							assert.equal(
								value(revision, 'date'),
								'2026-01-01T00:00:00Z',
							);
							assert.equal(
								revision.firstElementChild?.localName,
								item.display && !item.nested
									? 'oMathPara'
									: 'oMath',
							);
							assert.equal(
								revision.parentElement?.localName,
								item.nested ? 'oMathPara' : 'p',
							);
						} else
							assert.equal(
								math[0].parentElement?.localName,
								item.display ? 'oMathPara' : 'p',
							);
					}
				},
			);
		for (const mode of ['readOnly', 'forms', 'comments', null] as const)
			await inspect(
				`fields-${mode ?? 'unprotected'}`,
				output => buildWordcraft0181ProtectedFieldFixture(output, mode),
				(document, settings) => {
					const protection = nodes(settings, 'documentProtection');
					assert.equal(protection.length, mode ? 1 : 0);
					if (mode) {
						assert.equal(value(protection[0], 'edit'), mode);
						assert.equal(value(protection[0], 'enforcement'), '1');
					}
					assert.deepEqual(
						nodes(document, 'fldChar').map(node =>
							value(node, 'fldCharType'),
						),
						['begin', 'separate', 'end'],
					);
					assert.equal(
						value(nodes(document, 'fldChar')[0], 'dirty'),
						'true',
					);
					assert.equal(
						value(nodes(document, 'fldChar')[0], 'fldLock'),
						null,
					);
					assert.equal(
						nodes(document, 'instrText')[0].textContent?.trim(),
						'PAGEREF target',
					);
					assert.equal(
						nodes(nodes(document, 'p')[0], 't').at(-1)?.textContent,
						'104',
					);
					assert.equal(
						value(nodes(document, 'bookmarkStart')[0], 'name'),
						'target',
					);
					assert.equal(
						value(nodes(document, 'bookmarkStart')[0], 'id'),
						value(nodes(document, 'bookmarkEnd')[0], 'id'),
					);
					assert.equal(
						nodes(nodes(document, 'p')[1], 'pageBreakBefore')
							.length,
						1,
					);
					assert.equal(
						nodes(document, 'ins').length +
							nodes(document, 'del').length,
						0,
					);
				},
			);
		for (const localized of [true, false])
			await inspect(
				`lines-${localized ? 'localized' : 'english'}`,
				output =>
					buildWordcraft0181LineNumberFixture(output, localized),
				(document, settings, styles) => {
					assert.equal(nodes(document, 'p').length, 72);
					const texts = nodes(document, 't').map(
						node => node.textContent,
					);
					assert.equal(new Set(texts).size, 72);
					assert.equal(texts[0], 'COLUMN-1 LINE-01');
					assert.equal(texts[36], 'COLUMN-2 LINE-37');
					assert.equal(texts[71], 'COLUMN-2 LINE-72');
					assert.equal(nodes(document, 'br').length, 1);
					assert.equal(
						value(nodes(document, 'br')[0], 'type'),
						'column',
					);
					assert.equal(value(nodes(document, 'cols')[0], 'num'), '2');
					assert.equal(
						value(nodes(document, 'cols')[0], 'space'),
						'720',
					);
					const numbering = nodes(document, 'lnNumType')[0];
					for (const [key, expected] of Object.entries({
						countBy: '1',
						start: '1',
						distance: '360',
						restart: 'continuous',
					}))
						assert.equal(value(numbering, key), expected);
					const style = nodes(styles, 'style').filter(
						node =>
							value(node, 'styleId') ===
							(localized ? 'Zeilennummer' : 'LineNumber'),
					);
					assert.equal(style.length, 1);
					assert.equal(value(style[0], 'type'), 'character');
					assert.equal(
						value(nodes(style[0], 'name')[0], 'val'),
						'Line Number',
					);
					assert.equal(value(nodes(style[0], 'sz')[0], 'val'), '16');
					assert.equal(
						value(nodes(style[0], 'color')[0], 'val'),
						'C00000',
					);
					assert.equal(nodes(style[0], 'i').length, 1);
					if (localized)
						assert.equal(
							nodes(styles, 'style').filter(
								node => value(node, 'styleId') === 'LineNumber',
							).length,
							0,
						);
					assert.equal(
						nodes(settings, 'documentProtection').length,
						0,
					);
				},
			);
		assert.equal(cases, 8, 'all positive and negative controls executed');
	} finally {
		fs.rmSync(directory, { recursive: true, force: true });
		assert.equal(fs.existsSync(directory), false);
	}
}

main().catch(error => {
	console.error(error);
	process.exitCode = 1;
});
