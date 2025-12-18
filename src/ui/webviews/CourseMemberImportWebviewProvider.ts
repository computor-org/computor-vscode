import * as vscode from 'vscode';
import { BaseWebviewProvider } from './BaseWebviewProvider';
import { CourseRoleList, CourseMemberList, CourseGroupList } from '../../types/generated';
import { ComputorApiService } from '../../services/ComputorApiService';
import { LecturerTreeDataProvider } from '../tree/lecturer/LecturerTreeDataProvider';
import { CourseMemberParserFactory } from '../../utils/parsers/CourseMemberParserFactory';
import { CourseMemberImportRow } from '../../utils/parsers/ICourseMemberParser';
import * as path from 'path';

interface ImportMemberRow extends CourseMemberImportRow {
  rowNumber: number;
  status: 'missing' | 'existing' | 'modified';
  selectedRoleId: string;
  isSelected: boolean;
}

export class CourseMemberImportWebviewProvider extends BaseWebviewProvider {
  private apiService: ComputorApiService;
  private treeDataProvider?: LecturerTreeDataProvider;
  private courseId?: string;
  private members: ImportMemberRow[] = [];
  private availableRoles: CourseRoleList[] = [];
  private availableGroups: CourseGroupList[] = [];

  constructor(
    context: vscode.ExtensionContext,
    apiService: ComputorApiService,
    treeDataProvider?: LecturerTreeDataProvider
  ) {
    super(context, 'computor.courseMemberImportPreview');
    this.apiService = apiService;
    this.treeDataProvider = treeDataProvider;
  }

  async showMembers(courseId: string): Promise<void> {
    this.courseId = courseId;

    // Fetch existing course members, available roles, and course groups
    let existingMembers: CourseMemberList[] = [];
    try {
      [existingMembers, this.availableRoles, this.availableGroups] = await Promise.all([
        this.apiService.getCourseMembers(courseId),
        this.apiService.getCourseRoles(),
        this.apiService.getCourseGroups(courseId)
      ]);
      console.log(`Fetched ${this.availableGroups.length} course groups:`, this.availableGroups);
    } catch (error) {
      console.error('Failed to fetch course data:', error);
      vscode.window.showErrorMessage(`Failed to fetch course data: ${error}`);
      existingMembers = [];
      this.availableRoles = [
        { id: '_student', title: 'Student' },
        { id: '_tutor', title: 'Tutor' },
        { id: '_lecturer', title: 'Lecturer' }
      ] as CourseRoleList[];
      this.availableGroups = [];
    }

    // Convert existing members to display format
    this.members = existingMembers.map((em, index) => {
      // Map group ID to title
      let groupTitle = '';
      if (em.course_group_id) {
        const group = this.availableGroups.find(g => g.id === em.course_group_id);
        groupTitle = group?.title || '';
      }

      return {
        email: em.user.email || '',
        given_name: em.user.given_name || '',
        family_name: em.user.family_name || '',
        course_group_title: groupTitle,
        course_role_id: em.course_role_id,
        rowNumber: index + 1,
        status: 'existing' as const,
        selectedRoleId: em.course_role_id,
        isSelected: false
      };
    });

    await this.show('Course Members', {
      courseId,
      members: this.members,
      availableRoles: this.availableRoles,
      availableGroups: this.availableGroups
    });
  }

  async loadImportData(importMembers: CourseMemberImportRow[]): Promise<void> {
    if (!this.courseId) {
      vscode.window.showErrorMessage('Course ID not set');
      return;
    }

    // Fetch existing members for comparison
    let existingMembers: CourseMemberList[] = [];
    try {
      existingMembers = await this.apiService.getCourseMembers(this.courseId);
    } catch (error) {
      console.error('Failed to fetch existing members:', error);
    }

    // Merge import data with existing members
    const mergedMembers: ImportMemberRow[] = [];
    let rowNumber = 1;

    // Add all import members with status
    importMembers.forEach(member => {
      const existing = existingMembers.find(
        (em: CourseMemberList) => em.user.email?.toLowerCase() === member.email?.toLowerCase()
      );

      let status: 'missing' | 'existing' | 'modified' = 'missing';
      let selectedRoleId = member.course_role_id || '_student';

      if (existing) {
        const hasChanges =
          existing.user.given_name !== member.given_name ||
          existing.user.family_name !== member.family_name ||
          existing.course_role_id !== (member.course_role_id || '_student');

        status = hasChanges ? 'modified' : 'existing';
        selectedRoleId = existing.course_role_id;
      }

      mergedMembers.push({
        ...member,
        rowNumber: rowNumber++,
        status,
        selectedRoleId,
        isSelected: status === 'missing'
      });
    });

    // Add existing members not in import file
    existingMembers.forEach(em => {
      const inImport = importMembers.find(
        im => im.email?.toLowerCase() === em.user.email?.toLowerCase()
      );

      if (!inImport) {
        // Map group ID to title
        let groupTitle = '';
        if (em.course_group_id) {
          const group = this.availableGroups.find(g => g.id === em.course_group_id);
          groupTitle = group?.title || '';
        }

        mergedMembers.push({
          email: em.user.email || '',
          given_name: em.user.given_name || '',
          family_name: em.user.family_name || '',
          course_group_title: groupTitle,
          course_role_id: em.course_role_id,
          rowNumber: rowNumber++,
          status: 'existing',
          selectedRoleId: em.course_role_id,
          isSelected: false
        });
      }
    });

    this.members = mergedMembers;

    // Update webview
    this.panel?.webview.postMessage({
      command: 'updateMembers',
      data: {
        members: this.members,
        availableRoles: this.availableRoles,
        availableGroups: this.availableGroups
      }
    });
  }

  protected async getWebviewContent(data?: {
    courseId: string;
    members: ImportMemberRow[];
    availableRoles: CourseRoleList[];
    availableGroups: CourseGroupList[];
  }): Promise<string> {
    if (!this.panel) {
      return this.getBaseHtml('Course Member Import', '<p>Loading…</p>');
    }

    if (!data) {
      return this.getBaseHtml('Course Member Import', '<p>No import data available</p>');
    }

    const webview = this.panel.webview;
    const nonce = this.getNonce();
    const initialState = JSON.stringify(data);
    const stylesUri = this.getWebviewUri(webview, 'webview-ui', 'course-member-import.css');
    const scriptUri = this.getWebviewUri(webview, 'webview-ui', 'course-member-import.js');

    return `<!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
      <title>Course Members</title>
      <link rel="stylesheet" href="${stylesUri}">
    </head>
    <body>
      <div id="app" class="import-container">
        <div class="loading">Loading import preview...</div>
      </div>
      <script nonce="${nonce}">
        window.vscodeApi = window.vscodeApi || acquireVsCodeApi();
        window.__INITIAL_STATE__ = ${initialState};
      </script>
      <script nonce="${nonce}" src="${scriptUri}"></script>
    </body>
    </html>`;
  }

  protected async handleMessage(message: any): Promise<void> {
    switch (message.command) {
      case 'selectImportFile':
        await this.handleSelectImportFile();
        break;

      case 'importSelected':
        await this.handleImportSelected(message.data);
        break;

      case 'selectionChanged':
        this.handleSelectionChanged(message.data);
        break;

      case 'roleChanged':
        this.handleRoleChanged(message.data);
        break;

      case 'groupChanged':
        this.handleGroupChanged(message.data);
        break;

      case 'promptCustomGroup':
        await this.handlePromptCustomGroup(message.data);
        break;

      case 'bulkRoleChange':
        this.handleBulkRoleChange(message.data);
        break;

      case 'filterChanged':
        // Filtering is handled client-side in the webview
        break;

      case 'pollWorkflowStatus':
        console.log('Received pollWorkflowStatus message:', message.data);
        await this.handlePollWorkflowStatus(message.data);
        break;
    }
  }

  private async handlePollWorkflowStatus(data: {
    rowNumber: number;
    workflowId: string;
  }): Promise<void> {
    console.log('Polling workflow status:', data.workflowId);
    try {
      const status = await this.apiService.getWorkflowStatus(data.workflowId);

      this.panel?.webview.postMessage({
        command: 'workflowStatusUpdate',
        data: {
          rowNumber: data.rowNumber,
          workflowId: data.workflowId,
          status: status.status,
          result: status.result,
          error: status.error
        }
      });
    } catch (error: any) {
      this.panel?.webview.postMessage({
        command: 'workflowStatusUpdate',
        data: {
          rowNumber: data.rowNumber,
          workflowId: data.workflowId,
          status: 'error',
          error: error?.message || 'Failed to get workflow status'
        }
      });
    }
  }

  private async handleSelectImportFile(): Promise<void> {
    const supportedExtensions = CourseMemberParserFactory.getSupportedExtensions();
    const fileUri = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      filters: {
        'Course Member Files': supportedExtensions,
        'All Files': ['*']
      },
      title: 'Select file containing course members'
    });

    if (!fileUri || fileUri.length === 0) {
      return;
    }

    const firstFile = fileUri[0];
    if (!firstFile || !this.courseId) {
      return;
    }

    const filePath = firstFile.fsPath;
    const fileExtension = path.extname(filePath).substring(1);

    try {
      const fs = await import('fs');
      const fileBuffer = await fs.promises.readFile(filePath);
      const fileContent = fileBuffer.toString('utf-8');

      // Parse file using factory
      const members = CourseMemberParserFactory.parse(fileContent, fileExtension);

      if (members.length === 0) {
        vscode.window.showWarningMessage('No valid course members found in file');
        return;
      }

      await this.loadImportData(members);

      vscode.window.showInformationMessage(
        `Import file loaded successfully: ${members.length} member(s) found`
      );
    } catch (error: any) {
      console.error('Failed to load import file:', error);
      vscode.window.showErrorMessage(`Failed to load import file: ${error?.message || error}`);
    }
  }

  private async handleImportSelected(data: {
    selectedRows: Array<{
      rowNumber: number;
      memberData: CourseMemberImportRow;
      selectedRoleId: string;
    }>;
    options: {
      createMissingGroups: boolean;
      updateIfExists: boolean;
    };
  }): Promise<void> {
    if (!this.courseId) {
      vscode.window.showErrorMessage('Course ID not set');
      return;
    }

    const totalRows = data.selectedRows.length;
    let successCount = 0;
    let errorCount = 0;

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Importing course members...',
        cancellable: false
      },
      async (progress) => {
        for (let i = 0; i < data.selectedRows.length; i++) {
          const row = data.selectedRows[i];
          if (!row) {
            continue;
          }

          progress.report({
            increment: 100 / totalRows,
            message: `Importing ${i + 1}/${totalRows}: ${row.memberData.email}`
          });

          try {
            // Call the real API endpoint
            const result = await this.apiService.importSingleCourseMember(
              this.courseId!,
              {
                email: row.memberData.email,
                given_name: row.memberData.given_name,
                family_name: row.memberData.family_name,
                course_group_title: row.memberData.course_group_title,
                course_role_id: row.selectedRoleId
              },
              {
                createMissingGroup: data.options.createMissingGroups,
                updateIfExists: data.options.updateIfExists
              }
            );

            // Send result to webview
            console.log('Import API result:', result);

            if (result.workflow_id) {
              // Async workflow started - webview will poll for status
              console.log('Sending importProgress with workflowId:', result.workflow_id);
              this.panel?.webview.postMessage({
                command: 'importProgress',
                data: {
                  rowNumber: row.rowNumber,
                  result: {
                    status: 'pending',
                    workflowId: result.workflow_id
                  }
                }
              });
            } else {
              // No workflow - operation completed immediately
              const status = result.success ? 'success' : 'error';
              this.panel?.webview.postMessage({
                command: 'importProgress',
                data: {
                  rowNumber: row.rowNumber,
                  result: {
                    status,
                    message: result.message || (result.success ? 'Member imported successfully' : 'Import failed')
                  }
                }
              });

              if (result.success) {
                successCount++;
              } else {
                errorCount++;
              }
            }
          } catch (error: any) {
            this.panel?.webview.postMessage({
              command: 'importProgress',
              data: {
                rowNumber: row.rowNumber,
                result: {
                  status: 'error',
                  message: error?.message || 'Unknown error'
                }
              }
            });

            errorCount++;
          }
        }

        // Send completion message
        this.panel?.webview.postMessage({
          command: 'importComplete',
          data: {
            total: totalRows,
            success: successCount,
            errors: errorCount
          }
        });

        if (errorCount > 0) {
          vscode.window.showWarningMessage(
            `Import completed with errors. Success: ${successCount}, Errors: ${errorCount}`
          );
        } else {
          vscode.window.showInformationMessage(
            `Import successful! ${successCount} members imported.`
          );
        }

        // Refresh tree view
        if (this.treeDataProvider) {
          await this.treeDataProvider.refresh();
        }
      }
    );
  }

  private handleSelectionChanged(data: {
    rowNumber: number;
    isSelected: boolean;
  }): void {
    const member = this.members.find(m => m.rowNumber === data.rowNumber);
    if (member) {
      member.isSelected = data.isSelected;
    }
  }

  private handleRoleChanged(data: {
    rowNumber: number;
    roleId: string;
  }): void {
    const member = this.members.find(m => m.rowNumber === data.rowNumber);
    if (member) {
      member.selectedRoleId = data.roleId;
    }
  }

  private handleGroupChanged(data: {
    rowNumber: number;
    groupTitle: string;
  }): void {
    const member = this.members.find(m => m.rowNumber === data.rowNumber);
    if (member) {
      member.course_group_title = data.groupTitle;
    }
  }

  private async handlePromptCustomGroup(data: {
    rowNumber: number;
  }): Promise<void> {
    const groupTitle = await vscode.window.showInputBox({
      prompt: 'Enter new group name',
      placeHolder: 'Group name',
      validateInput: (value) => {
        if (!value || value.trim().length === 0) {
          return 'Group name cannot be empty';
        }
        return null;
      }
    });

    if (groupTitle) {
      const trimmedTitle = groupTitle.trim();
      const member = this.members.find(m => m.rowNumber === data.rowNumber);
      if (member) {
        member.course_group_title = trimmedTitle;
      }

      // Add to availableGroups if not already present
      const groupExists = this.availableGroups.find(g =>
        (g.title || g.id) === trimmedTitle
      );

      if (!groupExists) {
        // Add as a temporary group (no ID yet, will be created on import)
        this.availableGroups.push({
          id: `temp_${Date.now()}`,
          title: trimmedTitle,
          course_id: this.courseId || ''
        });
      }

      // Send back to webview with updated groups list
      this.panel?.webview.postMessage({
        command: 'customGroupEntered',
        data: {
          rowNumber: data.rowNumber,
          groupTitle: trimmedTitle,
          availableGroups: this.availableGroups
        }
      });
    }
  }

  private handleBulkRoleChange(data: {
    roleId: string;
    rowNumbers: number[];
  }): void {
    data.rowNumbers.forEach(rowNumber => {
      const member = this.members.find(m => m.rowNumber === rowNumber);
      if (member) {
        member.selectedRoleId = data.roleId;
      }
    });

    this.panel?.webview.postMessage({
      command: 'bulkRoleUpdated',
      data: {
        roleId: data.roleId,
        rowNumbers: data.rowNumbers
      }
    });
  }
}
