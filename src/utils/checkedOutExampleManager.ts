import * as fs from 'fs';
import * as path from 'path';
import { WorkspaceStructureManager } from './workspaceStructure';
import { readMetaYamlVersion } from './metaYamlHelpers';

const METADATA_FILENAME = '.computor-example.json';

export interface CheckoutMetadata {
  exampleId: string;
  repositoryId: string;
  versionId: string;
  versionTag: string;
  versionNumber: number;
  checkedOutAt: string;
}

export interface CheckedOutExample {
  directory: string;
  fullPath: string;
  metadata: CheckoutMetadata;
  localVersion?: string;
}

export function writeCheckoutMetadata(exampleDir: string, metadata: CheckoutMetadata): void {
  const metadataPath = path.join(exampleDir, METADATA_FILENAME);
  fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), 'utf8');
}

export function readCheckoutMetadata(exampleDir: string): CheckoutMetadata | undefined {
  const metadataPath = path.join(exampleDir, METADATA_FILENAME);
  try {
    const raw = fs.readFileSync(metadataPath, 'utf8');
    return JSON.parse(raw) as CheckoutMetadata;
  } catch {
    return undefined;
  }
}

export function scanCheckedOutExamples(): CheckedOutExample[] {
  let examplesDir: string;
  try {
    const wsManager = WorkspaceStructureManager.getInstance();
    examplesDir = wsManager.getExamplesPath();
  } catch {
    return [];
  }

  if (!fs.existsSync(examplesDir)) {
    return [];
  }

  const results: CheckedOutExample[] = [];

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(examplesDir, { withFileTypes: true });
  } catch {
    return [];
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) { continue; }
    const fullPath = path.join(examplesDir, entry.name);
    const metadata = readCheckoutMetadata(fullPath);
    if (!metadata) { continue; }

    results.push({
      directory: entry.name,
      fullPath,
      metadata,
      localVersion: readMetaYamlVersion(fullPath)
    });
  }

  return results.sort((a, b) => a.directory.localeCompare(b.directory));
}
