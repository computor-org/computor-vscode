import * as fs from 'fs';
import * as path from 'path';
import { WorkspaceStructureManager } from './workspaceStructure';
import { readMetaYamlVersion } from './metaYamlHelpers';
import { normalizeSemVer } from './versionHelpers';

const METADATA_FILENAME = '.computor-example.json';
const WORKING_DIR = 'working';

export interface CheckoutMetadata {
  exampleId: string;
  repositoryId: string;
  directory: string;
  versionId: string;
  versionTag: string;
  versionNumber: number;
  checkedOutAt: string;
}

export interface CheckedOutVersion {
  versionTag: string;
  fullPath: string;
  isWorking: boolean;
  metadata: CheckoutMetadata;
  localVersion?: string;
}

export interface CheckedOutExampleGroup {
  directory: string;
  fullPath: string;
  versions: CheckedOutVersion[];
  workingVersion?: CheckedOutVersion;
}

export function writeCheckoutMetadata(dir: string, metadata: CheckoutMetadata): void {
  const metadataPath = path.join(dir, METADATA_FILENAME);
  fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), 'utf8');
}

export function readCheckoutMetadata(dir: string): CheckoutMetadata | undefined {
  const metadataPath = path.join(dir, METADATA_FILENAME);
  try {
    const raw = fs.readFileSync(metadataPath, 'utf8');
    return JSON.parse(raw) as CheckoutMetadata;
  } catch {
    return undefined;
  }
}

export function getWorkingPath(examplesDir: string, exampleDirectory: string): string {
  return path.join(examplesDir, exampleDirectory, WORKING_DIR);
}

export function getVersionPath(examplesDir: string, exampleDirectory: string, versionTag: string): string {
  return path.join(examplesDir, exampleDirectory, normalizeSemVer(versionTag));
}

export function snapshotWorkingToVersion(examplesDir: string, exampleDirectory: string, versionTag: string): string {
  const workingDir = getWorkingPath(examplesDir, exampleDirectory);
  const versionDir = getVersionPath(examplesDir, exampleDirectory, versionTag);

  if (fs.existsSync(versionDir)) {
    fs.rmSync(versionDir, { recursive: true, force: true });
  }

  fs.cpSync(workingDir, versionDir, { recursive: true });
  return versionDir;
}

export function scanCheckedOutExamples(): CheckedOutExampleGroup[] {
  let examplesDir: string;
  try {
    examplesDir = WorkspaceStructureManager.getInstance().getExamplesPath();
  } catch {
    return [];
  }

  if (!fs.existsSync(examplesDir)) { return []; }

  let topEntries: fs.Dirent[];
  try {
    topEntries = fs.readdirSync(examplesDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const groups: CheckedOutExampleGroup[] = [];

  for (const topEntry of topEntries) {
    if (!topEntry.isDirectory()) { continue; }

    const exampleDir = path.join(examplesDir, topEntry.name);
    const versions: CheckedOutVersion[] = [];
    let workingVersion: CheckedOutVersion | undefined;

    let subEntries: fs.Dirent[];
    try {
      subEntries = fs.readdirSync(exampleDir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const subEntry of subEntries) {
      if (!subEntry.isDirectory()) { continue; }

      const versionPath = path.join(exampleDir, subEntry.name);
      const metadata = readCheckoutMetadata(versionPath);
      if (!metadata) { continue; }

      const isWorking = subEntry.name === WORKING_DIR;
      const version: CheckedOutVersion = {
        versionTag: isWorking ? (readMetaYamlVersion(versionPath) || metadata.versionTag) : subEntry.name,
        fullPath: versionPath,
        isWorking,
        metadata,
        localVersion: readMetaYamlVersion(versionPath)
      };

      versions.push(version);
      if (isWorking) { workingVersion = version; }
    }

    if (versions.length === 0) { continue; }

    groups.push({
      directory: topEntry.name,
      fullPath: exampleDir,
      versions: versions.sort((a, b) => {
        if (a.isWorking) return -1;
        if (b.isWorking) return 1;
        return b.versionTag.localeCompare(a.versionTag);
      }),
      workingVersion
    });
  }

  return groups.sort((a, b) => a.directory.localeCompare(b.directory));
}
