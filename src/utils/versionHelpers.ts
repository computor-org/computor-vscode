export interface SemVer {
  major: number;
  minor: number;
  patch: number;
}

export function parseSemVer(versionTag: string): SemVer {
  const cleaned = versionTag.replace(/^v/i, '');
  const parts = cleaned.split('.').map(Number);
  return {
    major: parts[0] || 0,
    minor: parts[1] || 0,
    patch: parts[2] || 0
  };
}

export function formatSemVer(version: SemVer): string {
  return `${version.major}.${version.minor}.${version.patch}`;
}

export function normalizeSemVer(versionTag: string): string {
  return formatSemVer(parseSemVer(versionTag));
}

export type BumpPart = 'major' | 'minor' | 'patch';

export function bumpVersion(versionTag: string, part: BumpPart): string {
  const version = parseSemVer(versionTag);
  switch (part) {
    case 'major':
      return formatSemVer({ major: version.major + 1, minor: 0, patch: 0 });
    case 'minor':
      return formatSemVer({ major: version.major, minor: version.minor + 1, patch: 0 });
    case 'patch':
      return formatSemVer({ major: version.major, minor: version.minor, patch: version.patch + 1 });
  }
}
