import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { IconGenerator } from './utils/IconGenerator';
import { errorCatalog } from './exceptions/ErrorCatalog';

import { ComputorSettingsManager } from './settings/ComputorSettingsManager';
import { ComputorApiService } from './services/ComputorApiService';
// GitLabTokenManager is dynamically imported in code blocks below
// import { GitLabTokenManager } from './services/GitLabTokenManager';

import { BearerTokenHttpClient } from './http/BearerTokenHttpClient';
import { ApiKeyHttpClient } from './http/ApiKeyHttpClient';
import { WebSocketService } from './services/WebSocketService';
import { BackendConnectionService } from './services/BackendConnectionService';
import { GitEnvironmentService } from './services/GitEnvironmentService';
import { ExtensionUpdateService } from './services/ExtensionUpdateService';

import { LecturerTreeDataProvider } from './ui/tree/lecturer/LecturerTreeDataProvider';
import { LecturerExampleTreeProvider } from './ui/tree/lecturer/LecturerExampleTreeProvider';
import { LecturerCommands } from './commands/LecturerCommands';
import { LecturerExampleCommands } from './commands/LecturerExampleCommands';
import { LecturerFsCommands } from './commands/LecturerFsCommands';
import { UserPasswordCommands } from './commands/UserPasswordCommands';
import { SignUpCommands } from './commands/SignUpCommands';
import { LogoutCommands } from './commands/LogoutCommands';
import { UserProfileWebviewProvider } from './ui/webviews/UserProfileWebviewProvider';

import { StudentCourseContentTreeProvider } from './ui/tree/student/StudentCourseContentTreeProvider';
import { StudentRepositoryManager } from './services/StudentRepositoryManager';
import { CourseSelectionService } from './services/CourseSelectionService';
import { StudentCommands } from './commands/StudentCommands';

import { TutorCommands } from './commands/TutorCommands';

import { TestResultsPanelProvider, TestResultsTreeDataProvider } from './ui/panels/TestResultsPanel';
import { TestResultService } from './services/TestResultService';
import { MessagesInputPanelProvider } from './ui/panels/MessagesInputPanel';
import { manageGitLabTokens } from './commands/manageGitLabTokens';
import { configureGit } from './commands/configureGit';
import { showGettingStarted } from './commands/showGettingStarted';

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

async function attemptSilentAutoLogin(
  context: vscode.ExtensionContext,
  baseUrl: string,
  username: string,
  password: string,
  onProgress?: (message: string) => void
): Promise<boolean> {
  try {
    const client = new BearerTokenHttpClient(baseUrl, 5000);
    await client.authenticateWithCredentials(username, password);

    const tokenData = client.getTokenData();
    const auth: StoredAuth = {
      accessToken: tokenData.accessToken!,
      refreshToken: tokenData.refreshToken || undefined,
      expiresAt: tokenData.expiresAt?.toISOString(),
      issuedAt: tokenData.issuedAt?.toISOString(),
      userId: tokenData.userId || undefined
    };

    await ensureWorkspaceMarker(baseUrl);
    const controller = new UnifiedController(context);

    await controller.activate(client as any, onProgress);
    backendConnectionService.startHealthCheck(baseUrl);

    activeSession = {
      deactivate: () => controller.dispose().then(async () => {
        await vscode.commands.executeCommand('setContext', 'computor.lecturer.show', false);
        await vscode.commands.executeCommand('setContext', 'computor.student.show', false);
        await vscode.commands.executeCommand('setContext', 'computor.tutor.show', false);
        await context.globalState.update('computor.tutor.selection', undefined);
        backendConnectionService.stopHealthCheck();
      }),
      getActiveViews: () => controller.getActiveViews(),
      getHttpClient: () => controller.getHttpClient()
    };

    await context.secrets.store('computor.auth', JSON.stringify(auth));

    if (extensionUpdateService) {
      extensionUpdateService.checkForUpdates().catch(err => {
        console.warn('Extension update check failed:', err);
      });
    }

    return true;
  } catch (error: any) {
    console.error('Auto-login failed:', error);
    return false;
  }
}

async function promptCredentials(
  previous?: { username?: string; password?: string },
  currentAutoLogin?: boolean
): Promise<{ username: string; password: string; enableAutoLogin?: boolean } | undefined> {
  const username = await vscode.window.showInputBox({
    title: 'Computor Login',
    prompt: 'Username',
    value: previous?.username,
    ignoreFocusOut: true
  });
  if (!username) return undefined;

  const password = await vscode.window.showInputBox({
    title: 'Computor Login',
    prompt: 'Password',
    value: previous?.password,
    password: true,
    ignoreFocusOut: true
  });
  if (!password) return undefined;

  // Only ask about auto-login if the setting is undefined (not yet configured)
  let enableAutoLogin: boolean | undefined = currentAutoLogin;

  if (currentAutoLogin === undefined) {
    const autoLoginChoice = await vscode.window.showQuickPick(
      [
        {
          label: '$(check) Enable auto-login',
          description: 'Automatically login when opening this workspace',
          picked: false,
          value: true
        },
        {
          label: '$(close) Disable auto-login',
          description: 'Always prompt for login',
          picked: true,
          value: false
        }
      ],
      {
        title: 'Computor Login - Auto-Login Settings',
        placeHolder: 'Choose whether to enable auto-login with stored credentials',
        ignoreFocusOut: true
      }
    );

    enableAutoLogin = autoLoginChoice?.value ?? false;
  }

  return { username, password, enableAutoLogin };
}

function buildHttpClient(baseUrl: string, auth: StoredAuth): BearerTokenHttpClient {
  const client = new BearerTokenHttpClient(baseUrl, 5000);
  client.setTokenData({
    accessToken: auth.accessToken,
    refreshToken: auth.refreshToken,
    expiresAt: auth.expiresAt ? new Date(auth.expiresAt) : undefined,
    issuedAt: auth.issuedAt ? new Date(auth.issuedAt) : undefined,
    userId: auth.userId
  });
  return client;
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
 * Result of auto-login attempt
 */
interface AutoLoginResult {
  success: boolean;
  shouldPromptManualLogin: boolean;
}

/**
 * Handles automatic login when .computor file is detected in workspace.
 * Consolidates duplicated auto-login logic from activation and workspace change handlers.
 */
/**
 * Attempt login using a pre-minted API token from the COMPUTOR_AUTH_TOKEN env var.
 * Returns true if successful, false otherwise.
 */
async function attemptApiTokenLogin(
  context: vscode.ExtensionContext,
  baseUrl: string,
  apiToken: string,
  onProgress?: (message: string) => void
): Promise<boolean> {
  try {
    const client = new ApiKeyHttpClient(baseUrl, apiToken, 'X-API-Token', '', 5000);

    await ensureWorkspaceMarker(baseUrl);
    const controller = new UnifiedController(context);

    await controller.activate(client as any, onProgress);
    backendConnectionService.startHealthCheck(baseUrl);

    activeSession = {
      deactivate: () => controller.dispose().then(async () => {
        await vscode.commands.executeCommand('setContext', 'computor.lecturer.show', false);
        await vscode.commands.executeCommand('setContext', 'computor.student.show', false);
        await vscode.commands.executeCommand('setContext', 'computor.tutor.show', false);
        await context.globalState.update('computor.tutor.selection', undefined);
        backendConnectionService.stopHealthCheck();
      }),
      getActiveViews: () => controller.getActiveViews(),
      getHttpClient: () => controller.getHttpClient()
    };

    if (extensionUpdateService) {
      extensionUpdateService.checkForUpdates().catch(err => {
        console.warn('Extension update check failed:', err);
      });
    }

    return true;
  } catch (error: any) {
    console.error('API token login failed:', error);
    return false;
  }
}

async function handleComputorWorkspaceDetected(
  context: vscode.ExtensionContext,
  computorMarkerPath: string
): Promise<void> {
  const settings = new ComputorSettingsManager(context);

  // Priority 1: Try API token from environment variable (Coder workspace injection)
  const apiToken = process.env.COMPUTOR_AUTH_TOKEN;
  if (apiToken) {
    const marker = await readMarker(computorMarkerPath);
    const baseUrl = marker?.backendUrl || await settings.getBaseUrl();

    if (baseUrl) {
      const success = await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'Computor',
        cancellable: false
      }, async (progress) => {
        progress.report({ message: 'Connecting (workspace token)...' });
        backendConnectionService.setBaseUrl(baseUrl);
        const status = await backendConnectionService.checkBackendConnection(baseUrl);
        if (!status.isReachable) {
          return false;
        }
        progress.report({ message: 'Authenticating...' });
        return await attemptApiTokenLogin(
          context, baseUrl, apiToken,
          (msg) => progress.report({ message: msg })
        );
      });

      if (success) {
        vscode.window.showInformationMessage(`Logged in (workspace token): ${baseUrl}`);
        return;
      }
      console.warn('API token login failed, falling back to credential-based login');
    }
  }

  // Priority 2: Stored credentials auto-login (existing flow)
  const autoLoginEnabled = await settings.isAutoLoginEnabled();
  const storedUsername = await context.secrets.get('computor.username');
  const storedPassword = await context.secrets.get('computor.password');

  if (autoLoginEnabled && storedUsername && storedPassword) {
    const result = await performAutoLogin(context, computorMarkerPath, storedUsername, storedPassword);

    if (!result.success && result.shouldPromptManualLogin) {
      const action = await vscode.window.showWarningMessage(
        'Auto-login failed. Would you like to login manually?',
        'Login',
        'Not Now'
      );
      if (action === 'Login') {
        await unifiedLoginFlow(context);
      }
    }
  } else if (autoLoginEnabled === false) {
    // Auto-login is explicitly disabled - show prompt
    const action = await vscode.window.showInformationMessage(
      'Computor workspace detected. Would you like to login?',
      'Login',
      'Not Now'
    );
    if (action === 'Login') {
      await unifiedLoginFlow(context);
    }
  }
  // If autoLogin is true but no credentials are stored, do nothing (silent)
}

/**
 * Performs the actual auto-login attempt with a single unified progress notification.
 */
async function performAutoLogin(
  context: vscode.ExtensionContext,
  computorMarkerPath: string,
  username: string,
  password: string
): Promise<AutoLoginResult> {
  let loginFailed = false;

  await vscode.window.withProgress({
    location: vscode.ProgressLocation.Notification,
    title: 'Computor',
    cancellable: false
  }, async (progress) => {
    try {
      progress.report({ message: 'Connecting to backend...' });

      const settings = new ComputorSettingsManager(context);
      const marker = await readMarker(computorMarkerPath);
      const baseUrl = marker?.backendUrl || await settings.getBaseUrl();

      if (!baseUrl) {
        loginFailed = true;
        return;
      }

      backendConnectionService.setBaseUrl(baseUrl);
      const connectionStatus = await backendConnectionService.checkBackendConnection(baseUrl);
      if (!connectionStatus.isReachable) {
        await backendConnectionService.showConnectionError(connectionStatus);
        loginFailed = true;
        return;
      }

      progress.report({ message: 'Authenticating...' });

      const success = await attemptSilentAutoLogin(
        context,
        baseUrl,
        username,
        password,
        (msg) => progress.report({ message: msg })
      );

      if (success) {
        vscode.window.showInformationMessage(`Logged in: ${baseUrl}`);
      } else {
        loginFailed = true;
      }
    } catch (error: any) {
      console.warn('Auto-login failed:', error);
      loginFailed = true;
    }
  });

  return {
    success: !loginFailed,
    shouldPromptManualLogin: loginFailed
  };
}

async function ensureWorkspaceMarker(baseUrl: string): Promise<void> {
  const root = getWorkspaceRoot();
  if (!root) {
    const action = await vscode.window.showErrorMessage('Login requires an open workspace.', 'Open Folder');
    if (action === 'Open Folder') {
      // Let the user select a folder to open as workspace
      const folderUri = await vscode.window.showOpenDialog({
        canSelectFolders: true,
        canSelectFiles: false,
        canSelectMany: false,
        openLabel: 'Select Workspace Folder'
      });

      if (folderUri && folderUri.length > 0) {
        // No longer storing pending login - will auto-detect .computor file instead

        // Add the folder to the current workspace
        // This will restart the extension if no workspace was open
        const workspaceFolders = vscode.workspace.workspaceFolders || [];
        vscode.workspace.updateWorkspaceFolders(
          workspaceFolders.length,
          0,
          { uri: folderUri[0]!, name: path.basename(folderUri[0]!.fsPath) }
        );

        // If we had existing workspace folders, the extension won't restart
        // In that case, we can continue immediately
        if (workspaceFolders.length > 0) {
          // Give VS Code a moment to update
          await new Promise(resolve => setTimeout(resolve, 100));
          // Recursively call to handle the marker with the new workspace
          await ensureWorkspaceMarker(baseUrl);
          return;
        }

        // Extension will restart
        return;
      }
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
  private wsService?: WebSocketService;

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

    // Initialize WebSocket service for real-time messaging
    const settingsManager = new ComputorSettingsManager(this.context);
    this.wsService = WebSocketService.getInstance(settingsManager);
    this.wsService.setHttpClient(client);
    this.messagesInputPanel.setWebSocketService(this.wsService);

    // Connect WebSocket (fire-and-forget, will reconnect automatically on failure)
    void this.wsService.connect();

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

    // Initialize ALL available views - each will get its own activity bar container
    // Each view will fetch and display all available courses
    if (views.includes('student')) {
      report('Setting up student view...');
      await this.initializeStudentView(api, onProgress);
      await vscode.commands.executeCommand('setContext', 'computor.student.show', true);
    }
    if (views.includes('tutor')) {
      report('Setting up tutor view...');
      await this.initializeTutorView(api);
      await vscode.commands.executeCommand('setContext', 'computor.tutor.show', true);
    }
    if (views.includes('lecturer')) {
      report('Setting up lecturer view...');
      await this.initializeLecturerView(api);
      await vscode.commands.executeCommand('setContext', 'computor.lecturer.show', true);
    }
    if (views.includes('user_manager')) {
      report('Setting up user manager view...');
      await this.initializeUserManagerView(api);
      await vscode.commands.executeCommand('setContext', 'computor.user_manager.show', true);
    }

    // Set context keys for views that are NOT available to false
    if (!views.includes('student')) {
      await vscode.commands.executeCommand('setContext', 'computor.student.show', false);
    }
    if (!views.includes('tutor')) {
      await vscode.commands.executeCommand('setContext', 'computor.tutor.show', false);
    }
    if (!views.includes('lecturer')) {
      await vscode.commands.executeCommand('setContext', 'computor.lecturer.show', false);
    }
    if (!views.includes('user_manager')) {
      await vscode.commands.executeCommand('setContext', 'computor.user_manager.show', false);
    }
  }

  private async focusHighestPriorityView(views: string[]): Promise<void> {
    // Priority: lecturer > tutor > student
    let viewToFocus: string | null = null;
    let commandToRun: string | null = null;

    if (views.includes('lecturer')) {
      viewToFocus = 'lecturer';
      commandToRun = 'workbench.view.extension.computor-lecturer';
    } else if (views.includes('tutor')) {
      viewToFocus = 'tutor';
      commandToRun = 'workbench.view.extension.computor-tutor';
    } else if (views.includes('student')) {
      viewToFocus = 'student';
      commandToRun = 'workbench.view.extension.computor-student';
    }

    if (commandToRun) {
      try {
        await vscode.commands.executeCommand(commandToRun);
        console.log(`Focused on ${viewToFocus} view after login`);
      } catch (err) {
        console.warn(`Failed to focus on ${viewToFocus} view:`, err);
      }
    }
  }

  private async initializeStudentView(
    api: ComputorApiService,
    onProgress?: (message: string) => void
  ): Promise<void> {
    const report = onProgress || (() => {});

    // Initialize student-specific components
    const repositoryManager = new StudentRepositoryManager(this.context, api);
    const statusBar = (await import('./ui/StatusBarService')).StatusBarService.initialize(this.context);
    const courseSelectionService = CourseSelectionService.initialize(this.context, api, statusBar);

    // Initialize tree view
    const tree = new StudentCourseContentTreeProvider(api, courseSelectionService, repositoryManager, this.context);
    this.disposables.push(vscode.window.registerTreeDataProvider('computor.student.courses', tree));
    const treeView = vscode.window.createTreeView('computor.student.courses', { treeDataProvider: tree, showCollapseAll: true });
    this.disposables.push(treeView);

    const studentExpandListener = treeView.onDidExpandElement((event) => {
      const element = event.element;
      if (!element) return;
      void tree.onTreeItemExpanded(element);
    });
    const studentCollapseListener = treeView.onDidCollapseElement((event) => {
      const element = event.element;
      if (!element) return;
      void tree.onTreeItemCollapsed(element);
    });
    const studentSelectionListener = treeView.onDidChangeSelection((event) => {
      const selected = event.selection[0];
      if (!selected) return;
      // Show test results automatically when an assignment is selected
      if (selected.contextValue?.startsWith('studentCourseContent.assignment')) {
        if ((selected as any).courseContent?.result) {
          void vscode.commands.executeCommand('computor.showTestResults', selected);
        } else {
          // Clear results view when selecting an assignment without results
          void vscode.commands.executeCommand('computor.results.clear');
        }
      }
    });
    const studentVisibilityListener = treeView.onDidChangeVisibility((event) => {
      if (event.visible) {
        // Clear results view when switching to student view
        void vscode.commands.executeCommand('computor.results.clear');
      }
    });
    this.disposables.push(studentExpandListener, studentCollapseListener, studentSelectionListener, studentVisibilityListener);

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
      const setupRepositories = async (progressReport: (msg: string) => void) => {
        progressReport('Preparing repositories...');
        try {
          await repositoryManager.autoSetupRepositories(undefined, progressReport, expandedCourseIds);
        } catch (e) {
          console.error('[initializeStudentView] Repository auto-setup failed:', e);
        }
        tree.refresh();
      };

      if (onProgress) {
        await setupRepositories(report);
      } else {
        await vscode.window.withProgress({
          location: vscode.ProgressLocation.Notification,
          title: 'Preparing course repositories...',
          cancellable: false
        }, async (progress) => {
          await setupRepositories((msg) => progress.report({ message: msg }));
        });
      }
    } else {
      console.log('[initializeStudentView] No expanded courses, skipping initial repository setup');
    }

    // Student commands
    const commands = new StudentCommands(this.context, tree, api, repositoryManager, this.messagesInputPanel, this.wsService);
    commands.registerCommands();

    // Results panel + tree
    const panelProvider = new TestResultsPanelProvider(this.context.extensionUri);
    this.disposables.push(vscode.window.registerWebviewViewProvider(TestResultsPanelProvider.viewType, panelProvider));
    const resultsTree = new TestResultsTreeDataProvider([]);
    resultsTree.setPanelProvider(panelProvider);
    this.disposables.push(vscode.window.registerTreeDataProvider('computor.testResultsView', resultsTree));
    TestResultService.getInstance().setApiService(api);
    this.disposables.push(vscode.commands.registerCommand('computor.results.open', async (results: any, resultId?: string, artifacts?: any[]) => {
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
    this.disposables.push(vscode.commands.registerCommand('computor.results.panel.update', (item: any) => {
      resultsTree.setSelectedNodeId(item.id);
      panelProvider.updateTestResults(item);
    }));
    this.disposables.push(vscode.commands.registerCommand('computor.results.clear', () => {
      resultsTree.clearResultArtifacts();
      resultsTree.refresh({});
      panelProvider.clearResults();
    }));
    this.disposables.push(vscode.commands.registerCommand('computor.results.artifact.open', async (resultId: string, artifactInfo: any) => {
      try {
        await this.openResultArtifact(api, resultId, artifactInfo);
      } catch (e) {
        console.error('Failed to open artifact:', e);
        vscode.window.showErrorMessage(`Failed to open artifact: ${e instanceof Error ? e.message : String(e)}`);
      }
    }));
  }

  private async openResultArtifact(api: ComputorApiService, resultId: string, artifactInfo: any): Promise<void> {
    const { WorkspaceStructureManager } = await import('./utils/workspaceStructure');
    const fs = await import('fs');
    const path = await import('path');
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
        vscode.window.showInformationMessage('Artifacts downloaded but no files found to open');
      }
    }
  }

  private async openArtifactFile(filePath: string): Promise<void> {
    const fileUri = vscode.Uri.file(filePath);
    const ext = filePath.toLowerCase().split('.').pop() || '';

    const imageExtensions = ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg', 'ico'];
    const binaryExtensions = ['pdf', 'zip', 'tar', 'gz', 'rar', '7z', 'exe', 'dll', 'so', 'dylib', 'bin', 'dat'];

    if (imageExtensions.includes(ext)) {
      await vscode.commands.executeCommand('vscode.open', fileUri, { preview: false });
    } else if (binaryExtensions.includes(ext)) {
      await vscode.commands.executeCommand('revealFileInOS', fileUri);
      vscode.window.showInformationMessage(`Binary file revealed in file explorer: ${filePath.split('/').pop()}`);
    } else {
      const doc = await vscode.workspace.openTextDocument(fileUri);
      await vscode.window.showTextDocument(doc, { preview: false });
    }
  }

  private async initializeTutorView(api: ComputorApiService): Promise<void> {
    // Register filter panel and tree
    const { TutorFilterPanelProvider } = await import('./ui/panels/TutorFilterPanel');
    const { TutorSelectionService } = await import('./services/TutorSelectionService');
    const { TutorStatusBarService } = await import('./ui/TutorStatusBarService');
    const { TutorEditorDecorationService } = await import('./providers/TutorEditorDecorationService');
    const selection = TutorSelectionService.initialize(this.context, api);

    // Initialize editor decoration service for in-editor student name display
    const editorDecorationService = TutorEditorDecorationService.initialize(this.context);
    editorDecorationService.connectToSelectionService(selection);

    // Don't pre-select any course - tutor will show all courses in dropdown
    const filterProvider = new TutorFilterPanelProvider(this.context.extensionUri, api, selection);
    this.disposables.push(vscode.window.registerWebviewViewProvider(TutorFilterPanelProvider.viewType, filterProvider));

    const { TutorStudentTreeProvider } = await import('./ui/tree/tutor/TutorStudentTreeProvider');
    const tree = new TutorStudentTreeProvider(api, selection);
    this.disposables.push(vscode.window.registerTreeDataProvider('computor.tutor.courses', tree));
    const treeView = vscode.window.createTreeView('computor.tutor.courses', { treeDataProvider: tree, showCollapseAll: true });
    this.disposables.push(treeView);

    // Track collapse events to update expansion cache
    const tutorCollapseListener = treeView.onDidCollapseElement((event) => {
      tree.handleCollapse(event.element);
    });
    this.disposables.push(tutorCollapseListener);

    // Checkout and show test results automatically when an assignment is selected
    const tutorSelectionListener = treeView.onDidChangeSelection((event) => {
      const selected = event.selection[0];
      if (!selected) return;
      if (selected.contextValue?.startsWith('tutorStudentContent.assignment')) {
        // Trigger checkout for the assignment (confirmRedownload=false: always download without asking)
        void vscode.commands.executeCommand('computor.tutor.checkout', selected, false);

        // Show test results if available
        if ((selected as any).content?.result) {
          void vscode.commands.executeCommand('computor.showTestResults', { courseContent: (selected as any).content });
        } else {
          void vscode.commands.executeCommand('computor.results.clear');
        }
      }
    });
    const tutorVisibilityListener = treeView.onDidChangeVisibility((event) => {
      if (event.visible) {
        // Clear results view when switching to tutor view
        void vscode.commands.executeCommand('computor.results.clear');
      }
    });
    this.disposables.push(tutorSelectionListener, tutorVisibilityListener);

    // Status bar: show selection and allow reset
    const tutorStatus = TutorStatusBarService.initialize();
    const updateStatus = async () => {
      const courseLabel = selection.getCurrentCourseLabel() || selection.getCurrentCourseId();
      const groupLabel = selection.getCurrentGroupLabel() || selection.getCurrentGroupId();
      const memberLabel = selection.getCurrentMemberLabel() || selection.getCurrentMemberId();
      tutorStatus.updateSelection(courseLabel, groupLabel, memberLabel);
    };
    this.disposables.push(selection.onDidChangeSelection(() => { void updateStatus(); }));
    void updateStatus();

    // Reset filters command
    this.disposables.push(vscode.commands.registerCommand('computor.tutor.resetFilters', async () => {
      const id = selection.getCurrentCourseId();
      if (!id) {
        return;
      }
      const label = selection.getCurrentCourseLabel();
      await selection.selectCourse(id, label);
      filterProvider.refreshFilters();
    }));

    const commands = new TutorCommands(this.context, tree, api, filterProvider, this.messagesInputPanel, this.wsService);
    commands.registerCommands();
  }

  private async initializeLecturerView(api: ComputorApiService): Promise<void> {
    const tree = new LecturerTreeDataProvider(this.context, api);
    this.disposables.push(vscode.window.registerTreeDataProvider('computor.lecturer.courses', tree));

    const treeView = vscode.window.createTreeView('computor.lecturer.courses', {
      treeDataProvider: tree,
      showCollapseAll: true,
      canSelectMany: false,
      dragAndDropController: tree
    });
    this.disposables.push(treeView);

    const lecturerExpandListener = treeView.onDidExpandElement((event) => {
      const elementId = event.element?.id;
      if (!elementId) return;
      void tree.setNodeExpanded(elementId, true);
    });
    const lecturerCollapseListener = treeView.onDidCollapseElement((event) => {
      const elementId = event.element?.id;
      if (!elementId) return;
      void tree.setNodeExpanded(elementId, false);
    });
    const lecturerVisibilityListener = treeView.onDidChangeVisibility((event) => {
      if (event.visible) {
        // Clear results view when switching to lecturer view
        void vscode.commands.executeCommand('computor.results.clear');
      }
    });
    this.disposables.push(lecturerExpandListener, lecturerCollapseListener, lecturerVisibilityListener);

    const exampleTree = new LecturerExampleTreeProvider(this.context, api);
    const exampleTreeView = vscode.window.createTreeView('computor.lecturer.examples', {
      treeDataProvider: exampleTree,
      showCollapseAll: true,
      canSelectMany: true,
      dragAndDropController: exampleTree
    });
    this.disposables.push(exampleTreeView);

    const commands = new LecturerCommands(this.context, tree, api, this.messagesInputPanel, this.wsService);
    commands.registerCommands();

    // Register example-related commands (search, upload from ZIP, etc.)
    new LecturerExampleCommands(this.context, api, exampleTree);
    new LecturerFsCommands(this.context, api).register();
    new UserPasswordCommands(this.context, api).register();
    new LogoutCommands(this.context).registerCommands();

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
    this.disposables.push(vscode.window.registerTreeDataProvider('computor.usermanager.users', tree));

    const treeView = vscode.window.createTreeView('computor.usermanager.users', {
      treeDataProvider: tree,
      showCollapseAll: false
    });
    this.disposables.push(treeView);

    const userManagerVisibilityListener = treeView.onDidChangeVisibility((event) => {
      if (event.visible) {
        // Clear results view when switching to user manager view
        void vscode.commands.executeCommand('computor.results.clear');
      }
    });
    this.disposables.push(userManagerVisibilityListener);

    const commands = new UserManagerCommands(this.context, tree, api);
    commands.registerCommands();
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
    vscode.window.showInformationMessage('Offline mode is already active');
    return;
  }

  const workspaceRoot = getWorkspaceRoot();
  if (!workspaceRoot) {
    vscode.window.showErrorMessage('Please open a folder first');
    return;
  }

  // Ensure student/ directory exists - create it automatically if not present
  const studentPath = path.join(workspaceRoot, 'student');
  if (!fs.existsSync(studentPath)) {
    try {
      fs.mkdirSync(studentPath, { recursive: true });
      console.log('[initializeOfflineMode] Created student/ directory');
    } catch (error: any) {
      vscode.window.showErrorMessage(`Failed to create student/ directory: ${error.message}`);
      return;
    }
  }

  try {
    // Initialize offline view (no .computor marker needed for offline mode)
    const { StudentOfflineTreeProvider } = await import('./ui/tree/student/StudentOfflineTreeProvider');
    const { StudentOfflineCommands } = await import('./commands/StudentOfflineCommands');

    const offlineTree = new StudentOfflineTreeProvider(context);
    const treeDisposable = vscode.window.registerTreeDataProvider('computor.student.offline.view', offlineTree);

    const offlineTreeView = vscode.window.createTreeView('computor.student.offline.view', {
      treeDataProvider: offlineTree,
      showCollapseAll: true
    });

    // Register offline commands
    const offlineCommands = new StudentOfflineCommands(context, offlineTree);
    offlineCommands.registerCommands();

    // Set context to show offline view
    await vscode.commands.executeCommand('setContext', 'computor.student.offline.show', true);

    // Focus on offline view
    await vscode.commands.executeCommand('workbench.view.extension.computor-student-offline');

    offlineSession = {
      deactivate: async () => {
        treeDisposable.dispose();
        offlineTreeView.dispose();
        await vscode.commands.executeCommand('setContext', 'computor.student.offline.show', false);
      }
    };

    vscode.window.showInformationMessage('✓ Offline mode activated');
  } catch (error: any) {
    console.error('Failed to initialize offline mode:', error);
    vscode.window.showErrorMessage(`Failed to initialize offline mode: ${error.message}`);
  }
}

async function performTokenRefresh(
  context: vscode.ExtensionContext,
  baseUrl: string,
  session: UnifiedSession
): Promise<void> {
  const secretKey = 'computor.auth';
  const usernameKey = 'computor.username';
  const passwordKey = 'computor.password';

  const settings = new ComputorSettingsManager(context);
  const storedUsername = await context.secrets.get(usernameKey);
  const storedPassword = await context.secrets.get(passwordKey);
  const currentAutoLogin = await settings.isAutoLoginEnabled();
  const creds = await promptCredentials(
    storedUsername || storedPassword
      ? { username: storedUsername, password: storedPassword }
      : undefined,
    currentAutoLogin
  );
  if (!creds) { return; }

  backendConnectionService.setBaseUrl(baseUrl);
  const connectionStatus = await backendConnectionService.checkBackendConnection(baseUrl);
  if (!connectionStatus.isReachable) {
    await backendConnectionService.showConnectionError(connectionStatus);
    return;
  }

  const tempClient = new BearerTokenHttpClient(baseUrl, 5000);

  try {
    await tempClient.authenticateWithCredentials(creds.username, creds.password);
  } catch (error: any) {
    vscode.window.showErrorMessage(`Authentication failed: ${error.message}`);
    return;
  }

  const tokenData = tempClient.getTokenData();
  const auth: StoredAuth = {
    accessToken: tokenData.accessToken!,
    refreshToken: tokenData.refreshToken || undefined,
    expiresAt: tokenData.expiresAt?.toISOString(),
    userId: tokenData.userId || undefined
  };

  // Update the existing HTTP client with new tokens
  const existingClient = session.getHttpClient?.();
  if (existingClient && existingClient instanceof BearerTokenHttpClient) {
    existingClient.setTokens(
      auth.accessToken,
      auth.refreshToken,
      auth.expiresAt ? new Date(auth.expiresAt) : undefined,
      auth.userId
    );
  }

  await ensureWorkspaceMarker(baseUrl);

  await context.secrets.store(secretKey, JSON.stringify(auth));
  await context.secrets.store(usernameKey, creds.username);
  await context.secrets.store(passwordKey, creds.password);

  // Only update auto-login setting if user was asked (i.e., if it was undefined before)
  if (creds.enableAutoLogin !== undefined) {
    await settings.setAutoLoginEnabled(creds.enableAutoLogin);
  }

  vscode.window.showInformationMessage(`Re-authenticated successfully: ${baseUrl}`);
}

async function unifiedLoginFlow(context: vscode.ExtensionContext): Promise<void> {
  if (isAuthenticating) { vscode.window.showInformationMessage('Login already in progress.'); return; }
  isAuthenticating = true;

  try {
    // Require an open workspace before proceeding
    const root = getWorkspaceRoot();
    if (!root) {
      const action = await vscode.window.showErrorMessage('Login requires an open workspace.', 'Open Folder');
      if (action === 'Open Folder') {
        // Let the user select a folder to open as workspace
        const folderUri = await vscode.window.showOpenDialog({
          canSelectFolders: true,
          canSelectFiles: false,
          canSelectMany: false,
          openLabel: 'Select Workspace Folder'
        });

        if (folderUri && folderUri.length > 0) {
          // No longer storing pending login - will auto-detect .computor file instead

          // Add the folder to the current workspace
          // This will restart the extension if no workspace was open
          const workspaceFolders = vscode.workspace.workspaceFolders || [];
          vscode.workspace.updateWorkspaceFolders(
            workspaceFolders.length,
            0,
            { uri: folderUri[0]!, name: path.basename(folderUri[0]!.fsPath) }
          );
        }
      }
      return;
    }

    const settings = new ComputorSettingsManager(context);
    const baseUrl = await ensureBaseUrl(settings);
    if (!baseUrl) { return; }

    // If already logged in, refresh tokens without re-registering commands
    if (activeSession) {
      const currentViews = activeSession.getActiveViews();
      const answer = await vscode.window.showWarningMessage(
        `Already logged in with views: ${currentViews.join(', ')}. Re-login with different credentials?`,
        'Re-login', 'Cancel'
      );
      if (answer !== 'Re-login') { return; }

      // Perform token refresh without deactivating the session
      await performTokenRefresh(context, baseUrl, activeSession);
      return;
    }

    const secretKey = 'computor.auth';
    const usernameKey = 'computor.username';
    const passwordKey = 'computor.password';

    const storedUsername = await context.secrets.get(usernameKey);
    const storedPassword = await context.secrets.get(passwordKey);
    const currentAutoLogin = await settings.isAutoLoginEnabled();
    const creds = await promptCredentials(
      storedUsername || storedPassword
        ? { username: storedUsername, password: storedPassword }
        : undefined,
      currentAutoLogin
    );
    if (!creds) { return; }

    backendConnectionService.setBaseUrl(baseUrl);
    const connectionStatus = await backendConnectionService.checkBackendConnection(baseUrl);
    if (!connectionStatus.isReachable) {
      await backendConnectionService.showConnectionError(connectionStatus);
      return;
    }

    const client = new BearerTokenHttpClient(baseUrl, 5000);

    try {
      await client.authenticateWithCredentials(creds.username, creds.password);
    } catch (error: any) {
      vscode.window.showErrorMessage(`Authentication failed: ${error.message}`);
      return;
    }

    const tokenData = client.getTokenData();
    const auth: StoredAuth = {
      accessToken: tokenData.accessToken!,
      refreshToken: tokenData.refreshToken || undefined,
      expiresAt: tokenData.expiresAt?.toISOString(),
      issuedAt: tokenData.issuedAt?.toISOString(),
      userId: tokenData.userId || undefined
    };

    await ensureWorkspaceMarker(baseUrl);
    const controller = new UnifiedController(context);

    try {
      await controller.activate(client as any);
      backendConnectionService.startHealthCheck(baseUrl);

      activeSession = {
        deactivate: () => controller.dispose().then(async () => {
          await vscode.commands.executeCommand('setContext', 'computor.lecturer.show', false);
          await vscode.commands.executeCommand('setContext', 'computor.student.show', false);
          await vscode.commands.executeCommand('setContext', 'computor.tutor.show', false);
          // Clear persisted tutor selection to prevent stale auth errors on next login
          await context.globalState.update('computor.tutor.selection', undefined);
          backendConnectionService.stopHealthCheck();
        }),
        getActiveViews: () => controller.getActiveViews(),
        getHttpClient: () => controller.getHttpClient()
      };

      await context.secrets.store(secretKey, JSON.stringify(auth));
      await context.secrets.store(usernameKey, creds.username);
      await context.secrets.store(passwordKey, creds.password);

      // Only update auto-login setting if user was asked (i.e., if it was undefined before)
      if (creds.enableAutoLogin !== undefined) {
        await settings.setAutoLoginEnabled(creds.enableAutoLogin);
      }

      if (extensionUpdateService) {
        extensionUpdateService.checkForUpdates().catch(err => {
          console.warn('Extension update check failed:', err);
        });
      }

      vscode.window.showInformationMessage(`Logged in: ${baseUrl}`);
    } catch (error: any) {
      console.error('Login failed:', error);
      await controller.dispose();

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

      vscode.window.showErrorMessage(
        `Failed to login: ${errorMessage}`,
        'Show Details'
      ).then(selection => {
        if (selection === 'Show Details') {
          vscode.window.showErrorMessage(fullError, { modal: true });
        }
      });

      backendConnectionService.stopHealthCheck();
    }
  } finally {
    isAuthenticating = false;
  }
}


// Automatic login prompt when .computor file is detected

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  console.log('Computor extension activated');
  IconGenerator.initialize(context);

  // Initialize backend error catalog
  errorCatalog.initialize();

  extensionUpdateService = new ExtensionUpdateService(context, new ComputorSettingsManager(context));

  // Initialize all view contexts to false to hide views until login
  await vscode.commands.executeCommand('setContext', 'computor.lecturer.show', false);
  await vscode.commands.executeCommand('setContext', 'computor.student.show', false);
  await vscode.commands.executeCommand('setContext', 'computor.tutor.show', false);
  await vscode.commands.executeCommand('setContext', 'computor.student.offline.show', false);

  // Unified login command
  context.subscriptions.push(vscode.commands.registerCommand('computor.login', async () => unifiedLoginFlow(context)));

  // Sign-up command (for users without passwords)
  new SignUpCommands(context).register();

  // Offline mode login command
  context.subscriptions.push(vscode.commands.registerCommand('computor.loginOffline', async () => {
    await initializeOfflineMode(context);
  }));

  context.subscriptions.push(vscode.commands.registerCommand('computor.manageGitLabTokens', async () => {
    await manageGitLabTokens(context);
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
        const action = await vscode.window.showWarningMessage(
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
          vscode.window.showInformationMessage(`✓ Backend is reachable at ${baseUrl}`);
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

      vscode.window.showErrorMessage(
        `Backend connection check failed: ${errorMessage}`,
        'Show Details'
      ).then(selection => {
        if (selection === 'Show Details') {
          vscode.window.showErrorMessage(fullError, { modal: true });
        }
      });
    }
  }));
  
  // Check if workspace has .computor file and automatically login if enabled
  const workspaceRoot = getWorkspaceRoot();
  if (workspaceRoot && !activeSession) {
    const computorMarkerPath = path.join(workspaceRoot, computorMarker);
    if (fs.existsSync(computorMarkerPath)) {
      // Small delay to let VS Code finish initializing
      setTimeout(() => {
        void handleComputorWorkspaceDetected(context, computorMarkerPath);
      }, 500);
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
    vscode.window.showInformationMessage('Computor backend URL updated.');
  }));

  // Listen for workspace folder changes to detect .computor files
  context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(() => {
    if (!activeSession) {
      const workspaceRoot = getWorkspaceRoot();
      if (workspaceRoot) {
        const computorMarkerPath = path.join(workspaceRoot, computorMarker);
        if (fs.existsSync(computorMarkerPath)) {
          // Small delay to let VS Code finish processing
          setTimeout(() => {
            void handleComputorWorkspaceDetected(context, computorMarkerPath);
          }, 500);
        }
      }
    }
  }));

  // Toggle auto-login command
  context.subscriptions.push(vscode.commands.registerCommand('computor.toggleAutoLogin', async () => {
    const settings = new ComputorSettingsManager(context);
    const currentValue = await settings.isAutoLoginEnabled();
    const newValue = currentValue !== true;
    await settings.setAutoLoginEnabled(newValue);
    vscode.window.showInformationMessage(
      `Auto-login ${newValue ? 'enabled' : 'disabled'}. ${newValue ? 'You will be automatically logged in when opening Computor workspaces.' : 'You will be prompted to login when opening Computor workspaces.'}`
    );
  }));

  // Maintain legacy settings command to open extension settings scope
  context.subscriptions.push(vscode.commands.registerCommand('computor.settings', async () => {
    await vscode.commands.executeCommand('workbench.action.openSettings', 'computor');
  }));

}

export async function deactivate(): Promise<void> {
  if (activeSession) {
    await activeSession.deactivate();
    activeSession = null;
  }
  IconGenerator.cleanup();
}
