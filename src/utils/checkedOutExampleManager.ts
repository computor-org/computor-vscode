import * as fs from 'fs';
import * as path from 'path';
import { WorkspaceStructureManager } from './workspaceStructure';
import { readMetaYamlVersion } from './metaYamlHelpers';
import { normalizeSemVer } from './versionHelpers';

const METADATA_FILENAME = '.computor-example.json';

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
  return path.join(examplesDir, exampleDirectory);
}

export function getVersionPath(versionsDir: string, exampleDirectory: string, versionTag: string): string {
  return path.join(versionsDir, exampleDirectory, normalizeSemVer(versionTag));
}

export function snapshotWorkingToVersion(examplesDir: string, versionsDir: string, exampleDirectory: string, versionTag: string): string {
  const workingDir = getWorkingPath(examplesDir, exampleDirectory);
  const versionDir = getVersionPath(versionsDir, exampleDirectory, versionTag);

  if (fs.existsSync(versionDir)) {
    fs.rmSync(versionDir, { recursive: true, force: true });
  }

  fs.mkdirSync(path.dirname(versionDir), { recursive: true });
  fs.cpSync(workingDir, versionDir, { recursive: true });
  return versionDir;
}

export function scanCheckedOutExamples(): CheckedOutExampleGroup[] {
  let examplesDir: string;
  let versionsDir: string;
  try {
    const wsManager = WorkspaceStructureManager.getInstance();
    examplesDir = wsManager.getExamplesPath();
    versionsDir = wsManager.getExampleVersionsPath();
  } catch {
    return [];
  }

  const groupMap = new Map<string, { versions: CheckedOutVersion[]; workingVersion?: CheckedOutVersion; workingPath: string }>();

  // Scan working copies from examples/ (flat: examples/<identifier>/files)
  if (fs.existsSync(examplesDir)) {
    try {
      const entries = fs.readdirSync(examplesDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) { continue; }
        const workingPath = path.join(examplesDir, entry.name);
        const metadata = readCheckoutMetadata(workingPath);
        if (!metadata) { continue; }

        const version: CheckedOutVersion = {
          versionTag: readMetaYamlVersion(workingPath) || metadata.versionTag,
          fullPath: workingPath,
          isWorking: true,
          metadata,
          localVersion: readMetaYamlVersion(workingPath)
        };

        groupMap.set(entry.name, {
          versions: [version],
          workingVersion: version,
          workingPath: workingPath
        });
      }
    } catch {
      // examples dir not readable
    }
  }

  // Scan version snapshots from example_versions/<identifier>/<tag>/
  if (fs.existsSync(versionsDir)) {
    try {
      const identifierEntries = fs.readdirSync(versionsDir, { withFileTypes: true });
      for (const idEntry of identifierEntries) {
        if (!idEntry.isDirectory()) { continue; }

        const identifierPath = path.join(versionsDir, idEntry.name);
        let tagEntries: fs.Dirent[];
        try {
          tagEntries = fs.readdirSync(identifierPath, { withFileTypes: true });
        } catch {
          continue;
        }

        for (const tagEntry of tagEntries) {
          if (!tagEntry.isDirectory()) { continue; }

          const versionPath = path.join(identifierPath, tagEntry.name);
          const metadata = readCheckoutMetadata(versionPath);
          if (!metadata) { continue; }

          const version: CheckedOutVersion = {
            versionTag: tagEntry.name,
            fullPath: versionPath,
            isWorking: false,
            metadata,
            localVersion: readMetaYamlVersion(versionPath)
          };

          if (!groupMap.has(idEntry.name)) {
            groupMap.set(idEntry.name, {
              versions: [],
              workingPath: path.join(examplesDir, idEntry.name)
            });
          }
          groupMap.get(idEntry.name)!.versions.push(version);
        }
      }
    } catch {
      // versions dir not readable
    }
  }

  const groups: CheckedOutExampleGroup[] = [];
  for (const [directory, data] of groupMap) {
    if (data.versions.length === 0) { continue; }

    groups.push({
      directory,
      fullPath: data.workingPath,
      versions: data.versions.sort((a, b) => {
        if (a.isWorking) { return -1; }
        if (b.isWorking) { return 1; }
        return b.versionTag.localeCompare(a.versionTag);
      }),
      workingVersion: data.workingVersion
    });
  }

  return groups.sort((a, b) => a.directory.localeCompare(b.directory));
}
