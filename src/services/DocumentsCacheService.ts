import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import type { DocumentList } from '../types/generated';

/** Identifies a documents bucket — `system` is global; the others require an id. */
export interface DocumentScope {
  scope: 'system' | 'organization' | 'course_family' | 'course';
  scopeId?: string | null;
}

export type DocumentSyncState =
  /** Local copy exists; mtime matches the server's last_modified. */
  | 'synced'
  /** Local copy exists; mtime is past the server's last_modified (user edited). */
  | 'modified'
  /** File only on disk — never uploaded. */
  | 'local-only'
  /** File only in the backend listing — not yet pulled. */
  | 'remote-only'
  /** Local copy lags the server; server published a newer version. */
  | 'remote-changed';

/** Joined view of one tree row — what `DocumentsTreeProvider` consumes. */
export interface DocumentEntry {
  /** Filename or directory name (no path). */
  name: string;
  /** Path inside the scope, including this entry. */
  relativePath: string;
  type: 'file' | 'directory';
  state: DocumentSyncState;
  /** Remote-side metadata; missing for local-only entries. */
  remote?: {
    etag: string;
    size?: number | null;
    lastModified: string;
  };
  /** Local-side metadata; missing for remote-only entries. */
  local?: {
    absPath: string;
    size: number;
    /** mtime of the on-disk file at classify time, in ms. */
    mtimeMs: number;
  };
}

/**
 * Owns the on-disk mirror under `<workspace>/.computor-data/documents/<scope>/<id|system>/...`
 * and the merge logic that turns a remote `DocumentList[]` plus the local
 * mirror into a list of `DocumentEntry`. There is no separate metadata
 * store — when we write/pull a file we stamp its mtime to the server's
 * `last_modified`, and `classifyEntries` reads that mtime back to derive
 * sync state.
 *
 * `.computor` (no `-data` suffix) is a marker FILE used by other parts of
 * the extension (LecturerRepositoryManager etc.), so we can't put a
 * directory at that path. `.computor-data/` reserves a sibling namespace.
 */
export class DocumentsCacheService {
  private static readonly MIRROR_DIR = path.join('.computor-data', 'documents');

  /** Compare two timestamps treating anything within ~1.5s as equal. The
   *  server typically reports last_modified at second precision while the
   *  filesystem stores nanoseconds, and rewriting the same bytes can shift
   *  the on-disk mtime by sub-second amounts; the slack absorbs that. */
  private static readonly EQUALITY_TOLERANCE_MS = 1500;

  /** Returns the workspace root, or undefined if no workspace is open. */
  private getWorkspaceRoot(): string | undefined {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  }

  /** Absolute path to the mirror directory for one scope bucket.
   *  System has no scope_id, so its files sit directly under
   *  `.computor-data/documents/system/`; the others get an extra
   *  `<scope_id>` segment. */
  private mirrorRoot(scope: DocumentScope): string | undefined {
    const root = this.getWorkspaceRoot();
    if (!root) { return undefined; }
    if (scope.scope === 'system') {
      return path.join(root, DocumentsCacheService.MIRROR_DIR, 'system');
    }
    const scopeKey = scope.scopeId || 'unknown';
    return path.join(root, DocumentsCacheService.MIRROR_DIR, scope.scope, scopeKey);
  }

  /** Joins a scope-relative path safely under the mirror root. */
  resolveLocalPath(scope: DocumentScope, relativePath: string): string | undefined {
    const root = this.mirrorRoot(scope);
    if (!root) { return undefined; }
    const normalized = relativePath.replace(/^\/+/, '');
    return path.join(root, normalized);
  }

  /** Persist freshly-pulled (or just-uploaded) bytes into the local mirror
   *  and stamp the file's mtime to the server's last_modified. Subsequent
   *  classifyEntries() calls compare against that mtime to decide synced /
   *  modified / remote-changed.
   *
   *  When `lastModified` is missing or unparsable the file is still written
   *  but its mtime falls to "now" — classify will then see mtime > server's
   *  last_modified and flag the row as `modified`. That's the safe default
   *  when we don't know better. */
  async writePulled(
    scope: DocumentScope,
    relativePath: string,
    bytes: Buffer,
    lastModified?: string
  ): Promise<void> {
    const localPath = this.resolveLocalPath(scope, relativePath);
    if (!localPath) { throw new Error('No workspace is open — cannot write document mirror.'); }
    await fs.promises.mkdir(path.dirname(localPath), { recursive: true });
    await fs.promises.writeFile(localPath, bytes);
    if (lastModified) {
      const stamp = new Date(lastModified);
      if (!isNaN(stamp.getTime())) {
        await fs.promises.utimes(localPath, stamp, stamp).catch(() => undefined);
      }
    }
  }

  /** Removes the local mirror copy (for "Discard local changes" or after a
   *  successful remote delete). */
  async removeLocal(scope: DocumentScope, relativePath: string): Promise<void> {
    const localPath = this.resolveLocalPath(scope, relativePath);
    if (localPath) {
      await fs.promises.rm(localPath, { force: true, recursive: true }).catch(() => undefined);
    }
  }

  /** Classify each remote entry against the local mirror, plus any orphan
   *  local files (not in the remote listing) as `local-only`. Caller passes
   *  the path of the directory whose contents `remote` describes. */
  async classifyEntries(
    scope: DocumentScope,
    parentPath: string,
    remote: DocumentList[]
  ): Promise<DocumentEntry[]> {
    const entries: DocumentEntry[] = [];
    const seenNames = new Set<string>();
    const parent = parentPath.replace(/^\/+/, '').replace(/\/+$/, '');

    for (const item of remote) {
      seenNames.add(item.name);
      const relativePath = parent ? `${parent}/${item.name}` : item.name;
      const localAbs = this.resolveLocalPath(scope, relativePath);
      const localStat = localAbs ? await fs.promises.stat(localAbs).catch(() => undefined) : undefined;

      let state: DocumentSyncState;
      let local: DocumentEntry['local'];

      if (item.type === 'directory') {
        // Directories don't carry sync state — treat as synced regardless of
        // whether the local mirror has an empty placeholder for them.
        state = 'synced';
      } else if (!localStat || !localStat.isFile()) {
        state = 'remote-only';
      } else {
        local = { absPath: localAbs!, size: localStat.size, mtimeMs: localStat.mtimeMs };
        const serverMs = Date.parse(item.last_modified);
        if (!isFinite(serverMs)) {
          // If we can't parse the server timestamp we have nothing to compare
          // against — treat the existence of the local file as "modified" so
          // the user can review/upload.
          state = 'modified';
        } else {
          const diff = localStat.mtimeMs - serverMs;
          if (Math.abs(diff) <= DocumentsCacheService.EQUALITY_TOLERANCE_MS) {
            state = 'synced';
          } else if (diff > 0) {
            state = 'modified';
          } else {
            state = 'remote-changed';
          }
        }
      }

      entries.push({
        name: item.name,
        relativePath,
        type: item.type,
        state,
        remote: { etag: item.etag, size: item.size ?? null, lastModified: item.last_modified },
        local
      });
    }

    // Local-only: anything on disk under this directory that the remote
    // listing didn't mention. Useful both for genuinely new files and for
    // files the user has staged for upload.
    const dirLocalAbs = this.resolveLocalPath(scope, parent);
    if (dirLocalAbs) {
      const dirEntries = await fs.promises.readdir(dirLocalAbs, { withFileTypes: true }).catch(() => undefined);
      if (dirEntries) {
        for (const dirent of dirEntries) {
          if (seenNames.has(dirent.name)) { continue; }
          const relativePath = parent ? `${parent}/${dirent.name}` : dirent.name;
          const localAbs = path.join(dirLocalAbs, dirent.name);
          const stat = await fs.promises.stat(localAbs).catch(() => undefined);
          if (!stat) { continue; }
          entries.push({
            name: dirent.name,
            relativePath,
            type: dirent.isDirectory() ? 'directory' : 'file',
            state: 'local-only',
            local: { absPath: localAbs, size: stat.size, mtimeMs: stat.mtimeMs }
          });
        }
      }
    }

    entries.sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === 'directory' ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });
    return entries;
  }

  /** Absolute path to the top-level mirror root (`<workspace>/.computor-data/documents`).
   *  Returns undefined when no workspace is open. Used for the "Reveal
   *  Documents Mirror" view-title command. */
  resolveMirrorRoot(): string | undefined {
    const root = this.getWorkspaceRoot();
    return root ? path.join(root, DocumentsCacheService.MIRROR_DIR) : undefined;
  }

  /** Walks `.computor-data/documents/<scopeType>/<scopeId>/...` and returns
   *  every (scopeType, scopeId) bucket that contains at least one file.
   *  Used by the global Upload All Pending. */
  async listScopesWithLocalFiles(): Promise<DocumentScope[]> {
    const root = this.resolveMirrorRoot();
    if (!root) { return []; }
    const out: DocumentScope[] = [];
    const scopeTypes = await fs.promises.readdir(root, { withFileTypes: true }).catch(() => undefined);
    if (!scopeTypes) { return out; }
    for (const scopeTypeDirent of scopeTypes) {
      if (!scopeTypeDirent.isDirectory()) { continue; }
      const scope = scopeTypeDirent.name as DocumentScope['scope'];
      if (scope !== 'system' && scope !== 'organization' && scope !== 'course_family' && scope !== 'course') {
        continue;
      }
      const scopeTypeRoot = path.join(root, scope);
      if (scope === 'system') {
        // System has no scope-id layer; its files sit directly under
        // `.computor-data/documents/system/`.
        const nested = await fs.promises.readdir(scopeTypeRoot).catch(() => []);
        if (nested.length > 0) {
          out.push({ scope: 'system', scopeId: null });
        }
        continue;
      }
      const idDirents = await fs.promises.readdir(scopeTypeRoot, { withFileTypes: true }).catch(() => []);
      for (const idDirent of idDirents) {
        if (!idDirent.isDirectory()) { continue; }
        // Quick non-empty check before claiming the bucket.
        const nested = await fs.promises.readdir(path.join(scopeTypeRoot, idDirent.name)).catch(() => []);
        if (nested.length === 0) { continue; }
        out.push({ scope, scopeId: idDirent.name });
      }
    }
    return out;
  }

  /** Walks the local mirror under a scope and returns every file. Used by
   *  Upload All Pending (per-scope variant) — the caller still has to ask
   *  the backend whether each file is `local-only` / `modified` to decide
   *  what to push. */
  async listAllLocalFiles(scope: DocumentScope): Promise<string[]> {
    const root = this.mirrorRoot(scope);
    if (!root) { return []; }
    const stack: string[] = [''];
    const result: string[] = [];
    while (stack.length > 0) {
      const rel = stack.pop()!;
      const abs = rel ? path.join(root, rel) : root;
      const dirents = await fs.promises.readdir(abs, { withFileTypes: true }).catch(() => undefined);
      if (!dirents) { continue; }
      for (const ent of dirents) {
        const childRel = rel ? `${rel}/${ent.name}` : ent.name;
        if (ent.isDirectory()) {
          stack.push(childRel);
        } else if (ent.isFile()) {
          result.push(childRel);
        }
      }
    }
    return result;
  }
}
