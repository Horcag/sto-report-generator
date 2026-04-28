import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import AdmZip from 'adm-zip';

const projectRoot = path.join(__dirname, '..');
const sampleDir = path.join(projectRoot, 'reports', 'modular_sample');
const tempOutput = path.join(__dirname, 'temp_output.docx');
const snapshotFile = path.join(__dirname, 'fixtures', 'generator', 'snapshot.xml');

// A simple formatter to make XML diffs readable
function formatXml(xml: string): string {
    return xml
        .replace(/>\s*</g, '>\n<') // Add newline between tags
        .trim();
}

function runSnapshotTest() {
    console.log('Running Generator Snapshot Test...\n');
    
    const updateSnapshot = process.argv.includes('--update');

    // 1. Build the document
    try {
        console.log('Building modular_sample report...');
        execSync(`npm run build "${sampleDir}" "${tempOutput}"`, { cwd: projectRoot, stdio: 'inherit' });
    } catch (e) {
        console.error('❌ Failed to build report.');
        process.exit(1);
    }

    if (!fs.existsSync(tempOutput)) {
        console.error('❌ Output docx was not generated.');
        process.exit(1);
    }

    // 2. Unzip and extract document.xml
    let currentXml = '';
    try {
        const zip = new AdmZip(tempOutput);
        const documentXmlEntry = zip.getEntry('word/document.xml');
        if (!documentXmlEntry) {
            throw new Error('word/document.xml not found in archive');
        }
        currentXml = documentXmlEntry.getData().toString('utf8');
    } catch (e: any) {
        console.error(`❌ Failed to extract document.xml: ${e.message}`);
        fs.unlinkSync(tempOutput);
        process.exit(1);
    }

    // Clean up temp docx
    fs.unlinkSync(tempOutput);

    // Format XML for readable diffs
    const formattedXml = formatXml(currentXml);

    // 3. Handle update or initial snapshot
    if (updateSnapshot || !fs.existsSync(snapshotFile)) {
        fs.writeFileSync(snapshotFile, formattedXml, 'utf-8');
        console.log(`✅ Snapshot saved to ${snapshotFile}`);
        console.log('\nTest Summary: 1 passed, 0 failed. (Snapshot updated)');
        process.exit(0);
    }

    // 4. Compare with existing snapshot
    const expectedXml = fs.readFileSync(snapshotFile, 'utf-8');

    if (formattedXml === expectedXml) {
        console.log('✅ PASSED: Generated document matches snapshot.');
        console.log('\nTest Summary: 1 passed, 0 failed.');
        process.exit(0);
    } else {
        console.log('❌ FAILED: Generated document DOES NOT match snapshot.');
        console.log('If this change was intentional, run: npm run test:generator -- --update');
        
        // Print a simple diff (just a few lines of difference)
        const expectedLines = expectedXml.split('\n');
        const actualLines = formattedXml.split('\n');
        
        console.log('\n--- First difference found at: ---');
        for (let i = 0; i < Math.max(expectedLines.length, actualLines.length); i++) {
            if (expectedLines[i] !== actualLines[i]) {
                console.log(`Expected (Line ${i+1}): ${expectedLines[i] || '<EOF>'}`);
                console.log(`Actual   (Line ${i+1}): ${actualLines[i] || '<EOF>'}`);
                break;
            }
        }
        
        process.exit(1);
    }
}

runSnapshotTest();
