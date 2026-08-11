#!/usr/bin/env node
/**
 * Enforces the Computor design spec on webview-ui/.
 *
 * shared/base.css states the rules in its own header; nothing enforced them.
 * webview-ui/ is outside the TypeScript program, is not linted and has no test
 * coverage, so a drifting stylesheet fails silently — and "silently" here means
 * the view looks right in the theme you happen to be using and wrong in the
 * others, which is how it ships.
 *
 * Rules (all scoped to stylesheets other than shared/base.css):
 *
 *   1. No hardcoded colors. Colors come from --vscode-* through the semantic
 *      --c-* tokens. A literal hex is invisible against one theme background
 *      and unreadable against another.
 *   2. No raw px for spacing or radius — use --sp-* and --radius-*. Off-ladder
 *      values (14px, 18px) are how two panels end up almost aligned.
 *   3. No redefining a base primitive. A per-view stylesheet adds layout; if
 *      two views need the same primitive it belongs in base.css.
 *
 * Ratchet, not a wall: by default only files you changed are checked, so new
 * work is clean and the existing drift is fixed opportunistically. `--all`
 * prints the inventory without failing.
 *
 * Usage:
 *   node scripts/check-webview-styling.js          # changed files, exits 1 on violations
 *   node scripts/check-webview-styling.js --all    # full inventory, always exits 0
 *   node scripts/check-webview-styling.js <paths…>
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const WEBVIEW_ROOT = path.join(REPO_ROOT, 'webview-ui');
const BASE_CSS = path.join(WEBVIEW_ROOT, 'shared', 'base.css');
/*
 * The ratchet baseline: which ref "changed files" is measured against.
 *
 * Hardcoding one integration branch breaks on both sides of a release. Work
 * currently targets release/2026.10 while main trails it by ~185 commits, so
 * baselining on main marks most of webview-ui/ as changed and reports 82
 * inherited violations on a clean branch. Baselining on release/2026.10 instead
 * would then go stale the moment that branch merges into main and the next
 * release branch opens.
 *
 * So don't choose — measure. Take the candidate whose merge-base with HEAD is
 * the most recent commit: that is the closest common ancestor, i.e. the tightest
 * baseline, i.e. the fewest inherited findings. It self-corrects as branches
 * merge and as release lines are renamed, with no edit here.
 */
const BASE_CANDIDATES = ['release/2026.10', 'main', 'origin/release/2026.10', 'origin/main'];

function pickBaseRef() {
  if (process.env.COMPUTOR_BASE_REF) return process.env.COMPUTOR_BASE_REF;
  let best = null;
  let bestTs = -1;
  for (const ref of BASE_CANDIDATES) {
    const mb = sh(`git merge-base HEAD ${ref}`).trim();
    if (!mb) continue;
    const ts = parseInt(sh(`git show -s --format=%ct ${mb}`).trim(), 10);
    if (Number.isFinite(ts) && ts > bestTs) { bestTs = ts; best = ref; }
  }
  return best;
}

/** Directories whose contents are third-party and not ours to restyle. */
const IGNORED_DIRS = new Set(['node_modules', '.git', 'dist', 'out', 'vendor']);

const HEX = /#[0-9a-fA-F]{3,8}\b/g;
const RGB = /\brgba?\s*\(/g;
// A px value on a spacing or radius property. Longhands included; 0px and 1px
// are allowed (hairline borders and resets are not spacing decisions).
const PX_SPACING =
  /\b(margin|padding|gap|row-gap|column-gap|border-radius|inset|top|right|bottom|left)(-(top|right|bottom|left|start|end|block|inline))?\s*:\s*([^;{}]*?\b(?!0px|1px)\d{1,3}px)/g;

/** Primitives owned by base.css. Redefining one in a view stylesheet forks it. */
const BASE_PRIMITIVES = [
  'btn', 'badge', 'chip', 'tag', 'notice', 'section', 'page-root', 'table',
  'tabs', 'tab', 'tab-panel', 'empty-state', 'spinner', 'progress-track',
  'progress-fill', 'form-field', 'form-grid', 'form-actions', 'header',
  'status-badge', 'toolbar', 'stack', 'container',
];
/*
 * Flags a rule whose subject IS a base primitive — `.section {`, `.empty-state,`,
 * `.btn.danger {`, `.tab:hover {`. Deliberately does NOT flag a descendant
 * selector like `.form-field .field-error {`: scoping a view-specific class
 * inside a primitive is exactly the "layout only" thing view stylesheets are
 * for. Hence the whitespace distinction — `.name.x` and `.name:x` restyle the
 * primitive, `.name .x` restyles a child.
 */
const PRIMITIVE_RULE = new RegExp(
  `^\\s*\\.(${BASE_PRIMITIVES.join('|')})(?![\\w-])([:.]|\\s*[{,])`,
);

const OPT_OUT = 'design-spec: allow';

function sh(cmd) {
  try {
    return execSync(cmd, { cwd: REPO_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return '';
  }
}

function changedFiles() {
  const ref = pickBaseRef();
  let base = (ref ? sh(`git merge-base HEAD ${ref}`).trim() : '') || 'HEAD';
  const out = [
    sh(`git diff --name-only --diff-filter=ACM ${base}`),
    sh('git diff --name-only --diff-filter=ACM'),
    sh('git diff --name-only --diff-filter=ACM --cached'),
  ].join('\n');
  return [...new Set(out.split('\n').filter(Boolean))]
    .map((p) => path.resolve(REPO_ROOT, p))
    .filter((p) => p.endsWith('.css') && fs.existsSync(p));
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (IGNORED_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.css')) out.push(full);
  }
  return out;
}

/** base.css defines the tokens, so it is the one file allowed literal values. */
function isGoverned(file) {
  return file.startsWith(WEBVIEW_ROOT + path.sep) && path.resolve(file) !== BASE_CSS;
}

function scan(file) {
  const rel = path.relative(REPO_ROOT, file);
  const findings = [];
  const lines = fs.readFileSync(file, 'utf8').split('\n');

  lines.forEach((line, i) => {
    const prev = i > 0 ? lines[i - 1] : '';
    if (line.includes(OPT_OUT) || prev.includes(OPT_OUT)) return;
    // Skip pure comment lines — the rules are about declarations.
    if (/^\s*(\/\*|\*)/.test(line)) return;

    for (const m of line.matchAll(HEX)) {
      findings.push({ rel, line: i + 1, rule: 'hardcoded-color', detail: m[0] });
    }
    if (RGB.test(line)) {
      findings.push({ rel, line: i + 1, rule: 'hardcoded-color', detail: 'rgb()/rgba()' });
      RGB.lastIndex = 0;
    }
    for (const m of line.matchAll(PX_SPACING)) {
      findings.push({ rel, line: i + 1, rule: 'raw-px', detail: m[0].trim() });
    }
    if (PRIMITIVE_RULE.test(line)) {
      findings.push({
        rel, line: i + 1, rule: 'redefines-primitive', detail: line.trim().slice(0, 60),
      });
    }
  });

  return findings;
}

const ADVICE = {
  'hardcoded-color':
    'Use the --c-* semantic tokens (which resolve to --vscode-* theme colors). Literal colors break in other themes.',
  'raw-px': 'Use the --sp-* spacing scale and --radius-* radius scale.',
  'redefines-primitive':
    'That primitive belongs to shared/base.css. Add a layout class here, or extend base.css if every view needs it.',
};

function main() {
  const argv = process.argv.slice(2);
  const all = argv.includes('--all');
  // --count prints just the violation total. Used by the PostToolUse hook to
  // compare a file against its committed version, so an edit is judged on what
  // it *added* rather than on the drift it inherited.
  const countOnly = argv.includes('--count');
  const explicit = argv.filter((a) => !a.startsWith('--'));

  if (countOnly) {
    const targets = explicit.map((p) => path.resolve(p)).filter((p) => fs.existsSync(p));
    console.log(targets.flatMap(scan).length);
    return 0;
  }

  let files;
  if (explicit.length) {
    files = explicit.map((p) => path.resolve(p)).filter((p) => fs.existsSync(p));
  } else if (all) {
    files = walk(WEBVIEW_ROOT);
  } else {
    files = changedFiles();
  }

  files = files.filter(isGoverned);

  if (!files.length) {
    console.log('✅ check-webview-styling: no governed stylesheets to check.');
    return 0;
  }

  const findings = files.flatMap(scan);

  if (all) {
    const byRule = {};
    const byFile = {};
    for (const f of findings) {
      byRule[f.rule] = (byRule[f.rule] || 0) + 1;
      byFile[f.rel] = (byFile[f.rel] || 0) + 1;
    }
    console.log(`Design-spec inventory across ${files.length} stylesheets\n`);
    Object.entries(byRule)
      .sort((a, b) => b[1] - a[1])
      .forEach(([rule, n]) => console.log(`  ${String(n).padStart(5)}  ${rule}`));
    console.log('\nWorst files:');
    Object.entries(byFile)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .forEach(([file, n]) => console.log(`  ${String(n).padStart(5)}  ${file}`));
    console.log('\n(--all never fails; it is a report.)');
    return 0;
  }

  if (!findings.length) {
    console.log(`✅ check-webview-styling: ${files.length} changed stylesheet(s) clean.`);
    return 0;
  }

  console.log(`❌ check-webview-styling: ${findings.length} violation(s) in changed files\n`);
  const rules = new Set();
  for (const f of findings) {
    console.log(`  ${f.rel}:${f.line}  ${f.rule}  ${f.detail}`);
    rules.add(f.rule);
  }
  console.log();
  for (const rule of rules) console.log(`  · ${ADVICE[rule]}`);
  console.log(`\n  Escape hatch for a genuine one-off: add "${OPT_OUT} — reason" on the line or above it.`);
  console.log('  Full inventory: node scripts/check-webview-styling.js --all');
  return 1;
}

process.exit(main());
