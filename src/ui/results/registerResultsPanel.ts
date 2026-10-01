import * as vscode from 'vscode';
import { TestResultsPanelProvider, TestResultsTreeDataProvider } from '../panels/TestResultsPanel';
import { TestResultService } from '../../services/TestResultService';
import { ComputorApiService } from '../../services/ComputorApiService';
import { notify } from '../../utils/notify';
import { resolveResultPayload, resultCacheKey, resultScopeFor } from './resolveResultPayload';

/**
 * The bottom "Results" panel and every command that drives it.
 *
 * This must be registered for ALL authenticated users, not just students.
 * `package.json` contributes the panel unconditionally, and the tutor and
 * lecturer flows invoke `computor.results.*` and `computor.showTestResults`
 * too - the tutor context menu even offers "Show Test Results" directly. While
 * this lived inside the student-view setup, a tutor-only or lecturer-only
 * account got "command not found" (silently, because most call sites are
 * `void`-ed) and an always-visible panel with no provider behind it.
 */
export function registerResultsPanel(
  context: vscode.ExtensionContext,
  api: ComputorApiService,
  openResultArtifact: (resultId: string, artifactInfo: any) => Promise<void>
): vscode.Disposable[] {
  const disposables: vscode.Disposable[] = [];

  const panelProvider = new TestResultsPanelProvider(context.extensionUri);
  disposables.push(vscode.window.registerWebviewViewProvider(TestResultsPanelProvider.viewType, panelProvider));

  const resultsTree = new TestResultsTreeDataProvider([]);
  resultsTree.setPanelProvider(panelProvider);
  disposables.push(vscode.window.registerTreeDataProvider('computor.testResultsView', resultsTree));

  TestResultService.getInstance().setApiService(api);

  disposables.push(vscode.commands.registerCommand('computor.results.open', async (results: any, resultId?: string, artifacts?: any[]) => {
    try {
      if (resultId && artifacts && artifacts.length > 0) {
        resultsTree.setResultArtifacts(resultId, artifacts);
      } else {
        resultsTree.clearResultArtifacts();
      }
      resultsTree.refresh(results || {});
      await vscode.commands.executeCommand('computor.testResultsPanel.focus');
    } catch (e) { console.error(e); }
  }));

  disposables.push(vscode.commands.registerCommand('computor.results.panel.update', (item: any) => {
    resultsTree.setSelectedNodeId(item.id);
    panelProvider.showDetails(item);
  }));

  disposables.push(vscode.commands.registerCommand('computor.results.clear', () => {
    resultsTree.clearResultArtifacts();
    // refresh() resets the details view along with the tree.
    resultsTree.refresh({});
  }));

  disposables.push(vscode.commands.registerCommand('computor.results.artifact.open', async (resultId: string, artifactInfo: any) => {
    try {
      await openResultArtifact(resultId, artifactInfo);
    } catch (e) {
      console.error('Failed to open artifact:', e);
      notify.error(`Failed to open artifact: ${e instanceof Error ? e.message : String(e)}`);
    }
  }));

  disposables.push(vscode.commands.registerCommand('computor.showTestResults', async (item?: any, opts?: { silent?: boolean }) => {
    // `silent` is used when the panel is refreshed from a plain tree selection
    // or view-visibility change: no popups, and no yanking the whole sidebar
    // to the test-results container.
    const silent = opts?.silent === true;
    try {
      // Get course content ID from the item (student tree uses courseContent, tutor tree uses content)
      const itemContent = (item?.courseContent || item?.content) as any;
      const courseContentId = itemContent?.id;

      // Whose result this is decides which endpoint may answer. Resolving it
      // from the signed-in user regardless of the view showed a tutor their own
      // passing run in place of the student's (#389).
      const scope = resultScopeFor(item);
      const cacheKey = resultCacheKey(scope, courseContentId);

      // The backend returns the latest *finished* result across all commits, so
      // a prior run survives a workspace restart even though the in-memory tree
      // item may no longer carry it (issue #273).
      let { resultPayload, resultId, resultArtifacts } = await resolveResultPayload(
        api,
        scope,
        courseContentId,
        itemContent?.result
      );

      // Persist the latest result per course content so it survives a
      // workspace restart, and fall back to it when the backend has nothing to
      // return (e.g. the most recent run crashed and left no finished result).
      if (cacheKey) {
        if (resultPayload) {
          void context.workspaceState.update(cacheKey, { resultPayload, resultId, resultArtifacts });
        } else {
          const cached = context.workspaceState.get<any>(cacheKey);
          if (cached?.resultPayload) {
            resultPayload = cached.resultPayload;
            resultId = cached.resultId;
            resultArtifacts = cached.resultArtifacts;
          }
        }
      }

      if (resultPayload) {
        await vscode.commands.executeCommand('computor.results.open', resultPayload, resultId, resultArtifacts);
      } else {
        // Nothing to show — reflect the empty state rather than leaving a
        // previous assignment's results on screen.
        await vscode.commands.executeCommand('computor.results.clear');
      }

      if (!silent) {
        try {
          await vscode.commands.executeCommand('workbench.view.extension.computor-test-results');
        } catch (focusError) {
          console.warn('[ResultsPanel] Failed to focus test results view container:', focusError);
        }
      }

      try {
        await vscode.commands.executeCommand('computor.testResultsPanel.focus');
      } catch (panelError) {
        console.warn('[ResultsPanel] Failed to focus test results panel:', panelError);
      }

      if (!resultPayload && !silent) {
        notify.info('No stored test results yet. Run tests to generate new results.');
      }
    } catch (error) {
      console.error('[ResultsPanel] Failed to show test results:', error);
      if (!silent) {
        notify.error('Failed to open test results. Please run tests again.');
      }
    }
  }));

  return disposables;
}
