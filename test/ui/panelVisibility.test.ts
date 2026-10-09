import { expect } from 'chai';
import * as path from 'path';
import * as vscode from 'vscode';
import { UiStateService } from '../../src/services/UiStateService';
import { MessagesInputPanelProvider } from '../../src/ui/panels/MessagesInputPanel';
import { CourseMemberCommentsInputPanelProvider } from '../../src/ui/panels/CourseMemberCommentsInputPanel';
import { TestResultsPanelProvider } from '../../src/ui/panels/TestResultsPanel';
import { registerResultsPanel } from '../../src/ui/results/registerResultsPanel';

const extensionUri = vscode.Uri.file(path.resolve(__dirname, '..', '..'));

function fakeView(visible = true) {
  const visibility = new vscode.EventEmitter<void>();
  const disposal = new vscode.EventEmitter<void>();
  const posted: unknown[] = [];
  const view = {
    visible,
    webview: {
      options: {},
      html: '',
      cspSource: 'vscode-webview://stub',
      asWebviewUri: (uri: vscode.Uri) => uri,
      postMessage: (message: unknown) => {
        posted.push(message);
        return Promise.resolve(true);
      },
      onDidReceiveMessage: () => ({ dispose() {} })
    },
    onDidChangeVisibility: visibility.event,
    onDidDispose: disposal.event,
    dispose: () => {
      disposal.fire();
      visibility.dispose();
      disposal.dispose();
    }
  };
  return {
    view,
    posted,
    setVisible: (next: boolean) => {
      view.visible = next;
      visibility.fire();
    }
  };
}

describe('bottom panel visibility', () => {
  let previousState: UiStateService | undefined;
  let uiState: UiStateService;

  beforeEach(() => {
    previousState = UiStateService.getInstanceOrUndefined();
    (UiStateService as any).instance = undefined;
    uiState = UiStateService.initialize({
      globalState: {
        get: () => ({ activeContainer: 'computor-tutor' }),
        update: async () => undefined
      }
    } as any);
  });

  afterEach(() => {
    (UiStateService as any).instance = previousState;
  });

  const panels = [
    {
      name: 'Messages',
      resolve: (view: vscode.WebviewView) => new MessagesInputPanelProvider(extensionUri, {} as any).resolveWebviewView(view),
      resendsState: true
    },
    {
      name: 'Comments',
      resolve: (view: vscode.WebviewView) => new CourseMemberCommentsInputPanelProvider(extensionUri, {} as any).resolveWebviewView(view),
      resendsState: true
    },
    {
      name: 'Result Details',
      resolve: (view: vscode.WebviewView) => new TestResultsPanelProvider(extensionUri).resolveWebviewView(view, {} as any, {} as any),
      resendsState: false
    }
  ];

  for (const panel of panels) {
    it(`counts ${panel.name} without a sidebar and releases it on hide or disposal`, () => {
      const fake = fakeView();
      panel.resolve(fake.view as unknown as vscode.WebviewView);
      expect(uiState.hasVisibleViews()).to.equal(true);

      const beforeHide = fake.posted.length;
      fake.setVisible(false);
      expect(uiState.hasVisibleViews()).to.equal(false);
      expect(fake.posted.length).to.equal(beforeHide);
      fake.setVisible(true);
      expect(uiState.hasVisibleViews()).to.equal(true);
      if (panel.resendsState) {
        expect(fake.posted.length).to.equal(beforeHide + 1);
      }

      fake.view.dispose();
      expect(uiState.hasVisibleViews()).to.equal(false);
      expect(uiState.getActiveContainer()).to.equal('computor-tutor');
    });
  }

  it('keeps Results visible while either the tree or details remains visible', () => {
    const tree = fakeView();
    const details = fakeView();
    const originalCreateTreeView = vscode.window.createTreeView;
    const originalRegisterWebview = vscode.window.registerWebviewViewProvider;
    let panelProvider: TestResultsPanelProvider | undefined;
    (vscode.window as any).createTreeView = () => tree.view;
    (vscode.window as any).registerWebviewViewProvider = (_id: string, provider: TestResultsPanelProvider) => {
      panelProvider = provider;
      return { dispose: () => details.view.dispose() };
    };
    let disposables: vscode.Disposable[] = [];
    try {
      disposables = registerResultsPanel({ extensionUri } as any, {} as any, async () => undefined);
      expect(uiState.hasVisibleViews()).to.equal(true);
      panelProvider!.resolveWebviewView(details.view as unknown as vscode.WebviewView, {} as any, {} as any);

      tree.setVisible(false);
      expect(uiState.hasVisibleViews()).to.equal(true);
      details.setVisible(false);
      expect(uiState.hasVisibleViews()).to.equal(false);
      tree.setVisible(true);
      details.setVisible(true);
      details.view.dispose();
      expect(uiState.hasVisibleViews()).to.equal(true);

      for (const disposable of disposables) disposable.dispose();
      expect(uiState.hasVisibleViews()).to.equal(false);
      expect(uiState.getActiveContainer()).to.equal('computor-tutor');
    } finally {
      for (const disposable of disposables) disposable.dispose();
      (vscode.window as any).createTreeView = originalCreateTreeView;
      (vscode.window as any).registerWebviewViewProvider = originalRegisterWebview;
    }
  });
});
