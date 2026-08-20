export interface IssueReportCreated {
  /** Opaque identifier for this report, safe to show the reporter. */
  report_id: string;
  issue_number: number;
  /** Link to the created issue; null when the tracker is private. */
  issue_url?: string | null;
}

export interface IssueReportPayload {
  title: string;
  description: string;
  expected?: string;
  steps?: string;
  context: Record<string, unknown>;
}
