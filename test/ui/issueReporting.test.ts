import { expect } from 'chai';
import * as vscode from 'vscode';

import { reportProblem } from '../../src/commands/reportProblem';
import {
  ISSUE_REPORTING_CONTEXT_KEY,
  ISSUE_REPORTING_TICKETS_CONTEXT_KEY,
  IssueReportStatusBarService,
  issueReportingMode
} from '../../src/ui/IssueReportStatusBarService';
import { MAX_LOG_BYTES, encodeLog } from '../../src/ui/webviews/IssueReportWebviewProvider';

/**
 * Feature detection for problem reports (computor-org/issues#520 step 2).
 *
 * The same Marketplace build talks to backend main (tickets) and to the
 * 2026.10 line on code.tugraz.at, whose `issue_reporting` has no `mode`.
 */
describe('issue reporting mode', () => {
  it('uses tickets when the server says so, without any GitHub fields', () => {
    expect(issueReportingMode({ enabled: true, mode: 'tickets' })).to.equal('tickets');
  });

  it('falls back to the GitHub path for the 2026.10 shape (no mode)', () => {
    expect(issueReportingMode({ enabled: true, visibility: 'private' })).to.equal('github');
    expect(issueReportingMode({ enabled: true, visibility: 'public', issues_url: 'https://x' }))
      .to.equal('github');
  });

  it('is off when disabled, absent, off, or an unknown future mode', () => {
    expect(issueReportingMode(undefined)).to.equal('off');
    expect(issueReportingMode(null)).to.equal('off');
    expect(issueReportingMode({ enabled: false })).to.equal('off');
    expect(issueReportingMode({ enabled: false, mode: 'tickets' })).to.equal('off');
    expect(issueReportingMode({ enabled: true, mode: 'off' })).to.equal('off');
    expect(issueReportingMode({ enabled: true, mode: 'later' as any })).to.equal('off');
  });
});

describe('issue reporting entry points', () => {
  let contexts: Record<string, unknown>;
  let opened: string[];
  let originalExecute: typeof vscode.commands.executeCommand;
  let originalOpen: typeof vscode.env.openExternal;

  beforeEach(() => {
    contexts = {};
    opened = [];
    originalExecute = vscode.commands.executeCommand;
    originalOpen = vscode.env.openExternal;
    (vscode.commands as any).executeCommand = async (cmd: string, key: string, value: unknown) => {
      if (cmd === 'setContext') {
        contexts[key] = value;
      }
    };
    (vscode.env as any).openExternal = async (uri: vscode.Uri) => {
      opened.push(String(uri));
      return true;
    };
  });

  afterEach(async () => {
    (vscode.commands as any).executeCommand = originalExecute;
    (vscode.env as any).openExternal = originalOpen;
  });

  it('sets both context keys from the capability', async () => {
    await IssueReportStatusBarService.apply({ enabled: true, mode: 'tickets' });
    expect(contexts[ISSUE_REPORTING_CONTEXT_KEY]).to.equal(true);
    expect(contexts[ISSUE_REPORTING_TICKETS_CONTEXT_KEY]).to.equal(true);

    await IssueReportStatusBarService.apply({ enabled: true, visibility: 'private' });
    expect(contexts[ISSUE_REPORTING_CONTEXT_KEY]).to.equal(true);
    expect(contexts[ISSUE_REPORTING_TICKETS_CONTEXT_KEY]).to.equal(false);

    await IssueReportStatusBarService.apply({ enabled: true, mode: 'off' });
    expect(contexts[ISSUE_REPORTING_CONTEXT_KEY]).to.equal(false);
  });

  it('keeps opening a public tracker on a 2026.10 backend', async () => {
    await IssueReportStatusBarService.apply({
      enabled: true,
      visibility: 'public',
      issues_url: 'https://github.com/example/tracker/issues'
    });
    await reportProblem({} as vscode.ExtensionContext, {} as any);
    expect(opened).to.deep.equal(['https://github.com/example/tracker/issues']);
  });

  it('never opens a GitHub link in tickets mode, even if one is present', async () => {
    await IssueReportStatusBarService.apply({
      enabled: true,
      mode: 'tickets',
      visibility: 'public',
      issues_url: 'https://github.com/example/tracker/issues'
    });
    try {
      await reportProblem({ extensionUri: vscode.Uri.file('/x') } as any, {} as any);
    } catch {
      // The webview itself is not available under the unit-test stub.
    }
    expect(opened).to.deep.equal([]);
  });
});

describe('log attachment', () => {
  it('sends nothing for an empty log and refuses one over the limit', () => {
    expect(encodeLog(undefined)).to.equal(undefined);
    expect(encodeLog({ text: '', fileName: 'a.log' })).to.equal(undefined);
    expect(encodeLog({ text: 'line\n', fileName: 'mine.txt' })).to.deep.include({ fileName: 'computor.log' });
    expect(() => encodeLog({ text: 'x'.repeat(MAX_LOG_BYTES + 1), fileName: 'a.log' })).to.throw();
  });
});
