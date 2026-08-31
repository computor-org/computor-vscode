#!/usr/bin/env node
/**
 * Verifies that every webview asset referenced from src/ actually exists.
 *
 * Why this exists: renderWebviewPage() inlines assets by reading them off disk
 * (src/ui/webviews/shared/webviewPage.ts), and its readAsset() swallows errors
 * with a bare catch. A mistyped path therefore produces no error at all — the
 * fallback emits a <link>/<script src> to a file that isn't there and the
 * webview renders unstyled or dead. Nothing else catches it: webview-ui/ is
 * outside the TypeScript program, is not linted, and has no test coverage.
 *
 * Checks:
 *   1. every string in a cssFiles/scriptFiles array resolves under webview-ui/
 *   2. every such string is folder-qualified (guards against a file drifting
 *      back to the flat layout)
 *   3. reports webview-ui files nothing references (warning only)
 *
 * Usage: node scripts/check-webview-assets.js
 */

const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const webviewRoot = path.join(repoRoot, 'webview-ui');

const IGNORED_DIRS = new Set(['node_modules', '.git', 'dist', 'out']);

function walk(dir, test, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (IGNORED_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, test, out);
    else if (test(entry.name)) out.push(full);
  }
  return out;
}

/** Every asset path referenced from the extension host, with its source location. */
function collectReferences() {
  const refs = [];
  const arrayRe = /\b(?:cssFiles|scriptFiles)\s*:\s*\[([^\]]*)\]/g;
  const literalRe = /['"]([^'"]+\.(?:css|js))['"]/g;

  for (const file of walk(path.join(repoRoot, 'src'), (n) => n.endsWith('.ts'))) {
    const source = fs.readFileSync(file, 'utf8');
    const lineOf = (index) => source.slice(0, index).split('\n').length;

    for (const match of source.matchAll(arrayRe)) {
      const listStart = match.index + match[0].indexOf('[');
      for (const lit of match[1].matchAll(literalRe)) {
        refs.push({
          asset: lit[1],
          file: path.relative(repoRoot, file),
          line: lineOf(listStart + lit.index)
        });
      }
    }
  }

  // base.css / base.js are prepended by renderWebviewPage rather than passed in,
  // so they never appear in a cssFiles/scriptFiles array.
  const pageFile = path.join(repoRoot, 'src/ui/webviews/shared/webviewPage.ts');
  const pageSource = fs.readFileSync(pageFile, 'utf8');
  for (const match of pageSource.matchAll(
    /\[\s*(['"])([^'"]+\.(?:css|js))\1\s*,\s*\.\.\.\(options\./g
  )) {
    refs.push({
      asset: match[2],
      file: path.relative(repoRoot, pageFile),
      line: pageSource.slice(0, match.index).split('\n').length
    });
  }

  return refs;
}

const references = collectReferences();
const errors = [];
const referenced = new Set();

for (const ref of references) {
  referenced.add(ref.asset);
  const where = `${ref.file}:${ref.line}`;

  if (!fs.existsSync(path.join(webviewRoot, ref.asset))) {
    errors.push(`${where}\n    missing: webview-ui/${ref.asset}`);
    continue;
  }
  if (!ref.asset.includes('/')) {
    errors.push(
      `${where}\n    not folder-qualified: '${ref.asset}' — assets live in webview-ui/<group>/`
    );
  }
}

// Loaded by the extension host with fs + path.join rather than through a
// scriptFiles array: the PDF viewer inlines the worker source and starts it
// from a blob URL (#361), so no array literal ever names it.
referenced.add('vendor/pdf.worker.min.js');

const allAssets = walk(webviewRoot, (n) => /\.(css|js)$/.test(n)).map((f) =>
  path.relative(webviewRoot, f)
);
const orphans = allAssets.filter((a) => !referenced.has(a));

if (errors.length > 0) {
  console.error(`check-webview-assets: ${errors.length} problem(s)\n`);
  for (const error of errors) console.error(`  ${error}\n`);
  process.exit(1);
}

console.log(
  `check-webview-assets: OK — ${references.length} references across ${allAssets.length} assets`
);
if (orphans.length > 0) {
  console.log(`\n  ${orphans.length} unreferenced file(s):`);
  for (const orphan of orphans) console.log(`    webview-ui/${orphan}`);
}
