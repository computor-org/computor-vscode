import * as fs from 'fs';
import * as path from 'path';
import { normalizeSemVer } from './versionHelpers';

export interface MetaYamlData {
  title?: string;
  identifier?: string;
  slug?: string;
  directory?: string;
  version?: string;
  category?: string;
  tags?: string[];
  description?: string;
  testDependencies?: Array<string | { slug: string; version?: string }>;
  [key: string]: unknown;
}

export function readMetaYaml(exampleDir: string): MetaYamlData | undefined {
  const metaPath = path.join(exampleDir, 'meta.yaml');
  if (!fs.existsSync(metaPath)) {
    return undefined;
  }
  // Use dynamic import to avoid loading yaml at module level
  const yaml = require('js-yaml');
  const content = fs.readFileSync(metaPath, 'utf8');
  return yaml.load(content) as MetaYamlData;
}

export function readMetaYamlVersion(exampleDir: string): string | undefined {
  const data = readMetaYaml(exampleDir);
  return data?.version ?? undefined;
}

export function updateMetaYamlVersion(exampleDir: string, newVersion: string): void {
  const metaPath = path.join(exampleDir, 'meta.yaml');
  if (!fs.existsSync(metaPath)) {
    throw new Error(`meta.yaml not found in ${exampleDir}`);
  }
  const content = fs.readFileSync(metaPath, 'utf8');
  const normalized = normalizeSemVer(newVersion);

  // Preserve YAML formatting by doing a regex replacement on the version line
  const versionPattern = /^(version\s*:\s*)(["']?).*?\2\s*$/m;
  let updated: string;
  if (versionPattern.test(content)) {
    updated = content.replace(versionPattern, `$1"${normalized}"`);
  } else {
    // Append version field if missing
    updated = content.trimEnd() + `\nversion: "${normalized}"\n`;
  }

  fs.writeFileSync(metaPath, updated, 'utf8');
}
