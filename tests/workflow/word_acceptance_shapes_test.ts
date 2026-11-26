import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import AdmZip from 'adm-zip';

import { compareFigureEvidence } from '@/app/word-acceptance-figures';
import { applyFigureDocumentPolicy } from '@/shared/lib/docx';
import {
	compileSvgToShapeGroup,
	planFigure,
	validateFigureSettings,
} from '@/shared/lib/figures';

const SVG_SOURCE = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100" viewBox="0 0 200 100">
  <rect x="20" y="20" width="160" height="60" fill="#eef4fb" stroke="#1f4e78" stroke-width="2"/>
  <text x="100" y="50" text-anchor="middle" dominant-baseline="middle" font-size="14">Узел A</text>
</svg>`;

function buildShapeDocxXml(texts: string[], includeBlip = false): string {
	const shapes = texts
		.map(
			text =>
				`<wps:wsp><wps:txbx><w:txbxContent><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:txbxContent></wps:txbx></wps:wsp>`,
		)
		.join('');
	const blip = includeBlip
		? '<pic:pic><pic:blipFill><a:blip r:embed="rId1"/></pic:blipFill></pic:pic>'
		: '';
	return `<w:document
		xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
		xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
		xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
		xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"
		xmlns:wpg="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup"
		xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"
		xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
		<w:body><w:p><w:r><w:drawing><wp:inline>
			<wp:extent cx="4320000" cy="2160000"/>
			<wp:docPr id="1" name="sto-figure:diagram"/>
			<a:graphic><a:graphicData><wpg:wgp><a:xfrm><a:off x="0" y="0"/><a:ext cx="4320000" cy="2160000"/></a:xfrm>${shapes}${blip}</wpg:wgp></a:graphicData></a:graphic>
		</wp:inline></w:drawing></w:r></w:p></w:body></w:document>`;
}

function writeDocx(
	filePath: string,
	docXml: string,
	compressionDisabled = true,
): void {
	const zip = new AdmZip();
	zip.addFile(
		'[Content_Types].xml',
		Buffer.from(
			'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>',
		),
	);
	zip.addFile('word/document.xml', Buffer.from(docXml));
	zip.addFile(
		'word/settings.xml',
		Buffer.from(
			`<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${compressionDisabled ? '<w:doNotAutoCompressPictures/>' : ''}</w:settings>`,
		),
	);
	zip.writeZip(filePath);
}

function run(): void {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sto-accept-shapes-'));
	try {
		const svgPath = path.join(root, 'diagram.svg');
		fs.writeFileSync(svgPath, SVG_SOURCE);
		const plan = planFigure(
			root,
			'diagram.svg',
			'diagram',
			validateFigureSettings({
				defaults: { svgMode: 'shapes' },
				figures: {},
			}),
		);
		const withoutPolicy = path.join(root, 'without-policy.docx');
		writeDocx(withoutPolicy, buildShapeDocxXml(['Узел A']), false);
		const packedPolicy = applyFigureDocumentPolicy(
			fs.readFileSync(withoutPolicy),
			[plan],
		);
		assert.match(
			new AdmZip(packedPolicy).readAsText('word/settings.xml'),
			/doNotAutoCompressPictures/,
		);

		const source = path.join(root, 'source.docx');
		const accepted = path.join(root, 'accepted.docx');
		writeDocx(source, buildShapeDocxXml(['Узел A']));
		writeDocx(accepted, buildShapeDocxXml(['Узел A']));

		const ok = compareFigureEvidence(source, accepted);
		assert.equal(ok.status, 'preserved');
		assert.equal(ok.occurrences[0].source.kind, 'shapes');
		assert.equal(ok.occurrences[0].accepted?.kind, 'shapes');
		assert.equal(ok.occurrences[0].accepted?.shapeCount, 1);
		assert.deepEqual(ok.occurrences[0].accepted?.shapeTexts, ['Узел A']);

		// Altered text inside shape group must fail acceptance.
		writeDocx(accepted, buildShapeDocxXml(['Узел B']));
		assert.equal(compareFigureEvidence(source, accepted).status, 'failed');

		// Missing / changed shape count must fail acceptance.
		writeDocx(accepted, buildShapeDocxXml(['Узел A', 'Лишний блок']));
		assert.equal(compareFigureEvidence(source, accepted).status, 'failed');

		// Smuggling a raster blip inside a shape group must fail payload verification.
		writeDocx(accepted, buildShapeDocxXml(['Узел A'], true));
		assert.equal(compareFigureEvidence(source, accepted).status, 'failed');

		assert.ok(compileSvgToShapeGroup);
		console.log('Word acceptance shape-group tests passed.');
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
	}
}

run();
