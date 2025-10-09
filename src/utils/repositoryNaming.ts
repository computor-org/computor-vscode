import * as path from 'path';

export interface RepositoryContext {
  submissionRepo?: {
    full_path?: string;
    path?: string;
    clone_url?: string | null;
    url?: string | null;
    web_url?: string | null;
    provider_url?: string | null;
  };
  remoteUrl?: string;
  courseId?: string;
  memberId?: string;
  submissionGroupId?: string;
}

export function deriveRepositoryDirectoryName(context: RepositoryContext): string {
  const { submissionRepo, submissionGroupId, courseId, memberId, remoteUrl } = context;

  // Prefer full_path from repository (with dots instead of slashes)
  if (submissionRepo?.full_path) {
    return submissionRepo.full_path.replace(/\//g, '.');
  }

  // Fallback to submission group ID (UUID) as the directory name
  if (submissionGroupId) {
    return submissionGroupId;
  }

  // Fallback to member ID for tutor repositories
  if (memberId) {
    return memberId;
  }

  // Fallback to course ID for lecturer repositories
  if (courseId) {
    return courseId;
  }

  // Last resort: derive from repository info
  const candidates: Array<string | undefined> = [
    repoNameFromSubmissionRepository(submissionRepo),
    repoNameFromUrl(remoteUrl)
  ];

  for (const candidate of candidates) {
    const slug = slugify(candidate);
    if (slug) {
      return slug;
    }
  }

  return 'repository';
}

export function buildStudentRepoRoot(workspaceRoot: string, repoName: string): string {
  return path.join(workspaceRoot, 'student', repoName);
}

export function buildReviewRepoRoot(workspaceRoot: string, repoName: string): string {
  return path.join(workspaceRoot, 'review', 'repositories', repoName);
}

export function buildReferenceRepoRoot(workspaceRoot: string, repoName: string): string {
  return path.join(workspaceRoot, 'reference', repoName);
}

export function slugify(value?: string | null): string | undefined {
  if (!value) {
    return undefined;
  }
  const slug = value
    .toString()
    .trim()
    .replace(/\.git$/, '')
    .replace(/[^a-zA-Z0-9-_]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();

  return slug || undefined;
}

function repoNameFromSubmissionRepository(repo?: RepositoryContext['submissionRepo']): string | undefined {
  if (!repo) {
    return undefined;
  }

  if (typeof repo.full_path === 'string' && repo.full_path.length > 0) {
    const parts = repo.full_path.split('/').filter(Boolean);
    const last = parts.pop();
    const slug = slugify(last);
    if (slug) {
      return slug;
    }
  }

  if (typeof repo.path === 'string' && repo.path.length > 0) {
    const slug = slugify(repo.path);
    if (slug) {
      return slug;
    }
  }

  return undefined;
}

function repoNameFromUrl(remoteUrl?: string): string | undefined {
  if (!remoteUrl) {
    return undefined;
  }

  try {
    const url = new URL(remoteUrl);
    const pathname = url.pathname;
    const segments = pathname.split('/').filter(Boolean);
    const last = segments.pop();
    const slug = slugify(last ? last.replace(/\.git$/, '') : undefined);
    if (slug) {
      return slug;
    }
  } catch {
    const parts = remoteUrl.split('/');
    const last = parts.pop();
    const slug = slugify(last ? last.replace(/\.git$/, '') : undefined);
    if (slug) {
      return slug;
    }
  }

  return undefined;
}
