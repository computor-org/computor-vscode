/**
 * Local mirror of the backend `computor_types.course_git` DTOs for course-level
 * student repository provisioning.
 *
 * These are hand-written because the backend types are not yet emitted into
 * `src/types/generated/*`. When the backend regenerates the TypeScript
 * interfaces, replace these with the generated ones and update the imports.
 * Kept aligned field-for-field with the backend models on branch
 * `refactor/git-course-dependency` (`computor_types/course_git.py`).
 */

/** Student-repo backends a course can offer. */
export type StudentRepoMode = 'forgejo' | 'gitlab_managed' | 'gitlab_byo' | 'download';

/** The `student-template` a student repository is derived from. */
export interface GitTemplateRef {
  /** 'forgejo' | 'gitlab' */
  server_type: string;
  base_url: string;
  /** Repo/project reference of the template on the server. */
  repo?: string | null;
  /** Clone/web URL of the template. */
  clone_url?: string | null;
  default_branch: string;
}

/** `GET /user/courses/{course_id}/git` — what the course offers. */
export interface CourseGitDescriptor {
  course_id: string;
  /** Whether the course has a git binding at all. */
  configured: boolean;
  /** 'git' | 'download' */
  delivery?: string | null;
  /** Allowed student-repo backends, subset of StudentRepoMode. */
  student_repo_modes: string[];
  /** Template location; absent for pure-download or unconfigured courses. */
  template?: GitTemplateRef | null;
}

/**
 * `GET /user/courses/{course_id}/repository` — the student's repo for a course,
 * or `null` if none exists yet.
 */
export interface CourseMemberRepositoryGet {
  id: string;
  course_member_id: string;
  /** StudentRepoMode */
  mode: string;
  server_url?: string | null;
  repo_ref?: string | null;
  http_url?: string | null;
  ssh_url?: string | null;
  web_url?: string | null;
}

/**
 * `POST /user/courses/{course_id}/provision-repository` — Forgejo babysat fork.
 * Extends the repo record with a one-time clone credential.
 */
export interface StudentRepositoryProvisioned extends CourseMemberRepositoryGet {
  /**
   * One-time repo-scoped Forgejo PAT, rotated on every provision call and never
   * returned by `GET .../repository`. Null until the student has logged into
   * Forgejo once (account is created on first OIDC login) — re-call provision
   * after their first Forgejo sign-in to obtain it.
   */
  clone_token?: string | null;
  /** Forgejo username to pair with `clone_token`. */
  clone_username?: string | null;
}

/** Body for `POST /user/courses/{course_id}/register-repository` (BYO record). */
export interface CourseMemberRepositoryRegister {
  mode: StudentRepoMode;
  server_url?: string | null;
  repo_ref?: string | null;
  http_url?: string | null;
  ssh_url?: string | null;
  web_url?: string | null;
}

/** A git server in the registry (`GET /git-servers`) — never carries secrets. */
export interface GitServerGet {
  id: string;
  /** 'forgejo' | 'gitlab' */
  type: string;
  base_url: string;
  name?: string | null;
  managed: boolean;
  has_token: boolean;
  /** GitLab parent group id/path for managed provisioning (GitLab only). */
  parent_group_id?: string | null;
}

/** Body for `PUT /courses/{course_id}/git` — lecturer binding upsert. */
export interface CourseGitBindingUpsert {
  delivery?: 'git' | 'download';
  git_server_id?: string | null;
  template_repo?: string | null;
  template_url?: string | null;
  default_branch?: string | null;
  student_repo_modes?: string[];
}
