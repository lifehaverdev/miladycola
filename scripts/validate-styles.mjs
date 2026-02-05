#!/usr/bin/env node
/**
 * validate-styles.mjs
 *
 * Compares computed styles between app-colasseum and miladycolav4.
 * Usage: node scripts/validate-styles.mjs
 *
 * Prerequisites:
 *   - Both apps running (app-colasseum :3000, miladycolav4 :5173)
 *   - puppeteer installed (npm i -D puppeteer)
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const APP_COLASSEUM_URL = process.env.COLASSEUM_URL || 'http://localhost:3000';
const MILADYCOLAV4_URL = process.env.MILADYV4_URL || 'http://localhost:5173';

async function loadTargets() {
  const targetsPath = join(__dirname, 'style-targets.json');
  const content = await readFile(targetsPath, 'utf-8');
  return JSON.parse(content);
}

async function getComputedStyles(page, selector, properties) {
  return page.evaluate(
    (sel, props) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const styles = window.getComputedStyle(el);
      const result = {};
      for (const prop of props) {
        result[prop] = styles.getPropertyValue(prop);
      }
      return result;
    },
    selector,
    properties
  );
}

function compareStyles(selector, source, target, properties) {
  const results = { selector, matches: [], mismatches: [], missing: false };

  if (!source) {
    results.missing = 'source';
    return results;
  }
  if (!target) {
    results.missing = 'target';
    return results;
  }

  for (const prop of properties) {
    const sourceVal = source[prop];
    const targetVal = target[prop];
    if (sourceVal === targetVal) {
      results.matches.push({ property: prop, value: sourceVal });
    } else {
      results.mismatches.push({ property: prop, source: sourceVal, target: targetVal });
    }
  }

  return results;
}

function printResults(allResults) {
  let totalMatches = 0;
  let totalMismatches = 0;

  console.log('\n=== Style Comparison Report ===\n');

  for (const result of allResults) {
    console.log(`Comparing: ${result.selector}`);

    if (result.missing === 'source') {
      console.log('  ⚠ Element not found in app-colasseum\n');
      continue;
    }
    if (result.missing === 'target') {
      console.log('  ⚠ Element not found in miladycolav4\n');
      continue;
    }

    for (const match of result.matches) {
      console.log(`  ✓ ${match.property}: ${match.value}`);
      totalMatches++;
    }

    for (const mismatch of result.mismatches) {
      console.log(`  ✗ ${mismatch.property}:`);
      console.log(`      app-colasseum: ${mismatch.source}`);
      console.log(`      miladycolav4:  ${mismatch.target}`);
      totalMismatches++;
    }

    console.log('');
  }

  console.log('=== Summary ===');
  console.log(`Total properties checked: ${totalMatches + totalMismatches}`);
  console.log(`Matches: ${totalMatches}`);
  console.log(`Mismatches: ${totalMismatches}`);
  console.log('');

  return totalMismatches === 0;
}

async function main() {
  let puppeteer;
  try {
    puppeteer = await import('puppeteer');
  } catch {
    console.error('Error: puppeteer not installed. Run: npm i -D puppeteer');
    process.exit(1);
  }

  const { targets } = await loadTargets();
  const browser = await puppeteer.default.launch({ headless: 'new' });

  const [sourcePage, targetPage] = await Promise.all([
    browser.newPage(),
    browser.newPage(),
  ]);

  try {
    console.log(`Loading app-colasseum from ${APP_COLASSEUM_URL}...`);
    await sourcePage.goto(APP_COLASSEUM_URL, { waitUntil: 'networkidle0', timeout: 30000 });

    console.log(`Loading miladycolav4 from ${MILADYCOLAV4_URL}...`);
    await targetPage.goto(MILADYCOLAV4_URL, { waitUntil: 'networkidle0', timeout: 30000 });
  } catch (err) {
    console.error('Error loading pages:', err.message);
    console.error('Make sure both apps are running:');
    console.error('  - app-colasseum: npx serve app-colasseum -p 3000');
    console.error('  - miladycolav4:  npm run dev (in miladycolav4/)');
    await browser.close();
    process.exit(1);
  }

  const allResults = [];

  for (const target of targets) {
    const sourceStyles = await getComputedStyles(sourcePage, target.selector, target.properties);
    const targetStyles = await getComputedStyles(targetPage, target.selector, target.properties);
    const comparison = compareStyles(target.selector, sourceStyles, targetStyles, target.properties);
    allResults.push(comparison);
  }

  await browser.close();

  const success = printResults(allResults);
  process.exit(success ? 0 : 1);
}

main().catch((err) => {
  console.error('Validation failed:', err);
  process.exit(1);
});
