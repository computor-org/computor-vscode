import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { TutorStudentTreeProvider } from '../ui/tree/tutor/TutorStudentTreeProvider';
import { ComputorApiService } from '../services/ComputorApiService';
import { TutorSelectionService } from '../services/TutorSelectionService';
import { createSimpleGit } from '../git/simpleGitFactory';
import { GitLabTokenManager } from '../services/GitLabTokenManager';
import { deriveRepositoryDirectoryName } from '../utils/repositoryNaming';
import { WorkspaceStructureManager } from '../utils/workspaceStructure';
// Import interfaces from generated types (interfaces removed to avoid duplication)
import { CourseMemberCommentsWebviewProvider } from '../ui/webviews/CourseMemberCommentsWebviewProvider';
import { MessagesWebviewProvider, MessageTargetContext } from '../ui/webviews/MessagesWebviewProvider';
import { MessageCreate, CourseContentStudentList, SubmissionGroupStudentList } from '../types/generated';
import { TutorGradeCreate, GradingStatus } from '../types/generated/common';
import { TutorFilterPanelProvider } from '../ui/panels/TutorFilterPanel';

export class TutorCommands {
  private context: vscode.ExtensionContext;
  private treeDataProvider: TutorStudentTreeProvider;
  private apiService: ComputorApiService;
  private commentsWebviewProvider: CourseMemberCommentsWebviewProvider;
  private messagesWebviewProvider: MessagesWebviewProvider;
  private workspaceStructure: WorkspaceStructureManager;
  private filterProvider?: TutorFilterPanelProvider;

  constructor(
    context: vscode.ExtensionContext,
    treeDataProvider: TutorStudentTreeProvider,
    apiService?: ComputorApiService,
    filterProvider?: TutorFilterPanelProvider
  ) {
    this.context = context;
    this.treeDataProvider = treeDataProvider;
    // Use provided apiService or create a new one
    this.apiService = apiService || new ComputorApiService(context);
    this.commentsWebviewProvider = new CourseMemberCommentsWebviewProvider(context, this.apiService);
    this.messagesWebviewProvider = new MessagesWebviewProvider(context, this.apiService);
    this.workspaceStructure = WorkspaceStructureManager.getInstance();
    this.filterProvider = filterProvider;
    // No workspace manager needed for current tutor actions
  }

  registerCommands(): void {
    // Refresh tutor view: clear caches for current member to force API reload
    this.context.subscriptions.push(
      vscode.commands.registerCommand('computor.tutor.refresh', async () => {
        try {
          const sel = TutorSelectionService.getInstance();
          const memberId = sel.getCurrentMemberId();
          const courseId = sel.getCurrentCourseId();
          const groupId = sel.getCurrentGroupId();
          if (memberId) {
            this.apiService.clearTutorMemberCourseContentsCache(memberId);
          }
          if (courseId) {
            this.apiService.clearTutorCourseMembersCache(courseId, groupId || undefined);
          }
          // Also clear content kinds to be safe
          this.apiService.clearCourseContentKindsCache();

          // Proactively fetch fresh data to trigger API calls
          if (courseId) {
            await this.apiService.getTutorCourseMembers(courseId, groupId || undefined);
          }
          if (courseId && memberId) {
            await this.apiService.getTutorCourseContents(courseId, memberId);
          }
        } catch (error) {
          console.error('[TutorCommands] Error refreshing tutor data:', error);
        }
        this.treeDataProvider.refresh();
        this.filterProvider?.refreshFilters();
      })
    );

    // Show Course Progress (uses current selected course from filters)
    this.context.subscriptions.push(
      vscode.commands.registerCommand('computor.tutor.showCourseProgress', async () => {
        const sel = TutorSelectionService.getInstance();
        const courseId = sel.getCurrentCourseId();
        if (!courseId) {
          vscode.window.showWarningMessage('Please select a course first.');
          return;
        }
        await vscode.commands.executeCommand('computor.lecturer.showCourseProgressOverview', courseId);
      })
    );

    // Show Member Progress (uses current selected member from filters)
    this.context.subscriptions.push(
      vscode.commands.registerCommand('computor.tutor.showMemberProgress', async () => {
        const sel = TutorSelectionService.getInstance();
        const memberId = sel.getCurrentMemberId();
        const memberName = sel.getCurrentMemberLabel();
        if (!memberId) {
          vscode.window.showWarningMessage('Please select a member first.');
          return;
        }
        await vscode.commands.executeCommand('computor.lecturer.showCourseMemberProgress', memberId, memberName);
      })
    );

    this.context.subscriptions.push(
      vscode.commands.registerCommand('computor.tutor.showCourseMemberComments', async () => {
        await this.showCourseMemberComments();
      })
    );

    this.context.subscriptions.push(
      vscode.commands.registerCommand('computor.tutor.showMessages', async (item?: any) => {
        await this.showMessages(item);
      })
    );

    // Old tutor example/course commands removed in favor of TutorStudentTreeProvider actions

    // Tutor: Clone student repository (scaffold)
    this.context.subscriptions.push(
      vscode.commands.registerCommand('computor.tutor.cloneStudentRepository', async (item: any) => {
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
            if (!courseId) courseId = (await vscode.window.showInputBox({ title: 'Course ID', prompt: 'Enter course ID', ignoreFocusOut: true })) || '';
            if (!memberId) memberId = (await vscode.window.showInputBox({ title: 'Course Member ID', prompt: 'Enter course member ID', ignoreFocusOut: true })) || '';
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
            vscode.window.showErrorMessage('No repository URL found for this student assignment.');
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
            vscode.window.showWarningMessage(`Directory not empty: ${dir}. Skipping clone.`);
          } else {
            const origin = (() => { try { const u = new URL(remoteUrl!); return u.origin; } catch { return undefined; } })();
            const tokenManager = GitLabTokenManager.getInstance(this.context);
            let authUrl = remoteUrl!;
            if (origin) {
              const savedToken = await tokenManager.getToken(origin);
              if (savedToken) {
                authUrl = tokenManager.buildAuthenticatedCloneUrl(remoteUrl!, savedToken);
              }
            }
            try {
              await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Cloning student repository...', cancellable: false }, async () => {
                await createSimpleGit().clone(authUrl, dir);
              });
              vscode.window.showInformationMessage(`Student repository cloned to ${dir}`);
              this.treeDataProvider.refresh();
            } catch (e: any) {
              const msg = String(e?.message || e || '');
              if (origin && (msg.includes('Authentication failed') || msg.includes('could not read Username') || msg.includes('401'))) {
                const newToken = await (async () => {
                  // Reuse token manager's prompt behavior
                  const t = await vscode.window.showInputBox({
                    title: `GitLab Authentication for ${origin}`,
                    prompt: `Enter your GitLab Personal Access Token for ${origin}`,
                    placeHolder: 'glpat-xxxxxxxxxxxxxxxxxxxx',
                    password: true,
                    ignoreFocusOut: true
                  });
                  if (t) await tokenManager.storeToken(origin, t);
                  return t || undefined;
                })();
                if (!newToken) throw e;
                authUrl = tokenManager.buildAuthenticatedCloneUrl(remoteUrl!, newToken);
                await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Cloning student repository...', cancellable: false }, async () => {
                  await createSimpleGit().clone(authUrl, dir);
                });
                vscode.window.showInformationMessage(`Student repository cloned to ${dir}`);
                this.treeDataProvider.refresh();
              } else {
                throw e;
              }
            }
          }
          // Directory is already inside the current workspace; no need to add a new folder
        } catch (e: any) {
          vscode.window.showErrorMessage(`Failed to clone student repository: ${e?.message || e}`);
        }
      })
    );

    // Tutor: Update student repository (pull latest changes)
    this.context.subscriptions.push(
      vscode.commands.registerCommand('computor.tutor.updateStudentRepository', async (item: any) => {
        try {
          const content: any = item?.content || item?.courseContent || item?.course_content || item;
          const submission = content?.submission_group || content?.submission || content;
          const submissionRepo = submission?.repository || content?.submission_group?.repository;

          // Get course and member context
          const sel = TutorSelectionService.getInstance();
          let courseId = sel.getCurrentCourseId();
          let memberId = sel.getCurrentMemberId();

          if (!courseId || !memberId) {
            if (!courseId) courseId = (await vscode.window.showInputBox({ title: 'Course ID', prompt: 'Enter course ID', ignoreFocusOut: true })) || '';
            if (!memberId) memberId = (await vscode.window.showInputBox({ title: 'Course Member ID', prompt: 'Enter course member ID', ignoreFocusOut: true })) || '';
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
            vscode.window.showErrorMessage('Repository not found. Please clone it first.');
            return;
          }

          // Update the repository
          await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: 'Updating student repository...', cancellable: false },
            async () => {
              const git = createSimpleGit({ baseDir: dir });
              await git.fetch(['--all']);
              await git.pull(['--ff-only']);
            }
          );

          vscode.window.showInformationMessage('Repository updated successfully.');
          this.treeDataProvider.refresh();
        } catch (e: any) {
          vscode.window.showErrorMessage(`Failed to update repository: ${e?.message || e}`);
        }
      })
    );

    // Tutor: Set grading and status together
    this.context.subscriptions.push(
      vscode.commands.registerCommand('computor.tutor.assignment.grading', async (item: any) => {
        const content: any = item?.content || item?.courseContent || item;
        const contentId: string | undefined = content?.id;
        if (!contentId) { vscode.window.showErrorMessage('No course content selected.'); return; }

        const sel = TutorSelectionService.getInstance();
        const memberId = sel.getCurrentMemberId();
        if (!memberId) { vscode.window.showErrorMessage('No course member selected.'); return; }

        const prev = (() => {
          const submission: any = content?.submission_group || content?.submission;
          const latest = submission?.latest_grading || submission?.grading;
          const grading = typeof latest?.grading === 'number' ? latest.grading as number : undefined;
          const status = typeof latest?.status === 'string' ? String(latest.status) : undefined;
          return { grading, status } as { grading?: number; status?: string };
        })();

        const gradingInput = await vscode.window.showInputBox({
          title: 'Grading',
          prompt: 'Enter grading (0..1 or percentage 0..100)',
          placeHolder: 'e.g., 0.85 or 85',
          value: prev.grading != null ? (prev.grading <= 1 ? String(Math.round(prev.grading * 1000) / 1000) : String(prev.grading)) : undefined,
          ignoreFocusOut: true,
          validateInput: (v) => {
            if (!v || !v.trim()) return 'Enter a number between 0 and 1 or 0 and 100';
            const n = Number(v.replace('%', '').trim());
            if (!isFinite(n)) return 'Not a number';
            if (n < 0 || n > 100) return 'Value must be between 0 and 100';
            return undefined;
          }
        });
        if (gradingInput == null) return; // cancelled
        let grade = Number(gradingInput.replace('%', '').trim());
        if (grade > 1) grade = grade / 100; // percentage to fraction
        grade = Math.max(0, Math.min(1, grade));

        const statusOptions: Array<vscode.QuickPickItem & { value: GradingStatus }> = [
          { label: 'corrected', description: 'Mark as corrected', value: 1 as GradingStatus },
          { label: 'correction_necessary', description: 'Correction necessary', value: 2 as GradingStatus },
          { label: 'improvement_possible', description: 'Improvement possible', value: 3 as GradingStatus },
          { label: 'not_reviewed', description: 'Not reviewed', value: 0 as GradingStatus },
        ];
        const statusPick = await vscode.window.showQuickPick(statusOptions, {
          title: 'Status',
          placeHolder: 'Choose status',
          canPickMany: false,
          ignoreFocusOut: true
        });
        if (!statusPick) return; // cancelled

        try {
          // Use new TutorGradeCreate type with enum status
          const tutorGrade: TutorGradeCreate = {
            grade: grade,
            status: statusPick.value,
            feedback: null
          };
          await this.apiService.submitTutorGrade(memberId, contentId, tutorGrade);

          // Clear caches and refresh to get updated data
          const sel = TutorSelectionService.getInstance();
          const courseId = sel.getCurrentCourseId();
          const groupId = sel.getCurrentGroupId();

          this.apiService.clearTutorMemberCourseContentsCache(memberId);
          if (courseId) {
            this.apiService.clearTutorCourseMembersCache(courseId, groupId || undefined);
          }

          // Fetch fresh item and update the clicked tree item inline
          const updated = await this.apiService.getTutorMemberCourseContent(memberId, contentId);
          if (updated && item && typeof (item as any).updateVisuals === 'function') {
            try {
              // Preserve course_content_type/course_content_types if the updated data doesn't include it
              // The single-item endpoint may not return this field
              // Handle both course_content_type (singular) and course_content_types (plural)
              const oldCourseContentType = (item.content as any)?.course_content_type || (item.content as any)?.course_content_types;
              const newCourseContentType = (updated as any).course_content_type || (updated as any).course_content_types;
              if (oldCourseContentType && !newCourseContentType) {
                (updated as any).course_content_type = oldCourseContentType;
              }
              // Update the content data
              item.content = updated;
              item.label = updated.title || updated.path;
              // Use the tree item's own method to update icon, tooltip, etc.
              (item as any).updateVisuals();
              // Trigger a targeted refresh for this item
              (this.treeDataProvider as any).refreshItem?.(item);
            } catch {
              // Fallback to full refresh if targeted update fails
              this.treeDataProvider.refresh();
            }
          } else {
            // Fallback to full refresh
            this.treeDataProvider.refresh();
          }

          // Refresh filter panel to update ungraded_submissions_count
          this.filterProvider?.refreshFilters();

          vscode.window.showInformationMessage(`Updated: ${(grade * 100).toFixed(1)}% • ${statusPick.label}`);
        } catch (e: any) {
          vscode.window.showErrorMessage(`Failed to update grading/status: ${e?.message || e}`);
        }
      })
    );

    // Tutor: Download reference (example version)
    this.context.subscriptions.push(
      vscode.commands.registerCommand('computor.tutor.downloadReference', async (item: any) => {
        await this.downloadReference(item);
      })
    );

    // Tutor: Download submission artifact
    this.context.subscriptions.push(
      vscode.commands.registerCommand('computor.tutor.downloadSubmissionArtifact', async (item: any) => {
        await this.downloadSubmissionArtifact(item);
      })
    );

    // Tutor: Compare with reference
    this.context.subscriptions.push(
      vscode.commands.registerCommand('computor.tutor.compareWithReference', async (item: any) => {
        await this.compareWithReference(item);
      })
    );

    // Tutor: Show submission test results
    this.context.subscriptions.push(
      vscode.commands.registerCommand('computor.tutor.showSubmissionTestResults', async (item: any) => {
        await this.showSubmissionTestResults(item);
      })
    );
  }

  private async showCourseMemberComments(): Promise<void> {
    try {
      const selection = TutorSelectionService.getInstance();
      const memberId = selection.getCurrentMemberId();
      if (!memberId) {
        vscode.window.showWarningMessage('No course member selected.');
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
      await this.commentsWebviewProvider.showComments(memberId, title);
    } catch (error: any) {
      vscode.window.showErrorMessage(`Failed to open comments: ${error?.message || error}`);
    }
  }

  private async showMessages(item?: any): Promise<void> {
    try {
      const selection = TutorSelectionService.getInstance();
      const courseId = selection.getCurrentCourseId();
      if (!courseId) {
        vscode.window.showWarningMessage('Select a course before viewing messages.');
        return;
      }

      const memberId = selection.getCurrentMemberId();
      if (!memberId) {
        vscode.window.showWarningMessage('Select a course member before viewing messages.');
        return;
      }

      const courseLabel = selection.getCurrentCourseLabel();
      const memberLabel = selection.getCurrentMemberLabel();

      const content: CourseContentStudentList | undefined = item?.content || item?.courseContent;
      const submissionGroup: SubmissionGroupStudentList | undefined = content?.submission_group || item?.submissionGroup;

      let target: MessageTargetContext | undefined;

      if (content) {
        const contentTitle = content.title || content.path || 'Course content';

        let query: Record<string, string>;
        let createPayload: Partial<MessageCreate>;

        if (submissionGroup?.id) {
          // Assignment with submission group - tutors only need submission_group messages
          // (not course_content announcements which are for all students)
          // Include course_member_id for cache invalidation (not sent to API)
          query = {
            submission_group_id: submissionGroup.id,
            course_member_id: memberId
          };
          createPayload = {
            submission_group_id: submissionGroup.id
          };
        } else {
          // Unit content without submission group - show course_content messages
          // Tutors can only read (lecturer+ for writing)
          // Include course_member_id for cache invalidation (not sent to API)
          query = {
            course_content_id: content.id,
            course_member_id: memberId
          };
          createPayload = {
            course_content_id: content.id  // Lecturer+ only
          };
        }

        const subtitleSegments = [courseLabel, memberLabel, content.path || contentTitle].filter(Boolean) as string[];
        const subtitle = subtitleSegments.length > 0 ? subtitleSegments.join(' › ') : undefined;
        const title = memberLabel ? `${memberLabel} — ${contentTitle}` : contentTitle;

        target = {
          title,
          subtitle,
          query,
          createPayload,
          sourceRole: 'tutor'
        } satisfies MessageTargetContext;
      }

      if (!target) {
        // For general course member messages
        // Tutors cannot write to course_id or course_member_id
        // course_member_id is not implemented, course_id is lecturer+ only
        // Use scope filter to show ONLY course-scoped messages, not content/submission messages
        const subtitleSegments = [courseLabel, memberLabel].filter(Boolean) as string[];
        const subtitle = subtitleSegments.length > 0 ? subtitleSegments.join(' › ') : undefined;
        target = {
          title: memberLabel ? `${memberLabel} — Course messages` : 'Course member messages',
          subtitle,
          query: { course_id: courseId, course_member_id: memberId, scope: 'course' },
          createPayload: { course_id: courseId },  // This will fail - lecturer+ only
          sourceRole: 'tutor'
        } satisfies MessageTargetContext;
      }

      await this.messagesWebviewProvider.showMessages(target);
    } catch (error: any) {
      vscode.window.showErrorMessage(`Failed to open messages: ${error?.message || error}`);
    }
  }

  private async downloadReference(item: any): Promise<void> {
    try {
      const content: CourseContentStudentList = item?.content || item?.courseContent || item?.course_content;

      if (!content) {
        vscode.window.showErrorMessage('No course content information available');
        return;
      }

      const deployment = content.deployment;
      if (!deployment || !deployment.example_version_id) {
        vscode.window.showErrorMessage('No reference available for this assignment');
        return;
      }

      const exampleVersionId = deployment.example_version_id;
      const referencePath = this.workspaceStructure.getReviewReferencePath(exampleVersionId);

      // Check if reference already exists
      const exists = await this.workspaceStructure.directoryExists(referencePath);
      if (exists) {
        const choice = await vscode.window.showWarningMessage(
          `Reference for this assignment already exists. The example version may have been updated. Re-download?`,
          'Re-download',
          'Cancel'
        );
        if (choice !== 'Re-download') {
          return;
        }
        // Remove existing directory
        await fs.promises.rm(referencePath, { recursive: true, force: true });
      }

      // Download reference
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Downloading reference...',
          cancellable: false
        },
        async () => {
          const buffer = await this.apiService.downloadCourseContentReference(content.id, true);
          if (!buffer) {
            throw new Error('Failed to download reference');
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

      vscode.window.showInformationMessage(`Reference downloaded to ${referencePath}`);
      this.treeDataProvider.refresh();
    } catch (error: any) {
      vscode.window.showErrorMessage(`Failed to download reference: ${error?.message || error}`);
    }
  }

  private async downloadSubmissionArtifact(item: any): Promise<void> {
    try {
      // If called from TutorSubmissionItem, we have the artifact info
      let artifactId = item?.artifactId || item?.artifact_id || item?.id;
      let submissionGroupId = item?.submissionGroupId || item?.submission_group_id;

      // If called from TutorVirtualFolderItem (Submissions folder), we need to get artifacts from API
      if (!artifactId || !submissionGroupId) {
        const content: CourseContentStudentList = item?.content || item?.courseContent;
        if (!content || !content.submission_group?.id) {
          vscode.window.showErrorMessage('No submission group available for this assignment');
          return;
        }

        submissionGroupId = content.submission_group.id;

        // Fetch available artifacts from API
        // TODO: Add API method to list artifacts for a submission group
        // For now, prompt user to select from tree instead
        vscode.window.showInformationMessage(
          'Please expand the Submissions folder and right-click on a specific submission to download it.'
        );
        return;
      }

      const submissionPath = this.workspaceStructure.getReviewSubmissionPath(submissionGroupId, artifactId);

      // Check if submission already exists
      const exists = await this.workspaceStructure.directoryExists(submissionPath);
      if (exists) {
        const choice = await vscode.window.showWarningMessage(
          `Submission artifact already exists. Re-download?`,
          'Re-download',
          'Cancel'
        );
        if (choice !== 'Re-download') {
          return;
        }
        // Remove existing directory
        await fs.promises.rm(submissionPath, { recursive: true, force: true });
      }

      // Download submission artifact
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Downloading submission artifact...',
          cancellable: false
        },
        async () => {
          const buffer = await this.apiService.downloadSubmissionArtifact(artifactId);
          if (!buffer) {
            throw new Error('Failed to download submission artifact');
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

      vscode.window.showInformationMessage(`Submission artifact downloaded to ${submissionPath}`);
      this.treeDataProvider.refresh();
    } catch (error: any) {
      vscode.window.showErrorMessage(`Failed to download submission artifact: ${error?.message || error}`);
    }
  }

  private async compareWithReference(item: any): Promise<void> {
    try {
      // Get the file path from the submission
      const submissionFilePath = item?.fsPath || item?.resourceUri?.fsPath;
      if (!submissionFilePath) {
        vscode.window.showErrorMessage('No file selected for comparison');
        return;
      }

      // Extract information from the path
      // Expected path: review/submissions/<submission_group_id>/<artifact_id>/<file_path>
      const dirs = this.workspaceStructure.getDirectories();
      const relativePath = path.relative(dirs.reviewSubmissions, submissionFilePath);
      const parts = relativePath.split(path.sep);

      if (parts.length < 3) {
        vscode.window.showErrorMessage('Invalid submission file path');
        return;
      }

      const fileInSubmission = parts.slice(2).join(path.sep);

      // Get course content to find example version
      const content = item?.content || item?.courseContent;
      if (!content || !content.deployment || !content.deployment.example_version_id) {
        vscode.window.showErrorMessage('No reference available for comparison');
        return;
      }

      const exampleVersionId = content.deployment.example_version_id;
      const referencePath = this.workspaceStructure.getReviewReferencePath(exampleVersionId);
      const referenceFilePath = path.join(referencePath, fileInSubmission);

      // Check if reference exists
      if (!fs.existsSync(referenceFilePath)) {
        const choice = await vscode.window.showWarningMessage(
          'Reference file not found. Download reference first?',
          'Download Reference',
          'Cancel'
        );
        if (choice === 'Download Reference') {
          await this.downloadReference({ content });
          // Try again after download
          if (!fs.existsSync(referenceFilePath)) {
            vscode.window.showErrorMessage('Reference file still not found after download');
            return;
          }
        } else {
          return;
        }
      }

      // Open diff view (reference on left, submission on right)
      const submissionUri = vscode.Uri.file(submissionFilePath);
      const referenceUri = vscode.Uri.file(referenceFilePath);
      const title = `${path.basename(submissionFilePath)} (Submission ↔ Reference)`;

      await vscode.commands.executeCommand('vscode.diff', submissionUri, referenceUri, title);
    } catch (error: any) {
      vscode.window.showErrorMessage(`Failed to compare with reference: ${error?.message || error}`);
    }
  }

  private async showSubmissionTestResults(item: any): Promise<void> {
    try {
      console.log('[TutorCommands] showSubmissionTestResults called with item:', item);

      // Get the submission artifact ID from the item
      const artifactId = item?.artifactId;
      if (!artifactId) {
        console.log('[TutorCommands] No artifactId in item');
        vscode.window.showWarningMessage('No submission artifact ID found.');
        return;
      }

      console.log('[TutorCommands] Fetching test results for artifact:', artifactId);

      // Fetch test results for this submission artifact
      const testResults = await this.apiService.getSubmissionArtifactTestResults(artifactId);
      console.log('[TutorCommands] Test results fetched:', testResults.length, 'results');

      if (!testResults || testResults.length === 0) {
        vscode.window.showWarningMessage('No test results available for this submission.');
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
        vscode.window.showWarningMessage('No detailed test results available for this submission.');
        return;
      }

      console.log('[TutorCommands] Opening results with resultJson');
      console.log('[TutorCommands] Result artifacts count:', resultArtifacts?.length ?? 0);

      await vscode.commands.executeCommand('computor.results.open', resultJson, resultId, resultArtifacts);
      await vscode.commands.executeCommand('computor.testResultsPanel.focus');

    } catch (error: any) {
      console.error('[TutorCommands] Error in showSubmissionTestResults:', error);
      vscode.window.showErrorMessage(`Failed to show test results: ${error?.message || error}`);
    }
  }

}
