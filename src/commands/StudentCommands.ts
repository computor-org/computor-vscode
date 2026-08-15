import * as vscode from 'vscode';
import { AUX_COLUMN } from '../ui/editorLayout';
import * as path from 'path';
import * as fs from 'fs';
// import * as os from 'os';
import { StudentCourseContentTreeProvider } from '../ui/tree/student/StudentCourseContentTreeProvider';
import { ComputorApiService } from '../services/ComputorApiService';
import { GitService } from '../services/GitService';
import { CourseSelectionService } from '../services/CourseSelectionService';
import { TestResultService } from '../services/TestResultService';
import { SubmissionGroupStudentList, SubmissionCreate, SubmissionGroupStudentGet, MessageCreate, CourseContentStudentList, CourseContentTypeList, SubmissionGroupGradingList, SubmissionGroupMemberBasic, ResultWithGrading, SubmissionUploadResponseModel, CourseContentStudentGet, SubmissionArtifactList } from '../types/generated';
import { StudentRepositoryManager } from '../services/StudentRepositoryManager';
import { StudentRepositoryProvisioningService, SetUpOutcome } from '../services/StudentRepositoryProvisioningService';
import { MessagesWebviewProvider, MessageTargetContext } from '../ui/webviews/MessagesWebviewProvider';
import { COURSE_ANNOUNCEMENT_DENIED_REASON, canPostCourseAnnouncement } from '../services/MessagePermissions';
import { StudentCourseContentDetailsWebviewProvider, StudentContentDetailsViewState, StudentGradingHistoryEntry, StudentResultHistoryEntry } from '../ui/webviews/StudentCourseContentDetailsWebviewProvider';
import { showMarkdownPreview } from '../ui/webviews/markdownPreview';
import type { MessagesInputPanelProvider } from '../ui/panels/MessagesInputPanel';
import type { WebSocketService } from '../services/WebSocketService';
import { getExampleVersionId } from '../utils/deploymentHelpers';
import JSZip from 'jszip';
import { extractZipBuffer } from '../utils/zipHelpers';
import { commandRegistrar } from './commandHelpers';
import { redactGitCredentials } from '../utils/gitUrlHelpers';
import { buildCourseExportZip, sanitizeContentDirName, type CourseExportFormat } from '../utils/courseExportZip';
import { runLockedWithProgress } from '../utils/progressLock';
import { notify } from '../utils/notify';
import {
  availableDescriptionLanguages,
  listDescriptionFiles,
  pickDescriptionFile
} from '../utils/descriptionLanguage';

// (Deprecated legacy types removed)


export class StudentCommands {
  private context: vscode.ExtensionContext;
  private treeDataProvider: StudentCourseContentTreeProvider;
  private courseContentTreeProvider?: any; // Will be set after registration
  private apiService: ComputorApiService; // Used for future API calls
  private repositoryManager?: StudentRepositoryManager;
  private provisioningService: StudentRepositoryProvisioningService;
  private gitService: GitService;
  private testResultService: TestResultService;
  private messagesWebviewProvider: MessagesWebviewProvider;
  private contentDetailsWebviewProvider: StudentCourseContentDetailsWebviewProvider;

  constructor(
    context: vscode.ExtensionContext,
    treeDataProvider: StudentCourseContentTreeProvider,
    apiService?: ComputorApiService,
    repositoryManager?: StudentRepositoryManager,
    messagesInputPanel?: MessagesInputPanelProvider,
    wsService?: WebSocketService
  ) {
    this.context = context;
    this.treeDataProvider = treeDataProvider;
    // Use provided apiService || create a new one
    this.apiService = apiService || new ComputorApiService(context);
    this.repositoryManager = repositoryManager;
    this.provisioningService = new StudentRepositoryProvisioningService(context, this.apiService);
    this.gitService = GitService.getInstance();
    this.testResultService = TestResultService.getInstance();
    // Make sure TestResultService has the API service
    this.testResultService.setApiService(this.apiService);
    this.messagesWebviewProvider = MessagesWebviewProvider.getShared(context, this.apiService);
    if (messagesInputPanel) {
      this.messagesWebviewProvider.setInputPanel(messagesInputPanel);
    }
    if (wsService) {
      this.messagesWebviewProvider.setWebSocketService(wsService);
    }
    this.contentDetailsWebviewProvider = new StudentCourseContentDetailsWebviewProvider(context);
    void this.courseContentTreeProvider; // Unused for now
  }

  /**
   * The newest artifact that has actually been tested.
   *
   * An artifact counts as tested only when it carries a result - the caller must
   * therefore have listed with `with_latest_result`. Ordering is re-established
   * here rather than relying on the server's default sort, so the "version that
   * was tested" can never turn out to be an arbitrary or untested one.
   */
  private static pickLatestTestedArtifact(
    artifacts: SubmissionArtifactList[]
  ): SubmissionArtifactList | null {
    const timestampOf = (artifact: SubmissionArtifactList): number => {
      const raw = artifact.uploaded_at || artifact.created_at;
      const parsed = raw ? Date.parse(raw) : NaN;
      return Number.isNaN(parsed) ? 0 : parsed;
    };

    return artifacts
      .filter(artifact => !!artifact.latest_result && !!artifact.version_identifier)
      .sort((a, b) => timestampOf(b) - timestampOf(a))[0] ?? null;
  }

  private async pushWithAuthRetry(repoPath: string): Promise<void> {
    try {
      await this.gitService.pushCurrentBranch(repoPath);
    } catch (error) {
      const originalError = error;
      try {
        if (this.repositoryManager && this.repositoryManager.isAuthenticationError(error)) {
          const refreshed = await this.repositoryManager.refreshRepositoryAuth(repoPath);
          if (refreshed) {
            await this.gitService.pushCurrentBranch(repoPath);
            return;
          }
        }
      } catch (secondaryError) {
        console.error('[StudentCommands] Push retry after credential refresh failed:', secondaryError);
      }
      throw originalError instanceof Error ? originalError : new Error(String(originalError));
    }
  }

  setCourseContentTreeProvider(provider: any): void {
    this.courseContentTreeProvider = provider;
  }

  /**
   * Language code -> readable name, for the language picker. Falls back to
   * bare codes when the server cannot be reached — a picker listing "DE" is
   * still usable, an error instead of a picker is not.
   */
  private async languageNames(): Promise<Map<string, string>> {
    const names = new Map<string, string>();
    try {
      for (const language of await this.apiService.getLanguages()) {
        const label = language.native_name && language.native_name !== language.name
          ? `${language.name} (${language.native_name})`
          : language.name;
        names.set(language.code.toLowerCase(), label);
      }
    } catch (error) {
      console.warn('[previewDescriptionLanguage] Failed to load language names:', error);
    }
    return names;
  }

  private async openReadmeIfExists(dir: string, silent: boolean = false): Promise<boolean> {
    try {
      let readmePath: string | undefined;
      let preferredLanguage: string | null = null;

      try {
        const userAccount = await this.apiService.getUserAccount();
        const userLanguage = userAccount?.profile?.language_code || null;

        const courseId = CourseSelectionService.getInstance().getCurrentCourseId();
        let courseLanguage: string | null = null;
        if (courseId) {
          const course = await this.apiService.getCourse(courseId);
          courseLanguage = course?.language_code || null;
        }

        preferredLanguage = userLanguage || courseLanguage;
      } catch (error) {
        console.warn('[openReadmeIfExists] Failed to fetch language preferences:', error);
      }

      const chosen = pickDescriptionFile(fs.readdirSync(dir), preferredLanguage);
      if (chosen) {
        readmePath = path.join(dir, chosen);
      }

      if (readmePath && fs.existsSync(readmePath)) {
        try {
          // Render through our own webview (marked + KaTeX) rather than the
          // built-in markdown preview: in code-server on Firefox/Safari the
          // built-in preview's service-worker-served assets are blocked and
          // the tab renders blank (issues #267/#274). Our webview inlines
          // its assets, so it works there.
          await showMarkdownPreview(this.context, readmePath);
        } catch (previewError) {
          // The built-in preview is exactly the path that stalls blank on the
          // affected browsers, so fall back to the raw file instead.
          console.warn('[openReadmeIfExists] Custom README preview failed, opening raw file:', previewError);
          // Still the README's group, even unrendered — it must not land on
          // top of the assignment the student is editing.
          await vscode.window.showTextDocument(vscode.Uri.file(readmePath), {
            preview: true,
            viewColumn: AUX_COLUMN
          });
        }
        return true;
      }

      if (!silent) {
        notify.info('No README.md found in this assignment');
      }
      return false;
    } catch (e) {
      console.error('openReadmeIfExists failed:', e);
      if (!silent) notify.error('Failed to open README.md');
      return false;
    }
  }

  private async findRepoRoot(startPath: string): Promise<string | undefined> {
    try {
      let current = startPath;
      while (true) {
        const stat = fs.existsSync(current) ? fs.statSync(current) : undefined;
        const dir = stat && stat.isDirectory() ? current : path.dirname(current);
        const gitDir = path.join(dir, '.git');
        if (fs.existsSync(gitDir)) {
          return dir;
        }
        const parent = path.dirname(dir);
        if (parent === dir) break;
        current = parent;
      }
      return undefined;
    } catch {
      return undefined;
    }
  }

  private async saveAllFilesInDirectory(directory: string): Promise<void> {
    const normalizedDir = path.normalize(directory);
    const textDocuments = vscode.workspace.textDocuments;

    const savePromises = textDocuments
      .filter(doc => {
        if (!doc.isDirty) {
          return false;
        }
        const docPath = path.normalize(doc.uri.fsPath);
        return docPath.startsWith(normalizedDir);
      })
      .map(doc => doc.save());

    await Promise.all(savePromises);
  }


  /**
   * Babysitting entry point: ensure the signed-in student has a working
   * repository for a course. Resolves the course from the passed argument
   * (course id string or a tree item with `courseId`) or prompts the student to
   * pick one, then runs the provisioning flow (Mode A / Forgejo for now).
   */
  private async setupCourseRepository(arg?: any): Promise<void> {
    let courseId: string | undefined =
      (typeof arg === 'string' ? arg : undefined) ||
      arg?.courseId || arg?.course?.id || arg?.course_id;

    if (!courseId) {
      const courses = await this.apiService.getStudentCourses();
      if (!courses.length) {
        notify.info('No student courses found.');
        return;
      }
      const picked = await vscode.window.showQuickPick(
        courses.map((c: any) => ({
          label: c.title || c.path || c.id,
          description: (c.title && c.path) ? c.path : undefined,
          courseId: c.id as string
        })),
        { title: 'Set up repository — pick a course', ignoreFocusOut: true }
      );
      if (!picked) { return; }
      courseId = picked.courseId;
    }

    const cid = courseId;

    // Pre-flight: if there's no repo yet and the course offers a choice of modes,
    // let the student pick first (a QuickPick mid-progress is awkward). If this
    // check fails transiently we fall through and let setUpRepository surface it.
    let preferredMode: string | undefined;
    try {
      const existing = await this.provisioningService.getRepository(cid);
      if (!existing) {
        const descriptor = await this.provisioningService.getDescriptor(cid);
        if (!descriptor.configured) {
          notify.info('This course has no git repository configured yet.');
          return;
        }
        const supported = descriptor.student_repo_modes.filter(
          m => m === 'managed' || m === 'external'
        );
        if (supported.length === 0) {
          notify.info(
            `This course offers: ${descriptor.student_repo_modes.join(', ') || 'no git modes'}. That setup isn't available from the extension yet.`
          );
          return;
        }
        if (supported.length > 1) {
          const pick = await vscode.window.showQuickPick(
            [
              { label: '$(server) Institution-hosted', description: 'We host your repository — recommended, no extra setup', mode: 'managed' },
              { label: '$(repo-forked) Your own repository', description: 'Bring your own repo on any git provider (needs a token)', mode: 'external' }
            ].filter(o => supported.includes(o.mode)),
            { title: 'Where should your repository live?', ignoreFocusOut: true }
          );
          if (!pick) { return; }
          preferredMode = pick.mode;
        } else {
          preferredMode = supported[0];
        }
      }
    } catch (error: any) {
      console.warn('[StudentCommands] Repo pre-flight check failed:', error);
    }

    await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: 'Computor',
      cancellable: true
    }, async (progress, token) => {
      try {
        const outcome = await this.provisioningService.setUpRepository(cid, {
          preferredMode,
          cancellationToken: token,
          onProgress: (m) => progress.report({ message: m })
        });
        await this.reportSetupOutcome(outcome);
        if (outcome.status === 'cloned' || outcome.status === 'already-cloned') {
          this.treeDataProvider.refresh();
        }
      } catch (error: any) {
        // Redact: a failed git clone surfaces an error whose message contains the
        // credential-embedded clone URL — keep the token out of logs and the toast.
        const message = redactGitCredentials(error?.message || String(error));
        console.error('[StudentCommands] Repository setup failed:', message);
        notify.error(`Repository setup failed: ${message}`);
      }
    });
  }

  /**
   * Merge new course-template commits into the student's repository for one
   * course — the same sync that runs on refresh (clone/pull + template merge),
   * but targeted and explicitly user-triggered.
   */
  private async updateFromTemplate(arg?: any): Promise<void> {
    let courseId: string | undefined =
      (typeof arg === 'string' ? arg : undefined) ||
      arg?.courseId || arg?.course?.id || arg?.course_id;

    if (!courseId) {
      const courses = await this.apiService.getStudentCourses();
      if (!courses.length) {
        notify.info('No student courses found.');
        return;
      }
      const picked = await vscode.window.showQuickPick(
        courses.map((c: any) => ({
          label: c.title || c.path || c.id,
          description: (c.title && c.path) ? c.path : undefined,
          courseId: c.id as string
        })),
        { title: 'Update repository from template — pick a course', ignoreFocusOut: true }
      );
      if (!picked) { return; }
      courseId = picked.courseId;
    }

    const manager = this.repositoryManager;
    if (!manager) {
      notify.warning('Repository manager is not available.');
      return;
    }
    const cid = courseId;

    await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: 'Updating repository from course template...',
      cancellable: true
    }, async (progress, token) => {
      try {
        await manager.autoSetupRepositories(cid, (m) => progress.report({ message: m }), undefined, token);
        this.treeDataProvider.refresh();
      } catch (error: any) {
        const message = redactGitCredentials(error?.message || String(error));
        console.error('[StudentCommands] Template update failed:', message);
        notify.error(`Template update failed: ${message}`);
      }
    });
  }

  private async reportSetupOutcome(outcome: SetUpOutcome): Promise<void> {
    switch (outcome.status) {
      case 'cloned':
        notify.info(`Repository ready at ${outcome.path}`);
        break;
      case 'already-cloned':
        notify.info(`Repository already set up at ${outcome.path}`);
        break;
      case 'forgejo-login-required': {
        const target = outcome.repo.server_url || outcome.repo.web_url || undefined;
        const choice = await notify.warning(
          'Sign in to your repository provider once in your browser to finish setting up your repository, then run "Set up repository" again.',
          ...(target ? ['Open in Browser'] : [])
        );
        if (choice === 'Open in Browser' && target) {
          void vscode.env.openExternal(vscode.Uri.parse(target));
        }
        break;
      }
      case 'unsupported-mode':
        notify.info(
          `This course offers: ${outcome.modes.join(', ') || 'no git modes'}. That setup isn't available from the extension yet.`
        );
        break;
      case 'cancelled':
        // Student backed out of a prompt — nothing to report.
        break;
      case 'not-configured':
        notify.info('This course has no git repository configured yet.');
        break;
    }
  }

  /** A short course slug for default file/folder names. */
  private async courseSlugFor(courseId: string): Promise<string> {
    try {
      const course = await this.apiService.getStudentCourse(courseId);
      const raw = String(course?.path || course?.title || courseId);
      const slug = raw.split(/[./]/).filter(Boolean).pop() || courseId.slice(0, 8);
      return slug.replace(/[^a-zA-Z0-9._-]/g, '-');
    } catch {
      return courseId.slice(0, 8);
    }
  }

  /**
   * Download the course template as a ZIP (download-mode courses, or offline
   * work). Lets the student save the archive or extract it into a folder to work
   * in. The backend streams the template using its service token — the student
   * needs no git credentials.
   */
  private async downloadCourseTemplate(arg?: any): Promise<void> {
    let courseId: string | undefined =
      (typeof arg === 'string' ? arg : undefined) ||
      arg?.courseId || arg?.course?.id || arg?.course_id;

    if (!courseId) {
      const courses = await this.apiService.getStudentCourses();
      if (!courses.length) {
        notify.info('No student courses found.');
        return;
      }
      const picked = await vscode.window.showQuickPick(
        courses.map((c: any) => ({
          label: c.title || c.path || c.id,
          description: (c.title && c.path) ? c.path : undefined,
          courseId: c.id as string
        })),
        { title: 'Download template — pick a course', ignoreFocusOut: true }
      );
      if (!picked) { return; }
      courseId = picked.courseId;
    }
    const cid = courseId;

    const how = await vscode.window.showQuickPick(
      [
        { label: '$(folder) Download and extract to a folder', value: 'extract' as const },
        { label: '$(file-zip) Download as ZIP', value: 'zip' as const }
      ],
      { title: 'Download course template', ignoreFocusOut: true }
    );
    if (!how) { return; }

    const slug = await this.courseSlugFor(cid);
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'Computor', cancellable: false },
      async (progress) => {
        progress.report({ message: 'Downloading template…' });
        let buffer: Buffer;
        try {
          buffer = await this.apiService.downloadTemplateArchive(cid);
        } catch (err: any) {
          notify.error(`Could not download the template: ${err?.message || String(err)}`);
          return;
        }

        if (how.value === 'zip') {
          const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
          const dest = await vscode.window.showSaveDialog({
            ...(wsRoot ? { defaultUri: vscode.Uri.file(path.join(wsRoot, `${slug}-template.zip`)) } : {}),
            filters: { 'ZIP Archives': ['zip'] },
            saveLabel: 'Save'
          });
          if (!dest) { return; }
          await fs.promises.writeFile(dest.fsPath, buffer);
          void notify.info(`Template saved to ${dest.fsPath}`, 'Reveal').then(c => {
            if (c === 'Reveal') { void vscode.commands.executeCommand('revealFileInOS', dest); }
          });
          return;
        }

        const folder = await vscode.window.showOpenDialog({
          canSelectFolders: true, canSelectFiles: false, canSelectMany: false,
          openLabel: 'Extract here', title: 'Choose a folder to extract the template into'
        });
        if (!folder || !folder[0]) { return; }
        const destDir = path.join(folder[0].fsPath, `${slug}-template`);
        progress.report({ message: 'Extracting…' });
        const count = await extractZipBuffer(buffer, destDir);
        void notify.info(
          `Extracted ${count} file(s) to ${destDir}`, 'Open Folder', 'Reveal'
        ).then(c => {
          if (c === 'Open Folder') {
            void vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(destDir), { forceNewWindow: true });
          } else if (c === 'Reveal') {
            void vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(destDir));
          }
        });
      }
    );
  }


  registerCommands(): void {


    const register = commandRegistrar(this.context);

    // Set up the student's repository for a course (course-level provisioning).
    // Optional arg: a course id string, or a tree item carrying `courseId`.
    register('computor.student.setupCourseRepository', async (arg?: any) => {
      await this.setupCourseRepository(arg);
    });

    // Download the course template as a ZIP (download mode / offline work).
    register('computor.student.downloadTemplate', async (arg?: any) => {
      await this.downloadCourseTemplate(arg);
    });

    // Merge new course-template commits into the student's repository.
    register('computor.student.updateFromTemplate', async (arg?: any) => {
      await this.updateFromTemplate(arg);
    });

    // Refresh student view
    register('computor.student.refresh', async () => {
      // Show progress notification while refreshing
      await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'Refreshing student view...',
        cancellable: true
      }, async (progress, token) => {
        // Update repositories only for expanded courses
        if (this.repositoryManager) {
          const expandedCourseIds = this.treeDataProvider.getExpandedCourseIds();
          if (expandedCourseIds.size > 0) {
            try {
              await this.repositoryManager.autoSetupRepositories(
                undefined,
                (msg) => progress.report({ message: msg }),
                expandedCourseIds,
                token
              );
            } catch (error) {
              console.error('[StudentCommands] Failed during repository refresh:', error);
            }
          }
        }

        // Refresh the tree view
        progress.report({ message: 'Refreshing tree view...' });
        this.treeDataProvider.refresh();
      });
    });

    // Refresh tree view only (without Git updates) - used after marking messages as read
    register('computor.student.refreshTree', () => {
      this.treeDataProvider.refresh();
    });

    register('computor.student.showMessages', async (item?: any) => {
      await this.showMessages(item);
    });

    register('computor.student.exportCourseExamples', async (item?: any) => {
      await this.exportCourseExamples(item);
    });

    // computor.showTestResults lives in ui/results/registerResultsPanel.ts and is
    // registered for every role - tutors and lecturers invoke it too, and it was
    // unavailable to them while it was registered here (issue #296).

    // Show README preview for assignments
    register('computor.student.showPreview', async (item?: any) => {
      try {
        // If item provided, check if it has a directory
        if (item?.courseContent) {
          const directoryFromItem: string | undefined = (item.courseContent as any).directory;
          if (directoryFromItem) {
            await this.openReadmeIfExists(directoryFromItem);
            return;
          } else {
            // Assignment directory not available (likely not released yet)
            notify.warning('Assignment not available yet. README preview cannot be shown.');
            return;
          }
        }

        // Try to infer from active editor
        const activePath = vscode.window.activeTextEditor?.document?.uri?.fsPath;
        if (activePath) {
          const repoRoot = await this.findRepoRoot(activePath);
          if (repoRoot) {
            const rel = path.relative(repoRoot, activePath);
            const firstSegment = rel.split(path.sep)[0];
            if (firstSegment && firstSegment !== '' && firstSegment !== '..') {
              const candidateDir = path.join(repoRoot, firstSegment);
              const ok = await this.openReadmeIfExists(candidateDir, true);
              if (ok) return;
            }
          }
        }

        // Fallback: let user pick an assignment directory from current course
        const courseId = CourseSelectionService.getInstance().getCurrentCourseId();
        if (!courseId) {
          notify.warning('No course selected. Select a course then try again.');
          return;
        }
        const contents = await this.apiService.getStudentCourseContents(courseId);
        if (this.repositoryManager) {
          this.repositoryManager.updateExistingRepositoryPaths(courseId, contents);
        }
        const assignables = contents
          .map(c => ({ content: c, directory: (c as any).directory as string | undefined }))
          .filter(x => !!x.directory && fs.existsSync(x.directory!));

        if (assignables.length === 0) {
          notify.info('No cloned assignments found for this course. Clone an assignment first.');
          return;
        }

        const pick = await vscode.window.showQuickPick(
          assignables.map(a => ({ label: a.content.title || a.content.path, description: a.directory, a })),
          { title: 'Select assignment to preview README.md' }
        );
        if (!pick) return;
        await this.openReadmeIfExists(pick.a.directory!);
      } catch (error: any) {
        console.error('Failed to show README preview:', error);
        notify.error(`Failed to show README preview: ${error.message || error}`);
      }
    });

    // Read the description in a language other than your own: assignments are
    // not always translated into everyone's language, and the one you get is
    // not always the one you can read best (computor-org/issues#328).
    register('computor.student.previewDescriptionLanguage', async (item?: any) => {
      try {
        const directory: string | undefined = item?.courseContent?.directory;
        if (!directory || !fs.existsSync(directory)) {
          notify.warning('Assignment not available yet. Its description cannot be shown.');
          return;
        }

        const files = fs.readdirSync(directory);
        const languages = availableDescriptionLanguages(files);
        const hasDefault = listDescriptionFiles(files).some((entry) => entry.language === undefined);
        if (languages.length === 0 && !hasDefault) {
          notify.info('This assignment has no description.');
          return;
        }

        const names = await this.languageNames();
        const picks: Array<vscode.QuickPickItem & { file: string }> = languages.map((code) => ({
          label: names.get(code) ?? code.toUpperCase(),
          description: code,
          file: pickDescriptionFile(files, code)!
        }));
        if (hasDefault) {
          picks.push({
            label: 'Default',
            description: 'the description as written, without a language suffix',
            file: listDescriptionFiles(files).find((entry) => entry.language === undefined)!.file
          });
        }

        const chosen = await vscode.window.showQuickPick(picks, {
          title: 'Preview description in another language'
        });
        if (!chosen) { return; }
        await showMarkdownPreview(this.context, path.join(directory, chosen.file));
      } catch (error: any) {
        console.error('Failed to preview description language:', error);
        notify.error(`Failed to open the description: ${error?.message || error}`);
      }
    });

    // Clone repository from course content tree
    register('computor.student.cloneRepository', async (item: any) => {
      console.log('[CloneRepo] Item received:', item);
      console.log('[CloneRepo] Item courseContent:', item?.courseContent);
      console.log('[CloneRepo] Item submissionGroup:', item?.submissionGroup);
      
      // The item is a CourseContentItem from StudentCourseContentTreeProvider
      if (!item || !item.submissionGroup || !item.submissionGroup.repository) {
        notify.error('No repository available for this assignment');
        return;
      }

      const submissionGroup = item.submissionGroup;
      let courseId = submissionGroup.course_id;
      
      // If course_id is not in submission group, try to get it from course selection
      if (!courseId) {
        const courseSelection = CourseSelectionService.getInstance();
        courseId = courseSelection.getCurrentCourseId();
        
        if (!courseId) {
          console.error('[CloneRepo] Course ID is missing from submission group and no course selected:', submissionGroup);
          notify.error('No course selected. Please select a course first.');
          return;
        }
        
        console.log('[CloneRepo] Using course ID from course selection:', courseId);
      }
      
      try {
        if (!this.repositoryManager) {
          notify.error('Repository manager not available');
          return;
        }
        await vscode.window.withProgress({
          location: vscode.ProgressLocation.Notification,
          title: `Cloning repository for ${submissionGroup.course_content_title}...`,
          cancellable: false
        }, async () => {
          await this.repositoryManager!.autoSetupRepositories(courseId!);
        });

        this.treeDataProvider.refresh();
        notify.info('Repository cloned/updated. Expand the assignment to see files.');
      } catch (error: any) {
        notify.error(`Failed to clone repository: ${error?.message || error}`);
      }
    });

    // Open course in browser (if GitLab URL exists)
    register('computor.student.openInBrowser', async (item: any) => {
      if (!item || !item.course.repository) {
        notify.error('No repository URL available');
        return;
      }

      const url = `${item.course.repository.provider_url}/${item.course.repository.full_path}`;
      vscode.env.openExternal(vscode.Uri.parse(url));
    });

    // Clone submission group repository
    register('computor.student.cloneSubmissionGroupRepository', async (submissionGroup: SubmissionGroupStudentList, courseId: string) => {
      if (!submissionGroup || !submissionGroup.repository) {
        notify.error('No repository available for this submission group');
        return;
      }

      try {
        if (!this.repositoryManager) {
          notify.error('Repository manager not available');
          return;
        }
        await vscode.window.withProgress({
          location: vscode.ProgressLocation.Notification,
          title: `Cloning repository for ${submissionGroup.course_content_title}...`,
          cancellable: false
        }, async () => {
          await this.repositoryManager!.autoSetupRepositories(courseId);
        });
        this.treeDataProvider.refresh();
        notify.info('Repository cloned/updated for the submission group.');
      } catch (error: any) {
        notify.error(`Failed to clone repository: ${error?.message || error}`);
      }
    });

    // Submit assignment
    // Submit without git (download mode): zip a folder and upload as a submission.
    // The backend content-addresses it (a content hash), so no commit/repo is needed.
    register('computor.student.submitDownload', async (item?: any) => {
      await this.submitDownload(item);
    });

    register('computor.student.submitAssignment', async (itemOrSubmissionGroup: any) => {
      try {
        // Support invocation from tree item (preferred)
        let directory: string | undefined;
        let assignmentPath: string | undefined;
        let assignmentTitle: string | undefined;
        let submissionGroup: SubmissionGroupStudentList | undefined;
        let courseContentId: string | undefined;
        let testingServiceId: string | null | undefined;
        let courseContent: CourseContentStudentList | CourseContentStudentGet | undefined;

        if (itemOrSubmissionGroup?.courseContent) {
          const item = itemOrSubmissionGroup;
          courseContent = item.courseContent as CourseContentStudentList | CourseContentStudentGet;
          directory = (item.courseContent as any)?.directory as string | undefined;
          {
            const pv: any = (item.courseContent as any)?.path;
            assignmentPath = pv == null ? undefined : String(pv);
          }
          {
            const tv: any = (item.courseContent as any)?.title;
            assignmentTitle = tv == null ? assignmentPath : String(tv);
          }
          submissionGroup = item.submissionGroup as SubmissionGroupStudentList | undefined;
          courseContentId = typeof item.courseContent?.id === 'string' ? item.courseContent.id : undefined;
          testingServiceId = courseContent?.testing_service_id;
        } else {
          // Backward compatibility with old signature
          submissionGroup = itemOrSubmissionGroup as SubmissionGroupStudentList | undefined;
          {
            const sv: any = submissionGroup?.course_content_path as any;
            assignmentPath = sv == null ? undefined : String(sv);
          }
          {
            const stv: any = submissionGroup?.course_content_title as any;
            assignmentTitle = stv == null ? assignmentPath : String(stv);
          }


          // Try to resolve directory via current course contents
          const courseId = CourseSelectionService.getInstance().getCurrentCourseId();
          if (courseId) {
            const contents = await this.apiService.getStudentCourseContents(courseId);
            if (this.repositoryManager) {
              this.repositoryManager.updateExistingRepositoryPaths(courseId, contents);
            }
            const match = contents.find(c => c.submission_group?.id === submissionGroup?.id);
            directory = (match as any)?.directory as string | undefined;
            if (!courseContentId && match?.id) {
              courseContentId = String(match.id);
            }
            if (match) {
              courseContent = match;
              testingServiceId = match.testing_service_id;
            }
          }
        }

        if (!directory || !fs.existsSync(directory)) {
          notify.error('Assignment directory not found. Please clone the repository first.');
          return;
        }
        if (!assignmentPath) {
          notify.error('Assignment path is missing.');
          return;
        }

        if (!submissionGroup?.id) {
          notify.error('Submission group information missing; cannot create submission.');
          return;
        }

        const submissionDirectory = directory as string;
        const submissionGroupId = String(submissionGroup.id);

        const repoPath = await this.findRepoRoot(submissionDirectory);
        if (!repoPath) {
          notify.error('Could not determine repository root.');
          return;
        }

        // Save all open files in the assignment directory
        await this.saveAllFilesInDirectory(submissionDirectory);

        // Perform submission by ensuring latest work is committed and pushed
        let submissionOk = false;
        let submissionVersion: string | undefined;
        let submissionResponse: SubmissionUploadResponseModel | undefined;
        let reusedExistingSubmission = false;

        // First, check current commit and whether it has been tested
        const currentCommitBeforeStaging = await this.gitService.getLatestCommitHash(repoPath);
        const hasUncommittedChanges = await this.gitService.hasChanges(repoPath);

        if (hasUncommittedChanges || !currentCommitBeforeStaging) {
          // If there are uncommitted changes, we need to commit them first
          const commitLabel = assignmentTitle || assignmentPath || courseContentId || 'Assignment';

          await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Preparing submission...',
            cancellable: false
          }, async (progress) => {
            progress.report({ message: 'Staging changes...' });
            await this.gitService.stageAll(repoPath);

            const hasStagedFiles = await this.gitService.hasStagedFiles(repoPath);
            if (hasStagedFiles) {
              const now = new Date();
              const timestamp = now.toISOString().replace('T', ' ').split('.')[0];
              const commitMessage = `Update ${commitLabel} - ${timestamp}`;
              progress.report({ message: 'Committing changes...' });
              await this.gitService.commitChanges(repoPath, commitMessage);
            }

            const currentBranch = await this.gitService.getCurrentBranch(repoPath);
            if (!currentBranch) {
              throw new Error('Could not determine current branch.');
            }

            progress.report({ message: `Pushing ${currentBranch}...` });
            await this.pushWithAuthRetry(repoPath);
          });
        }

        const currentCommitHash = await this.gitService.getLatestCommitHash(repoPath);
        if (!currentCommitHash) {
          throw new Error('Failed to get current commit hash');
        }

        // Get the most recent *tested* artifact. Both halves matter: ask the
        // server for the results (latest_result is omitted otherwise, so every
        // artifact looks untested) and pick the newest artifact that actually
        // carries one. Taking [0] of the unfiltered list meant an untested
        // artifact could pose as "the tested version" and get submitted.
        let latestTestedArtifact: SubmissionArtifactList | null = null;
        try {
          const previousArtifacts = await this.apiService.listStudentSubmissionArtifacts({
            submission_group_id: submissionGroupId,
            submit: false,
            with_latest_result: true
          });

          latestTestedArtifact = StudentCommands.pickLatestTestedArtifact(previousArtifacts);
        } catch (listError) {
          console.warn('[submitAssignment] Failed to check tested artifacts:', listError);
        }

        // Check if current commit has been tested
        const currentCommitTested = latestTestedArtifact?.version_identifier === currentCommitHash;

        // Resolve testing_service_id authoritatively from the backend before
        // deciding whether to test. The tree item / list DTO can be stale or
        // partial on a fresh load and omit it, which previously made the very
        // first submit skip testing entirely — tests only started running after
        // the student had manually tested once (which refreshed the item)
        // (issue #271). Fall back to the tree item's value if the fetch fails.
        if (courseContentId) {
          try {
            const freshContent = await this.apiService.getStudentCourseContent(courseContentId, { force: true });
            if (freshContent && freshContent.testing_service_id !== undefined) {
              testingServiceId = freshContent.testing_service_id;
            }
          } catch (resolveError) {
            console.warn('[submitAssignment] Failed to resolve testing_service_id from backend; using tree item value:', resolveError);
          }
        }

        // If testing is required and current commit hasn't been tested, run test first
        if (testingServiceId && !currentCommitTested) {
          console.log(`[submitAssignment] Testing required (testing_service_id: ${testingServiceId}), running test first...`);

          let testArtifactId: string | undefined;

          // Check if artifact already exists for current commit (untested)
          try {
            const existingArtifacts = await this.apiService.listStudentSubmissionArtifacts({
              submission_group_id: submissionGroupId,
              version_identifier: currentCommitHash,
              with_latest_result: true
            });

            // Any tested artifact for HEAD means there is nothing to run. Search
            // the whole list rather than trusting [0] to be the tested one.
            const testedForHead = existingArtifacts.find(artifact => !!artifact.latest_result);
            if (testedForHead) {
              console.log(`[submitAssignment] Commit ${currentCommitHash} already tested`);
              latestTestedArtifact = testedForHead;
            } else if (existingArtifacts.length > 0 && existingArtifacts[0]) {
              // Artifact exists but not tested - reuse it for testing
              console.log(`[submitAssignment] Reusing existing untested artifact ID: ${existingArtifacts[0].id}`);
              testArtifactId = existingArtifacts[0].id;
            }
          } catch (checkError) {
            console.warn('[submitAssignment] Failed to check existing artifacts:', checkError);
          }

          // Create an artifact whenever HEAD itself has no tested one. The old
          // condition asked whether *any* tested artifact existed, so an older
          // tested commit suppressed both the upload and the test run below -
          // and that older commit was then what got submitted.
          const headAlreadyTested = latestTestedArtifact?.version_identifier === currentCommitHash;
          if (!testArtifactId && !headAlreadyTested) {
            await vscode.window.withProgress({
              location: vscode.ProgressLocation.Notification,
              title: `Testing ${assignmentTitle}...`,
              cancellable: false
            }, async (progress) => {
              progress.report({ message: 'Packaging submission archive...' });
              const archive = await this.createSubmissionArchive(submissionDirectory);
              console.log(`[submitAssignment] Archive created for testing`);

              progress.report({ message: 'Uploading for testing...' });
              const testSubmissionResponse = await this.apiService.createStudentSubmission({
                submission_group_id: submissionGroupId,
                version_identifier: currentCommitHash,
                submit: false
              }, archive);
              console.log(`[submitAssignment] Created test artifact:`, testSubmissionResponse);

              if (testSubmissionResponse?.artifacts && testSubmissionResponse.artifacts.length > 0) {
                testArtifactId = testSubmissionResponse.artifacts[0];
              }
            });
          }

          // Run the test and wait for results
          if (testArtifactId && courseContentId) {
            console.log(`[submitAssignment] Submitting test with artifact ID: ${testArtifactId}`);
            const testResult = await this.testResultService.submitTestByArtifactAndAwaitResults(
              testArtifactId,
              assignmentTitle || 'Assignment',
              undefined,
              { courseContentId }
            );

            // Check if test was successful
            // Test is considered successful if status is SUCCESS (regardless of score)
            // We allow submission even with partial test scores
            if (!testResult || testResult.status === 'ERROR' || testResult.status === 'TIMEOUT') {
              notify.error('Test execution failed. Please try again.');
              // Clear cache and refresh tree
              if (courseContentId) {
                this.apiService.clearStudentCourseContentCache(courseContentId);
                this.treeDataProvider.refresh();
              }
              return;
            }

            if (testResult.status === 'CANCELLED') {
              notify.warning('Test was cancelled. Submission aborted.');
              if (courseContentId) {
                this.apiService.clearStudentCourseContentCache(courseContentId);
                this.treeDataProvider.refresh();
              }
              return;
            }

            // FAILED status means test execution failed (not that tests didn't pass)
            // We still proceed with submission as the student may want to submit anyway
            console.log(`[submitAssignment] Test completed with status: ${testResult.status}, proceeding with submission`);

            // Update latestTestedArtifact with the newly tested artifact
            try {
              const testedArtifacts = await this.apiService.listStudentSubmissionArtifacts({
                submission_group_id: submissionGroupId,
                version_identifier: currentCommitHash,
                with_latest_result: true
              });
              const refreshed = StudentCommands.pickLatestTestedArtifact(testedArtifacts)
                ?? testedArtifacts[0];
              if (refreshed) {
                latestTestedArtifact = refreshed;
              }
            } catch (refreshError) {
              console.warn('[submitAssignment] Failed to refresh tested artifact:', refreshError);
            }
          }
        }

        // Determine which version to submit
        // If we have a tested artifact, submit that version (not HEAD)
        // This ensures we submit the commit that was actually tested
        if (latestTestedArtifact?.version_identifier) {
          submissionVersion = latestTestedArtifact.version_identifier;
          console.log(`[submitAssignment] Using tested artifact version: ${submissionVersion}`);
        } else {
          // No tested artifact exists, submit current HEAD
          submissionVersion = currentCommitHash;
          console.log(`[submitAssignment] No tested artifact found, using current HEAD: ${submissionVersion}`);
        }

        // Submitting anything other than HEAD means the student's newest work is
        // not what gets graded. That used to happen silently; never do it without
        // saying so. Reachable when the test run could not be started (e.g. the
        // upload returned no artifact) and an older tested commit is all we have.
        if (submissionVersion !== currentCommitHash) {
          const submitOlder = 'Submit the tested commit';
          const choice = await vscode.window.showWarningMessage(
            `Your latest commit (${currentCommitHash.substring(0, 8)}) has not been tested.\n\n` +
            `Continuing submits the last tested commit (${submissionVersion.substring(0, 8)}) instead — ` +
            'your newest work will not be graded.',
            { modal: true },
            submitOlder
          );
          if (choice !== submitOlder) {
            notify.info('Submission cancelled. Run a test on your latest commit, then submit again.');
            return;
          }
          console.log(`[submitAssignment] Student confirmed submitting older commit ${submissionVersion}`);
        }

        await vscode.window.withProgress({
          location: vscode.ProgressLocation.Notification,
          title: `Submitting ${assignmentTitle}...`,
          cancellable: false
        }, async (progress) => {
          try {

            let existingArtifactId: string | undefined;
            let alreadySubmitted = false;
            try {
              // Get artifact for this version
              const existingSubmissions = await this.apiService.listStudentSubmissionArtifacts({
                submission_group_id: submissionGroupId,
                version_identifier: submissionVersion
              });
              console.log(`[submitAssignment] GET response: Found ${existingSubmissions.length} artifacts for version ${submissionVersion}`);
              console.log(`[submitAssignment] Full response:`, JSON.stringify(existingSubmissions, null, 2));

              if (existingSubmissions.length > 0) {
                const matchingArtifact = existingSubmissions[0];
                existingArtifactId = matchingArtifact!.id;
                alreadySubmitted = matchingArtifact!.submit === true;
                console.log(`[submitAssignment] Found latest artifact ${existingArtifactId}:`);
                console.log(`  - submit field value: ${matchingArtifact!.submit}`);
                console.log(`  - submit field type: ${typeof matchingArtifact!.submit}`);
                console.log(`  - alreadySubmitted: ${alreadySubmitted}`);
                console.log(`  - Full artifact:`, JSON.stringify(matchingArtifact, null, 2));
              } else {
                console.log(`[submitAssignment] GET returned empty array - no existing artifacts`);
              }
            } catch (listError) {
              console.warn('[submitAssignment] Failed to check existing submissions:', listError);
            }

            if (existingArtifactId && alreadySubmitted) {
              // Case 1: Artifact exists AND submit=true → Do nothing
              reusedExistingSubmission = true;
              submissionOk = true;
              progress.report({ message: 'Submission already exists for this version.' });
              console.log('[submitAssignment] Case 1: Artifact already submitted (submit=true), doing nothing');
              return;
            } else if (existingArtifactId && !alreadySubmitted) {
              // Case 2: Artifact exists AND submit=false → PATCH to mark as submitted
              console.log('[submitAssignment] Case 2: Artifact exists but submit=false, calling PATCH');
              progress.report({ message: 'Marking existing artifact as submitted...' });
              submissionResponse = await this.apiService.updateStudentSubmission(
                existingArtifactId,
                { submit: true }
              );
            } else {
              // Case 3: No existing artifact → POST to create new submission
              console.log('[submitAssignment] Case 3: No existing artifact found, calling POST to create new submission');
              progress.report({ message: 'Packaging submission archive...' });
              const archive = await this.createSubmissionArchive(submissionDirectory);

              progress.report({ message: 'Creating submission...' });
              submissionResponse = await this.apiService.createStudentSubmission({
                submission_group_id: submissionGroupId,
                version_identifier: submissionVersion || undefined,
                submit: true
              }, archive);
            }

            submissionOk = true;
          } catch (e) {
            throw e;
          }
        });
        if (submissionOk) {
          try {
            if (courseContentId) {
              // After PATCH, fetch fresh data from the API and update the tree
              const courseId = CourseSelectionService.getInstance().getCurrentCourseId();
              console.log('[submitAssignment] Fetching fresh course contents after PATCH:', {
                courseId,
                courseContentId
              });

              if (courseId) {
                // Clear cache and fetch fresh data with course_id filter
                this.apiService.clearStudentCourseContentsCache(courseId);
                this.apiService.clearStudentCourseContentCache(courseContentId);

                // This will make: GET /students/course-contents?course_id=...
                await this.apiService.getStudentCourseContents(courseId, { force: true });

                // Now refresh the tree item with the fresh data
                await this.treeDataProvider.refreshContentItem(courseContentId);
                console.log('[submitAssignment] Tree refresh complete');
              } else {
                console.warn('[submitAssignment] No courseId available, doing full refresh');
                this.treeDataProvider.refresh();
              }
            } else {
              console.log('[submitAssignment] No courseContentId, doing full refresh');
              this.treeDataProvider.refresh();
            }
          } catch (refreshError) {
            console.error('[submitAssignment] Failed to refresh course content after submission:', refreshError);
          }

          if (reusedExistingSubmission) {
            notify.warning('This artifact has already been submitted. No action taken.');
          } else if (submissionResponse) {
            const successMessage = 'Assignment submitted successfully.';

            notify.info(successMessage);
          } else {
            notify.warning('Submission completed without a response from the server.');
          }
        }
      } catch (error: any) {
        console.error('Failed to submit assignment:', error?.response?.data || error);
        const message = typeof error?.message === 'string'
          ? error.message
          : typeof error === 'string'
            ? error
            : 'Failed to submit assignment.';
        notify.error(message);
      }
    });

    // View submission group details (accepts tree item || raw submission group)
    register('computor.student.viewSubmissionGroup', async (arg: any) => {
      await this.showContentDetails(arg);
    });

    // Commit and push assignment changes
    register('computor.student.commitAssignment', async (item: any) => {
      console.log('[CommitAssignment] Item received:', item);
      
      // The item is a CourseContentItem from StudentCourseContentTreeProvider
      if (!item || !item.courseContent) {
        notify.error('No assignment selected');
        return;
      }

      // Get the assignment directory
      const directory = (item.courseContent as any).directory;
      if (!directory || !fs.existsSync(directory)) {
        notify.error('Assignment directory not found. Please clone the repository first.');
        return;
      }

      const assignmentPath = item.courseContent.path;
      const assignmentTitle = item.courseContent.title || assignmentPath;

      try {
        // Save all open files in the assignment directory
        await this.saveAllFilesInDirectory(directory);

        // Check if there are any changes to commit
        const hasChanges = await this.gitService.hasChanges(directory);
        if (!hasChanges) {
          notify.info('No changes to commit in this assignment.');
          return;
        }

        // Generate automatic commit message
        const now = new Date();
        const timestamp = now.toISOString().replace('T', ' ').split('.')[0];
        const commitMessage = `Update ${assignmentTitle} - ${timestamp}`;

        // Show progress while committing and pushing
        await vscode.window.withProgress({
          location: vscode.ProgressLocation.Notification,
          title: `Committing and pushing ${assignmentTitle}...`,
          cancellable: false
        }, async (progress) => {
          progress.report({ increment: 0, message: 'Preparing to commit...' });

          // Find repository root
          const repoPath = await this.findRepoRoot(directory);
          if (!repoPath) {
            throw new Error('Could not determine repository root');
          }

          progress.report({ increment: 40, message: 'Committing changes...' });
          // Stage only the assignment directory
          await this.gitService.stagePath(repoPath, directory);

          // Commit only if something is staged
          const hasStagedFiles = await this.gitService.hasStagedFiles(repoPath);
          if (!hasStagedFiles) {
            throw new Error('No changes to commit in the assignment folder');
          }

          await this.gitService.commitChanges(repoPath, commitMessage);

          progress.report({ increment: 60, message: 'Pushing to remote...' });
          // Push to main branch, prompting for new token if required
          await this.pushWithAuthRetry(repoPath);

          progress.report({ increment: 100, message: 'Successfully committed and pushed!' });
        });

        notify.info(`Successfully committed and pushed ${assignmentTitle}`);

        // Optionally refresh the tree to update any status indicators
        this.treeDataProvider.refreshNode(item);
      } catch (error: any) {
        console.error('Failed to commit assignment:', error);
        notify.error(`Failed to commit assignment: ${error.message}`);
      }
    });

    // Test assignment (includes commit, push, and test submission)
    register('computor.student.testAssignment', async (item: any) => {
      console.log('[TestAssignment] Item received:', item);
      
      // The item is a CourseContentItem from StudentCourseContentTreeProvider
      if (!item || !item.courseContent) {
        notify.error('No assignment selected');
        return;
      }

      // Get the assignment directory and submission metadata
      let directory = (item.courseContent as any).directory as string | undefined;
      const assignmentPath = item.courseContent.path;
      const assignmentTitle = item.courseContent.title || assignmentPath;
      let submissionGroup = item.submissionGroup as SubmissionGroupStudentList | undefined;

      if ((!directory || !fs.existsSync(directory)) || !submissionGroup?.id) {
        const courseId = CourseSelectionService.getInstance().getCurrentCourseId();
        if (courseId) {
          const contents = await this.apiService.getStudentCourseContents(courseId) || [];
          if (this.repositoryManager) {
            this.repositoryManager.updateExistingRepositoryPaths(courseId, contents);
          }
          const match = contents.find(c => c.id === item.courseContent.id);
          if (!directory && match) {
            directory = (match as any)?.directory as string | undefined;
          }
          if (!submissionGroup?.id) {
            submissionGroup = match?.submission_group as SubmissionGroupStudentList | undefined;
          }
        }
      }

      if (!directory || !fs.existsSync(directory)) {
        notify.error('Assignment directory not found. Please clone the repository first.');
        return;
      }

      if (!submissionGroup?.id) {
        notify.error('Submission group information missing; cannot upload for testing.');
        return;
      }

      const submissionDirectory = directory as string;
      const submissionGroupId = String(submissionGroup.id);
      const courseContentId = typeof item.courseContent.id === 'string'
        ? item.courseContent.id
        : String(item.courseContent.id);

      let testSucceeded = false;
      // True once the artifact is handed to TestResultService, which surfaces its
      // own errors. Errors before this point (commit/push/artifact upload — e.g.
      // the backend rejecting the upload) must be shown here, or they vanish.
      let reachedTestSubmission = false;
      try {
        // Save all open files in the assignment directory
        await this.saveAllFilesInDirectory(submissionDirectory);

        const hasChanges = await this.gitService.hasChanges(submissionDirectory);
        let currentCommitHash = await this.gitService.getLatestCommitHash(submissionDirectory);

        // Commit changes first if there are any
        if (hasChanges) {
          await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `Preparing ${assignmentTitle}...`,
            cancellable: true
          }, async (progress, token) => {
            progress.report({ message: 'Committing changes...' });
            await this.gitService.stageAll(submissionDirectory);
            const now = new Date();
            const timestamp = now.toISOString().replace('T', ' ').split('.')[0];
            const commitMessage = `Update ${assignmentTitle} - ${timestamp}`;
            await this.gitService.commitChanges(submissionDirectory, commitMessage);

            progress.report({ message: 'Pushing to remote...' });
            try {
              await this.pushWithAuthRetry(submissionDirectory);
              progress.report({ message: 'Successfully pushed to remote.' });
            } catch (pushError) {
              console.error('[TestAssignment] Git push failed:', pushError);
              throw new Error(`Failed to push changes to remote: ${pushError instanceof Error ? pushError.message : String(pushError)}`);
            }

            progress.report({ message: 'Getting commit hash...' });
            currentCommitHash = await this.gitService.getLatestCommitHash(submissionDirectory);
          });
        }

        // Now check for existing artifact for current HEAD commit
        let submissionResponse: any = null;
        if (currentCommitHash && courseContentId) {
          // Check if artifact already exists for this commit
          try {
            const existingArtifacts = await this.apiService.listStudentSubmissionArtifacts({
              submission_group_id: submissionGroupId,
              version_identifier: currentCommitHash,
              with_latest_result: true
            });

            if (existingArtifacts.length > 0) {
              const artifact = existingArtifacts[0];
              if (!artifact) {
                throw new Error('Unexpected: artifact is undefined');
              }

              console.log(`[TestAssignment] Found existing artifact for commit ${currentCommitHash}:`, artifact);

              // "Tested" is carried by latest_result, which only comes back when
              // asked for above. This used to read a `result` field the endpoint
              // never returns, so the already-tested guard never fired.
              if (existingArtifacts.some(candidate => !!candidate.latest_result)) {
                throw new Error('This commit has already been tested. Make new changes to test again.');
              }

              // Artifact exists but not tested yet - reuse it
              console.log(`[TestAssignment] Reusing existing untested artifact ID: ${artifact.id}`);
              submissionResponse = { artifacts: [artifact.id] };
            } else {
              // No artifact exists, create new one
              console.log(`[TestAssignment] No artifact found for commit ${currentCommitHash}, creating new one`);
              await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: `Preparing ${assignmentTitle}...`,
                cancellable: false
              }, async (progress) => {
                progress.report({ message: 'Packaging submission archive...' });
                const archive = await this.createSubmissionArchive(submissionDirectory);
                console.log(`[TestAssignment] Archive created successfully`);

                progress.report({ message: 'Uploading submission package...' });
                submissionResponse = await this.apiService.createStudentSubmission({
                  submission_group_id: submissionGroupId,
                  version_identifier: currentCommitHash,
                  submit: false
                }, archive);
                console.log(`[TestAssignment] Created new artifact:`, submissionResponse);
              });
            }
          } catch (error: any) {
            console.error('[TestAssignment] Error handling artifact:', error);
            throw error;
          }
        }

        // Submit test - TestResultService will handle its own progress if polling is needed
        if (submissionResponse?.artifacts?.length > 0) {
          const artifactId = submissionResponse.artifacts[0];
          console.log(`[TestAssignment] Submitting test with artifact ID: ${artifactId}`);
          reachedTestSubmission = true;
          await this.testResultService.submitTestByArtifactAndAwaitResults(
            artifactId,
            assignmentTitle,
            undefined,
            { courseContentId }
          );
          testSucceeded = true;
        } else if (currentCommitHash && courseContentId) {
          console.error('[TestAssignment] No artifact ID available, cannot submit test');
          throw new Error('Failed to create or retrieve submission artifact');
        } else {
          notify.warning('Could not determine commit hash or content ID for testing');
        }

        // Only refresh if test completed successfully
        if (testSucceeded) {
          // Clear the cache for this specific content to ensure fresh data
          this.apiService.clearStudentCourseContentCache(courseContentId);
          // Use full refresh to ensure tree updates properly
          this.treeDataProvider.refresh();
        }
      } catch (error: any) {
        console.error('Failed to test assignment:', error);
        // Errors during the test run itself are surfaced by TestResultService.
        // Anything earlier (commit/push/artifact upload — e.g. the backend
        // rejecting the upload because the content has no testing service) must
        // be shown here, or the command fails silently.
        if (!reachedTestSubmission) {
          notify.error(`Could not run the test: ${error?.message || String(error)}`);
        }
      }
    });

    // Help command
    register('computor.student.help', async (item?: any) => {
      await this.showHelp(item);
    });
  }

  private async showHelp(item?: any): Promise<void> {
    try {
      let helpFileName = 'student-course.md';

      // Determine which help file to show based on context value
      if (item?.contextValue) {
        const contextValue = item.contextValue as string;

        if (contextValue.startsWith('studentCourseContent')) {
          // All course content items show assignment help
          helpFileName = 'student-assignment.md';
        } else if (contextValue === 'studentCourseUnit') {
          helpFileName = 'student-unit.md';
        } else if (contextValue === 'studentCourseRoot') {
          helpFileName = 'student-course.md';
        }
      }

      const helpPath = path.join(this.context.extensionPath, 'docs', 'help', helpFileName);

      if (!fs.existsSync(helpPath)) {
        notify.warning(`Help file not found: ${helpFileName}`);
        return;
      }

      await showMarkdownPreview(this.context, helpPath, { title: 'Computor Help' });

    } catch (error) {
      console.error('[showHelp] Failed to show help:', error);
      notify.error('Failed to open help documentation');
    }
  }

  private async exportCourseExamples(item?: any): Promise<void> {
    const courseId: string | undefined = typeof item?.courseId === 'string' ? item.courseId : undefined;
    const courseTitle: string = typeof item?.title === 'string' && item.title.trim().length > 0
      ? item.title
      : 'Course';
    if (!courseId) {
      notify.warning('No course selected for export.');
      return;
    }

    const formatPick = await vscode.window.showQuickPick(
      [
        { label: 'Tree (default)', description: 'Mirror the course content tree, named by content titles', value: 'tree' as CourseExportFormat },
        { label: 'Flat', description: 'One folder per assignment, named by example identifier', value: 'flat' as CourseExportFormat }
      ],
      {
        title: `Export ${courseTitle}: choose archive layout`,
        placeHolder: 'Tree (recommended)',
        ignoreFocusOut: true
      }
    );
    if (!formatPick) { return; }

    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
      notify.warning('Open a workspace folder before exporting.');
      return;
    }

    const defaultFile = `${sanitizeContentDirName(courseTitle)}.${formatPick.value}.zip`;
    const dest = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(path.join(workspaceRoot, defaultFile)),
      filters: { 'ZIP Archives': ['zip'] },
      saveLabel: 'Export'
    });
    if (!dest) { return; }

    await runLockedWithProgress(
      {
        key: `student-export:${courseId}`,
        title: `Exporting ${courseTitle}…`,
        duplicateMessage: 'Export already in progress for this course.',
        timeoutMs: 300_000
      },
      async () => {
        const contents = (await this.apiService.getStudentCourseContents(courseId)) ?? [];
        if (contents.length === 0) {
          notify.info('No course contents found to export.');
          return;
        }

        const result = await buildCourseExportZip({
          contents,
          workspaceRoot,
          format: formatPick.value
        });

        if (result.packaged === 0) {
          console.warn('[exportCourseExamples] Nothing packaged. Probed paths:', result.probedPaths);
          const sample = result.probedPaths.slice(0, 3).join('\n');
          const choice = await notify.warning(
            `Nothing was exported. Probed ${result.probedPaths.length} path(s).${sample ? `\nFirst: ${sample}` : ''}`,
            'Open Console'
          );
          if (choice === 'Open Console') {
            void vscode.commands.executeCommand('workbench.action.toggleDevTools');
          }
          return;
        }

        const buffer = await result.zip.generateAsync({
          type: 'nodebuffer',
          compression: 'DEFLATE',
          compressionOptions: { level: 6 }
        });
        await fs.promises.writeFile(dest.fsPath, buffer);

        const summary = result.missing.length > 0
          ? `Exported ${result.packaged} assignment(s); skipped ${result.missing.length} not on disk.`
          : `Exported ${result.packaged} assignment(s).`;
        // Fire-and-forget: awaiting this would keep the "Exporting…" progress
        // popup open until the user dismisses the success toast.
        void notify.info(summary, 'Reveal').then(choice => {
          if (choice === 'Reveal') {
            void vscode.commands.executeCommand('revealFileInOS', dest);
          }
        });
      }
    );
  }

  private async showMessages(item?: any): Promise<void> {
    try {
      const courseSelection = CourseSelectionService.getInstance();
      const courseInfo = courseSelection.getCurrentCourseInfo();
      let courseId = courseSelection.getCurrentCourseId();

      let target: MessageTargetContext | undefined;

      // Check if item is a course tree node (CourseRootItem has courseId property)
      if (item?.courseId && typeof item.courseId === 'string') {
        courseId = item.courseId;
      }

      // Also check if item has a nested course object
      const course = item?.course as any;
      if (course && typeof course.id === 'string') {
        courseId = course.id;
      }

      // Extract course content - could be in item.courseContent or item.node.courseContent (for units)
      let content = item?.courseContent as any;
      if (!content && item?.node?.courseContent) {
        content = item.node.courseContent;
      }

      if (content && typeof content.id === 'string') {
        courseId = content.course_id || courseId;

        if (!courseId) {
          notify.warning('No course selected.');
          return;
        }

        const submissionGroup = item?.submissionGroup as SubmissionGroupStudentList | undefined;
        const contentTitle: string = content.title || content.path || 'Course content';
        const courseLabel = courseInfo?.title || courseInfo?.path || 'Course';
        const subtitle = courseLabel ? `${courseLabel} › ${content.path || contentTitle}` : undefined;

        let query: Record<string, string>;
        let createPayload: Partial<MessageCreate>;

        let wsChannel: string | undefined;
        let readOnly = false;

        if (submissionGroup?.id) {
          // Assignment with submission group - students only need submission_group messages.
          // Pin scope so the panel doesn't pull in messages from broader scopes that
          // happen to share the same submission_group_id.
          query = {
            scope: 'submission_group',
            submission_group_id: submissionGroup.id
          };
          createPayload = {
            submission_group_id: submissionGroup.id
          };
          wsChannel = `submission_group:${submissionGroup.id}`;
        } else {
          // Unit content without a submission group: course_content is an
          // announcement scope, lecturer+ only. Students read it.
          query = {
            scope: 'course_content',
            course_content_id: content.id
          };
          createPayload = {
            course_content_id: content.id
          };
          wsChannel = `course_content:${content.id}`;
          readOnly = !canPostCourseAnnouncement(
            await this.apiService.getUserScopes().catch(() => undefined),
            courseId
          );
        }

        target = {
          title: contentTitle,
          subtitle,
          query,
          createPayload,
          sourceRole: 'student',
          wsChannel,
          readOnly,
          readOnlyReason: readOnly ? COURSE_ANNOUNCEMENT_DENIED_REASON : undefined
        } satisfies MessageTargetContext;
      }

      if (!target) {
        if (!courseId) {
          notify.warning('No course selected.');
          return;
        }

        const courseLabel = courseInfo?.title || courseInfo?.path || 'Course messages';
        const subtitle = courseInfo?.path ? `Course • ${courseInfo.path}` : undefined;

        // Course announcements: lecturer+ writes, everyone in the course
        // reads. Scope is pinned so the list stays announcements rather than
        // walking down into contents, groups and submission-group chats.
        const canPost = canPostCourseAnnouncement(
          await this.apiService.getUserScopes().catch(() => undefined),
          courseId
        );
        target = {
          title: courseLabel,
          subtitle,
          query: { course_id: courseId, scope: 'course' },
          createPayload: { course_id: courseId },
          sourceRole: 'student',
          wsChannel: `course:${courseId}`,
          readOnly: !canPost,
          readOnlyReason: canPost ? undefined : COURSE_ANNOUNCEMENT_DENIED_REASON
        } satisfies MessageTargetContext;
      }

      await this.messagesWebviewProvider.showMessages(target);
    } catch (error: any) {
      notify.error(`Failed to open messages: ${error?.message || error}`);
    }
  }

  // Utility method - currently unused but may be needed in the future
  /*
  private async fileExists(filePath: string): Promise<boolean> {
    try {
      const stat = await vscode.workspace.fs.stat(vscode.Uri.file(filePath));
      return (stat.type & vscode.FileType.File) !== 0;
    } catch {
      return false;
    }
  }
  */

  /**
   * Submit without git (download mode): zip a chosen folder and upload it as a
   * submission with NO version_identifier, so the backend content-addresses it
   * (a content hash) — an unchanged re-submit is then detected by dedup.
   */
  private async submitDownload(item?: any): Promise<void> {
    const submissionGroup = item?.submissionGroup as SubmissionGroupStudentList | undefined;
    const submissionGroupId = submissionGroup?.id;
    if (!submissionGroupId) {
      notify.warning('Open "Submit (without git)" from an assignment in the student tree.');
      return;
    }

    const folder = await vscode.window.showOpenDialog({
      canSelectFolders: true,
      canSelectFiles: false,
      canSelectMany: false,
      openLabel: 'Submit this folder',
      title: 'Choose the folder with your work to submit'
    });
    if (!folder || !folder[0]) { return; }
    const dir = folder[0].fsPath;

    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'Submitting…', cancellable: false },
      async (progress) => {
        try {
          progress.report({ message: 'Packaging your work…' });
          const archive = await this.createSubmissionArchive(dir);
          progress.report({ message: 'Uploading…' });
          // No version_identifier → the backend content-addresses the upload.
          const res = await this.apiService.createStudentSubmission(
            { submission_group_id: submissionGroupId, version_identifier: null, submit: true } as SubmissionCreate,
            archive
          );
          if (res) {
            void notify.info('Submitted your work (no git).');
          }
        } catch (e: any) {
          notify.error(`Submit failed: ${e?.message || String(e)}`);
        }
      }
    );
  }

  private async createSubmissionArchive(directory: string): Promise<{ buffer: Buffer; fileName: string }> {
    const zip = new JSZip();
    const baseDir = path.dirname(directory);
    await this.addDirectoryToZip(zip, directory, baseDir);

    const fileName = `${path.basename(directory)}.zip`;
    const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    return { buffer, fileName };
  }

  private async addDirectoryToZip(zip: JSZip, currentPath: string, baseDir: string): Promise<void> {
    const entries = await fs.promises.readdir(currentPath, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.name === '.git') {
        continue;
      }

      const entryPath = path.join(currentPath, entry.name);

      if (entry.isDirectory()) {
        await this.addDirectoryToZip(zip, entryPath, baseDir);
      } else if (entry.isFile()) {
        const relPath = path.relative(baseDir, entryPath).split(path.sep).join('/');
        const data = await fs.promises.readFile(entryPath);
        zip.file(relPath, data);
      }
    }
  }

  private async showContentDetails(arg: any): Promise<void> {
    try {
      const courseSelection = CourseSelectionService.getInstance();
      const courseInfo = courseSelection.getCurrentCourseInfo();
      const currentCourseId = courseSelection.getCurrentCourseId();

      let courseContentSummary: CourseContentStudentList | CourseContentStudentGet | undefined;
      let submissionGroupSummary: SubmissionGroupStudentList | undefined;
      let contentType: CourseContentTypeList | undefined;
      let localPath: string | undefined;
      let isCloned = false;

      if (arg && typeof arg === 'object') {
        if ('courseContent' in arg) {
          courseContentSummary = arg.courseContent as CourseContentStudentList;
          contentType = arg.contentType as CourseContentTypeList | undefined;
          submissionGroupSummary = arg.submissionGroup as SubmissionGroupStudentList | undefined;
          if (typeof arg.getRepositoryPath === 'function') {
            const repoPath = arg.getRepositoryPath();
            if (repoPath) {
              localPath = repoPath;
              isCloned = fs.existsSync(repoPath);
            }
          }
        } else if ('id' in arg && 'course_content_path' in arg) {
          submissionGroupSummary = arg as SubmissionGroupStudentList;
        } else if ('id' in arg && 'course_content_type_id' in arg) {
          courseContentSummary = arg as CourseContentStudentList;
        }
      }

      if (!courseContentSummary && submissionGroupSummary) {
        const courseContentId = (submissionGroupSummary as any).course_content_id as string | undefined;
        if (courseContentId) {
          courseContentSummary = await this.apiService.getStudentCourseContent(courseContentId, { force: true });
        }
      }

      if (!courseContentSummary && submissionGroupSummary && currentCourseId) {
        const contents = await this.apiService.getStudentCourseContents(currentCourseId, { force: false }) || [];
        courseContentSummary = contents.find(content => {
          const group = content.submission_group as SubmissionGroupStudentList | undefined;
          return group?.id === submissionGroupSummary?.id
            || group?.course_content_path === submissionGroupSummary?.course_content_path
            || content.id === (submissionGroupSummary as any)?.course_content_id;
        });
      }

      if (!courseContentSummary) {
        notify.warning('No detailed information available for this content yet.');
        return;
      }

      const courseContentDetails = await this.apiService.getStudentCourseContentDetails(courseContentSummary.id, { force: true });
      const courseContent = courseContentDetails ?? courseContentSummary;

      if (!submissionGroupSummary) {
        submissionGroupSummary = courseContentSummary.submission_group as SubmissionGroupStudentList | undefined;
      }

      const submissionGroupDetails = courseContentDetails?.submission_group as SubmissionGroupStudentGet | undefined;
      const submissionGroupCombined: SubmissionGroupStudentGet | SubmissionGroupStudentList | undefined = submissionGroupDetails ?? submissionGroupSummary;

      // Handle both course_content_type (singular) and course_content_types (plural)
      if (!contentType) {
        const ct = (courseContent as any).course_content_type || (courseContent as any).course_content_types;
        if (ct) {
          contentType = ct as CourseContentTypeList;
        }
      }

      if (!localPath) {
        localPath = this.resolveLocalRepositoryPath(courseContentSummary, submissionGroupSummary);
        if (localPath) {
          isCloned = fs.existsSync(localPath);
        }
      }

      const repo = submissionGroupCombined?.repository as any;

      const resultsHistoryRaw = await this.apiService.getStudentCourseContentResults(courseContent.id, {
        submissionGroupId: submissionGroupCombined?.id ?? undefined,
        limit: 20,
        force: true
      });
      const resultsHistory = this.buildResultHistory(resultsHistoryRaw);

      const gradingHistory = this.buildGradingHistory(submissionGroupDetails?.gradings);
      const latestGrading = (submissionGroupDetails as any)?.latest_grading ?? (submissionGroupSummary as any)?.latest_grading;
      let latestHistoryEntry = gradingHistory[0];

      const fallbackGradingValue = this.normalizeGradeValue(latestGrading?.grading ?? submissionGroupCombined?.grading);
      const candidateStatus = this.mapGradingStatus(latestGrading?.status) || submissionGroupCombined?.status || 'unknown';
      const candidateGrader = this.formatGraderName((latestGrading as any)?.graded_by_course_member, latestGrading?.graded_by);
      const candidateGradedAt = latestGrading?.updated_at || latestGrading?.created_at || null;
      const candidateFeedback = (typeof latestGrading?.feedback === 'string' ? latestGrading.feedback : undefined)
        || (submissionGroupCombined as any)?.latest_grading_feedback
        || (submissionGroupCombined as any)?.feedback
        || null;

      if (!latestHistoryEntry && (fallbackGradingValue !== null || latestGrading)) {
        const fallbackEntry: StudentGradingHistoryEntry = {
          id: latestGrading?.id ? String(latestGrading.id) : `${courseContent.id}-latest-grading`,
          gradePercent: fallbackGradingValue !== null ? fallbackGradingValue * 100 : null,
          rawGrade: fallbackGradingValue,
          status: candidateStatus,
          feedback: candidateFeedback,
          gradedAt: candidateGradedAt || undefined,
          graderName: candidateGrader || undefined
        };
        gradingHistory.unshift(fallbackEntry);
        latestHistoryEntry = fallbackEntry;
      }

      const gradingValue = latestHistoryEntry?.rawGrade ?? fallbackGradingValue;
      const gradeStatus = latestHistoryEntry?.status || candidateStatus || null;
      const gradedByDisplay = latestHistoryEntry?.graderName || candidateGrader || null;
      const gradedAtValue = latestHistoryEntry?.gradedAt || candidateGradedAt || null;
      const feedbackValue = latestHistoryEntry?.feedback ?? candidateFeedback;

      const resultValue = typeof courseContent.result?.result === 'number' ? courseContent.result.result : null;

      const members: SubmissionGroupMemberBasic[] = (submissionGroupCombined?.members as SubmissionGroupMemberBasic[] | undefined) ?? [];

      const viewState: StudentContentDetailsViewState = {
        course: courseInfo,
        content: courseContent,
        contentType,
        submissionGroup: submissionGroupCombined ?? null,
        repository: {
          hasRepository: Boolean(repo),
          fullPath: repo?.full_path || repo?.url || repo?.web_url,
          cloneUrl: repo?.clone_url,
          webUrl: repo?.web_url,
          localPath,
          isCloned
        },
        metrics: {
          testsRun: typeof courseContent.result_count === 'number' ? courseContent.result_count : undefined,
          maxTests: courseContent.max_test_runs ?? null,
          submissions: submissionGroupCombined?.count ?? null,
          maxSubmissions: submissionGroupCombined?.max_submissions ?? null,
          submitted: courseContent.submitted ?? null,
          resultPercent: resultValue !== null ? resultValue * 100 : null,
          gradePercent: gradingValue !== null ? gradingValue * 100 : null,
          gradeStatus,
          gradedBy: gradedByDisplay,
          gradedAt: gradedAtValue,
          status: submissionGroupCombined?.status || null,
          feedback: feedbackValue
        },
        team: {
          maxSize: submissionGroupCombined?.max_group_size ?? null,
          currentSize: submissionGroupCombined?.current_group_size ?? null,
          members: members.map((member) => ({
            id: member.course_member_id || member.id,
            name: member.full_name || member.username,
            username: member.username || null
          }))
        },
        example: {
          identifier: submissionGroupCombined?.example_identifier || null,
          versionId: getExampleVersionId(courseContentSummary)
        },
        actions: {
          localPath,
          webUrl: repo?.web_url,
          cloneUrl: repo?.clone_url
        },
        gradingHistory,
        resultsHistory
      };

      await this.contentDetailsWebviewProvider.showDetails(viewState);
    } catch (error: any) {
      console.error('Failed to show course content details:', error);
      notify.error(`Failed to open details: ${error?.message || error}`);
    }
  }
  
  private buildResultHistory(entries: ResultWithGrading[] | undefined | null): StudentResultHistoryEntry[] {
    if (!Array.isArray(entries) || entries.length === 0) {
      return [];
    }

    const sorted = [...entries].sort((a, b) => {
      const aTime = Date.parse(a.created_at ?? '') || 0;
      const bTime = Date.parse(b.created_at ?? '') || 0;
      return bTime - aTime;
    });

    return sorted.map((entry) => this.createResultHistoryEntry(entry));
  }

  private createResultHistoryEntry(entry: ResultWithGrading): StudentResultHistoryEntry {
    const normalizedResult = this.normalizeGradeValue(entry.result);

    return {
      id: entry.id,
      resultPercent: normalizedResult !== null ? normalizedResult * 100 : null,
      rawResult: normalizedResult,
      status: entry.status ?? null,
      submit: null,
      createdAt: entry.created_at ?? null,
      updatedAt: entry.updated_at ?? null,
      versionIdentifier: entry.version_identifier ?? null,
      testSystemId: entry.test_system_id ?? null
    } satisfies StudentResultHistoryEntry;
  }


  private buildGradingHistory(entries: unknown): StudentGradingHistoryEntry[] {
    let normalized: SubmissionGroupGradingList[] = [];

    if (Array.isArray(entries)) {
      normalized = entries.filter((entry): entry is SubmissionGroupGradingList => Boolean(entry));
    } else if (entries && typeof entries === 'object') {
      const maybeItems = (entries as any).items;
      if (Array.isArray(maybeItems)) {
        normalized = maybeItems.filter((entry: any): entry is SubmissionGroupGradingList => Boolean(entry));
      } else {
        normalized = Object.values(entries as Record<string, SubmissionGroupGradingList>)
          .filter((entry): entry is SubmissionGroupGradingList => Boolean(entry));
      }
    }

    if (normalized.length === 0) {
      return [];
    }

    const sorted = [...normalized].sort((a, b) => {
      const aTime = Date.parse(a.created_at ?? '') || 0;
      const bTime = Date.parse(b.created_at ?? '') || 0;
      return bTime - aTime;
    });

    return sorted.map((entry) => this.createHistoryEntry(entry));
  }

  private createHistoryEntry(entry: SubmissionGroupGradingList): StudentGradingHistoryEntry {
    const grade = this.normalizeGradeValue(entry.grading);
    const graderName = this.formatGraderName(entry.graded_by_course_member as any, entry.graded_by_course_member_id);
    const status = this.mapGradingStatus(entry.status) || 'unknown';

    return {
      id: entry.id,
      gradePercent: grade !== null ? grade * 100 : null,
      rawGrade: grade,
      status,
      feedback: entry.feedback ?? null,
      gradedAt: entry.created_at || undefined,
      graderName: graderName || undefined
    } satisfies StudentGradingHistoryEntry;
  }

  private normalizeGradeValue(value: unknown): number | null {
    if (value === undefined || value === null) {
      return null;
    }
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || Number.isNaN(numeric)) {
      return null;
    }
    if (numeric > 1) {
      return numeric / 100;
    }
    if (numeric < 0) {
      return 0;
    }
    return numeric;
  }

  private formatGraderName(
    gradedByCourseMember?: { user?: { given_name?: string | null; family_name?: string | null }; user_id?: string | null },
    fallback?: string | null
  ): string | null {
    const user = gradedByCourseMember?.user;
    const parts: string[] = [];

    if (user) {
      const given = typeof user.given_name === 'string' ? user.given_name.trim() : '';
      const family = typeof user.family_name === 'string' ? user.family_name.trim() : '';
      if (given) {
        parts.push(given);
      }
      if (family) {
        parts.push(family);
      }
    }

    if (parts.length > 0) {
      return parts.join(' ');
    }

    const userId = gradedByCourseMember?.user_id?.trim();
    if (userId) {
      return userId;
    }

    const fallbackId = typeof fallback === 'string' ? fallback.trim() : '';
    return fallbackId || null;
  }

  private mapGradingStatus(value: unknown): string | undefined {
    if (value === undefined || value === null) {
      return undefined;
    }
    if (typeof value === 'string') {
      return value;
    }
    const map: Record<string, string> = {
      '0': 'pending',
      '1': 'corrected',
      '2': 'correction_necessary',
      '3': 'improvement_possible'
    };
    const key = String(value);
    return map[key] || key;
  }




  private resolveLocalRepositoryPath(
    courseContent: CourseContentStudentList | CourseContentStudentGet,
    submissionGroup?: SubmissionGroupStudentList
  ): string | undefined {
    const directory = (courseContent as any)?.directory as string | undefined;
    if (!directory) {
      return undefined;
    }

    if (path.isAbsolute(directory)) {
      return directory;
    }

    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
      return undefined;
    }

    const repo = submissionGroup?.repository as any;
    let repoName: string | undefined;
    if (repo) {
      if (typeof repo.full_path === 'string' && repo.full_path.length > 0) {
        const parts = repo.full_path.split('/');
        repoName = parts[parts.length - 1] || undefined;
      } else if (typeof repo.clone_url === 'string' && repo.clone_url.length > 0) {
        const clean = repo.clone_url.replace(/\.git$/, '');
        const parts = clean.split('/');
        repoName = parts[parts.length - 1] || undefined;
      } else if (typeof repo.web_url === 'string' && repo.web_url.length > 0) {
        const parts = repo.web_url.split('/');
        repoName = parts[parts.length - 1] || undefined;
      }
    }

    if (repoName) {
      return path.join(workspaceRoot, repoName, directory);
    }

    return path.join(workspaceRoot, directory);
  }
}
