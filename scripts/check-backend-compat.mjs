#!/usr/bin/env node
/**
 * Backend compatibility guard (computor-org/issues#520 step 2).
 *
 * One Marketplace build serves every live Computor deployment, including the
 * semester line still running an older backend (release/2026.10 on
 * code.tugraz.at). This check fails when the extension uses an API path, or
 * relies on a response field, that such a backend does not provide, unless
 * the code feature-detects it.
 *
 * Inputs: compat/lines.json lists the live backend lines and their contract
 * snapshots (compat/backend-<line>.json, produced from that backend's own
 * OpenAPI by scripts/compat/dump-backend-contract.py).
 *
 * Rules, checked with the TypeScript compiler on src/:
 *
 * 1. Paths. Every endpoint the extension calls (HttpClient get/getBuffer/post/
 *    put/patch/delete/deleteWithBody with a literal path, and `${base…}/path`
 *    templates for fetch/new URL) must exist with that method in each live
 *    contract. A call to a newer endpoint is allowed only inside a function
 *    whose JSDoc carries `@backendCompat <how it is feature-detected>`; the
 *    callers of such a function must check the capability first.
 * 2. Response fields. For a call with a response type argument (`get<T>`),
 *    every property of T, recursively, must either exist in the live line's
 *    response schema or be optional in T. With `strict` on, an optional field
 *    cannot be used without handling its absence, which is the feature
 *    detection for fields.
 *
 * Known gaps: compat/known-gaps.json lists findings that predate this guard
 * and are not specific to an old line (the endpoint or field is missing on
 * backend main too, i.e. dead or mistyped code). They are reported, not
 * failed. The list may only shrink: an entry that no longer occurs fails the
 * check so it gets removed.
 *
 * Usage: node scripts/check-backend-compat.mjs [--verbose]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const verbose = process.argv.includes('--verbose');

const HTTP_METHODS = {
  get: 'GET',
  getBuffer: 'GET',
  post: 'POST',
  put: 'PUT',
  patch: 'PATCH',
  delete: 'DELETE',
  deleteWithBody: 'DELETE'
};
const COMPAT_TAG = 'backendCompat';
// Files that build raw `${baseUrl}/…` backend URLs for fetch/new URL. Other
// files use such templates for GitLab/Forgejo hosts, which are not the backend.
const RAW_BACKEND_FILES = new Set([
  'src/http/BearerTokenHttpClient.ts',
  'src/services/ExtensionUpdateService.ts',
  'src/services/BackendConnectionService.ts'
]);
const SPAN = '\u0000';

// ---------------------------------------------------------------- contract

function loadLines() {
  const file = path.join(root, 'compat', 'lines.json');
  let lines = JSON.parse(fs.readFileSync(file, 'utf8')).lines || [];
  const override = process.env.COMPAT_CONTRACT;
  if (override) {
    // Ad-hoc comparison, e.g. against a backend main dump.
    lines = [{ line: path.basename(override), branch: override, contract: path.relative(root, path.resolve(override)) }];
  }
  return lines.map((line) => {
    const contract = JSON.parse(fs.readFileSync(path.join(root, line.contract), 'utf8'));
    const matchers = Object.entries(contract.paths).map(([p, methods]) => ({
      path: p,
      methods,
      segments: p.split('/').filter(Boolean)
    }));
    return { ...line, contract, matchers };
  });
}

/** Does a contract path (with {param} segments) accept this call path? */
function segmentMatches(pattern, actual) {
  if (/^\{[^}]+\}$/.test(pattern)) {
    return actual.length > 0;
  }
  if (!actual.includes(SPAN)) {
    return pattern === actual;
  }
  // A literal with interpolations: each span stands for any text.
  const re = new RegExp(
    '^' + actual.split(SPAN).map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$'
  );
  return re.test(pattern);
}

function findOperations(line, rawPath) {
  // The query string is not part of the route.
  const callPath = rawPath.split('?')[0];
  const variants = new Set([callPath]);
  // A trailing interpolation glued to the last segment is usually a query
  // string (`/courses${query}`); also try without it.
  if (callPath.endsWith(SPAN) && !callPath.endsWith('/' + SPAN)) {
    variants.add(callPath.slice(0, -1));
  }
  const found = [];
  for (const variant of variants) {
    const segments = variant.split('/').filter(Boolean);
    for (const m of line.matchers) {
      if (m.segments.length !== segments.length) {
        continue;
      }
      if (m.segments.every((s, i) => segmentMatches(s, segments[i]))) {
        found.push(m);
      }
    }
  }
  // Prefer literal matches over parameter matches (/courses/mine vs /courses/{id}).
  found.sort((a, b) => b.path.split('{').length - a.path.split('{').length).reverse();
  return found;
}

function resolveRef(contract, schema) {
  let s = schema;
  const seen = new Set();
  while (s && s.$ref) {
    if (seen.has(s.$ref)) {
      return undefined;
    }
    seen.add(s.$ref);
    s = contract.schemas[s.$ref.replace('#/components/schemas/', '')];
  }
  return s;
}

/** The non-null alternatives of a schema, with references resolved. */
function variants(contract, schema) {
  const s = resolveRef(contract, schema);
  if (!s) {
    return [];
  }
  const alts = s.anyOf || s.oneOf;
  if (alts) {
    return alts.flatMap((a) => variants(contract, a)).filter((a) => a.type !== 'null');
  }
  if (s.allOf) {
    const merged = { type: 'object', properties: {} };
    for (const part of s.allOf.flatMap((a) => variants(contract, a))) {
      Object.assign(merged.properties, part.properties || {});
    }
    return [merged];
  }
  return [s];
}

// ---------------------------------------------------------------- source

function loadProgram() {
  const configPath = path.join(root, 'tsconfig.json');
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
  return ts.createProgram(parsed.fileNames, parsed.options);
}

/** Path text of a literal or template, with interpolations as SPAN; else undefined. */
function pathText(node, checker, depth = 0) {
  if (!node || depth > 3) {
    return undefined;
  }
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }
  if (ts.isTemplateExpression(node)) {
    let text = node.head.text;
    for (const span of node.templateSpans) {
      text += SPAN + span.literal.text;
    }
    return text;
  }
  if (ts.isIdentifier(node)) {
    // `const url = '/x/' + ...` style: follow a const initializer.
    const symbol = checker.getSymbolAtLocation(node);
    const decl = symbol?.valueDeclaration;
    if (decl && ts.isVariableDeclaration(decl) && decl.initializer &&
        (ts.getCombinedNodeFlags(decl) & ts.NodeFlags.Const)) {
      return pathText(decl.initializer, checker, depth + 1);
    }
  }
  return undefined;
}

/** `${baseUrl}/path…` → '/path…' when the first interpolation names a base URL. */
function baseUrlPath(node) {
  if (!ts.isTemplateExpression(node) || node.head.text !== '') {
    return undefined;
  }
  const first = node.templateSpans[0];
  if (!/base/i.test(first.expression.getText()) || !first.literal.text.startsWith('/')) {
    return undefined;
  }
  let text = first.literal.text;
  for (const span of node.templateSpans.slice(1)) {
    text += SPAN + span.literal.text;
  }
  return text;
}

function compatTag(node) {
  for (let n = node; n; n = n.parent) {
    if (ts.isFunctionLike(n) || ts.isVariableStatement(n) || ts.isPropertyDeclaration(n)) {
      const tags = ts.getJSDocTags(n).filter((t) => t.tagName.text === COMPAT_TAG);
      if (tags.length) {
        const comment = ts.getTextOfJSDocComment(tags[0].comment) || '';
        return comment.trim() || '(no reason given)';
      }
      if (ts.isVariableDeclarationList(n.parent ?? {})) {
        continue;
      }
    }
  }
  return undefined;
}

function isHttpClientReceiver(expr, checker) {
  const type = checker.getTypeAtLocation(expr);
  const names = [type.getSymbol()?.getName(), ...(type.getBaseTypes?.() || []).map((t) => t.getSymbol()?.getName())];
  let t = type;
  for (let i = 0; i < 4 && t; i++) {
    const base = t.getBaseTypes?.()?.[0];
    if (base) {
      names.push(base.getSymbol()?.getName());
    }
    t = base;
  }
  return names.some((n) => n && /HttpClient$/.test(n));
}

function collectCalls(program, checker) {
  const calls = [];
  for (const sf of program.getSourceFiles()) {
    const rel = path.relative(root, sf.fileName);
    if (sf.isDeclarationFile || !rel.startsWith('src' + path.sep)) {
      continue;
    }
    const visit = (node) => {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
        const name = node.expression.name.text;
        const method = HTTP_METHODS[name];
        if (method && node.arguments.length > 0 && isHttpClientReceiver(node.expression.expression, checker)) {
          const text = pathText(node.arguments[0], checker);
          const where = `${rel}:${sf.getLineAndCharacterOfPosition(node.getStart()).line + 1}`;
          if (text === undefined) {
            calls.push({ node, method, path: undefined, where, typeArg: node.typeArguments?.[0] });
          } else if (text.startsWith('/')) {
            calls.push({ node, method, path: text, where, typeArg: node.typeArguments?.[0] });
          }
        }
      }
      if (RAW_BACKEND_FILES.has(rel.split(path.sep).join('/')) && ts.isTemplateExpression(node)) {
        const text = baseUrlPath(node);
        if (text) {
          const where = `${rel}:${sf.getLineAndCharacterOfPosition(node.getStart()).line + 1}`;
          calls.push({ node, method: undefined, path: text, where });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return calls;
}

// ---------------------------------------------------------------- fields

function isOptional(symbol) {
  if (symbol.flags & ts.SymbolFlags.Optional) {
    return true;
  }
  return false;
}

function objectMembers(type) {
  // Strip null/undefined; keep object-ish members.
  const parts = type.isUnion() ? type.types : [type];
  return parts.filter((t) => !(t.flags & (ts.TypeFlags.Null | ts.TypeFlags.Undefined)));
}

function checkFields(checker, type, schema, contract, trail, problems, seen) {
  for (const t of objectMembers(type)) {
    const key = `${checker.typeToString(t)}|${JSON.stringify(schema)}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    const alts = variants(contract, schema);
    if (!alts.length) {
      continue;
    }
    if (checker.isArrayType(t)) {
      const element = checker.getTypeArguments(t)[0];
      const arraySchemas = alts.filter((a) => a.type === 'array' && a.items);
      for (const a of arraySchemas) {
        checkFields(checker, element, a.items, contract, `${trail}[]`, problems, seen);
      }
      continue;
    }
    if (!(t.flags & ts.TypeFlags.Object) || checker.getIndexInfosOfType(t).length) {
      continue;
    }
    const objectSchemas = alts.filter((a) => a.properties);
    if (!objectSchemas.length) {
      continue; // free-form object on the server side
    }
    for (const prop of checker.getPropertiesOfType(t)) {
      const name = prop.getName();
      const serverProps = objectSchemas.map((a) => a.properties[name]).filter(Boolean);
      if (!serverProps.length) {
        if (!isOptional(prop)) {
          problems.push(`${trail}.${name}`);
        }
        continue;
      }
      const decl = prop.valueDeclaration || prop.declarations?.[0];
      if (!decl) {
        continue;
      }
      const propType = checker.getTypeOfSymbolAtLocation(prop, decl);
      for (const sp of serverProps) {
        checkFields(checker, propType, sp, contract, `${trail}.${name}`, problems, seen);
      }
    }
  }
}

// ---------------------------------------------------------------- main

function main() {
  const lines = loadLines();
  const program = loadProgram();
  const checker = program.getTypeChecker();
  const calls = collectCalls(program, checker);
  const errors = [];
  const gated = [];
  const gapsFile = path.join(root, 'compat', 'known-gaps.json');
  const knownGaps = new Set(
    process.env.COMPAT_CONTRACT || !fs.existsSync(gapsFile)
      ? []
      : JSON.parse(fs.readFileSync(gapsFile, 'utf8')).gaps || []
  );
  const seenGaps = new Set();
  const known = [];
  const report = (key, message) => {
    if (knownGaps.has(key)) {
      seenGaps.add(key);
      known.push(message);
    } else {
      errors.push(`${message}\n      key: ${key}`);
    }
  };
  let checked = 0;
  let dynamic = 0;

  for (const call of calls) {
    if (call.path === undefined) {
      dynamic += 1;
      if (verbose) {
        console.log(`  dynamic path (not checked): ${call.where}`);
      }
      continue;
    }
    if (call.path === '/') {
      continue; // reachability probe of the server root
    }
    checked += 1;
    const tag = compatTag(call.node);
    const shown = call.path.split(SPAN).join('${…}');
    for (const line of lines) {
      const ops = findOperations(line, call.path).filter(
        (m) => call.method === undefined || m.methods[call.method]
      );
      if (!ops.length) {
        if (tag) {
          gated.push(`${call.where} ${call.method ?? 'ANY'} ${shown} (backend ${line.line}): ${tag}`);
        } else {
          report(
            `${line.line} ${call.method ?? 'ANY'} ${shown.split('?')[0]}`,
            `${call.where}: ${call.method ?? 'ANY'} ${shown} does not exist on backend ${line.line} ` +
              `(${line.branch}). Feature-detect it and mark the function @${COMPAT_TAG} <capability>.`
          );
        }
        continue;
      }
      if (!call.typeArg) {
        continue;
      }
      const response = ops[0].methods[call.method]?.response;
      if (!response) {
        continue;
      }
      const type = checker.getTypeFromTypeNode(call.typeArg);
      const problems = [];
      checkFields(checker, type, response, line.contract, checker.typeToString(type), problems, new Set());
      for (const p of problems) {
        report(
          `${line.line} ${call.method} ${shown.split('?')[0]} ${p}`,
          `${call.where}: ${call.method} ${shown} — field ${p} is required in the extension's type ` +
            `but missing on backend ${line.line} (${line.branch}). Make it optional and handle its absence.`
        );
      }
    }
  }

  console.log(
    `backend compat: ${checked} endpoint uses checked against ${lines.map((l) => l.line).join(', ')}; ` +
      `${gated.length} feature-gated, ${dynamic} with dynamic paths (not checkable).`
  );
  for (const g of gated) {
    console.log(`  gated: ${g}`);
  }
  if (known.length) {
    console.log(`  ${known.length} known gaps (compat/known-gaps.json, also absent on backend main):`);
    for (const k of known) {
      console.log(`    ${k}`);
    }
  }
  for (const key of knownGaps) {
    if (!seenGaps.has(key)) {
      errors.push(`compat/known-gaps.json: "${key}" no longer occurs; remove it from the list.`);
    }
  }
  if (errors.length) {
    console.error(`\n${errors.length} incompatibilities:`);
    for (const e of errors) {
      console.error(`  ${e}`);
    }
    process.exit(1);
  }
}

main();
