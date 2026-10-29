import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { TutorStudentTreeProvider } from '../ui/tree/tutor/TutorStudentTreeProvider';
import { ComputorApiService } from '../services/ComputorApiService';
import { TutorSelectionService } from '../services/TutorSelectionService';
import { createSimpleGit } from '../git/simpleGitFactory';
import { RepositoryTokenManager } from '../services/RepositoryTokenManager';
import { deriveRepositoryDirectoryName } from '../utils/repositoryNaming';
import { WorkspaceStructureManager } from '../utils/workspaceStructure';
// Import interfaces from generated types (interfaces removed to avoid duplication)
import { CourseMemberCommentsWebviewProvider } from '../ui/webviews/CourseMemberCommentsWebviewProvider';
import { showMarkdownPreview } from '../ui/webviews/markdownPreview';
import { CourseMemberCommentsInputPanelProvider } from '../ui/panels/CourseMemberCommentsInputPanel';
import { MessagesWebviewProvider, MessageTargetContext } from '../ui/webviews/MessagesWebviewProvider';
import { COURSE_ANNOUNCEMENT_DENIED_REASON, canPostCourseAnnouncement } from '../services/MessagePermissions';
import { MessageCreate, CourseContentStudentList, SubmissionGroupStudentList } from '../types/generated';
import { TutorGradeCreate, GradingStatus } from '../types/generated/common';
import { notify } from '../utils/notify';
import { readingLanguage } from '../services/WorkspaceCourseLanding';
import { pickDescriptionFile } from '../utils/descriptionLanguage';
import { pickLatestSubmissionArtifactId, sortSubmissionArtifactsByRecency } from '../utils/submissionArtifacts';
import { tutorTestTargetFor } from '../ui/tree/tutor/tutorTestTarget';
import { tutorHelpPageFor } from '../utils/tutorHelpPages';
import { helpPagePath } from '../utils/studentHelpPages';
import { say } from '../utils/uiLanguage';
interface TutorFilterRefreshable {
  refreshFilters(): void;
}
import type { MessagesInputPanelProvider } from '../ui/panels/MessagesInputPanel';
import type { WebSocketService } from '../services/WebSocketService';
import { TutorTestService } from '../services/TutorTestService';
import { commandRegistrar } from './commandHelpers';

export class TutorCommands {
  private context: vscode.ExtensionContext;
  private treeDataProvider: TutorStudentTreeProvider;
  private apiService: ComputorApiService;
  private commentsWebviewProvider: CourseMemberCommentsWebviewProvider;
  private messagesWebviewProvider: MessagesWebviewProvider;
  private workspaceStructure: WorkspaceStructureManager;
  private filterProvider?: TutorFilterRefreshable;
  private checkoutQueue: Array<{ item: unknown; confirmRedownload: boolean; resolve: () => void }> = [];
  private isCheckoutInProgress = false;
  private tutorTestService: TutorTestService;

  constructor(
    context: vscode.ExtensionContext,
    treeDataProvider: TutorStudentTreeProvider,
    apiService?: ComputorApiService,
    filterProvider?: TutorFilterRefreshable,
    messagesInputPanel?: MessagesInputPanelProvider,
    wsService?: WebSocketService,
    commentsInputPanel?: CourseMemberCommentsInputPanelProvider
  ) {
    this.context = context;
    this.treeDataProvider = treeDataProvider;
    // Use provided apiService or create a new one
    this.apiService = apiService || new ComputorApiService(context);
    this.commentsWebviewProvider = new CourseMemberCommentsWebviewProvider(context, this.apiService);
    if (commentsInputPanel) {
      this.commentsWebviewProvider.setInputPanel(commentsInputPanel);
    }
    this.messagesWebviewProvider = MessagesWebviewProvider.getShared(context, this.apiService);
    if (messagesInputPanel) {
      this.messagesWebviewProvider.setInputPanel(messagesInputPanel);
    }
    if (wsService) {
      this.messagesWebviewProvider.setWebSocketService(wsService);
    }
    this.workspaceStructure = WorkspaceStructureManager.getInstance();
    this.filterProvider = filterProvider;
    this.tutorTestService = TutorTestService.getInstance(this.apiService);

    // When the tutor selects a different course member in the filter tree, and the
    // comments webview is currently open, switch it to the new member automatically.
    // preserveFocus keeps the keyboard caret in the filter tree so up/down keep working.
    const selectionService = TutorSelectionService.getInstance();
    this.context.subscriptions.push(selectionService.onDidChangeSelection(() => {
      if (!this.commentsWebviewProvider.isOpen()) { return; }
      const memberId = selectionService.getCurrentMemberId();
      if (!memberId) { return; }
      if (this.commentsWebviewProvider.getCurrentCourseMemberId() === memberId) { return; }
      void this.showCourseMemberComments({ preserveFocus: true });
    }));
  }

  registerCommands(): void {

    const register = commandRegistrar(this.context);
    // Refresh tutor view: clear caches for current member to force API reload
    register('computor.tutor.refresh', async () => {
      try {
        const sel = TutorSelectionService.getInstance();
        const memberId = sel.getCurrentMemberId();
        const courseId = sel.getCurrentCourseId();
        // API-safe id: never the "No Group" sentinel (would 500 the backend).
        const groupId = sel.getApiGroupId();

        // Clear all tutor-related caches to ensure fresh data
        this.apiService.clearTutorCoursesCache();
        if (courseId) {
          this.apiService.clearTutorCourseGroupsCache(courseId);
          // Every group filter's roster, not just the one on screen: an
          // explicit Refresh should leave nothing stale behind it.
          this.apiService.clearTutorCourseMembersCache(courseId);
        }
        if (memberId) {
          this.apiService.clearTutorMemberCourseContentsCache(memberId);
        }
        // Also clear content kinds to be safe
        this.apiService.clearCourseContentKindsCache();

        // Proactively fetch fresh data, bypassing the warm tier outright so
        // an explicit Refresh can never serve a stale unread badge
        // (computor-org/issues#317).
        if (courseId) {
          await this.apiService.getTutorCourseMembers(courseId, groupId || undefined, { force: true });
        }
        if (courseId && memberId) {
          await this.apiService.getTutorCourseContents(courseId, memberId, { force: true });
        }
      } catch (error) {
        console.error('[TutorCommands] Error refreshing tutor data:', error);
      }
      this.treeDataProvider.refresh();
      this.filterProvider?.refreshFilters();
    });

    // Refresh tree view only (without cache clearing/API re-fetch) - used after marking messages as read
    register('computor.tutor.refreshTree', () => {
      this.treeDataProvider.refresh();
    });

    // Show Course Progress (uses current selected course from filters)
    register('computor.tutor.showCourseProgress', async () => {
      if (!(await this.hasLecturerView())) {
        notify.info(say('Grading and progress views are available to lecturers only.', 'Bewertungs- und Fortschrittsansichten stehen nur Lehrenden zur Verfügung.'));
        return;
      }
      const sel = TutorSelectionService.getInstance();
      const courseId = sel.getCurrentCourseId();
      if (!courseId) {
        notify.warning(say('Please select a course first.', 'Wähle zuerst einen Kurs aus.'));
        return;
      }
      await vscode.commands.executeCommand('computor.lecturer.showCourseProgressOverview', courseId);
    });

    // Show Member Progress (uses current selected member from filters)
    register('computor.tutor.showMemberProgress', async () => {
      if (!(await this.hasLecturerView())) {
        notify.info(say('Grading and progress views are available to lecturers only.', 'Bewertungs- und Fortschrittsansichten stehen nur Lehrenden zur Verfügung.'));
        return;
      }
      const sel = TutorSelectionService.getInstance();
      const memberId = sel.getCurrentMemberId();
      const memberName = sel.getCurrentMemberLabel();
      if (!memberId) {
        notify.warning(say('Please select a member first.', 'Wähle zuerst eine Person aus.'));
        return;
      }
      await vscode.commands.executeCommand('computor.lecturer.showCourseMemberProgress', memberId, memberName);
    });

    register('computor.tutor.showCourseMemberComments', async () => {
      await this.showCourseMemberComments();
    });

    register('computor.tutor.showMessages', async (item?: any) => {
      await this.showMessages(item);
    });

    // Old tutor example/course commands removed in favor of TutorStudentTreeProvider actions

    // Tutor: Clone student repository (scaffold)
    register('computor.tutor.cloneStudentRepository', async (item: any) => {
      try {
        // Prefer repository information from the clicked assignment's submission_group
        const content: any = item?.content || item?.course_content;
        const contentCourseId: string | undefined = content?.course_id;
        const submission = content?.submission_group || content?.submission;
        const submissionRepo = submission?.repository;

        const sel = TutorSelectionService.getInstance();
        let courseId = contentCourseId || sel.getCurrentCourseId() || '';
        let memberId = sel.getCurrentMemberId() || '';
        if (!courseId || !memberId) {
          // Fallback prompts only if selection is missing
          if (!courseId) courseId = (await vscode.window.showInputBox({ title: say('Course ID', 'Kurs-ID'), prompt: say('Enter course ID', 'Gib die Kurs-ID ein'), ignoreFocusOut: true })) || '';
          if (!memberId) memberId = (await vscode.window.showInputBox({ title: say('Course Member ID', 'ID der Kursteilnahme'), prompt: say('Enter course member ID', 'Gib die ID der Kursteilnahme ein'), ignoreFocusOut: true })) || '';
        }
        if (!courseId || !memberId) { return; }

        // Build remote URL: prefer clone_url; then url/web_url; try to construct from provider_url + full_path; fallback to backend member repo; if still missing, throw
        let remoteUrl: string | undefined = submissionRepo?.clone_url || submissionRepo?.url || submissionRepo?.web_url;
        if (!remoteUrl && submissionRepo) {
          const base = (submissionRepo as any).provider_url || (submissionRepo as any).provider || submissionRepo.url || '';
          const full = submissionRepo.full_path || '';
          if (base && full) {
            remoteUrl = `${base.replace(/\/$/, '')}/${full.replace(/^\//, '')}`;
            if (!remoteUrl.endsWith('.git')) remoteUrl += '.git';
          }
        }
        if (!remoteUrl) {
          // Try backend member repository endpoint
          const repoMeta = await this.apiService.getTutorStudentRepository(courseId, memberId);
          remoteUrl = repoMeta?.remote_url;
        }
        if (!remoteUrl) {
          notify.error(say('No repository URL found for this student assignment.', 'Für diese Aufgabe der Person ist keine Repository-Adresse bekannt.'));
          return;
        }

        // Extract submission group ID if available
        const submissionGroupId = submission?.id || content?.submission_group?.id;
        // Include full repository data for full_path
        const fullSubmissionRepo = submissionRepo || content?.submission_group?.repository;
        const repoName = deriveRepositoryDirectoryName({
          submissionRepo: fullSubmissionRepo,
          remoteUrl,
          submissionGroupId,
          courseId,
          memberId
        });

        // Ensure workspace directories exist
        await this.workspaceStructure.ensureDirectories();

        // Use review directory for tutor repositories
        const dir = this.workspaceStructure.getReviewRepositoryPath(repoName);
        await fs.promises.mkdir(dir, { recursive: true });
        // Git clone into the destination if empty
        const exists = await fs.promises.readdir(dir).then(list => list.length > 0).catch(() => false);
        if (exists) {
          notify.warning(say(`Directory not empty: ${dir}. Skipping clone.`, `Der Ordner ist nicht leer: ${dir}. Es wird nicht geklont.`));
        } else {
          const origin = (() => { try { const u = new URL(remoteUrl!); return u.origin; } catch { return undefined; } })();
          const tokenManager = RepositoryTokenManager.getInstance(this.context);
          let authUrl = remoteUrl!;
          if (origin) {
            const savedToken = await tokenManager.getToken(origin);
            if (savedToken) {
              authUrl = tokenManager.buildAuthenticatedCloneUrl(remoteUrl!, savedToken);
            }
          }
          try {
            await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: say('Cloning student repository...', 'Repository der Person wird geklont …'), cancellable: false }, async () => {
              await createSimpleGit().clone(authUrl, dir);
            });
            notify.info(say(`Student repository cloned to ${dir}`, `Repository der Person geklont nach ${dir}`));
            this.treeDataProvider.refresh();
          } catch (e: any) {
            const msg = String(e?.message || e || '');
            if (origin && (msg.includes('Authentication failed') || msg.includes('could not read Username') || msg.includes('401'))) {
              const newToken = await (async () => {
                // Reuse token manager's prompt behavior
                const t = await vscode.window.showInputBox({
                  title: say(`GitLab Authentication for ${origin}`, `GitLab-Anmeldung für ${origin}`),
                  prompt: say(`Enter your GitLab Personal Access Token for ${origin}`, `Gib dein persönliches GitLab-Zugriffstoken für ${origin} ein`),
                  placeHolder: 'glpat-xxxxxxxxxxxxxxxxxxxx',
                  password: true,
                  ignoreFocusOut: true
                });
                if (t) await tokenManager.storeToken(origin, t);
                return t || undefined;
              })();
              if (!newToken) throw e;
              authUrl = tokenManager.buildAuthenticatedCloneUrl(remoteUrl!, newToken);
              await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: say('Cloning student repository...', 'Repository der Person wird geklont …'), cancellable: false }, async () => {
                await createSimpleGit().clone(authUrl, dir);
              });
              notify.info(say(`Student repository cloned to ${dir}`, `Repository der Person geklont nach ${dir}`));
              this.treeDataProvider.refresh();
            } else {
              throw e;
            }
          }
        }
        // Directory is already inside the current workspace; no need to add a new folder
      } catch (e: any) {
        notify.error(say(`Failed to clone student repository: ${e?.message || e}`, `Das Repository der Person konnte nicht geklont werden: ${e?.message || e}`));
      }
    });

    // Tutor: Update student repository (pull latest changes)
    register('computor.tutor.updateStudentRepository', async (item: any) => {
      try {
        const content: any = item?.content || item?.courseContent || item?.course_content || item;
        const submission = content?.submission_group || content?.submission || content;
        const submissionRepo = submission?.repository || content?.submission_group?.repository;

        // Get course and member context
        const sel = TutorSelectionService.getInstance();
        let courseId = sel.getCurrentCourseId();
        let memberId = sel.getCurrentMemberId();

        if (!courseId || !memberId) {
          if (!courseId) courseId = (await vscode.window.showInputBox({ title: say('Course ID', 'Kurs-ID'), prompt: say('Enter course ID', 'Gib die Kurs-ID ein'), ignoreFocusOut: true })) || '';
          if (!memberId) memberId = (await vscode.window.showInputBox({ title: say('Course Member ID', 'ID der Kursteilnahme'), prompt: say('Enter course member ID', 'Gib die ID der Kursteilnahme ein'), ignoreFocusOut: true })) || '';
        }
        if (!courseId || !memberId) { return; }

        // Build remote URL
        let remoteUrl: string | undefined = submissionRepo?.clone_url || submissionRepo?.url || submissionRepo?.web_url;
        if (!remoteUrl && submissionRepo) {
          const base = (submissionRepo as any).provider_url || (submissionRepo as any).provider || submissionRepo.url || '';
          const full = submissionRepo.full_path || '';
          if (base && full) {
            remoteUrl = `${base.replace(/\/$/, '')}/${full.replace(/^\//, '')}`;
            if (!remoteUrl.endsWith('.git')) remoteUrl += '.git';
          }
        }

        // Get repository directory name
        const submissionGroupId = submission?.id || content?.submission_group?.id;
        const fullSubmissionRepo = submissionRepo || content?.submission_group?.repository;
        const repoName = deriveRepositoryDirectoryName({
          submissionRepo: fullSubmissionRepo,
          remoteUrl,
          submissionGroupId,
          courseId,
          memberId
        });

        const dir = this.workspaceStructure.getReviewRepositoryPath(repoName);
        const gitDir = path.join(dir, '.git');

        // Check if repository exists
        if (!fs.existsSync(gitDir)) {
          notify.error(say('Repository not found. Please clone it first.', 'Das Repository wurde nicht gefunden. Klone es zuerst.'));
          return;
        }

        // Update the repository
        await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: say('Updating student repository...', 'Repository der Person wird aktualisiert …'), cancellable: false },
          async () => {
            const git = createSimpleGit({ baseDir: dir });
            await git.fetch(['--all']);
            await git.pull(['--ff-only']);
          }
        );

        notify.info(say('Repository updated successfully.', 'Das Repository ist aktualisiert.'));
        this.treeDataProvider.refresh();
      } catch (e: any) {
        notify.error(say(`Failed to update repository: ${e?.message || e}`, `Das Repository konnte nicht aktualisiert werden: ${e?.message || e}`));
      }
    });

    // Tutor: Set grading and status together
    register('computor.tutor.assignment.grading', async (item: { content?: CourseContentStudentList; courseContent?: CourseContentStudentList }) => {
      const content: CourseContentStudentList | undefined = item?.content || item?.courseContent;
      const contentId = content?.id;
      if (!content || !contentId) { notify.error(say('No course content selected.', 'Kein Kursinhalt ausgewählt.')); return; }

      const sel = TutorSelectionService.getInstance();
      const memberId = sel.getCurrentMemberId();
      if (!memberId) { notify.error(say('No course member selected.', 'Keine Person ausgewählt.')); return; }

      // Get the latest submitted artifact to ensure grade is applied correctly
      const submissionGroup: SubmissionGroupStudentList | undefined | null = content.submission_group;
      let latestSubmittedArtifactId: string | undefined;
      if (submissionGroup?.id) {
        const artifacts = await this.apiService.listSubmissionArtifacts(submissionGroup.id, { latest: true });
        if (artifacts && artifacts.length > 0 && artifacts[0]) {
          latestSubmittedArtifactId = artifacts[0].id;
        }
      }

      // Previous grade (0.0–1.0) from submission_group, previous status from content
      const prevGrade: number | undefined = typeof submissionGroup?.grading === 'number' ? submissionGroup.grading : undefined;
      const prevStatus: string | undefined = content.status ?? undefined;

      const gradingInput = await vscode.window.showInputBox({
        title: say('Grading', 'Bewertung'),
        prompt: say('Enter grade between 0.00 and 1.00 (max 2 decimal places)', 'Gib eine Bewertung zwischen 0.00 und 1.00 ein (höchstens 2 Nachkommastellen)'),
        placeHolder: say('e.g., 0.85', 'z. B. 0.85'),
        value: prevGrade != null ? prevGrade.toFixed(2) : undefined,
        ignoreFocusOut: true,
        validateInput: (v) => {
          if (!v || !v.trim()) return say('Enter a value between 0 and 1', 'Gib einen Wert zwischen 0 und 1 ein');
          const trimmed = v.trim();
          if (!/^(?:0(?:\.\d{1,2})?|1(?:\.0{1,2})?|\.\d{1,2})$/.test(trimmed)) {
            return say('Value must be between 0 and 1 with at most 2 decimal places', 'Der Wert muss zwischen 0 und 1 liegen und darf höchstens 2 Nachkommastellen haben');
          }
          const n = Number(trimmed);
          if (!isFinite(n) || n < 0 || n > 1) return say('Value must be between 0 and 1', 'Der Wert muss zwischen 0 und 1 liegen');
          return undefined;
        }
      });
      if (gradingInput == null) return; // cancelled
      const grade = Math.max(0, Math.min(1, Number(gradingInput.trim())));

      const statusOptions: Array<vscode.QuickPickItem & { value: GradingStatus }> = [
        { label: say('corrected', 'Bewertet'), description: say('Mark as corrected', 'corrected'), value: 1 as GradingStatus },
        { label: say('correction_necessary', 'Korrektur nötig'), description: say('Correction necessary', 'correction_necessary'), value: 2 as GradingStatus },
        { label: say('improvement_possible', 'Verbesserung möglich'), description: say('Improvement possible', 'improvement_possible'), value: 3 as GradingStatus },
        { label: say('not_reviewed', 'Nicht bewertet'), description: say('Not reviewed', 'not_reviewed'), value: 0 as GradingStatus },
      ];
      const statusPick = await vscode.window.showQuickPick(statusOptions, {
        title: 'Status',
        placeHolder: prevStatus ? say(`Current: ${prevStatus}`, `Aktuell: ${prevStatus}`) : say('Choose status', 'Status wählen'),
        canPickMany: false,
        ignoreFocusOut: true
      });
      if (!statusPick) return; // cancelled

      try {
        const tutorGrade: TutorGradeCreate = {
          artifact_id: latestSubmittedArtifactId,
          grade,
          status: statusPick.value,
        };
        await this.apiService.submitTutorGrade(memberId, contentId, tutorGrade);

        // Clear caches and refresh to get updated data
        const courseId = sel.getCurrentCourseId();

        this.apiService.clearTutorMemberCourseContentsCache(memberId);
        if (courseId) {
          // The ungraded-submissions badge just changed, and this member
          // appears in the "All groups" roster as well as their own.
          this.apiService.clearTutorCourseMembersCache(courseId);
        }

        // Full tree refresh: status changes affect parent unit items (aggregated from API)
        this.treeDataProvider.refresh();
        this.filterProvider?.refreshFilters();

        notify.info(say(`Updated: ${grade.toFixed(2)} • ${statusPick.label}`, `Gespeichert: ${grade.toFixed(2)} • ${statusPick.label}`));

        // Both verdicts ask the student to act, and students can't know what
        // to change unless the tutor says so — open the conversation for this
        // assignment right away (#372).
        if (statusPick.value === 2 || statusPick.value === 3) {
          await this.showMessages(item);
        }
      } catch (e: any) {
        notify.error(say(`Failed to update grading: ${e?.message || e}`, `Die Bewertung konnte nicht gespeichert werden: ${e?.message || e}`));
      }
    });

    register('computor.tutor.setMaxTestRuns', async (item: any) => {
      await this.setGroupBudget(item, 'max_test_runs');
    });

    register('computor.tutor.setMaxSubmissions', async (item: any) => {
      await this.setGroupBudget(item, 'max_submissions');
    });

    // Tutor: Download reference (example version)
    register('computor.tutor.downloadReference', async (item: any) => {
      await this.downloadReference(item);
    });

    // Tutor: Download submission artifact
    register('computor.tutor.downloadSubmissionArtifact', async (item: any) => {
      await this.downloadSubmissionArtifact(item);
    });

    // Tutor: Compare with reference
    register('computor.tutor.compareWithReference', async (item: any) => {
      await this.compareWithReference(item);
    });

    // Tutor: Show submission test results
    register('computor.tutor.showSubmissionTestResults', async (item: any) => {
      await this.showSubmissionTestResults(item);
    });

    // Tutor: Checkout - download reference and latest submission (or just reference if no submission)
    // When called from context menu (confirmRedownload=true), asks before re-downloading existing files
    // When called from selection (confirmRedownload=false), always downloads without asking
    register('computor.tutor.checkout', async (item: unknown, confirmRedownload?: boolean) => {
      await this.queueCheckout(item, confirmRedownload ?? true);
    });

    // Tutor: Show README preview for assignment
    register('computor.tutor.showReadme', async (item: any) => {
      await this.showReadme(item);
    });

    // Tutor: Run test on submission
    register('computor.tutor.runTest', async (item: any) => {
      await this.runTestOnSubmission(item);
    });

    // Help command
    register('computor.tutor.help', async (item?: any) => {
      await this.showHelp(item);
    });
  }

  private async showHelp(item?: any): Promise<void> {
    try {
      const helpFileName = tutorHelpPageFor(item?.contextValue);
      const helpPath = helpPagePath(this.context.extensionPath, helpFileName);

      if (!fs.existsSync(helpPath)) {
        notify.warning(say(`Help file not found: ${helpFileName}`, `Die Hilfeseite fehlt: ${helpFileName}`));
        return;
      }

      await showMarkdownPreview(this.context, helpPath, { title: say('Computor Help', 'Computor-Hilfe') });
    } catch (error) {
      console.error('[showHelp] Failed to show help:', error);
      notify.error(say('Failed to open help documentation', 'Die Hilfe konnte nicht geöffnet werden.'));
    }
  }

  /**
   * Grant one student (one submission group) their own test-run or submission
   * budget, straight from the assignment row in the tutor tree.
   *
   * The refusal a student hits tells them to ask for another attempt, which
   * until now nobody could act on: the limit lives on the assignment and on the
   * course, so raising it raised it for the whole class
   * (computor-org/issues#393). This writes the group-level override instead,
   * which is the only tier that reaches a single student — and the only one a
   * `_tutor` may touch.
   *
   * The number shown is the *effective* budget, whatever tier it comes from;
   * clearing the field drops the override rather than granting unlimited, so
   * the result is reported back from the server's own resolution.
   */
  private async setGroupBudget(
    item: any,
    field: 'max_test_runs' | 'max_submissions'
  ): Promise<void> {
    const content: CourseContentStudentList | undefined = item?.content || item?.courseContent;
    const submissionGroup: SubmissionGroupStudentList | undefined | null = content?.submission_group;

    if (!content) { notify.error(say('No assignment selected.', 'Keine Aufgabe ausgewählt.')); return; }
    if (!submissionGroup?.id) {
      notify.warning(
        say('This student has no submission group for the assignment yet, so there is nothing to grant. '
        + 'A group appears once the assignment is deployed to them.', 'Diese Person hat für die Aufgabe noch keine Abgabegruppe, daher gibt es nichts freizugeben. '
        + 'Die Gruppe entsteht, sobald die Aufgabe für sie bereitgestellt ist.')
      );
      return;
    }

    const isTestRuns = field === 'max_test_runs';
    const label = isTestRuns ? say('Max Test Runs', 'Höchstzahl der Testläufe') : say('Max Submissions', 'Höchstzahl der Abgaben');
    const noun = isTestRuns ? say('test runs', 'Testläufe') : say('submissions', 'Abgaben');
    const current = (isTestRuns ? content.max_test_runs : content.max_submissions) ?? null;
    const who = submissionGroup.members?.[0]?.full_name || say('this student', 'diese Person');

    const answer = await vscode.window.showInputBox({
      title: say(`Set ${label} for ${who}`, `${label} für ${who} festlegen`),
      prompt: say(`How many ${noun} may ${who} use for "${content.title || content.path}"? `
        + `Leave empty to follow the assignment's limit.`,
        `Wie viele ${noun} darf ${who} für „${content.title || content.path}“ nutzen? `
        + 'Lass das Feld leer, um die Grenze der Aufgabe zu übernehmen.'),
      value: current === null ? '' : String(current),
      ignoreFocusOut: true,
      validateInput: (value) => {
        const trimmed = value.trim();
        if (trimmed.length === 0) { return undefined; }
        if (!/^\d+$/.test(trimmed)) { return say('Enter a whole number, or leave empty to follow the assignment.', 'Gib eine ganze Zahl ein oder lass das Feld leer, um die Grenze der Aufgabe zu übernehmen.'); }
        return undefined;
      }
    });

    if (answer === undefined) { return; }

    const trimmed = answer.trim();
    // Empty means "drop the override", not "unlimited": the group falls back to
    // the assignment and then the course. An unchanged number is a no-op rather
    // than an override that freezes today's inherited value.
    const value = trimmed.length === 0 ? null : Number.parseInt(trimmed, 10);
    if (value !== null && value === current) { return; }

    try {
      const updated = await this.apiService.updateTutorSubmissionGroupLimits(
        submissionGroup.id,
        { [field]: value }
      );

      const memberId: string | undefined = item?.memberId || TutorSelectionService.getInstance().getCurrentMemberId() || undefined;
      if (memberId) {
        this.apiService.clearTutorMemberCourseContentsCache(memberId);
      }
      this.treeDataProvider.refresh();

      const effective = isTestRuns ? updated.max_test_runs : updated.max_submissions;
      const resolved = effective === null || effective === undefined ? say('unlimited', 'unbegrenzt') : String(effective);
      notify.info(
        value === null
          ? say(`${label} for ${who}: following the assignment (${resolved})`, `${label} für ${who}: wie in der Aufgabe (${resolved})`)
          : say(`${label} for ${who}: ${resolved}`, `${label} für ${who}: ${resolved}`)
      );
    } catch (error: any) {
      notify.error(say(`Failed to set ${label}: ${error?.message || error}`, `${label} konnte nicht gespeichert werden: ${error?.message || error}`));
    }
  }

  // Grading/progress views are lecturer+ only (the backend enforces this too).
  // getUserViews() is cached, so this is cheap on repeated invocations.
  private async hasLecturerView(): Promise<boolean> {
    try {
      return (await this.apiService.getUserViews()).includes('lecturer');
    } catch {
      return false;
    }
  }

  private async queueCheckout(item: unknown, confirmRedownload: boolean): Promise<void> {
    return new Promise((resolve) => {
      this.checkoutQueue.push({ item, confirmRedownload, resolve });
      void this.processCheckoutQueue();
    });
  }

  private async processCheckoutQueue(): Promise<void> {
    if (this.isCheckoutInProgress || this.checkoutQueue.length === 0) {
      return;
    }

    this.isCheckoutInProgress = true;
    const { item, confirmRedownload, resolve } = this.checkoutQueue.shift()!;

    try {
      await this.checkout(item, confirmRedownload);
    } finally {
      this.isCheckoutInProgress = false;
      resolve();
      void this.processCheckoutQueue();
    }
  }

  private async showCourseMemberComments(opts?: { preserveFocus?: boolean }): Promise<void> {
    try {
      const selection = TutorSelectionService.getInstance();
      const memberId = selection.getCurrentMemberId();
      if (!memberId) {
        notify.warning(say('No course member selected.', 'Keine Person ausgewählt.'));
        return;
      }

      const segments: string[] = [];
      const memberLabel = selection.getCurrentMemberLabel();
      const courseLabel = selection.getCurrentCourseLabel();
      if (memberLabel) {
        segments.push(memberLabel);
      }
      if (courseLabel) {
        segments.push(courseLabel);
      }
      const title = segments.length > 0 ? segments.join(' — ') : memberId;
      await this.commentsWebviewProvider.showComments(memberId, title, opts);
    } catch (error: any) {
      notify.error(say(`Failed to open comments: ${error?.message || error}`, `Die Kommentare konnten nicht geöffnet werden: ${error?.message || error}`));
    }
  }

  private async showMessages(item?: any): Promise<void> {
    try {
      const selection = TutorSelectionService.getInstance();
      const courseId = selection.getCurrentCourseId();
      if (!courseId) {
        notify.warning(say('Select a course before viewing messages.', 'Wähle einen Kurs aus, bevor du Nachrichten ansiehst.'));
        return;
      }

      const memberId = selection.getCurrentMemberId();
      if (!memberId) {
        notify.warning(say('Select a course member before viewing messages.', 'Wähle eine Person aus, bevor du Nachrichten ansiehst.'));
        return;
      }

      const courseLabel = selection.getCurrentCourseLabel();

      // Fetch member data to build clean name (without badges)
      const member = await this.apiService.getCourseMember(memberId);
      let memberName: string | null = null;
      if (member?.user) {
        const user = member.user;
        if (user.given_name && user.family_name) {
          memberName = `${user.family_name}, ${user.given_name}`;
        } else {
          memberName = (user as any).full_name || null;
        }
      }

      const content: CourseContentStudentList | undefined = item?.content || item?.courseContent;
      const submissionGroup: SubmissionGroupStudentList | undefined = content?.submission_group || item?.submissionGroup;

      let target: MessageTargetContext | undefined;

      if (content) {
        const contentTitle = content.title || content.path || say('Course content', 'Kursinhalt');

        let query: Record<string, string>;
        let createPayload: Partial<MessageCreate>;

        let wsChannel: string | undefined;
        let readOnly = false;

        if (submissionGroup?.id) {
          // Assignment with submission group — the tutor's conversation with
          // that student. Pin scope so the submission_group filter doesn't
          // also walk into the group's course_member messages.
          query = {
            scope: 'submission_group',
            submission_group_id: submissionGroup.id
          };
          createPayload = {
            submission_group_id: submissionGroup.id
          };
          // Tutors subscribe to the specific submission group for targeted updates
          wsChannel = `submission_group:${submissionGroup.id}`;
        } else {
          // Unit content without a submission group: course_content is an
          // announcement scope, lecturer+ only. Tutors read it.
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

        const subtitleSegments = [courseLabel, memberName, content.path || contentTitle].filter(Boolean) as string[];
        const subtitle = subtitleSegments.length > 0 ? subtitleSegments.join(' › ') : undefined;
        const title = memberName ? `${memberName} — ${contentTitle}` : contentTitle;

        target = {
          title,
          subtitle,
          query,
          createPayload,
          sourceRole: 'tutor',
          wsChannel,
          // The tree refresh after a read sweep keys off this member, and it
          // used to be smuggled through `query` (where the API client had to
          // strip it again before every request).
          cacheCourseMemberId: memberId,
          readOnly,
          readOnlyReason: readOnly ? COURSE_ANNOUNCEMENT_DENIED_REASON : undefined
        } satisfies MessageTargetContext;
      }

      if (!target) {
        // Course announcements: lecturer+ writes, everyone in the course reads.
        const subtitleSegments = [courseLabel, memberName].filter(Boolean) as string[];
        const subtitle = subtitleSegments.length > 0 ? subtitleSegments.join(' › ') : undefined;
        const canPost = canPostCourseAnnouncement(
          await this.apiService.getUserScopes().catch(() => undefined),
          courseId
        );
        target = {
          title: memberName ? say(`${memberName} — Course messages`, `${memberName} — Kursnachrichten`) : say('Course member messages', 'Nachrichten der Person'),
          subtitle,
          query: { course_id: courseId, scope: 'course' },
          createPayload: { course_id: courseId },
          sourceRole: 'tutor',
          wsChannel: `course:${courseId}`,
          cacheCourseMemberId: memberId,
          readOnly: !canPost,
          readOnlyReason: canPost ? undefined : COURSE_ANNOUNCEMENT_DENIED_REASON
        } satisfies MessageTargetContext;
      }

      await this.messagesWebviewProvider.showMessages(target);
    } catch (error: any) {
      notify.error(say(`Failed to open messages: ${error?.message || error}`, `Die Nachrichten konnten nicht geöffnet werden: ${error?.message || error}`));
    }
  }

  private async downloadReference(item: any): Promise<void> {
    try {
      const content: CourseContentStudentList = item?.content || item?.courseContent || item?.course_content;

      if (!content) {
        notify.error(say('No course content information available', 'Zu diesem Kursinhalt liegen keine Angaben vor.'));
        return;
      }

      const deployment = content.deployment;
      if (!deployment || !deployment.example_version_id) {
        notify.error(say('No reference available for this assignment', 'Für diese Aufgabe gibt es keine Musterlösung.'));
        return;
      }

      const exampleVersionId = deployment.example_version_id;
      const referencePath = this.workspaceStructure.getReviewReferencePath(exampleVersionId);

      // Check if reference already exists
      const exists = await this.workspaceStructure.directoryExists(referencePath);
      if (exists) {
        const choice = await notify.warning(
          say(`Reference for this assignment already exists. The example version may have been updated. Re-download?`, `Die Musterlösung dieser Aufgabe ist bereits vorhanden. Die Beispielversion hat sich vielleicht geändert. Erneut herunterladen?`),
          say('Re-download', 'Erneut herunterladen'),
          say('Cancel', 'Abbrechen')
        );
        if (choice !== say('Re-download', 'Erneut herunterladen')) {
          return;
        }
        // Remove existing directory
        await fs.promises.rm(referencePath, { recursive: true, force: true });
      }

      // Download reference
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: say('Downloading reference...', 'Musterlösung wird heruntergeladen …'),
          cancellable: false
        },
        async () => {
          const buffer = await this.apiService.downloadCourseContentReference(content.id, true);
          if (!buffer) {
            throw new Error(say('Failed to download reference', 'Die Musterlösung konnte nicht heruntergeladen werden'));
          }

          // Extract ZIP to reference path
          await fs.promises.mkdir(referencePath, { recursive: true });
          const JSZip = require('jszip');
          const zip = await JSZip.loadAsync(buffer);

          for (const [filename, file] of Object.entries(zip.files)) {
            const fileData = file as any;
            if (!fileData.dir) {
              const content = await fileData.async('nodebuffer');
              const filePath = path.join(referencePath, filename);
              await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
              await fs.promises.writeFile(filePath, content);
            }
          }
        }
      );

      notify.info(say(`Reference downloaded to ${referencePath}`, `Musterlösung heruntergeladen nach ${referencePath}`));
      this.treeDataProvider.refresh();
    } catch (error: any) {
      notify.error(say(`Failed to download reference: ${error?.message || error}`, `Die Musterlösung konnte nicht heruntergeladen werden: ${error?.message || error}`));
    }
  }

  private async downloadSubmissionArtifact(item: any): Promise<void> {
    try {
      // If called from TutorSubmissionItem, we have the artifact info
      // Note: Do NOT fall back to item.id — that's the tree item's internal ID (e.g. "tutorVirtualFolder:..."), not a UUID
      let artifactId = item?.artifactId || item?.artifact_id;
      let submissionGroupId = item?.submissionGroupId || item?.submission_group_id;

      // If called from TutorVirtualFolderItem (Submissions folder), we need to get artifacts from API
      if (!artifactId || !submissionGroupId) {
        const content: CourseContentStudentList = item?.content || item?.courseContent;
        if (!content || !content.submission_group?.id) {
          notify.error(say('No submission group available for this assignment', 'Für diese Aufgabe gibt es keine Abgabegruppe.'));
          return;
        }

        submissionGroupId = content.submission_group.id;

        // Fetch available artifacts from API
        // TODO: Add API method to list artifacts for a submission group
        // For now, prompt user to select from tree instead
        notify.info(
          say('Please expand the Submissions folder and right-click on a specific submission to download it.', 'Klappe den Ordner „Submissions“ auf und lade eine Abgabe über ihr Kontextmenü (Rechtsklick) herunter.')
        );
        return;
      }

      const submissionPath = this.workspaceStructure.getReviewSubmissionPath(submissionGroupId, artifactId);

      // Check if submission already exists
      const exists = await this.workspaceStructure.directoryExists(submissionPath);
      if (exists) {
        const choice = await notify.warning(
          say(`Submission artifact already exists. Re-download?`, `Diese Abgabe ist bereits heruntergeladen. Erneut herunterladen?`),
          say('Re-download', 'Erneut herunterladen'),
          say('Cancel', 'Abbrechen')
        );
        if (choice !== say('Re-download', 'Erneut herunterladen')) {
          return;
        }
        // Remove existing directory
        await fs.promises.rm(submissionPath, { recursive: true, force: true });
      }

      // Download submission artifact
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: say('Downloading submission artifact...', 'Abgabe wird heruntergeladen …'),
          cancellable: false
        },
        async () => {
          const buffer = await this.apiService.downloadSubmissionArtifact(artifactId);
          if (!buffer) {
            throw new Error(say('Failed to download submission artifact', 'Die Abgabe konnte nicht heruntergeladen werden'));
          }

          // Extract ZIP to submission path
          await fs.promises.mkdir(submissionPath, { recursive: true });
          const JSZip = require('jszip');
          const zip = await JSZip.loadAsync(buffer);

          for (const [filename, file] of Object.entries(zip.files)) {
            const fileData = file as any;
            if (!fileData.dir) {
              const content = await fileData.async('nodebuffer');
              const filePath = path.join(submissionPath, filename);
              await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
              await fs.promises.writeFile(filePath, content);
            }
          }
        }
      );

      notify.info(say(`Submission artifact downloaded to ${submissionPath}`, `Abgabe heruntergeladen nach ${submissionPath}`));
      this.treeDataProvider.refresh();
    } catch (error: any) {
      notify.error(say(`Failed to download submission artifact: ${error?.message || error}`, `Die Abgabe konnte nicht heruntergeladen werden: ${error?.message || error}`));
    }
  }

  private async compareWithReference(item: any): Promise<void> {
    try {
      // Get the file path from the submission
      const submissionFilePath = item?.fsPath || item?.resourceUri?.fsPath;
      if (!submissionFilePath) {
        notify.error(say('No file selected for comparison', 'Keine Datei zum Vergleichen ausgewählt.'));
        return;
      }

      // Extract information from the path
      // Expected path: review/submissions/<submission_group_id>/<artifact_id>/<file_path>
      const dirs = this.workspaceStructure.getDirectories();
      const relativePath = path.relative(dirs.reviewSubmissions, submissionFilePath);
      const parts = relativePath.split(path.sep);

      if (parts.length < 3) {
        notify.error(say('Invalid submission file path', 'Der Pfad der abgegebenen Datei ist ungültig.'));
        return;
      }

      const fileInSubmission = parts.slice(2).join(path.sep);

      // Get course content to find example version
      const content = item?.content || item?.courseContent;
      if (!content || !content.deployment || !content.deployment.example_version_id) {
        notify.error(say('No reference available for comparison', 'Zum Vergleichen gibt es keine Musterlösung.'));
        return;
      }

      const exampleVersionId = content.deployment.example_version_id;
      const referencePath = this.workspaceStructure.getReviewReferencePath(exampleVersionId);
      const referenceFilePath = path.join(referencePath, fileInSubmission);

      // Check if reference exists
      if (!fs.existsSync(referenceFilePath)) {
        const choice = await notify.warning(
          say('Reference file not found. Download reference first?', 'Die Datei der Musterlösung fehlt. Zuerst die Musterlösung herunterladen?'),
          say('Download Reference', 'Musterlösung herunterladen'),
          say('Cancel', 'Abbrechen')
        );
        if (choice === say('Download Reference', 'Musterlösung herunterladen')) {
          await this.downloadReference({ content });
          // Try again after download
          if (!fs.existsSync(referenceFilePath)) {
            notify.error(say('Reference file still not found after download', 'Die Datei der Musterlösung fehlt auch nach dem Herunterladen.'));
            return;
          }
        } else {
          return;
        }
      }

      // Open diff view (reference on left, submission on right)
      const submissionUri = vscode.Uri.file(submissionFilePath);
      const referenceUri = vscode.Uri.file(referenceFilePath);
      const title = `${path.basename(submissionFilePath)} (Reference ↔ Submission)`;

      await vscode.commands.executeCommand('vscode.diff', referenceUri, submissionUri, title);
    } catch (error: any) {
      notify.error(say(`Failed to compare with reference: ${error?.message || error}`, `Der Vergleich mit der Musterlösung ist fehlgeschlagen: ${error?.message || error}`));
    }
  }

  private async showSubmissionTestResults(item: any): Promise<void> {
    try {
      console.log('[TutorCommands] showSubmissionTestResults called with item:', item);

      // Get the submission artifact ID from the item
      const artifactId = item?.artifactId;
      if (!artifactId) {
        console.log('[TutorCommands] No artifactId in item');
        notify.warning(say('No submission artifact ID found.', 'Zu dieser Abgabe wurde keine ID gefunden.'));
        return;
      }

      console.log('[TutorCommands] Fetching test results for artifact:', artifactId);

      // Fetch test results for this submission artifact
      const testResults = await this.apiService.getSubmissionArtifactTestResults(artifactId);
      console.log('[TutorCommands] Test results fetched:', testResults.length, 'results');

      if (!testResults || testResults.length === 0) {
        notify.warning(say('No test results available for this submission.', 'Zu dieser Abgabe gibt es keine Testergebnisse.'));
        return;
      }

      // Get the latest/first result (results are typically ordered by date)
      const latestResult = testResults[0];
      console.log('[TutorCommands] Latest result:', JSON.stringify(latestResult, null, 2));

      const resultJson = latestResult?.result_json;
      const resultId = latestResult?.id;
      const resultArtifacts = latestResult?.result_artifacts;

      if (!resultJson) {
        console.log('[TutorCommands] No result_json in latest result');
        notify.warning(say('No detailed test results available for this submission.', 'Zu dieser Abgabe gibt es keine ausführlichen Testergebnisse.'));
        return;
      }

      console.log('[TutorCommands] Opening results with resultJson');
      console.log('[TutorCommands] Result artifacts count:', resultArtifacts?.length ?? 0);

      await vscode.commands.executeCommand('computor.results.open', resultJson, resultId, resultArtifacts);
      await vscode.commands.executeCommand('computor.testResultsPanel.focus');

    } catch (error: any) {
      console.error('[TutorCommands] Error in showSubmissionTestResults:', error);
      notify.error(say(`Failed to show test results: ${error?.message || error}`, `Die Testergebnisse konnten nicht angezeigt werden: ${error?.message || error}`));
    }
  }

  private async checkout(item: unknown, confirmRedownload = true): Promise<void> {
    try {
      const itemAny = item as any;
      const content: CourseContentStudentList = itemAny?.content || itemAny?.courseContent || itemAny?.course_content;

      if (!content) {
        notify.error(say('No course content information available', 'Zu diesem Kursinhalt liegen keine Angaben vor.'));
        return;
      }

      const deployment = content.deployment;
      if (!deployment || !deployment.example_version_id) {
        notify.error(say('No reference available for this assignment', 'Für diese Aufgabe gibt es keine Musterlösung.'));
        return;
      }

      const exampleVersionId = deployment.example_version_id;
      const submissionGroupId = content.submission_group?.id;

      // Try to get latest submission artifact (may not exist)
      let latestArtifact: { id: string } | undefined;
      if (submissionGroupId) {
        const artifacts = await this.apiService.listSubmissionArtifacts(submissionGroupId);
        if (artifacts && artifacts.length > 0) {
          latestArtifact = sortSubmissionArtifactsByRecency(artifacts)[0];
        }
      }

      const referencePath = this.workspaceStructure.getReviewReferencePath(exampleVersionId);
      const submissionPath = latestArtifact && submissionGroupId
        ? this.workspaceStructure.getReviewSubmissionPath(submissionGroupId, latestArtifact.id)
        : undefined;

      // Check what already exists
      const referenceExists = await this.workspaceStructure.directoryExists(referencePath);
      const submissionExists = submissionPath
        ? await this.workspaceStructure.directoryExists(submissionPath)
        : false;

      // Determine what needs to be downloaded
      const hasSubmission = !!latestArtifact && !!submissionPath;

      // Handle existing files based on confirmRedownload flag
      if (hasSubmission && referenceExists && submissionExists) {
        if (confirmRedownload) {
          const choice = await notify.warning(
            say('Reference and latest submission already exist locally. Re-download?', 'Musterlösung und neueste Abgabe sind bereits lokal vorhanden. Erneut herunterladen?'),
            say('Re-download', 'Erneut herunterladen'),
            say('Cancel', 'Abbrechen')
          );
          if (choice !== say('Re-download', 'Erneut herunterladen')) {
            // Still expand the folders even if not re-downloading
            this.treeDataProvider.markForVirtualFolderExpansion(content.id);
            this.treeDataProvider.refresh();
            return;
          }
        }
        await fs.promises.rm(referencePath, { recursive: true, force: true });
        await fs.promises.rm(submissionPath, { recursive: true, force: true });
      } else if (!hasSubmission && referenceExists) {
        if (confirmRedownload) {
          const choice = await notify.warning(
            say('Reference already exists locally. Re-download?', 'Die Musterlösung ist bereits lokal vorhanden. Erneut herunterladen?'),
            say('Re-download', 'Erneut herunterladen'),
            say('Cancel', 'Abbrechen')
          );
          if (choice !== say('Re-download', 'Erneut herunterladen')) {
            // Still expand the folders even if not re-downloading
            this.treeDataProvider.markForVirtualFolderExpansion(content.id);
            this.treeDataProvider.refresh();
            return;
          }
        }
        await fs.promises.rm(referencePath, { recursive: true, force: true });
      }

      const progressTitle = hasSubmission
        ? say('Checking out reference and submission...', 'Musterlösung und Abgabe werden ausgecheckt …')
        : say('Checking out reference...', 'Musterlösung wird ausgecheckt …');

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: progressTitle,
          cancellable: false
        },
        async (progress) => {
          const JSZip = require('jszip');

          // Download reference
          progress.report({ message: say('Downloading reference...', 'Musterlösung wird heruntergeladen …') });
          const referenceBuffer = await this.apiService.downloadCourseContentReference(content.id, true);
          if (!referenceBuffer) {
            throw new Error(say('Failed to download reference', 'Die Musterlösung konnte nicht heruntergeladen werden'));
          }

          await fs.promises.mkdir(referencePath, { recursive: true });
          const referenceZip = await JSZip.loadAsync(referenceBuffer);
          for (const [filename, file] of Object.entries(referenceZip.files)) {
            const fileData = file as any;
            if (!fileData.dir) {
              const fileContent = await fileData.async('nodebuffer');
              const filePath = path.join(referencePath, filename);
              await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
              await fs.promises.writeFile(filePath, fileContent);
            }
          }

          // Download latest submission if available
          if (hasSubmission && latestArtifact && submissionPath) {
            progress.report({ message: say('Downloading latest submission...', 'Neueste Abgabe wird heruntergeladen …') });
            const submissionBuffer = await this.apiService.downloadSubmissionArtifact(latestArtifact.id);
            if (!submissionBuffer) {
              throw new Error(say('Failed to download submission artifact', 'Die Abgabe konnte nicht heruntergeladen werden'));
            }

            await fs.promises.mkdir(submissionPath, { recursive: true });
            const submissionZip = await JSZip.loadAsync(submissionBuffer);
            for (const [filename, file] of Object.entries(submissionZip.files)) {
              const fileData = file as any;
              if (!fileData.dir) {
                const fileContent = await fileData.async('nodebuffer');
                const filePath = path.join(submissionPath, filename);
                await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
                await fs.promises.writeFile(filePath, fileContent);
              }
            }
          }
        }
      );

      const successMessage = hasSubmission
        ? say('Reference and latest submission checked out successfully', 'Musterlösung und neueste Abgabe sind ausgecheckt.')
        : say('Reference checked out successfully (no submission available)', 'Die Musterlösung ist ausgecheckt (es gibt keine Abgabe).');
      notify.info(successMessage);

      // Mark this content to be expanded when the tree refreshes
      this.treeDataProvider.markForVirtualFolderExpansion(content.id);
      this.treeDataProvider.refresh();
    } catch (error: any) {
      notify.error(say(`Failed to checkout: ${error?.message || error}`, `Das Auschecken ist fehlgeschlagen: ${error?.message || error}`));
    }
  }

  /**
   * Show README preview for a tutor assignment.
   * Downloads the description (README) from the API if not cached, then opens in markdown preview.
   */
  private async showReadme(item: any): Promise<void> {
    try {
      const content: CourseContentStudentList | undefined = item?.content;
      if (!content) {
        notify.error(say('No course content found', 'Kein Kursinhalt gefunden.'));
        return;
      }

      const courseContentId = content.id;
      const descriptionPath = this.workspaceStructure.getReviewDescriptionPath(courseContentId);

      // Check if description is already cached
      const descriptionExists = await this.workspaceStructure.directoryExists(descriptionPath);

      if (!descriptionExists) {
        // Download description from API
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: say('Downloading README...', 'Anleitung wird heruntergeladen …'),
            cancellable: false
          },
          async () => {
            const buffer = await this.apiService.downloadCourseContentDescription(courseContentId);
            if (!buffer) {
              throw new Error(say('No README available for this assignment', 'Für diese Aufgabe gibt es keine Anleitung'));
            }

            // Extract ZIP to description path
            await fs.promises.mkdir(descriptionPath, { recursive: true });
            const JSZip = require('jszip');
            const zip = await JSZip.loadAsync(buffer);

            for (const [filename, file] of Object.entries(zip.files)) {
              const zipFile = file as any;
              if (!zipFile.dir) {
                const fileContent = await zipFile.async('nodebuffer');
                const filePath = path.join(descriptionPath, filename);
                await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
                await fs.promises.writeFile(filePath, fileContent);
              }
            }
          }
        );
      }

      // Find and open README file
      await this.openReadmeFromDirectory(descriptionPath, content.course_id);
    } catch (error: any) {
      notify.error(say(`Failed to show README: ${error?.message || error}`, `Die Anleitung konnte nicht angezeigt werden: ${error?.message || error}`));
    }
  }

  /**
   * Find and open a description file from a directory, with language preference support.
   * Supports both README and index naming patterns (e.g., README_en.md, index_de.md).
   * Searches recursively in case files are in subdirectories.
   */
  private async openReadmeFromDirectory(dir: string, courseId?: string): Promise<void> {
    const preferredLanguage = await readingLanguage(this.apiService);

    // Matches README.md, README_en.md, index.md, index_de.md, etc.
    const descriptionPattern = /^(README|index)(_[a-z]{2})?\.md$/i;

    // Find all description files recursively
    const findDescriptionFiles = (directory: string): string[] => {
      const results: string[] = [];
      try {
        const entries = fs.readdirSync(directory, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(directory, entry.name);
          if (entry.isDirectory()) {
            results.push(...findDescriptionFiles(fullPath));
          } else if (descriptionPattern.test(entry.name)) {
            results.push(fullPath);
          }
        }
      } catch {
        // Ignore read errors
      }
      return results;
    };

    const descriptionPath = pickDescriptionFile(findDescriptionFiles(dir), preferredLanguage);

    if (descriptionPath && fs.existsSync(descriptionPath)) {
      // Self-contained preview webview (renders under code-server on
      // Firefox/Safari where the built-in preview stays blank, #267)
      await showMarkdownPreview(this.context, descriptionPath);
    } else {
      notify.info(say('No description found for this assignment', 'Für diese Aufgabe wurde keine Anleitung gefunden.'));
    }
  }

  /**
   * Run a test on the checked-out submission - or on the reference, when that
   * is the node the command was invoked from.
   */
  private async runTestOnSubmission(item: any): Promise<void> {
    try {
      // Get course content information
      const content: CourseContentStudentList = item?.content || item?.courseContent || item?.course_content;
      if (!content) {
        notify.error(say('No course content information available', 'Zu diesem Kursinhalt liegen keine Angaben vor.'));
        return;
      }

      const courseContentId = content.id;
      if (!courseContentId) {
        notify.error(say('No course content ID available', 'Zu diesem Kursinhalt ist keine ID bekannt.'));
        return;
      }

      const assignmentTitle = content.title || say('Assignment', 'Aufgabe');

      // "Run Test" hangs off five different nodes. On References the point is
      // to check that the assignment still passes its own tests, so go there
      // directly instead of preferring whatever submission is on disk - which
      // is what the node did until now, without ever saying so.
      if (tutorTestTargetFor(item) === 'reference') {
        const referencePath = await this.resolveReferencePath(content);
        if (referencePath) {
          await this.runTutorTestAndOpenResults(courseContentId, referencePath, `${assignmentTitle} (reference)`);
        }
        return;
      }

      let submissionPath = await this.resolveDownloadedSubmissionPath(item, content);

      if (!submissionPath) {
        // No submission found, offer to test the reference instead
        const choice = await notify.warning(
          say('No student submission found. Would you like to test the reference solution instead?', 'Es gibt keine Abgabe der Person. Stattdessen die Musterlösung testen?'),
          say('Test Reference', 'Musterlösung testen'),
          say('Cancel', 'Abbrechen')
        );

        if (choice !== say('Test Reference', 'Musterlösung testen')) {
          return;
        }

        submissionPath = await this.resolveReferencePath(content);
        if (!submissionPath) {
          return;
        }
      }

      await this.runTutorTestAndOpenResults(courseContentId, submissionPath, assignmentTitle);
    } catch (error: any) {
      console.error('[TutorCommands] Error running test:', error);
      notify.error(say(`Failed to run test: ${error?.message || error}`, `Der Test konnte nicht ausgeführt werden: ${error?.message || error}`));
    }
  }

  private async runTutorTestAndOpenResults(courseContentId: string, sourcePath: string, title: string): Promise<void> {
    const result = await this.tutorTestService.runTutorTest(courseContentId, sourcePath, title);
    if (!result) {
      return;
    }

    if (result.status === 'SUCCESS' || result.status === 'FAILED') {
      // Open test results if available
      if (result.testId) {
        await this.tutorTestService.openTestResults(result.testId, result.artifactsPath, result.testDetails, result.artifacts);
      }
    }
  }

  /**
   * The downloaded reference for an assignment, offering the download when it
   * is not there yet rather than sending the tutor off to checkout first.
   */
  private async resolveReferencePath(content: CourseContentStudentList): Promise<string | undefined> {
    const exampleVersionId = content.deployment?.example_version_id;
    if (!exampleVersionId) {
      notify.error(say('No reference available for this assignment', 'Für diese Aufgabe gibt es keine Musterlösung.'));
      return undefined;
    }

    const referencePath = this.workspaceStructure.getReviewReferencePath(exampleVersionId);
    if (await this.workspaceStructure.directoryExists(referencePath)) {
      return referencePath;
    }

    const choice = await notify.warning(
      say('Reference not downloaded. Download it now?', 'Die Musterlösung ist noch nicht heruntergeladen. Jetzt herunterladen?'),
      say('Download Reference', 'Musterlösung herunterladen'),
      say('Cancel', 'Abbrechen')
    );
    if (choice !== say('Download Reference', 'Musterlösung herunterladen')) {
      return undefined;
    }

    await this.downloadReference({ content });
    if (!await this.workspaceStructure.directoryExists(referencePath)) {
      notify.error(say('Reference still not found after download', 'Die Musterlösung fehlt auch nach dem Herunterladen.'));
      return undefined;
    }
    return referencePath;
  }

  /**
   * The downloaded submission to test: the artifact the node names, else the
   * student's latest one.
   */
  private async resolveDownloadedSubmissionPath(
    item: any,
    content: CourseContentStudentList
  ): Promise<string | undefined> {
    const submissionGroupId = content.submission_group?.id;
    if (!submissionGroupId) {
      return undefined;
    }

    if (item?.artifactId) {
      const artifactPath = this.workspaceStructure.getReviewSubmissionPath(submissionGroupId, item.artifactId);
      return await this.workspaceStructure.directoryExists(artifactPath) ? artifactPath : undefined;
    }

    const downloadedIds = await this.workspaceStructure.getSubmissionArtifacts(submissionGroupId);
    if (downloadedIds.length === 0) {
      return undefined;
    }

    // Those directories are named by artifact id, so their listing order says
    // nothing about which submission is the newest - the upload dates do.
    const downloaded = await Promise.all(downloadedIds.map(async id => ({
      id,
      downloadedAt: await this.downloadedAt(submissionGroupId, id)
    })));
    const artifacts = await this.apiService.listSubmissionArtifacts(submissionGroupId);
    const latestId = pickLatestSubmissionArtifactId(downloaded, artifacts);

    return latestId
      ? this.workspaceStructure.getReviewSubmissionPath(submissionGroupId, latestId)
      : undefined;
  }

  private async downloadedAt(submissionGroupId: string, artifactId: string): Promise<number> {
    try {
      const stats = await fs.promises.stat(
        this.workspaceStructure.getReviewSubmissionPath(submissionGroupId, artifactId)
      );
      return stats.mtimeMs;
    } catch {
      return 0;
    }
  }

}
