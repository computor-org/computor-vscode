import { expect } from 'chai';
import * as path from 'path';
import * as vscode from 'vscode';
import {
  TestResultsPanelProvider,
  TestResultsTreeDataProvider
} from '../../src/ui/panels/TestResultsPanel';

/**
 * The Result Details view shows the details of the entry selected in the
 * Result Tree — and nothing else. These tests pin the two ways the old
 * "render the whole result" behaviour went wrong: the render disappeared on
 * the first selection and could not be brought back (#280), and it survived a
 * later, passing run (#281).
 */

const extensionUri = vscode.Uri.file(path.resolve(__dirname, '..', '..'));

function fakeView() {
  const posted: any[] = [];
  let onMessage: ((message: any) => void) | undefined;
  const view = {
    visible: true,
    webview: {
      options: {},
      html: '',
      cspSource: 'vscode-webview://stub',
      asWebviewUri: (uri: any) => uri,
      postMessage: (message: any) => {
        posted.push(message);
        return Promise.resolve(true);
      },
      onDidReceiveMessage: (handler: (message: any) => void) => {
        onMessage = handler;
        return { dispose() {} };
      }
    },
    onDidDispose: () => ({ dispose() {} })
  };
  return {
    view: view as unknown as vscode.WebviewView,
    posted,
    send: (message: any) => onMessage?.(message),
    last: () => posted[posted.length - 1]?.data
  };
}

function resolvedPanel() {
  const provider = new TestResultsPanelProvider(extensionUri);
  const fake = fakeView();
  provider.resolveWebviewView(fake.view, {} as any, {} as any);
  return { provider, ...fake };
}

const failingRun = {
  type: 'python',
  timestamp: '2026-07-20T10:00:00Z',
  summary: { total: 2, passed: 1, failed: 1 },
  name: 'Assignment 1',
  tests: [
    { name: 'test_add', result: 'PASSED' },
    { name: 'test_divide', result: 'FAILED', resultMessage: 'ZeroDivisionError: division by zero' }
  ]
};

const passingRun = {
  type: 'python',
  timestamp: '2026-07-20T11:00:00Z',
  summary: { total: 2, passed: 2, failed: 0 },
  name: 'Assignment 1',
  tests: [
    { name: 'test_add', result: 'PASSED' },
    { name: 'test_divide', result: 'PASSED' }
  ]
};

describe('Result Details panel', () => {
  it('asks for a selection instead of re-rendering the whole result', () => {
    const { provider, last } = resolvedPanel();
    const tree = new TestResultsTreeDataProvider({});
    tree.setPanelProvider(provider);

    tree.refresh(failingRun);

    expect(last().body).to.contain('Select an entry in the Result Tree');
    // The tree next to it already lists every test; the panel must not.
    expect(last().body).to.not.contain('test_divide');
    expect(last().body).to.not.contain('ZeroDivisionError');
  });

  it('reports an empty state when no result is loaded', () => {
    const { provider, last } = resolvedPanel();
    const tree = new TestResultsTreeDataProvider({});
    tree.setPanelProvider(provider);

    tree.refresh({});

    expect(last().body).to.contain('No test results available');
  });

  it('shows the details of the selected entry only', () => {
    const { provider, last } = resolvedPanel();

    provider.showDetails({
      id: 'Assignment 1/test_divide',
      label: 'test_divide',
      passed: false,
      message: 'ZeroDivisionError: division by zero'
    });

    expect(last().label).to.equal('test_divide');
    expect(last().body).to.contain('Failed');
    expect(last().body).to.contain('ZeroDivisionError: division by zero');
    expect(last().body).to.not.contain('test_add');
  });

  it('escapes details coming from the test runner', () => {
    const { provider, last } = resolvedPanel();

    provider.showDetails({ id: 'x', label: 'x', message: '<img src=x onerror=alert(1)>' });

    expect(last().body).to.not.contain('<img');
    expect(last().body).to.contain('&lt;img');
  });

  it('re-sends the current details when the webview reloads (#280)', () => {
    const { provider, last, send } = resolvedPanel();

    provider.showDetails({ id: 'x', label: 'test_divide', message: 'boom' });
    // Collapsing and re-opening the view recreates the webview, which replays
    // the HTML captured at resolve time and drops anything posted meanwhile.
    send({ command: 'ready' });

    expect(last().label).to.equal('test_divide');
    expect(last().body).to.contain('boom');
  });

  it('drops the previous run\'s details when a new result arrives (#281)', () => {
    const { provider, last } = resolvedPanel();
    const tree = new TestResultsTreeDataProvider({});
    tree.setPanelProvider(provider);

    tree.refresh(failingRun);
    tree.setSelectedNodeId('Assignment 1/test_divide');
    provider.showDetails({
      id: 'Assignment 1/test_divide',
      label: 'test_divide',
      passed: false,
      message: 'ZeroDivisionError: division by zero'
    });
    expect(last().body).to.contain('ZeroDivisionError');

    tree.refresh(passingRun);

    expect(last().body).to.not.contain('ZeroDivisionError');
    expect(last().body).to.contain('Select an entry in the Result Tree');
  });

  it('keeps the selected entry when the same result is re-loaded', () => {
    const { provider, last } = resolvedPanel();
    const tree = new TestResultsTreeDataProvider({});
    tree.setPanelProvider(provider);

    tree.refresh(failingRun);
    tree.setSelectedNodeId('Assignment 1/test_divide');

    // Selecting the assignment in the tree, or the view becoming visible
    // again, re-opens the very same result; that must not reset the panel.
    tree.refresh(failingRun);

    expect(last().label).to.equal('test_divide');
    expect(last().body).to.contain('ZeroDivisionError');
  });
});

/**
 * Every worker container runs on UTC, but the testers disagree on how they say
 * so. computor-testing emits a real ISO 8601 instant; the MATLAB framework
 * (itp-matlab-testing, CodeAbilityTestOutput.m) emits a bare
 * "yyyy-MM-dd HH:mm:ss". `new Date()` reads an offset-less date-time as *local*
 * time, so MATLAB runs used to render UTC_OFFSET early — two hours behind in
 * CEST, one in CET.
 */
describe('Result Tree timestamp', () => {
  function rootDescription(result: any): string | undefined {
    const tree = new TestResultsTreeDataProvider({});
    tree.refresh(result);
    return tree.getChildren()[0]?.description;
  }

  // Fixed instant so the assertions do not depend on the current DST offset.
  const expectedLocal = (iso: string) => new Date(iso).toLocaleString();

  it('reads an offset-less MATLAB timestamp as UTC, not local time', () => {
    // Verbatim from a stored MATLAB result_json.
    const description = rootDescription({
      type: 'MATLAB',
      timestamp: '2026-08-10 07:12:00',
      tests: []
    });

    expect(description).to.equal(expectedLocal('2026-08-10T07:12:00Z'));
  });

  it('renders the fixed MATLAB framework output unchanged', () => {
    // What CodeAbilityTestOutput.m emits once it tags the zone, verified
    // against MATLAB R2025b. Both forms must land on the same wall clock.
    const legacy = rootDescription({ type: 'MATLAB', timestamp: '2026-08-10 07:12:00', tests: [] });
    const fixed = rootDescription({ type: 'MATLAB', timestamp: '2026-08-10T07:12:00Z', tests: [] });

    expect(fixed).to.equal(expectedLocal('2026-08-10T07:12:00Z'));
    expect(fixed).to.equal(legacy);
  });

  it('keeps the offset an ISO timestamp already carries', () => {
    const description = rootDescription({
      type: 'python',
      timestamp: '2026-07-28T20:26:29.140387+00:00',
      tests: []
    });

    expect(description).to.equal(expectedLocal('2026-07-28T20:26:29.140387Z'));
  });

  it('does not shift a timestamp that names a non-UTC offset', () => {
    const description = rootDescription({
      type: 'python',
      timestamp: '2026-08-10T09:12:00+02:00',
      tests: []
    });

    expect(description).to.equal(expectedLocal('2026-08-10T07:12:00Z'));
  });

  it('shows an unparseable timestamp verbatim rather than "Invalid Date"', () => {
    const description = rootDescription({
      type: 'MATLAB',
      timestamp: 'not a date',
      tests: []
    });

    expect(description).to.equal('not a date');
  });
});
