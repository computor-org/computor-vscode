export interface IssueReportCreated {
  /** Opaque identifier for this report, safe to show the reporter. */
  report_id: string;
  issue_number: number;
  /** Link to the created issue; null when the tracker is private. */
  issue_url?: string | null;
  /** False when a screenshot was sent but could not be stored. */
  screenshot_attached?: boolean;
  /** Support ticket the report became; absent on backends without tickets (2026.10). */
  ticket_id?: string | null;
  ticket_number?: number | null;
  /** Whether an attached log was stored; absent on backends without tickets. */
  log_attached?: boolean;
}

export interface IssueReportPayload {
  title: string;
  description: string;
  expected?: string;
  steps?: string;
  context: Record<string, unknown>;
  /** Sent as the `channel` form field; backends without tickets ignore it. */
  channel?: 'vscode';
}
