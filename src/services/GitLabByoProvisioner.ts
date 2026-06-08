import * as vscode from 'vscode';
import { ApiKeyHttpClient } from '../http/ApiKeyHttpClient';
import { GitLabTokenManager } from './GitLabTokenManager';
import { extractOriginFromGitUrl } from '../utils/gitUrlHelpers';
import type { GitTemplateRef } from '../types/courseGit';

export interface GitLabForkResult {
  serverUrl: string;
  /** group/path of the created project. */
  repoRef: string;
  httpUrl: string;
  sshUrl?: string;
  webUrl?: string;
  /** The student's PAT, returned so the caller can authenticate the clone. */
  token: string;
  defaultBranch: string;
}

/**
 * GitLab "bring your own" provisioning (Mode B): fork the course's GitLab
 * student-template into a group the student designates, using the student's own
 * PAT. Same-instance native fork only — cross-instance (template on a different
 * server) clone-and-push is a later increment. All work is client-side against
 * the GitLab REST API; the backend only records the result afterwards.
 *
 * Returns `null` when the student cancels a prompt (PAT or group).
 */
export class GitLabByoProvisioner {
  private readonly tokenManager: GitLabTokenManager;

  constructor(context: vscode.ExtensionContext) {
    this.tokenManager = GitLabTokenManager.getInstance(context);
  }

  async forkTemplate(template: GitTemplateRef, courseSlug: string): Promise<GitLabForkResult | null> {
    if (!template.repo) {
      throw new Error('The course template has no GitLab project reference to fork.');
    }
    const gitlabUrl = (extractOriginFromGitUrl(template.base_url) || template.base_url).replace(/\/$/, '');

    const token = await this.tokenManager.ensureTokenForUrl(gitlabUrl);
    if (!token) { return null; }

    const gl = new ApiKeyHttpClient(gitlabUrl, token, 'PRIVATE-TOKEN', '', 20_000);

    // Identify the student (also confirms the PAT works) → username for the slug.
    const me = await gl.get<{ id: number; username: string }>('/api/v4/user');
    const username = me.data?.username;
    if (!username) {
      throw new Error('Could not read your GitLab account — check the token has the "api" scope.');
    }

    const groupInput = await vscode.window.showInputBox({
      title: 'GitLab group for your repository',
      prompt: 'Where to create your repo — group namespace path (e.g. me/computor) or numeric group id',
      placeHolder: 'me/computor',
      ignoreFocusOut: true,
      validateInput: (v) => (v && v.trim()) ? undefined : 'A group path or id is required'
    });
    if (!groupInput) { return null; }

    const group = await this.resolveGroup(gl, groupInput.trim());
    const repoSlug = this.sanitizeSlug(`${courseSlug}-${username}`);
    const repoRef = `${group.full_path}/${repoSlug}`;

    const project = await this.forkOrReuse(gl, String(template.repo), group.id, repoSlug, repoRef);
    await this.waitForImport(gl, project.id);

    const defaultBranch = template.default_branch || project.default_branch || 'main';
    await this.unprotectDefaultBranch(gl, project.id, defaultBranch);

    if (!project.http_url_to_repo) {
      throw new Error('GitLab did not return a clone URL for the new project.');
    }

    return {
      serverUrl: gitlabUrl,
      repoRef: project.path_with_namespace || repoRef,
      httpUrl: project.http_url_to_repo,
      sshUrl: project.ssh_url_to_repo,
      webUrl: project.web_url,
      token,
      defaultBranch
    };
  }

  private async resolveGroup(gl: ApiKeyHttpClient, input: string): Promise<{ id: number; full_path: string }> {
    try {
      // /groups/{id} accepts a numeric id or a URL-encoded full path.
      const res = await gl.get<{ id: number; full_path: string }>(`/api/v4/groups/${encodeURIComponent(input)}`);
      return { id: res.data.id, full_path: res.data.full_path };
    } catch (error: any) {
      // Distinguish "wrong group" from transient/auth failures so the student
      // isn't sent chasing a typo when the real cause is the network or token.
      const status = error?.status;
      if (status === 404) {
        throw new Error(`GitLab group "${input}" not found — check the path or numeric id.`);
      }
      if (status === 401 || status === 403) {
        throw new Error(`Your GitLab token can't access group "${input}" (it needs the "api" scope, and Maintainer/Owner on the group to create a repo there).`);
      }
      const detail = error?.response?.message || error?.message || 'unknown error';
      throw new Error(`Could not resolve GitLab group "${input}": ${detail}`);
    }
  }

  private async forkOrReuse(
    gl: ApiKeyHttpClient,
    templateRef: string,
    namespaceId: number,
    repoSlug: string,
    repoRef: string
  ): Promise<any> {
    try {
      const res = await gl.post<any>(`/api/v4/projects/${encodeURIComponent(templateRef)}/fork`, {
        namespace_id: namespaceId,
        path: repoSlug,
        name: repoSlug
      });
      return res.data;
    } catch (error: any) {
      const status = error?.status;
      const blob = JSON.stringify(error?.response ?? error?.message ?? '');
      if (status === 409 || /already (been )?taken|already exists/i.test(blob)) {
        // Partial-run recovery: a project at our slug already exists → reuse it
        // (idempotent). If we can't fetch it back (e.g. it lives at a different
        // path than our slug), give a clear, actionable message instead of a raw 404.
        try {
          const existing = await gl.get<any>(`/api/v4/projects/${encodeURIComponent(repoRef)}`);
          return existing.data;
        } catch {
          throw new Error(`A project named "${repoSlug}" already exists in that group but couldn't be reused automatically — remove it (or choose a different group) and try again.`);
        }
      }
      if (status === 403) {
        throw new Error('Your GitLab token cannot create a project in that group (needs Maintainer/Owner and the "api" scope).');
      }
      throw error;
    }
  }

  private async waitForImport(gl: ApiKeyHttpClient, projectId: number | string): Promise<void> {
    // A fork import runs asynchronously on GitLab; poll briefly so we don't clone
    // an empty repo. Best-effort — never block setup on the poll itself.
    for (let i = 0; i < 10; i++) {
      let status: string | undefined;
      try {
        const res = await gl.get<{ import_status?: string }>(`/api/v4/projects/${projectId}`);
        status = res.data?.import_status ?? undefined;
      } catch {
        return;
      }
      if (!status || status === 'finished' || status === 'none') { return; }
      if (status === 'failed') {
        console.warn('[GitLabByoProvisioner] Fork import reported failed');
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 1500));
    }
  }

  private async unprotectDefaultBranch(gl: ApiKeyHttpClient, projectId: number | string, branch: string): Promise<void> {
    try {
      await gl.delete(`/api/v4/projects/${projectId}/protected_branches/${encodeURIComponent(branch)}`);
    } catch {
      // Best-effort: the branch may not be protected, or the plan/permissions disallow it.
    }
  }

  private sanitizeSlug(value: string): string {
    return value
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, '-')
      .replace(/^[-.]+|[-.]+$/g, '')
      .slice(0, 100) || 'computor-repo';
  }
}
