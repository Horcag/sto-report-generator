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
    
    // Check for "0.744" in plain text (not in math blocks or code)
    // This is a bit heuristic, but useful.
    const rawDots = content.match(/(?:\s|^)(\d+\.\d+)(?:\s|$)/g);
    if (rawDots) {
        // Just a warning for now as it's too aggressive
        // console.warn(`Warning: Found potential decimal dots in ${file}: ${rawDots.join(', ')}`);
    }
  }

  // 3. Verify Abstract Placeholders (Should remain as placeholders for post-build)
  const referat = fs.readFileSync(path.join(reportsDir, '01_referat.md'), 'utf8');
  if (!referat.includes('{{PAGES}}') || !referat.includes('{{FIGURES}}') || !referat.includes('{{TABLES}}') || !referat.includes('{{SOURCES}}')) {
    // If they are hardcoded, we want to know, but only if they don't match source
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

  if (errors.length > 0) {
    console.error('\nRegression Tests Failed:');
    errors.forEach(e => console.error(e));
    process.exit(1);
  } else {
    console.log('All regression tests passed.');
  }
}

runTests();
