export interface IssueReportCreated {
  issue_number: number;
  issue_url: string;
  screenshot_url?: string | null;
}

export interface IssueReportPayload {
  title: string;
  description: string;
  expected?: string;
  steps?: string;
  context: Record<string, unknown>;
}
