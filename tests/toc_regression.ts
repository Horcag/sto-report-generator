import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import AdmZip from 'adm-zip';

const projectRoot = path.join(__dirname, '..');
const tempMd = path.join(__dirname, 'toc_test.md');
const tempDocx = path.join(__dirname, 'toc_test.docx');

const testMarkdown = `---
title: Тест ТОС
---

\\sto_structural_heading{РЕФЕРАТ}

\\sto_structural_heading{СОДЕРЖАНИЕ}

\\sto_structural_heading{ВВЕДЕНИЕ}

# Глава 1

\\sto_structural_heading{ЗАКЛЮЧЕНИЕ}

\\sto_structural_heading{СПИСОК ИСПОЛЬЗОВАННЫХ ИСТОЧНИКОВ}
`;

async function runTocRegressionTest() {
    console.log('Running TOC Regression Test...\n');

    fs.writeFileSync(tempMd, testMarkdown, 'utf-8');

    try {
        console.log('Building TOC test report...');
        execSync(`npx tsx src/index.ts "${tempMd}" "${tempDocx}"`, { cwd: projectRoot, stdio: 'inherit' });
    } catch (e) {
        console.error('❌ Failed to build report.');
        cleanup();
        process.exit(1);
    }

    let currentXml = '';
    try {
        const zip = new AdmZip(tempDocx);
        const documentXmlEntry = zip.getEntry('word/document.xml');
        if (!documentXmlEntry) throw new Error('word/document.xml not found');
        currentXml = documentXmlEntry.getData().toString('utf8');
    } catch (e: any) {
        console.error(`❌ Error: ${e.message}`);
        cleanup();
        process.exit(1);
    }

    const errors: string[] = [];

    // 1. Check if РЕФЕРАТ or СОДЕРЖАНИЕ use the TOC-tracked style
    // StructuralHeading is tracked by TOC (\t "StructuralHeading,1")
    if (currentXml.includes('w:val="StructuralHeading"') && currentXml.includes('>РЕФЕРАТ<')) {
        const abstractBlock = currentXml.match(/<w:p(?:(?!<w:p).)*?>РЕФЕРАТ[\s\S]*?<\/w:p>/);
        if (abstractBlock && abstractBlock[0].includes('w:val="StructuralHeading"')) {
            errors.push('РЕФЕРАТ is using "StructuralHeading" style, will incorrectly appear in TOC');
        }
    }
    
    if (currentXml.includes('w:val="StructuralHeading"') && currentXml.includes('>СОДЕРЖАНИЕ<')) {
        const tocHeadingBlock = currentXml.match(/<w:p(?:(?!<w:p).)*?>СОДЕРЖАНИЕ[\s\S]*?<\/w:p>/);
        if (tocHeadingBlock && tocHeadingBlock[0].includes('w:val="StructuralHeading"')) {
            errors.push('СОДЕРЖАНИЕ is using "StructuralHeading" style, will incorrectly appear in TOC');
        }
    }

    // 2. Check casing of structural headings
    // They should be converted to Sentence Case in the document text 
    // (the style StructuralHeading should handle the CAPS display)
    const headings = ['ВВЕДЕНИЕ', 'ЗАКЛЮЧЕНИЕ', 'СПИСОК ИСПОЛЬЗОВАННЫХ ИСТОЧНИКОВ'];
    for (const h of headings) {
        if (currentXml.includes(`>${h}<`)) {
            errors.push(`Heading "${h}" found in ALL CAPS in XML. Should be Sentence case (e.g. "${h.charAt(0) + h.slice(1).toLowerCase()}")`);
        }
    }

    if (errors.length > 0) {
        console.error('\n❌ TOC Regression Test FAILED:');
        errors.forEach(err => console.error(`  - ${err}`));
        cleanup();
        process.exit(1);
    } else {
        console.log('\n✅ TOC Regression Test PASSED!');
        cleanup();
        process.exit(0);
    }
}

function cleanup() {
    if (fs.existsSync(tempMd)) fs.unlinkSync(tempMd);
    if (fs.existsSync(tempDocx)) fs.unlinkSync(tempDocx);
}

runTocRegressionTest();
