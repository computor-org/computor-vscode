import { EXAMPLE_EXCLUDE_PATTERNS } from '../types/generated/constants';

/**
 * Check if a file or directory name should be excluded from example
 * packaging, uploading, syncing, or diffing.
 *
 * Supports exact name matches and glob-style wildcards (e.g., '*.pyc').
 */
export function shouldExcludeExampleEntry(name: string): boolean {
  for (const pattern of EXAMPLE_EXCLUDE_PATTERNS) {
    if (pattern.includes('*')) {
      const regex = new RegExp(
        '^' + pattern.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$'
      );
      if (regex.test(name)) { return true; }
    } else if (name === pattern) {
      return true;
    }
  }
  return false;
}
