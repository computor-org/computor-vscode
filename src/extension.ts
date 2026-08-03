import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { IconGenerator } from './utils/IconGenerator';
import { execAsync } from './utils/exec';
import { GitCancelledError } from './exceptions/errors/GitExecError';
import { errorCatalog } from './exceptions/ErrorCatalog';
import { clientErrorCatalog } from './exceptions/ClientErrorCatalog';
import { ErrorPageWebviewProvider } from './ui/webviews/ErrorPageWebviewProvider';
import { openFile, registerEditorLayout, showOptions } from './ui/editorLayout';
import { UiStateService } from './services/UiStateService';
import { containerById, containerForView, isContainerAvailable } from './ui/viewContainers';
import { isRestoringSelection, restoreSelection, trackTree, treeItemId } from './ui/treeRestore';

import { ComputorSettingsManager } from './settings/ComputorSettingsManager';
import { ComputorApiService } from './services/ComputorApiService';
// RepositoryTokenManager is dynamically imported in code blocks below
// import { RepositoryTokenManager } from './services/RepositoryTokenManager';

import { BearerTokenHttpClient } from './http/BearerTokenHttpClient';
import { ApiKeyHttpClient } from './http/ApiKeyHttpClient';
import { WebSocketService } from './services/WebSocketService';
import { BackendConnectionService } from './services/BackendConnectionService';
import { GitEnvironmentService } from './services/GitEnvironmentService';
import { ExtensionUpdateService } from './services/ExtensionUpdateService';

import { LecturerTreeDataProvider } from './ui/tree/lecturer/LecturerTreeDataProvider';
import { notify } from './utils/notify';
import {
  OrganizationTreeItem as LecturerOrganizationTreeItem,
  CourseFamilyTreeItem as LecturerCourseFamilyTreeItem,
  CourseTreeItem as LecturerCourseTreeItem,
  CourseFolderTreeItem as LecturerCourseFolderTreeItem,
  CourseContentTreeItem as LecturerCourseContentTreeItem,
  CourseContentTypeTreeItem as LecturerCourseContentTypeTreeItem,
  CourseGroupTreeItem as LecturerCourseGroupTreeItem,
  NoGroupTreeItem as LecturerNoGroupTreeItem,
  CourseMemberTreeItem as LecturerCourseMemberTreeItem
} from './ui/tree/lecturer/LecturerTreeItems';
import { LecturerBreadcrumbStatusBar } from './ui/LecturerBreadcrumbStatusBar';
import { LecturerExampleTreeProvider } from './ui/tree/lecturer/LecturerExampleTreeProvider';
import { LecturerCommands } from './commands/LecturerCommands';
import { LecturerExampleCommands } from './commands/LecturerExampleCommands';
import { LecturerFsCommands } from './commands/LecturerFsCommands';
import { SettingsCommands } from './commands/SettingsCommands';
import { LogoutCommands } from './commands/LogoutCommands';
import { UserProfileWebviewProvider } from './ui/webviews/UserProfileWebviewProvider';

import { StudentCourseContentTreeProvider } from './ui/tree/student/StudentCourseContentTreeProvider';
import { StudentRepositoryManager } from './services/StudentRepositoryManager';
import { CourseSelectionService } from './services/CourseSelectionService';
import { StudentCommands } from './commands/StudentCommands';

import { TutorCommands } from './commands/TutorCommands';

import { registerResultsPanel } from './ui/results/registerResultsPanel';
import { MessagesInputPanelProvider } from './ui/panels/MessagesInputPanel';
import { CourseMemberCommentsInputPanelProvider } from './ui/panels/CourseMemberCommentsInputPanel';
import { registerFigureViewer } from './ui/panels/FiguresPanel';
import { registerImageViewer } from './ui/panels/ImagePreviewPanel';
import { manageRepositoryTokens } from './commands/manageRepositoryTokens';
import { configureGit } from './commands/configureGit';
import { showGettingStarted } from './commands/showGettingStarted';
import { ssoBrowserLogin, SsoLoginResult } from './authentication/SsoLoginService';

interface StoredAuth {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: string;
  issuedAt?: string;
  userId?: string;
}


const computorMarker = '.computor';

function getWorkspaceRoot(): string | undefined {
  const ws = vscode.workspace.workspaceFolders;
  if (!ws || ws.length === 0) return undefined;
  return ws[0]?.uri.fsPath;
}

async function ensureBaseUrl(settings: ComputorSettingsManager): Promise<string | undefined> {
  const current = await settings.getBaseUrl();
  if (current) return current;
  const url = await vscode.window.showInputBox({
    title: 'Computor Backend URL',
    prompt: 'Enter the Computor backend URL',
    placeHolder: 'http://localhost:8000',
    ignoreFocusOut: true,
    validateInput: (value) => {
      try { new URL(value); return undefined; } catch { return 'Enter a valid URL'; }
    }
  });
  if (!url) return undefined;
  await settings.setBaseUrl(url);
  return url;
}

const SESSION_AUTH_KEY = 'computor.auth';
const API_TOKEN_KEY = 'computor.apiToken';

/**
 * Build a session client from the tokens handed back by the SSO browser flow.
 * The session token has a sliding ~1h server TTL; the browser redirect doesn't
 * carry an exact expiry, so we assume 1h to drive proactive refresh while
 * VS Code is active.
 */
function buildSessionClient(baseUrl: string, sso: SsoLoginResult): BearerTokenHttpClient {
  const client = new BearerTokenHttpClient(baseUrl, 10000);
  const now = new Date();
  client.setTokenData({
    accessToken: sso.token,
    refreshToken: sso.refreshToken,
    expiresAt: new Date(now.getTime() + 3600_000),
    issuedAt: now,
    userId: sso.userId
  });
  return client;
}

function sessionAuthFromClient(client: BearerTokenHttpClient): StoredAuth {
  const t = client.getTokenData();
  return {
    accessToken: t.accessToken!,
    refreshToken: t.refreshToken || undefined,
    expiresAt: t.expiresAt?.toISOString(),
    issuedAt: t.issuedAt?.toISOString(),
    userId: t.userId || undefined
  };
}

async function persistSession(context: vscode.ExtensionContext, auth: StoredAuth): Promise<void> {
  await context.secrets.store(SESSION_AUTH_KEY, JSON.stringify(auth));
}

/**
 * Wire an authenticated HTTP client into a live UnifiedController session.
 * Shared by every entry point (SSO, API token, restored session). Throws if the
 * controller fails to activate (e.g. invalid/expired token); callers handle it.
 */
async function activateSession(
  context: vscode.ExtensionContext,
  baseUrl: string,
  client: BearerTokenHttpClient | ApiKeyHttpClient,
  onProgress?: (message: string) => void
): Promise<void> {
  await ensureWorkspaceMarker(baseUrl);
  const controller = new UnifiedController(context);
  try {
    await controller.activate(client as any, onProgress);
  } catch (error) {
    // Tear down the partially-initialized controller so callers can try another
    // auth path (e.g. stored API token → stored SSO token) without leaking
    // registered commands/views or a running health check.
    await controller.dispose();
    backendConnectionService.stopHealthCheck();
    throw error;
  }
  backendConnectionService.startHealthCheck(baseUrl);
  activeSession = createActiveSession(context, controller);

  // When the session can't be renewed, the client trips its breaker and calls
  // this once — offer an immediate re-login instead of silently failing fast.
  if (client instanceof BearerTokenHttpClient) {
    client.setOnUnauthorized(() => { void handleSessionExpired(context); });
  }

  if (extensionUpdateService) {
    extensionUpdateService.checkForUpdates().catch(err => {
      console.warn('Extension update check failed:', err);
    });
  }
}

/**
 * Invoked once (by the session client's circuit breaker) when the SSO session
 * has died and can't be refreshed. Offers a re-login; declining leaves the
 * client failing fast locally, so the backend isn't hammered with doomed calls.
 */
async function handleSessionExpired(context: vscode.ExtensionContext): Promise<void> {
  const choice = await notify.warning(
    'Your Computor session expired. Sign in again to continue.',
    'Sign in'
  );
  if (choice === 'Sign in') {
    await unifiedLoginFlow(context);
  }
}

/** Run the SSO browser handshake inside a cancellable progress notification. */
async function runSsoWithProgress(baseUrl: string): Promise<SsoLoginResult> {
  return vscode.window.withProgress({
    location: vscode.ProgressLocation.Notification,
    title: 'Computor',
    cancellable: true
  }, async (progress, token) => {
    progress.report({ message: 'Waiting for browser sign-in…' });
    return ssoBrowserLogin(baseUrl, { cancellationToken: token });
  });
}

interface TreeViewRegistration<T> {
  provider: vscode.TreeDataProvider<T>;
  options?: Omit<vscode.TreeViewOptions<T>, 'treeDataProvider'>;
  onExpand?: (event: vscode.TreeViewExpansionEvent<T>) => void;
  onCollapse?: (event: vscode.TreeViewExpansionEvent<T>) => void;
  onSelection?: (event: vscode.TreeViewSelectionChangeEvent<T>) => void;
  onVisibility?: (event: vscode.TreeViewVisibilityChangeEvent) => void;
}

async function setViewContextKeys(enabled: readonly string[], all: readonly string[]): Promise<void> {
  const enabledSet = new Set(enabled);
  for (const view of all) {
    await vscode.commands.executeCommand('setContext', `computor.${view}.show`, enabledSet.has(view));
  }
}

function extractLecturerBreadcrumb(item: vscode.TreeItem): { organization?: string | null; courseFamily?: string | null; course?: string | null } | undefined {
  const orgLabel = (org: { title?: string | null; path: string }) => org.title || org.path;
  const familyLabel = (f: { title?: string | null; path: string }) => f.title || f.path;
  const courseLabel = (c: { title?: string | null; path: string }) => c.title || c.path;

  if (item instanceof LecturerOrganizationTreeItem) {
    return { organization: orgLabel(item.organization) };
  }
  if (item instanceof LecturerCourseFamilyTreeItem) {
    return {
      organization: orgLabel(item.organization),
      courseFamily: familyLabel(item.courseFamily)
    };
  }
  if (
    item instanceof LecturerCourseTreeItem ||
    item instanceof LecturerCourseFolderTreeItem ||
    item instanceof LecturerCourseContentTreeItem ||
    item instanceof LecturerCourseContentTypeTreeItem ||
    item instanceof LecturerCourseGroupTreeItem ||
    item instanceof LecturerNoGroupTreeItem ||
    item instanceof LecturerCourseMemberTreeItem
  ) {
    return {
      organization: orgLabel(item.organization),
      courseFamily: familyLabel(item.courseFamily),
      course: courseLabel(item.course)
    };
  }
  return undefined;
}

function registerTreeView<T>(
  id: string,
  registration: TreeViewRegistration<T>,
  disposables: vscode.Disposable[]
): vscode.TreeView<T> {
  // createTreeView already binds the data provider; calling
  // registerTreeDataProvider in addition would attach a second listener to
  // onDidChangeTreeData and cause every refresh to invoke getChildren twice.
  // Wrapped, not replaced: this supplies getParent (which reveal() needs and
  // most providers do not implement) and an id index, while every command
  // holding a reference to the provider itself keeps working.
  const tracked = trackTree(registration.provider);
  const treeView = vscode.window.createTreeView(id, {
    treeDataProvider: tracked.provider,
    ...registration.options
  });
  disposables.push(treeView, tracked);
  if (registration.onExpand) disposables.push(treeView.onDidExpandElement(registration.onExpand));
  if (registration.onCollapse) disposables.push(treeView.onDidCollapseElement(registration.onCollapse));
  if (registration.onSelection) disposables.push(treeView.onDidChangeSelection(registration.onSelection));
  if (registration.onVisibility) disposables.push(treeView.onDidChangeVisibility(registration.onVisibility));

  // Remember what was selected, and put it back next time.
  const uiState = UiStateService.getInstanceOrUndefined();
  if (uiState) {
    disposables.push(treeView.onDidChangeSelection(event => {
      if (!isRestoringSelection()) {
        uiState.setSelection(id, treeItemId(event.selection[0]));
      }
    }));
    const remembered = uiState.getSelection(id);
    if (remembered) {
      restoreSelection(treeView, tracked, remembered, disposables);
    }
  }

  // Every tree goes through here, so this is the one place that can see which
  // container the user is actually in. A view becoming visible means its
  // container is the one on screen — that is what gets restored on the next
  // activation (computor-org/issues#285).
  const container = containerForView(id);
  if (container) {
    disposables.push(treeView.onDidChangeVisibility(event => {
      if (event.visible) {
        UiStateService.getInstanceOrUndefined()?.setActiveContainer(container.id);
      }
    }));
  }
  return treeView;
}

function buildHttpClient(baseUrl: string, auth: StoredAuth): BearerTokenHttpClient {
  const client = new BearerTokenHttpClient(baseUrl, 10000);
  client.setTokenData({
    accessToken: auth.accessToken,
    refreshToken: auth.refreshToken,
    expiresAt: auth.expiresAt ? new Date(auth.expiresAt) : undefined,
    issuedAt: auth.issuedAt ? new Date(auth.issuedAt) : undefined,
    userId: auth.userId
  });
  return client;
}

function createActiveSession(context: vscode.ExtensionContext, controller: UnifiedController): UnifiedSession {
  return {
    deactivate: () => controller.dispose().then(async () => {
      await vscode.commands.executeCommand('setContext', 'computor.lecturer.show', false);
      await vscode.commands.executeCommand('setContext', 'computor.student.show', false);
      await vscode.commands.executeCommand('setContext', 'computor.tutor.show', false);
      await vscode.commands.executeCommand('setContext', 'computor.chat.show', false);
      // Deliberately does NOT clear the tutor selection any more. deactivate()
      // runs on window close, so this destroyed the one selection that had a
      // working restore path exactly when it needed to survive
      // (computor-org/issues#285). Forgetting is logout's job, and
      // LogoutCommands.clearAllGlobalState already does it.
      await UiStateService.getInstanceOrUndefined()?.flush();
      backendConnectionService.stopHealthCheck();
    }),
    getActiveViews: () => controller.getActiveViews(),
    getHttpClient: () => controller.getHttpClient()
  };
}

async function readMarker(file: string): Promise<{ backendUrl?: string; courseId?: string } | undefined> {
  try {
    if (!fs.existsSync(file)) return undefined;
    const raw = await fs.promises.readFile(file, 'utf8');
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

async function writeMarker(file: string, data: { backendUrl: string }): Promise<void> {
  await fs.promises.writeFile(file, JSON.stringify(data, null, 2), 'utf8');
}

/**
 * Interactive sign-in with a Computor API token — the non-SSO escape hatch for
 * power users / automation. The token is sent as `X-API-Token` and persisted in
 * secret storage so it survives restarts; Logout clears it.
 */
async function apiTokenLoginFlow(context: vscode.ExtensionContext): Promise<void> {
  if (isAuthenticating) { notify.info('Login already in progress.'); return; }
  if (activeSession) {
    notify.info('Already signed in. Log out first to switch accounts.');
    return;
  }

  // Claim the in-flight guard synchronously, before any await, so a concurrent
  // login can't race us into a duplicate controller.activate().
  isAuthenticating = true;
  try {
    const root = getWorkspaceRoot();
    if (!root) { await promptOpenWorkspaceFolder(); return; }

    const settings = new ComputorSettingsManager(context);
    const baseUrl = await ensureBaseUrl(settings);
    if (!baseUrl) { return; }

    const token = await vscode.window.showInputBox({
      title: 'Sign in with API Token',
      prompt: 'Enter a Computor API token (starts with "ctp_")',
      password: true,
      ignoreFocusOut: true,
      placeHolder: 'ctp_…',
      validateInput: (v) => (v && v.startsWith('ctp_')) ? undefined : 'API tokens start with "ctp_"'
    });
    if (!token) { return; }

    const ok = await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: 'Computor',
      cancellable: false
    }, async (progress) => {
      progress.report({ message: 'Connecting to backend…' });
      backendConnectionService.setBaseUrl(baseUrl);
      const status = await backendConnectionService.checkBackendConnection(baseUrl);
      if (!status.isReachable) {
        await backendConnectionService.showConnectionError(status);
        return false;
      }
      progress.report({ message: 'Validating API token…' });
      const client = new ApiKeyHttpClient(baseUrl, token, 'X-API-Token', '', 10000);
      try {
        await activateSession(context, baseUrl, client, (m) => progress.report({ message: m }));
      } catch (error: any) {
        console.error('API token login failed:', error);
        notify.error(`API token sign-in failed: ${error?.message || error}`);
        return false;
      }
      await context.secrets.store(API_TOKEN_KEY, token);
      return true;
    });

    if (ok) { notify.info(`Signed in with API token: ${baseUrl}`); }
  } finally {
    isAuthenticating = false;
  }
}

/**
 * Cheap token-validity probe: a single `GET /user` straight through the HTTP
 * client. This deliberately bypasses ComputorApiService's error-recovery
 * pipeline, whose 401 strategy pops a BLOCKING "session expired — reload window"
 * dialog. During a silent restore that dialog would hang activation forever
 * (the user can't reach the sign-in prompt). Returns false on any error.
 */
async function probeToken(client: BearerTokenHttpClient | ApiKeyHttpClient): Promise<boolean> {
  try {
    await client.get('/user');
    return true;
  } catch (error) {
    console.warn('Token validation probe failed:', error);
    return false;
  }
}

/**
 * Silently restore a previously authenticated session without any UI prompts:
 * first a stored API token, then a stored SSO session token. Each candidate is
 * validated with a lightweight `GET /user` probe BEFORE activation — a stored
 * token that fails the probe is cleared and we fall through (ultimately to an
 * interactive sign-in) rather than letting a doomed token hang activation.
 * Returns true on success. The injected `COMPUTOR_AUTH_TOKEN` env token is
 * handled separately (higher priority) by the caller.
 */
async function restoreSession(
  context: vscode.ExtensionContext,
  baseUrl: string,
  onProgress?: (message: string) => void
): Promise<boolean> {
  const storedApiToken = await context.secrets.get(API_TOKEN_KEY);
  if (storedApiToken) {
    const client = new ApiKeyHttpClient(baseUrl, storedApiToken, 'X-API-Token', '', 10000);
    if (await probeToken(client)) {
      try {
        await activateSession(context, baseUrl, client, onProgress);
        return true;
      } catch (error) {
        console.warn('API token session activation failed:', error);
      }
    } else {
      console.warn('Stored API token is invalid; clearing it.');
      await context.secrets.delete(API_TOKEN_KEY);
    }
  }

  const raw = await context.secrets.get(SESSION_AUTH_KEY);
  if (raw) {
    let auth: StoredAuth | undefined;
    try { auth = JSON.parse(raw) as StoredAuth; } catch { auth = undefined; }
    if (auth?.accessToken) {
      const client = buildHttpClient(baseUrl, auth);
      if (await probeToken(client)) {
        try {
          await activateSession(context, baseUrl, client, onProgress);
          await persistSession(context, sessionAuthFromClient(client));
          return true;
        } catch (error) {
          console.warn('Session activation failed:', error);
        }
      } else {
        console.warn('Stored session token expired or invalid; clearing it.');
        await context.secrets.delete(SESSION_AUTH_KEY);
      }
    } else {
      await context.secrets.delete(SESSION_AUTH_KEY);
    }
  }

  return false;
}

async function promptOpenWorkspaceFolder(): Promise<{ opened: boolean; hadExistingFolders: boolean }> {
  const action = await notify.error('Login requires an open workspace.', 'Open Folder');
  if (action !== 'Open Folder') return { opened: false, hadExistingFolders: false };

  const folderUri = await vscode.window.showOpenDialog({
    canSelectFolders: true,
    canSelectFiles: false,
    canSelectMany: false,
    openLabel: 'Select Workspace Folder'
  });
  if (!folderUri || folderUri.length === 0) return { opened: false, hadExistingFolders: false };

  const workspaceFolders = vscode.workspace.workspaceFolders || [];
  const hadExistingFolders = workspaceFolders.length > 0;
  vscode.workspace.updateWorkspaceFolders(
    workspaceFolders.length,
    0,
    { uri: folderUri[0]!, name: path.basename(folderUri[0]!.fsPath) }
  );
  return { opened: true, hadExistingFolders };
}

/**
 * Auto-login when a `.computor` workspace marker is detected. Tries, in order:
 *   1. an injected `COMPUTOR_AUTH_TOKEN` API token (Coder / CI workspaces),
 *   2. a silently restored session (stored API token, then stored SSO token),
 * and otherwise prompts the user to sign in via SSO or an API token.
 */
async function handleComputorWorkspaceDetected(
  context: vscode.ExtensionContext,
  computorMarkerPath: string
): Promise<void> {
  if (activeSession || isAuthenticating) {
    return;
  }

  // Claim the in-flight guard synchronously — before any await — so a manual
  // login triggered while we're still reading the marker/settings can't race
  // this auto-login into a second controller.activate() (duplicate command
  // registration).
  isAuthenticating = true;
  try {
    const settings = new ComputorSettingsManager(context);
    const marker = await readMarker(computorMarkerPath);
    const baseUrl = marker?.backendUrl || await settings.getBaseUrl();
    if (!baseUrl) { return; }

    const envToken = process.env.COMPUTOR_AUTH_TOKEN;
    const autoLoginEnabled = await settings.isAutoLoginEnabled();

    // Priority 1: injected API token (Coder workspace injection / CI)
    if (envToken) {
      const ok = await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'Computor',
        cancellable: false
      }, async (progress) => {
        progress.report({ message: 'Connecting (workspace token)…' });
        backendConnectionService.setBaseUrl(baseUrl);
        const status = await backendConnectionService.checkBackendConnection(baseUrl);
        if (!status.isReachable) { return false; }
        progress.report({ message: 'Authenticating…' });
        const client = new ApiKeyHttpClient(baseUrl, envToken, 'X-API-Token', '', 5000);
        if (!(await probeToken(client))) {
          console.error('Workspace API token is invalid');
          return false;
        }
        try {
          await activateSession(context, baseUrl, client, (msg) => progress.report({ message: msg }));
          return true;
        } catch (error) {
          console.error('Workspace API token login failed:', error);
          return false;
        }
      });

      if (ok) {
        notify.info(`Logged in (workspace token): ${baseUrl}`);
        return;
      }
      console.warn('Workspace API token login failed, falling back to stored session');
    }

    // Priority 2: silently restore a stored session (if auto-login is enabled)
    if (autoLoginEnabled) {
      const restored = await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'Computor',
        cancellable: false
      }, async (progress) => {
        progress.report({ message: 'Connecting to backend…' });
        backendConnectionService.setBaseUrl(baseUrl);
        const status = await backendConnectionService.checkBackendConnection(baseUrl);
        if (!status.isReachable) { return false; }
        progress.report({ message: 'Restoring session…' });
        return restoreSession(context, baseUrl, (msg) => progress.report({ message: msg }));
      });

      if (restored) {
        notify.info(`Logged in: ${baseUrl}`);
        return;
      }
    }
  } finally {
    isAuthenticating = false;
  }

  // Priority 3: nothing stored (or session expired) — offer to sign in.
  const action = await notify.info(
    'Computor workspace detected. Sign in to continue.',
    'Sign in',
    'Use API Token',
    'Not Now'
  );
  if (action === 'Sign in') {
    await unifiedLoginFlow(context);
  } else if (action === 'Use API Token') {
    await apiTokenLoginFlow(context);
  }
}

async function ensureWorkspaceMarker(baseUrl: string): Promise<void> {
  const root = getWorkspaceRoot();
  if (!root) {
    const result = await promptOpenWorkspaceFolder();
    if (result.opened && result.hadExistingFolders) {
      await new Promise(resolve => setTimeout(resolve, 100));
      await ensureWorkspaceMarker(baseUrl);
    }
    return;
  }
  const file = path.join(root, computorMarker);
  const existing = await readMarker(file);

  // Update marker with backend URL if different or missing
  if (!existing || existing.backendUrl !== baseUrl) {
    await writeMarker(file, { backendUrl: baseUrl });
  }
}




class UnifiedController {
  private context: vscode.ExtensionContext;
  private api?: ComputorApiService;
  private httpClient?: BearerTokenHttpClient;
  private disposables: vscode.Disposable[] = [];
  private activeViews: string[] = [];
  private profileWebviewProvider?: UserProfileWebviewProvider;
  private messagesInputPanel?: MessagesInputPanelProvider;
  private commentsInputPanel?: CourseMemberCommentsInputPanelProvider;
  private wsService?: WebSocketService;
  private readonly uiState = UiStateService.getInstanceOrUndefined();

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
  }

  async activate(
    client: ReturnType<typeof buildHttpClient>,
    onProgress?: (message: string) => void
  ): Promise<void> {
    const report = onProgress || (() => {});

    this.httpClient = client;
    const api = await this.setupApi(client);

    this.profileWebviewProvider = new UserProfileWebviewProvider(this.context, api);
    const profileCommand = vscode.commands.registerCommand('computor.user.profile', async () => {
      if (!this.profileWebviewProvider) {
        this.profileWebviewProvider = new UserProfileWebviewProvider(this.context, api);
      } else {
        this.profileWebviewProvider.setApiService(api);
      }
      await this.profileWebviewProvider.open();
    });
    this.disposables.push(profileCommand);

    // Messages input panel (shared across all views)
    this.messagesInputPanel = new MessagesInputPanelProvider(this.context.extensionUri, api);
    this.disposables.push(
      vscode.window.registerWebviewViewProvider(MessagesInputPanelProvider.viewType, this.messagesInputPanel)
    );

    // Course-member comments input panel (shared across lecturer + tutor views)
    this.commentsInputPanel = new CourseMemberCommentsInputPanelProvider(this.context.extensionUri, api);
    this.disposables.push(
      vscode.window.registerWebviewViewProvider(CourseMemberCommentsInputPanelProvider.viewType, this.commentsInputPanel)
    );

    // Initialize WebSocket service for real-time messaging
    const settingsManager = new ComputorSettingsManager(this.context);
    this.wsService = WebSocketService.getInstance(settingsManager);
    this.wsService.setHttpClient(client);
    this.messagesInputPanel.setWebSocketService(this.wsService);

    // Connect WebSocket (fire-and-forget, will reconnect automatically on failure)
    void this.wsService.connect();

    // Check initial maintenance status (fire-and-forget)
    void this.checkInitialMaintenanceStatus(api);

    // Register WebSocket reconnect command
    this.disposables.push(
      vscode.commands.registerCommand('computor.websocket.reconnect', async () => {
        if (this.wsService) {
          await this.wsService.reconnect();
        }
      })
    );

    // Get available views for this user across all courses
    // This is a lightweight check to determine which role views to show
    report('Loading user views...');
    const availableViews = await this.getAvailableViews(api);

    if (availableViews.length === 0) {
      throw new Error('No views available for your account.');
    }

    report('Validating Git environment...');
    await GitEnvironmentService.getInstance().validateGitEnvironment();

    // Validate and register course provider accounts BEFORE initializing views
    // This ensures tokens are ready before ANY git operations
    report('Validating course access...');
    await this.validateCourseProviderAccess(api, onProgress);

    // NOW initialize views - git operations will work because tokens are validated
    report('Initializing views...');
    await this.initializeViews(api, null, availableViews, onProgress);

    // Focus on the highest priority view: lecturer > tutor > student
    await this.focusHighestPriorityView(availableViews);
  }

  private async setupApi(client: ReturnType<typeof buildHttpClient>): Promise<ComputorApiService> {
    const api = new ComputorApiService(this.context, client);
    this.api = api;
    // API service is now available via ComputorApiService.getInstance()
    return api;
  }

  private async getAvailableViews(api: ComputorApiService): Promise<string[]> {
    return await api.getUserViews();
  }

  private async validateCourseProviderAccess(
    api: ComputorApiService,
    onProgress?: (message: string) => void
  ): Promise<void> {
    try {
      const { CourseProviderValidationService } = await import('./services/CourseProviderValidationService');
      const validationService = new CourseProviderValidationService(this.context, api);
      await validationService.validateAllCourseProviders(onProgress);
      console.log('[UnifiedController] Course provider validation complete');
    } catch (error) {
      console.warn('[UnifiedController] Failed to validate course provider access:', error);
    }
  }

  private async initializeViews(
    api: ComputorApiService,
    courseId: string | null,
    views: string[],
    onProgress?: (message: string) => void
  ): Promise<void> {
    void courseId; // No longer used - views show all courses
    const report = onProgress || (() => {});

    // Store the active views
    this.activeViews = views;

    // Results panel first: every role's flows dispatch computor.results.* and
    // computor.showTestResults, so the commands must exist before any view runs.
    this.initializeResultsPanel(api);

    // Initialize ALL available views - each will get its own activity bar container
    // Each view will fetch and display all available courses
    if (views.includes('student')) {
      report('Setting up student view...');
      await this.initializeStudentView(api, onProgress);
    }
    if (views.includes('tutor')) {
      report('Setting up tutor view...');
      await this.initializeTutorView(api);
    }
    if (views.includes('lecturer')) {
      report('Setting up lecturer view...');
      await this.initializeLecturerView(api);
    }
    if (views.includes('user_manager')) {
      report('Setting up user manager view...');
      await this.initializeUserManagerView(api);
    }

    // Computor Chat is available to every authenticated user, regardless of role.
    report('Setting up chat view...');
    await this.initializeChatView(api);

    await setViewContextKeys(views, ['student', 'tutor', 'lecturer', 'user_manager']);
    await vscode.commands.executeCommand('setContext', 'computor.chat.show', true);
  }

  /**
   * Open the container the user was last in.
   *
   * This used to run a fixed lecturer > tutor > student priority on every
   * activation, not just the first, so a tutor who worked in the Tutor
   * container was put back in Lecturer every time they reopened the workspace
   * (computor-org/issues#285). The remembered container wins when it is still
   * reachable — roles change between sessions, and focusing a container whose
   * views are all gated off would leave an empty pane.
   */
  private async focusHighestPriorityView(views: string[]): Promise<void> {
    const remembered = this.uiState?.getActiveContainer();
    let target = remembered ? containerById(remembered) : undefined;
    if (target && !isContainerAvailable(target, views)) {
      target = undefined;
    }

    if (!target) {
      const fallback = ['lecturer', 'tutor', 'student'].find(role => views.includes(role));
      target = fallback === 'lecturer' ? containerById('computor-lecturer')
        : fallback === 'tutor' ? containerById('computor-tutor')
          : fallback === 'student' ? containerById('computor-student')
            : undefined;
    }

    if (!target) {
      return;
    }

    try {
      await vscode.commands.executeCommand(target.focusCommand);
      console.log(`Focused ${target.id}${remembered === target.id ? ' (where you left off)' : ''}`);
    } catch (err) {
      console.warn(`Failed to focus ${target.id}:`, err);
    }
  }

  private async initializeStudentView(
    api: ComputorApiService,
    onProgress?: (message: string) => void
  ): Promise<void> {
    const report = onProgress || (() => {});

    // Initialize student-specific components
    const repositoryManager = new StudentRepositoryManager(this.context, api);

    // Wire error page for corrupt git index detection
    const errorPageProvider = new ErrorPageWebviewProvider(this.context);
    errorPageProvider.registerActionHandler('REBUILD_INDEX', async (_errorCode, ctx) => {
      if (!ctx?.repositoryPath) { return; }
      try {
        const indexPath = path.join(ctx.repositoryPath, '.git', 'index');
        if (fs.existsSync(indexPath)) {
          await fs.promises.unlink(indexPath);
        }
        await execAsync('git reset', { cwd: ctx.repositoryPath });
        notify.info('Git index rebuilt successfully. Please reload the window.', 'Reload Window').then(choice => {
          if (choice === 'Reload Window') {
            void vscode.commands.executeCommand('workbench.action.reloadWindow');
          }
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        notify.error(`Failed to rebuild git index: ${message}`);
      }
    });
    errorPageProvider.registerActionHandler('OPEN_TERMINAL', async (_errorCode, ctx) => {
      if (!ctx?.repositoryPath) { return; }
      const terminal = vscode.window.createTerminal({ name: 'Repository', cwd: ctx.repositoryPath });
      terminal.show();
    });
    repositoryManager.setCorruptIndexHandler((repoPath: string) => {
      void errorPageProvider.showError('GIT_INDEX_CORRUPT', { repositoryPath: repoPath });
    });

    const statusBar = (await import('./ui/StatusBarService')).StatusBarService.initialize(this.context);
    const courseSelectionService = CourseSelectionService.initialize(this.context, api, statusBar);

    // Initialize tree view
    const tree = new StudentCourseContentTreeProvider(api, courseSelectionService, this.context);
    if (this.wsService) tree.setWebSocketService(this.wsService);
    // Last assignment selected in the tree, so the results view can be
    // rehydrated (rather than cleared) when it becomes visible again (#273).
    let lastSelectedAssignment: any | undefined;
    registerTreeView('computor.student.courses', {
      provider: tree,
      options: { showCollapseAll: true },
      onExpand: (event) => {
        if (event.element) void tree.onTreeItemExpanded(event.element);
      },
      onCollapse: (event) => {
        if (event.element) void tree.onTreeItemCollapsed(event.element);
      },
      onSelection: (event) => {
        const selected = event.selection[0];
        if (!selected) return;
        if (selected.contextValue?.startsWith('studentCourseContent.assignment')) {
          lastSelectedAssignment = selected;
          // A restore only puts the highlight back. Fetching results for it
          // would make every workspace reopen wait on the backend.
          if (isRestoringSelection()) return;
          // Always load the latest result from the backend rather than gating on
          // the possibly-stale in-memory tree item — after a workspace restart
          // the item may not carry `.result` yet even though a prior result
          // exists server-side (issue #273). Silent: a plain selection should
          // update the panel without popups or hijacking the sidebar.
          void vscode.commands.executeCommand('computor.showTestResults', selected, { silent: true });
        }
      },
      onVisibility: (event) => {
        // Re-show the last selected assignment's results when the view becomes
        // visible again, instead of wiping the panel to "No test results
        // available" every time (issue #273).
        if (event.visible && lastSelectedAssignment) {
          void vscode.commands.executeCommand('computor.showTestResults', lastSelectedAssignment, { silent: true });
        }
      }
    }, this.disposables);

    // No course pre-selection - tree will show all courses

    // Load expanded states to determine which courses need immediate update
    // Only previously expanded courses will have their repositories updated on startup
    const settingsManager = new ComputorSettingsManager(this.context);
    const expandedStates = await settingsManager.getStudentTreeExpandedStates();

    // Extract course IDs from expanded states (format: "course-{courseId}")
    const expandedCourseIds = new Set<string>();
    for (const nodeId of Object.keys(expandedStates)) {
      if (nodeId.startsWith('course-') && expandedStates[nodeId]) {
        expandedCourseIds.add(nodeId.replace('course-', ''));
      }
    }

    console.log(`[initializeStudentView] Expanded courses for startup update: ${Array.from(expandedCourseIds).join(', ') || '(none)'}`);

    // Auto-setup repositories only for expanded courses (tokens already validated before this runs)
    // Courses that were never expanded will be set up lazily when first expanded
    if (expandedCourseIds.size > 0) {
      // Use external progress if available, otherwise show own popup
      const setupRepositories = async (progressReport: (msg: string) => void, cancellationToken?: vscode.CancellationToken) => {
        progressReport('Preparing repositories...');
        try {
          await repositoryManager.autoSetupRepositories(undefined, progressReport, expandedCourseIds, cancellationToken);
        } catch (e) {
          if (e instanceof GitCancelledError) {
            notify.info('Repository setup was cancelled. Repositories will be set up when you expand a course.');
          } else {
            console.error('[initializeStudentView] Repository auto-setup failed:', e);
          }
        }
        tree.refresh();
      };

      if (onProgress) {
        await setupRepositories(report);
      } else {
        await vscode.window.withProgress({
          location: vscode.ProgressLocation.Notification,
          title: 'Preparing course repositories...',
          cancellable: true
        }, async (progress, token) => {
          await setupRepositories((msg) => progress.report({ message: msg }), token);
        });
      }
    } else {
      console.log('[initializeStudentView] No expanded courses, skipping initial repository setup');
    }

    // Student commands
    const commands = new StudentCommands(this.context, tree, api, repositoryManager, this.messagesInputPanel, this.wsService);
    commands.registerCommands();

  }

  /**
   * The Results panel is contributed unconditionally in package.json and driven
   * from student, tutor and lecturer flows alike, so its provider and commands
   * are registered for every authenticated user - not only when the account
   * happens to have the student view.
   */
  private initializeResultsPanel(api: ComputorApiService): void {
    this.disposables.push(...registerResultsPanel(
      this.context,
      api,
      (resultId, artifactInfo) => this.openResultArtifact(api, resultId, artifactInfo)
    ));
  }

  private async openResultArtifact(api: ComputorApiService, resultId: string, artifactInfo: any): Promise<void> {
    const fs = await import('fs');
    const path = await import('path');

    // Local artifacts from lecturer example testing: resultId is "local:<outputDir>"
    if (resultId.startsWith('local:')) {
      const outputDir = resultId.substring('local:'.length);
      const filePath = path.join(outputDir, artifactInfo.filename);
      if (fs.existsSync(filePath)) {
        await this.openArtifactFile(filePath);
      } else {
        notify.error(`Local artifact not found: ${artifactInfo.filename}`);
      }
      return;
    }

    const { WorkspaceStructureManager } = await import('./utils/workspaceStructure');
    const JSZip = (await import('jszip')).default;

    const wsManager = WorkspaceStructureManager.getInstance();
    const artifactsDir = wsManager.getResultArtifactsPath(resultId);
    const artifactFilePath = path.join(artifactsDir, artifactInfo.filename);

    const artifactExists = await wsManager.resultArtifactsExist(resultId);
    const fileExists = artifactExists && fs.existsSync(artifactFilePath);

    if (fileExists) {
      await this.openArtifactFile(artifactFilePath);
      return;
    }

    await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: `Downloading artifact: ${artifactInfo.filename}`,
      cancellable: false
    }, async () => {
      const buffer = await api.downloadResultArtifacts(resultId);
      if (!buffer) {
        throw new Error('Failed to download artifacts');
      }

      await fs.promises.mkdir(artifactsDir, { recursive: true });

      const zip = await JSZip.loadAsync(buffer);
      for (const [filename, zipEntry] of Object.entries(zip.files)) {
        if (!zipEntry.dir) {
          const content = await zipEntry.async('nodebuffer');
          const filePath = path.join(artifactsDir, filename);
          const fileDir = path.dirname(filePath);
          await fs.promises.mkdir(fileDir, { recursive: true });
          await fs.promises.writeFile(filePath, content);
        }
      }
    });

    if (fs.existsSync(artifactFilePath)) {
      await this.openArtifactFile(artifactFilePath);
    } else {
      const files = await wsManager.getResultArtifactFiles(resultId);
      if (files.length > 0) {
        const firstFile = path.join(artifactsDir, files[0]!);
        await this.openArtifactFile(firstFile);
      } else {
        notify.info('Artifacts downloaded but no files found to open');
      }
    }
  }

  private async openArtifactFile(filePath: string): Promise<void> {
    const fileUri = vscode.Uri.file(filePath);
    const ext = filePath.toLowerCase().split('.').pop() || '';

    const imageExtensions = ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg', 'ico'];
    const binaryExtensions = ['pdf', 'zip', 'tar', 'gz', 'rar', '7z', 'exe', 'dll', 'so', 'dylib', 'bin', 'dat'];

    if (imageExtensions.includes(ext)) {
      // openFile puts an image in the auxiliary group with the figures, and
      // keeps it routed to the Computor image preview.
      await openFile(fileUri, { preview: false });
    } else if (binaryExtensions.includes(ext)) {
      await vscode.commands.executeCommand('revealFileInOS', fileUri);
      notify.info(`Binary file revealed in file explorer: ${filePath.split('/').pop()}`);
    } else {
      const doc = await vscode.workspace.openTextDocument(fileUri);
      await vscode.window.showTextDocument(doc, showOptions(fileUri, { preview: false }));
    }
  }

  private async initializeTutorView(api: ComputorApiService): Promise<void> {
    const { TutorFilterTreeProvider } = await import('./ui/tree/tutor/tutor-filter-tree-provider');
    const { TutorCourseFilterItem, TutorGroupOptionItem, TutorMemberFilterItem, NO_GROUP_SENTINEL, formatMemberName } = await import('./ui/tree/tutor/tutor-filter-tree-items');
    const { TutorSelectionService } = await import('./services/TutorSelectionService');
    const { TutorStatusBarService } = await import('./ui/TutorStatusBarService');
    const { TutorEditorDecorationService } = await import('./ui/TutorEditorDecorationService');
    const selection = TutorSelectionService.initialize(this.context, api);

    const editorDecorationService = TutorEditorDecorationService.initialize(this.context);
    editorDecorationService.connectToSelectionService(selection);

    // Register filter tree (replaces webview filter panel)
    const tutorSettingsManager = new ComputorSettingsManager(this.context);
    const filterTree = new TutorFilterTreeProvider(api, selection, tutorSettingsManager);

    // One way in for "the tutor is now looking at this course", shared by the
    // course node's click, its expand, and picking a member of another course.
    const selectTutorCourse = async (courseId: string, label?: string | null): Promise<boolean> => {
      if (selection.getCurrentCourseId() === courseId) {
        return false;
      }
      await selection.selectCourse(courseId, label ?? filterTree.resolveCourseLabel(courseId));
      filterTree.refresh();
      return true;
    };
    registerTreeView('computor.tutor.filters', {
      provider: filterTree,
      options: { showCollapseAll: true },
      onExpand: async (event) => {
        // Switch first, persist after: writing ~/.computor/config.json is a
        // read-modify-write of the whole file, and it used to sit between the
        // user's click and the selection actually changing.
        if (event.element instanceof TutorCourseFilterItem) {
          await selectTutorCourse(event.element.course.id, event.element.course.title
            || event.element.course.path || event.element.course.name || event.element.course.id);
        }
        const id = event.element.id;
        if (id) {
          void filterTree.setNodeExpanded(id, true);
        }
      },
      onCollapse: async (event) => {
        const id = event.element.id;
        if (id) {
          await filterTree.setNodeExpanded(id, false);
        }
      }
    }, this.disposables);

    // Register filter interaction commands
    this.disposables.push(vscode.commands.registerCommand('computor.tutor.selectCourse', async (item: InstanceType<typeof TutorCourseFilterItem>) => {
      const course = item.course;
      await selectTutorCourse(course.id, course.title || course.path || course.name || course.id);
    }));

    this.disposables.push(vscode.commands.registerCommand('computor.tutor.selectGroup', async (item: InstanceType<typeof TutorGroupOptionItem>) => {
      // Picking a group under another course means switching to that course.
      // selectCourse resets the group, so it has to happen first or the click
      // is thrown away.
      await selectTutorCourse(item.courseId);
      if (item.isNoGroup) {
        await selection.selectGroup(NO_GROUP_SENTINEL, 'No Group');
      } else {
        await selection.selectGroup(item.groupId, item.groupLabel);
      }
      filterTree.refresh();
    }));

    this.disposables.push(vscode.commands.registerCommand('computor.tutor.selectMember', async (item: InstanceType<typeof TutorMemberFilterItem>) => {
      // Same here: selectCourse resets the member, so course comes first.
      await selectTutorCourse(item.courseId);
      const name = formatMemberName(item.member);
      const memberGroupId = item.member.course_group_id ?? null;
      const memberGroupLabel = memberGroupId
        ? filterTree.resolveGroupLabel(item.courseId, memberGroupId)
        : null;
      await selection.selectMember(item.member.id, name, memberGroupId, memberGroupLabel, item.member.user?.email);
      filterTree.refresh();
    }));

    // Register course content tree
    const { TutorStudentTreeProvider } = await import('./ui/tree/tutor/TutorStudentTreeProvider');
    const tree = new TutorStudentTreeProvider(api, selection);
    if (this.wsService) tree.setWebSocketService(this.wsService);
    registerTreeView('computor.tutor.courses', {
      provider: tree,
      options: { showCollapseAll: true },
      onExpand: (event) => tree.handleExpand(event.element),
      onCollapse: (event) => tree.handleCollapse(event.element),
      onSelection: (event) => {
        const selected = event.selection[0];
        if (!selected) return;
        if (selected.contextValue?.startsWith('tutorStudentContent.assignment')) {
          // Never on a restore: this clones the member's repository, which is
          // not something reopening a workspace should set off by itself.
          if (isRestoringSelection()) return;
          void vscode.commands.executeCommand('computor.tutor.checkout', selected, false);
          if ((selected as any).content?.result) {
            void vscode.commands.executeCommand('computor.showTestResults', { courseContent: (selected as any).content });
          } else {
            void vscode.commands.executeCommand('computor.results.clear');
          }
        }
      },
      onVisibility: (event) => {
        if (event.visible) void vscode.commands.executeCommand('computor.results.clear');
      }
    }, this.disposables);

    // Status bar
    const tutorStatus = TutorStatusBarService.initialize();
    const updateStatus = async () => {
      const courseLabel = selection.getCurrentCourseLabel() || selection.getCurrentCourseId();
      const groupLabel = selection.getCurrentGroupLabel() || selection.getCurrentGroupId();
      const memberLabel = selection.getCurrentMemberLabel() || selection.getCurrentMemberId();
      tutorStatus.updateSelection(courseLabel, groupLabel, memberLabel);
    };
    this.disposables.push(selection.onDidChangeSelection(() => {
      void updateStatus();
      void vscode.commands.executeCommand('computor.results.clear');
    }));
    void updateStatus();

    // Reset filters command
    this.disposables.push(vscode.commands.registerCommand('computor.tutor.resetFilters', async () => {
      const id = selection.getCurrentCourseId();
      if (!id) {
        return;
      }
      const label = selection.getCurrentCourseLabel();
      await selection.selectCourse(id, label);
      filterTree.refresh();
    }));

    const commands = new TutorCommands(this.context, tree, api, filterTree, this.messagesInputPanel, this.wsService, this.commentsInputPanel);
    commands.registerCommands();
  }

  private async initializeLecturerView(api: ComputorApiService): Promise<void> {
    const tree = new LecturerTreeDataProvider(this.context, api);
    if (this.wsService) tree.setWebSocketService(this.wsService);

    const breadcrumb = new LecturerBreadcrumbStatusBar();
    this.disposables.push(breadcrumb);

    registerTreeView('computor.lecturer.courses', {
      provider: tree,
      options: {
        showCollapseAll: true,
        canSelectMany: false,
        dragAndDropController: tree
      },
      onExpand: (event) => {
        if (event.element?.id) void tree.setNodeExpanded(event.element.id, true);
      },
      onCollapse: (event) => {
        if (event.element?.id) void tree.setNodeExpanded(event.element.id, false);
      },
      onSelection: (event) => {
        const selected = event.selection?.[0];
        if (!selected) {
          breadcrumb.clear();
          return;
        }
        const labels = extractLecturerBreadcrumb(selected);
        if (labels) {
          breadcrumb.update(labels);
        } else {
          breadcrumb.clear();
        }
      },
      onVisibility: (event) => {
        breadcrumb.setViewVisible(event.visible);
        if (event.visible) void vscode.commands.executeCommand('computor.results.clear');
      }
    }, this.disposables);

    const exampleTree = new LecturerExampleTreeProvider(this.context, api);
    const exampleTreeView = registerTreeView('computor.lecturer.examples', {
      provider: exampleTree,
      options: {
        showCollapseAll: true,
        canSelectMany: true,
        dragAndDropController: exampleTree
      }
    }, this.disposables);
    exampleTree.setTreeView(exampleTreeView);

    this.context.subscriptions.push(
      vscode.commands.registerCommand('computor.lecturer.revealInExamples', async (item: any) => {
        const identifier = item?.exampleInfo?.identifier;
        const id = item?.exampleInfo?.id;
        if (!identifier && !id) {
          notify.warning('No example assigned to this content.');
          return;
        }
        const found = await exampleTree.revealExample({
          identifier,
          id,
          repositoryId: item?.exampleInfo?.example_repository_id
        });
        if (!found) {
          notify.warning('Example not found in the examples tree.');
        }
      })
    );

    const commands = new LecturerCommands(this.context, tree, api, this.messagesInputPanel, this.wsService, this.commentsInputPanel);
    commands.registerCommands();

    // Register example-related commands (search, upload from ZIP, etc.)
    new LecturerExampleCommands(this.context, api, exampleTree);
    new LecturerFsCommands(this.context, api).register();

    // Documents tree — file-system mirror over /documents/* with per-entry sync state.
    const { DocumentsTreeProvider } = await import('./ui/tree/lecturer-documents/DocumentsTreeProvider');
    const { DocumentsCommands } = await import('./commands/DocumentsCommands');
    const documentsTree = new DocumentsTreeProvider(api);
    registerTreeView('computor.lecturer.documents', {
      provider: documentsTree,
      options: {
        showCollapseAll: true,
        canSelectMany: false,
        dragAndDropController: documentsTree
      }
    }, this.disposables);
    new DocumentsCommands(this.context, api, documentsTree).register();

    // Initialize lecturer assignments repository manager and trigger a background sync
    try {
      const { LecturerRepositoryManager } = await import('./services/LecturerRepositoryManager');
      const repoManager = new LecturerRepositoryManager(this.context, api);
      // Fire-and-forget sync on login
      void repoManager.syncAllAssignments((msg: string) => {
        console.log('[LecturerRepositoryManager]', msg);
      });
    } catch (err) {
      console.warn('LecturerRepositoryManager init failed:', err);
    }
  }

  private async initializeUserManagerView(api: ComputorApiService): Promise<void> {
    const { UserManagerTreeProvider } = await import('./ui/tree/user-manager/UserManagerTreeProvider');
    const { UserManagerCommands } = await import('./commands/UserManagerCommands');

    const tree = new UserManagerTreeProvider(api, this.context);
    registerTreeView('computor.usermanager.users', {
      provider: tree,
      options: { showCollapseAll: false },
      onVisibility: (event) => {
        if (event.visible) void vscode.commands.executeCommand('computor.results.clear');
      }
    }, this.disposables);

    const commands = new UserManagerCommands(this.context, tree, api);
    commands.registerCommands();
  }

  private async initializeChatView(api: ComputorApiService): Promise<void> {
    const { ChatInboxTreeProvider } = await import('./ui/tree/chat/ChatInboxTreeProvider');
    const { ChatScopeItem, ChatThreadItem, ChatCourseGroupItem } = await import('./ui/tree/chat/ChatInboxTreeItems');

    // The chat view drives the existing MessagesWebviewProvider + bottom Compose
    // panel, so reuse the input panel + WebSocket service we already instantiated.
    const messagesWebview = (await import('./ui/webviews/MessagesWebviewProvider')).MessagesWebviewProvider.getShared(this.context, api);
    if (this.messagesInputPanel) {
      messagesWebview.setInputPanel(this.messagesInputPanel);
    }
    if (this.wsService) {
      messagesWebview.setWebSocketService(this.wsService);
    }

    const tree = new ChatInboxTreeProvider(this.context, api, messagesWebview);
    if (this.wsService) {
      tree.setWebSocketService(this.wsService);
    }
    const chatTreeView = registerTreeView('computor.chat.inbox', {
      provider: tree,
      options: { showCollapseAll: true },
      onExpand: (event) => {
        if (event.element instanceof ChatScopeItem) {
          tree.recordExpanded(event.element.scope, true);
        } else if (event.element instanceof ChatCourseGroupItem) {
          tree.recordCourseGroupExpanded(event.element.scope, event.element.courseId, true);
        }
      },
      onCollapse: (event) => {
        if (event.element instanceof ChatScopeItem) {
          tree.recordExpanded(event.element.scope, false);
        } else if (event.element instanceof ChatCourseGroupItem) {
          tree.recordCourseGroupExpanded(event.element.scope, event.element.courseId, false);
        }
      },
      onVisibility: (event) => {
        if (event.visible) {
          tree.refresh();
        }
      }
    }, this.disposables);

    this.disposables.push(
      tree.onDidChangeUnread((count) => {
        chatTreeView.badge = count > 0
          ? { value: count, tooltip: `${count} unread message${count === 1 ? '' : 's'}` }
          : undefined;
      })
    );

    this.disposables.push(
      vscode.commands.registerCommand('computor.chat.refresh', () => tree.refresh()),
      vscode.commands.registerCommand('computor.chat.showUnreadOnly', () => tree.setUnreadOnly(true)),
      vscode.commands.registerCommand('computor.chat.showAll', () => tree.setUnreadOnly(false)),
      vscode.commands.registerCommand('computor.chat.openThread', (item: any) => {
        if (item instanceof ChatThreadItem) {
          void tree.openThread(item);
        }
      }),
      vscode.commands.registerCommand('computor.chat.markScopeRead', (item: any) => {
        if (item instanceof ChatScopeItem) {
          void tree.markScopeRead(item);
        }
      }),
      vscode.commands.registerCommand('computor.chat.markThreadRead', (item: any) => {
        if (item instanceof ChatThreadItem) {
          void tree.markThreadRead(item);
        }
      }),
      vscode.commands.registerCommand('computor.chat.loadMore', (scope: unknown, courseId?: unknown) => {
        if (typeof scope !== 'string' || scope.length === 0) { return; }
        if (typeof courseId === 'string' && courseId.length > 0) {
          void tree.loadMoreForCourseScope(scope as any, courseId);
        } else {
          void tree.loadMoreForScope(scope as any);
        }
      }),
      vscode.commands.registerCommand('computor.chat.notifications.mute', () => {
        tree.toggleAllNotifications();
      }),
      vscode.commands.registerCommand('computor.chat.notifications.unmute', () => {
        tree.toggleAllNotifications();
      }),
      vscode.commands.registerCommand('computor.chat.scope.mute', (item: any) => {
        if (item instanceof ChatScopeItem) {
          tree.toggleScopeMuted(item.scope);
        }
      }),
      vscode.commands.registerCommand('computor.chat.scope.unmute', (item: any) => {
        if (item instanceof ChatScopeItem) {
          tree.toggleScopeMuted(item.scope);
        }
      })
    );

    // Initial load.
    tree.refresh();

    // VS Code can't declare the secondary (right) sidebar as a default location
    // for a view container, so we move it there programmatically the first time
    // a user activates the extension. Wrapped in best-effort: if the workbench
    // command names ever change, the user can still drag it manually.
    void this.moveChatToSecondarySidebarOnce();
  }

  private async moveChatToSecondarySidebarOnce(): Promise<void> {
    const flagKey = 'computor.chat.movedToSecondarySidebar';
    if (this.context.globalState.get<boolean>(flagKey)) {
      return;
    }
    try {
      // Reveal the chat view so the move targets the right element, then move it
      // to the secondary (auxiliary) sidebar.
      await vscode.commands.executeCommand('computor.chat.inbox.focus');
      await vscode.commands.executeCommand('workbench.action.moveViewToAuxiliarySideBar');
      await this.context.globalState.update(flagKey, true);
    } catch (err) {
      console.warn('[ChatInbox] Could not auto-move to secondary sidebar:', err);
    }
  }

  async dispose(): Promise<void> {
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
    if (this.wsService) {
      this.wsService.dispose();
      this.wsService = undefined;
    }
    if (this.api) this.api.clearHttpClient();
    this.api = undefined;
    this.profileWebviewProvider = undefined;
  }

  getActiveViews(): string[] {
    return [...this.activeViews];
  }

  getHttpClient(): BearerTokenHttpClient | undefined {
    return this.httpClient;
  }

  private async checkInitialMaintenanceStatus(api: ComputorApiService): Promise<void> {
    try {
      const status = await api.getMaintenanceStatus();
      if (!status || !this.wsService) return;

      if (status.active) {
        this.httpClient?.setMaintenanceMode(true, status.message);
        this.wsService.updateMaintenanceStatusBar('active', status.message);
        notify.warning(`Maintenance Mode Active: ${status.message || 'System is under maintenance'}`);
      } else if (status.scheduled_at) {
        this.wsService.updateMaintenanceStatusBar('scheduled', status.message, status.scheduled_at);
        notify.info(`Maintenance Scheduled for ${new Date(status.scheduled_at).toLocaleString()}: ${status.message || 'Scheduled maintenance is planned'}`);
      }
    } catch (error) {
      // Non-critical — don't block startup
      console.warn('Failed to check initial maintenance status:', error);
    }
  }
}



interface UnifiedSession {
  deactivate: () => Promise<void>;
  getActiveViews: () => string[];
  getHttpClient: () => BearerTokenHttpClient | undefined;
}

let activeSession: UnifiedSession | null = null;
let offlineSession: OfflineSession | null = null;
let isAuthenticating = false;
let extensionUpdateService: ExtensionUpdateService | undefined;

const backendConnectionService = BackendConnectionService.getInstance();

/**
 * Offline session interface
 */
interface OfflineSession {
  deactivate: () => Promise<void>;
}

/**
 * Initialize offline mode - works without API
 */
async function initializeOfflineMode(context: vscode.ExtensionContext): Promise<void> {
  if (offlineSession) {
    notify.info('Offline mode is already active');
    return;
  }

  const workspaceRoot = getWorkspaceRoot();
  if (!workspaceRoot) {
    notify.error('Please open a folder first');
    return;
  }

  // Ensure student/ directory exists - create it automatically if not present
  const studentPath = path.join(workspaceRoot, 'student');
  if (!fs.existsSync(studentPath)) {
    try {
      fs.mkdirSync(studentPath, { recursive: true });
      console.log('[initializeOfflineMode] Created student/ directory');
    } catch (error: any) {
      notify.error(`Failed to create student/ directory: ${error.message}`);
      return;
    }
  }

  try {
    // Initialize offline view (no .computor marker needed for offline mode)
    const { StudentOfflineTreeProvider } = await import('./ui/tree/student/StudentOfflineTreeProvider');
    const { StudentOfflineCommands } = await import('./commands/StudentOfflineCommands');

    const offlineTree = new StudentOfflineTreeProvider(context);
    const offlineDisposables: vscode.Disposable[] = [];
    registerTreeView('computor.student.offline.view', {
      provider: offlineTree,
      options: { showCollapseAll: true }
    }, offlineDisposables);

    // Register offline commands
    const offlineCommands = new StudentOfflineCommands(context, offlineTree);
    offlineCommands.registerCommands();

    // Set context to show offline view
    await vscode.commands.executeCommand('setContext', 'computor.student.offline.show', true);

    // Focus on offline view
    await vscode.commands.executeCommand('workbench.view.extension.computor-student-offline');

    offlineSession = {
      deactivate: async () => {
        for (const d of offlineDisposables) d.dispose();
        await vscode.commands.executeCommand('setContext', 'computor.student.offline.show', false);
      }
    };

    notify.info('✓ Offline mode activated');
  } catch (error: any) {
    console.error('Failed to initialize offline mode:', error);
    notify.error(`Failed to initialize offline mode: ${error.message}`);
  }
}

async function unifiedLoginFlow(context: vscode.ExtensionContext): Promise<void> {
  if (isAuthenticating) { notify.info('Login already in progress.'); return; }
  // Claim the in-flight guard synchronously, before any await, so a second
  // trigger (e.g. the auto-login prompt) can't race us into a duplicate
  // controller.activate().
  isAuthenticating = true;
  try {
    // Require an open workspace before proceeding
    const root = getWorkspaceRoot();
    if (!root) {
      await promptOpenWorkspaceFolder();
      return;
    }

    const settings = new ComputorSettingsManager(context);
    const baseUrl = await ensureBaseUrl(settings);
    if (!baseUrl) { return; }

    // Already signed in → offer in-place SSO re-authentication. We update the
    // existing client's tokens rather than tearing down the session, so role
    // commands held on context.subscriptions aren't re-registered.
    if (activeSession) {
      const answer = await notify.warning(
        `Already logged in with views: ${activeSession.getActiveViews().join(', ')}. Re-authenticate?`,
        'Re-authenticate', 'Cancel'
      );
      if (answer !== 'Re-authenticate') { return; }

      const existing = activeSession.getHttpClient?.();
      if (!(existing instanceof BearerTokenHttpClient)) {
        notify.info('Already signed in with an API token; nothing to refresh.');
        return;
      }

      try {
        const sso = await runSsoWithProgress(baseUrl);
        const now = new Date();
        existing.setTokenData({
          accessToken: sso.token,
          refreshToken: sso.refreshToken,
          expiresAt: new Date(now.getTime() + 3600_000),
          issuedAt: now,
          userId: sso.userId
        });
        await persistSession(context, sessionAuthFromClient(existing));
        notify.info(`Re-authenticated: ${baseUrl}`);
      } catch (error: any) {
        notify.error(`Re-authentication failed: ${error?.message || error}`);
      }
      return;
    }

    backendConnectionService.setBaseUrl(baseUrl);
    const status = await backendConnectionService.checkBackendConnection(baseUrl);
    if (!status.isReachable) {
      await backendConnectionService.showConnectionError(status);
      return;
    }

    let sso: SsoLoginResult;
    try {
      sso = await runSsoWithProgress(baseUrl);
    } catch (error: any) {
      // Cancelled, timed out, or the browser handshake failed.
      notify.warning(`Sign-in not completed: ${error?.message || error}`);
      return;
    }

    const client = buildSessionClient(baseUrl, sso);
    try {
      await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'Computor',
        cancellable: false
      }, async (progress) => {
        progress.report({ message: 'Loading your courses…' });
        await activateSession(context, baseUrl, client, (m) => progress.report({ message: m }));
      });
    } catch (error: any) {
      console.error('Login failed:', error);
      backendConnectionService.stopHealthCheck();
      notify.error(`Login failed: ${error?.message || error}`);
      return;
    }

    await persistSession(context, sessionAuthFromClient(client));
    notify.info(
      sso.isNewUser ? 'Welcome to Computor! Your account has been set up.' : `Logged in: ${baseUrl}`
    );
  } finally {
    isAuthenticating = false;
  }
}


// Automatic login prompt when .computor file is detected

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  console.log('Computor extension activated');
  IconGenerator.initialize(context);

  // Initialize error catalogs
  errorCatalog.initialize();
  clientErrorCatalog.initialize();

  const settingsManager = new ComputorSettingsManager(context);
  extensionUpdateService = new ExtensionUpdateService(context, settingsManager);

  // How the workspace looked when it was last closed: which container was
  // open, which nodes were expanded, what was selected. Set up before any
  // tree is built, because every provider reads it on its first render.
  const uiState = UiStateService.initialize(context);
  await uiState.migrateLegacyExpansion(settingsManager);

  // Initialize all view contexts to false to hide views until login
  await setViewContextKeys([], ['student', 'tutor', 'lecturer', 'student.offline']);

  // Plots. A workspace container has no desktop, so plotting libraries publish
  // figures as files and this shows them. Independent of login and of role:
  // the figures come from the student's own code, not from the backend.
  registerFigureViewer(context);

  // Opening a PNG. The built-in image editor cannot show one under code-server
  // in Firefox or older Safari — its picture, stylesheet and script all come
  // through a service worker that never sees the request (issue #282) — so we
  // bring our own, inlined like every other Computor webview.
  registerImageViewer(context);

  // Which editor group a file opens in. Registered before any tree is built,
  // because every tree item's click binds to computor.openFile.
  registerEditorLayout(context);

  // Unified login command (Keycloak SSO browser flow)
  context.subscriptions.push(vscode.commands.registerCommand('computor.login', async () => unifiedLoginFlow(context)));

  // Advanced: sign in with a Computor API token (non-SSO escape hatch)
  context.subscriptions.push(vscode.commands.registerCommand('computor.loginWithApiToken', async () => apiTokenLoginFlow(context)));

  // Privacy-policy consent: open the web app's consent page. Shared by the
  // consent-gate notification button and the "accept the privacy policy" tree
  // node (see utils/consentGate.ts).
  context.subscriptions.push(vscode.commands.registerCommand('computor.acceptPrivacyPolicy', async () => {
    const { openConsentPage } = await import('./utils/consentGate');
    await openConsentPage();
  }));

  // Logout / clear-data commands — registered for ALL roles (not just lecturers),
  // and available even when signed out. SSO sessions expire, so every role needs
  // to be able to sign out and back in.
  new LogoutCommands(context).registerCommands();

  // Settings view command (backend URL, git config, GitLab tokens)
  new SettingsCommands(context).register();

  // Offline mode login command
  context.subscriptions.push(vscode.commands.registerCommand('computor.loginOffline', async () => {
    await initializeOfflineMode(context);
  }));

  context.subscriptions.push(vscode.commands.registerCommand('computor.manageRepositoryTokens', async () => {
    await manageRepositoryTokens(context);
  }));

  context.subscriptions.push(vscode.commands.registerCommand('computor.configureGit', async () => {
    await configureGit();
  }));

  context.subscriptions.push(vscode.commands.registerCommand('computor.gettingStarted', async () => {
    await showGettingStarted(context);
  }));

  // Check backend connection command
  context.subscriptions.push(vscode.commands.registerCommand('computor.checkBackendConnection', async () => {
    try {
      const settings = new ComputorSettingsManager(context);
      const baseUrl = await settings.getBaseUrl();

      if (!baseUrl) {
        const action = await notify.warning(
          'No backend URL configured. Would you like to configure it now?',
          'Configure',
          'Cancel'
        );
        if (action === 'Configure') {
          await vscode.commands.executeCommand('computor.changeRealmUrl');
        }
        return;
      }

      const backendConnectionService = BackendConnectionService.getInstance();
      backendConnectionService.setBaseUrl(baseUrl);

      await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'Checking backend connection...',
        cancellable: false
      }, async () => {
        const status = await backendConnectionService.checkBackendConnection(baseUrl);

        if (status.isReachable) {
          notify.info(`✓ Backend is reachable at ${baseUrl}`);
        } else {
          await backendConnectionService.showConnectionError(status);
        }
      });
    } catch (error: any) {
      console.error('Backend connection check failed:', error);

      let errorMessage = 'Unknown error';
      if (error?.message) {
        errorMessage = error.message;
      } else if (typeof error === 'string') {
        errorMessage = error;
      } else if (error?.toString) {
        errorMessage = error.toString();
      }

      const fullError = error?.stack ? `${errorMessage}\n\nStack trace:\n${error.stack}` : errorMessage;
      console.error('Full error details:', fullError);

      notify.error(
        `Backend connection check failed: ${errorMessage}`,
        'Show Details'
      ).then(selection => {
        if (selection === 'Show Details') {
          notify.modal('error', fullError);
        }
      });
    }
  }));
  
  // Check if workspace has .computor file and automatically login if enabled
  const workspaceRoot = getWorkspaceRoot();
  if (workspaceRoot && !activeSession) {
    const computorMarkerPath = path.join(workspaceRoot, computorMarker);
    if (fs.existsSync(computorMarkerPath)) {
      void handleComputorWorkspaceDetected(context, computorMarkerPath);
    }
  }

  // Change backend URL command
  context.subscriptions.push(vscode.commands.registerCommand('computor.changeRealmUrl', async () => {
    const settings = new ComputorSettingsManager(context);
    const url = await vscode.window.showInputBox({
      title: 'Set Computor Backend URL',
      value: await settings.getBaseUrl(),
      prompt: 'Enter the base URL of the Computor API',
      ignoreFocusOut: true,
      validateInput: (v) => { try { new URL(v); return undefined; } catch { return 'Enter a valid URL'; } }
    });
    if (!url) return;
    await settings.setBaseUrl(url);

    backendConnectionService.setBaseUrl(url);
    const status = await backendConnectionService.checkBackendConnection(url);
    if (status.isReachable) {
      backendConnectionService.startHealthCheck(url);
      notify.info('Computor backend URL updated.');
    } else {
      backendConnectionService.stopHealthCheck();
      await backendConnectionService.showConnectionError(status);
    }
  }));

  // Listen for workspace folder changes to detect .computor files
  context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(() => {
    const workspaceRoot = getWorkspaceRoot();
    if (workspaceRoot) {
      const computorMarkerPath = path.join(workspaceRoot, computorMarker);
      if (fs.existsSync(computorMarkerPath)) {
        void handleComputorWorkspaceDetected(context, computorMarkerPath);
      }
    }
  }));

  // Toggle auto-login command
  context.subscriptions.push(vscode.commands.registerCommand('computor.toggleAutoLogin', async () => {
    const settings = new ComputorSettingsManager(context);
    const currentValue = await settings.isAutoLoginEnabled();
    const newValue = currentValue !== true;
    await settings.setAutoLoginEnabled(newValue);
    notify.info(
      `Auto-login ${newValue ? 'enabled' : 'disabled'}. ${newValue ? 'You will be automatically logged in when opening Computor workspaces.' : 'You will be prompted to login when opening Computor workspaces.'}`
    );
  }));

  // Legacy alias kept for existing keybindings. It used to open VS Code's own
  // settings filtered by "computor", which showed an empty page: the extension
  // contributes no `configuration` section - the real settings live in
  // ~/.computor/config.json and are edited through the settings webview. It is
  // hidden from the command palette so only one Settings entry is offered.
  context.subscriptions.push(vscode.commands.registerCommand('computor.settings', async () => {
    await vscode.commands.executeCommand('computor.settingsView');
  }));

}

export async function deactivate(): Promise<void> {
  if (activeSession) {
    await activeSession.deactivate();
    activeSession = null;
  }
  // Writes are debounced, so the last expand or click before the window closes
  // would otherwise never reach disk — which is the exact moment it matters.
  // Runs even without a session, since state changes before login too.
  await UiStateService.getInstanceOrUndefined()?.flush();
  IconGenerator.cleanup();
}
