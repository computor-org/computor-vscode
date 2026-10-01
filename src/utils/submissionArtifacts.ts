/**
 * Ordering helpers for submission artifacts.
 *
 * Artifacts are identified - and stored on disk - by id, so neither the order
 * `readdir` hands their directories back nor the order the API lists them says
 * anything about which submission is the most recent one. Every "latest
 * submission" decision has to go through the upload date.
 */

/** One artifact directory under `review/submissions/<group>/`. */
export interface DownloadedSubmission {
  /** Artifact id, i.e. the directory name. */
  id: string;
  /** When it was written locally; the tie-breaker when the API is unreachable. */
  downloadedAt: number;
}

/**
 * When the server recorded an artifact, as a sortable number.
 *
 * Anything missing or unparseable sorts oldest rather than turning the
 * comparison into NaN, which leaves a sort free to return any order at all.
 */
export function submissionArtifactTime(artifact: any): number {
  const stamp = artifact?.uploaded_at || artifact?.created_at;
  const time = stamp ? new Date(stamp).getTime() : NaN;
  return Number.isFinite(time) ? time : 0;
}

/** The same artifacts, newest first. Does not touch the array it was given. */
export function sortSubmissionArtifactsByRecency<T>(artifacts: readonly T[]): T[] {
  return [...artifacts].sort((a, b) => submissionArtifactTime(b) - submissionArtifactTime(a));
}

/**
 * Which downloaded artifact is the student's latest submission.
 *
 * The server's upload dates decide it. `downloadedAt` only breaks the tie when
 * the artifact list is unavailable (offline) or has nothing to say about the
 * directories on disk - "whichever we fetched last" beats picking whichever id
 * happens to sort last.
 */
export function pickLatestSubmissionArtifactId(
  downloaded: readonly DownloadedSubmission[],
  artifacts: readonly any[] | undefined
): string | undefined {
  if (downloaded.length === 0) {
    return undefined;
  }

  const onDisk = new Set(downloaded.map(entry => entry.id));
  const listed = (artifacts ?? []).filter(artifact => onDisk.has(String(artifact?.id)));
  const newestListed = sortSubmissionArtifactsByRecency(listed)[0];
  if (newestListed) {
    return String(newestListed.id);
  }

  return [...downloaded].sort((a, b) => b.downloadedAt - a.downloadedAt)[0]?.id;
}
