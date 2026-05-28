import fs from 'fs';
import path from 'path';

/**
 * Regression tests for STO report quality.
 * Usage: npx tsx tests/regression_checks.ts <reports_dir>
 */
async function runTests() {
  const reportsDir = process.argv[2];
  if (!reportsDir) {
    console.error('Usage: npx tsx tests/regression_checks.ts <reports_dir>');
    process.exit(1);
  }

  if (!fs.existsSync(reportsDir)) {
    console.error(`Error: Directory not found - ${reportsDir}`);
    process.exit(1);
  }

  const mdFiles = fs.readdirSync(reportsDir).filter(f => f.endsWith('.md'));

  let errors: string[] = [];

  // 1. Check for "Source not found" or "Источник не найден" in Markdown
  for (const file of mdFiles) {
    const content = fs.readFileSync(path.join(reportsDir, file), 'utf8');
    if (content.includes('Источник не найден') || content.includes('Source not found') || content.includes('NOT FOUND')) {
      errors.push(`FAIL: [${file}] contains "Source not found" marker.`);
    }

    if (content.includes('—')) {
      errors.push(`FAIL: [${file}] contains em-dash (—). Use en-dash (–) in STO reports.`);
    }

    if (/\[0\]/.test(content)) {
      errors.push(`FAIL: [${file}] contains citation [0]. Source numbering starts from [1].`);
    }

    if (file !== '01_referat.md' && /\*\*[^*]+\*\*/.test(content)) {
      errors.push(`FAIL: [${file}] contains bold markdown. Bold is allowed only in the referat module.`);
    }

    const imageMatches = [...content.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)];
    for (const match of imageMatches) {
      const imagePath = match[1].trim();
      if (/^(https?:|file:|#)/i.test(imagePath)) {
        continue;
      }
      const resolvedImagePath = path.resolve(imagePath);
      if (!fs.existsSync(resolvedImagePath)) {
        errors.push(`FAIL: [${file}] image file does not exist: ${imagePath}`);
      }
    }
  }

  // 2. Check for dots in ROC-AUC or metrics (should be commas in Russian text)
  // We exclude math blocks and tables where dots might be preferred, but focus on plain text metrics.
  for (const file of mdFiles) {
    const content = fs.readFileSync(path.join(reportsDir, file), 'utf8');
    
    // Pattern for metrics like "ROC-AUC: 0.744" or "CV = 1.26"
    const metricMatches = content.match(/(?:ROC-AUC|PR-AUC|F1-score|CV)(?:\s*[:=]\s*)(\d+\.\d+)/gi);
    if (metricMatches) {
        for (const match of metricMatches) {
            errors.push(`FAIL: [${file}] contains decimal dot in metric: ${match}. Use comma instead.`);
        }
    }
  }

  // 3. Verify Abstract Placeholders
  const referatPath = path.join(reportsDir, '01_referat.md');
  if (fs.existsSync(referatPath)) {
    const referat = fs.readFileSync(referatPath, 'utf8');
    if (!referat.includes('{{PAGES}}') || !referat.includes('{{FIGURES}}') || !referat.includes('{{TABLES}}') || !referat.includes('{{SOURCES}}')) {
      const figureRefs = mdFiles.reduce((acc, file) => {
          const content = fs.readFileSync(path.join(reportsDir, file), 'utf8');
          const matches = content.match(/!\[.*?\]\(.*?\)/g) || [];
          return acc + matches.length;
      }, 0);

      const abstractFiguresMatch = referat.match(/(\d+)\s+рис/);
      if (abstractFiguresMatch && parseInt(abstractFiguresMatch[1]) !== figureRefs) {
          errors.push(`FAIL: Abstract says ${abstractFiguresMatch[1]} figures, but found ${figureRefs} in source images. Use {{FIGURES}} placeholder.`);
      }
    }
  }

  // 4. GOST Rule: Mention before appearance (Hanging References)
  // Check that every table and figure is referenced in text before it appears.
  for (const file of mdFiles) {
    const content = fs.readFileSync(path.join(reportsDir, file), 'utf8');
    const lines = content.split('\n');
    let textSoFar = '';

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        
        // Match Table Title: "Таблица 1 – Название"
        const tableMatch = line.match(/^Таблица\s+(\d+)/i);
        if (tableMatch) {
            const tableNum = tableMatch[1];
            // Check if there's a reference to "таблиц* X" in the text preceding this line
            const refRegex = new RegExp(`(?:таблиц[а-я]{1,3}|таблица)\\s+${tableNum}`, 'i');
            if (!refRegex.test(textSoFar)) {
                errors.push(`GOST VIOLATION: [${file}:L${i+1}] Table ${tableNum} appears before being referenced in text. (Found: "${line}")`);
            }
        }

        // Match Figure Caption: "Рисунок 1 – Название"
        const figMatch = line.match(/^Рисунок\s+(\d+)/i);
        if (figMatch) {
            const figNum = figMatch[1];
            // Check if there's a reference to "рисунк* X" in the text preceding this line
            const refRegex = new RegExp(`(?:рисунк[а-я]{1,3}|рисунок)\\s+${figNum}`, 'i');
            if (!refRegex.test(textSoFar)) {
                errors.push(`GOST VIOLATION: [${file}:L${i+1}] Figure ${figNum} appears before being referenced in text. (Found: "${line}")`);
            }
        }

        textSoFar += line + '\n';
    }
  }

  if (errors.length > 0) {
    console.error('\nRegression Tests Failed:');
    errors.forEach(e => console.error(e));
    process.exit(1);
  } else {
    console.log('All regression tests passed. No hanging references found.');
  }
}

runTests();
