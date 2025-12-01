import * as vscode from 'vscode';
import { BaseWebviewProvider } from './BaseWebviewProvider';
import { CourseMemberImportRow, CourseRoleList, CourseMemberList } from '../../types/generated';
import { ComputorApiService } from '../../services/ComputorApiService';
import { LecturerTreeDataProvider } from '../tree/lecturer/LecturerTreeDataProvider';

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

    // Fetch existing course members and available roles
    let existingMembers: CourseMemberList[] = [];
    try {
      [existingMembers, this.availableRoles] = await Promise.all([
        this.apiService.getCourseMembers(courseId),
        this.apiService.getCourseRoles()
      ]);
    } catch (error) {
      console.error('Failed to fetch course data:', error);
      vscode.window.showErrorMessage(`Failed to fetch course data: ${error}`);
      existingMembers = [];
      this.availableRoles = [
        { id: '_student', title: 'Student' },
        { id: '_tutor', title: 'Tutor' },
        { id: '_lecturer', title: 'Lecturer' }
      ] as CourseRoleList[];
    }

    // Convert existing members to display format
    this.members = existingMembers.map((em, index) => ({
      email: em.user.email || '',
      given_name: em.user.given_name || '',
      family_name: em.user.family_name || '',
      course_group_title: '', // TODO: Map group ID to title
      course_role_id: em.course_role_id,
      rowNumber: index + 1,
      status: 'existing' as const,
      selectedRoleId: em.course_role_id,
      isSelected: false
    }));

    await this.show('Course Members', {
      courseId,
      members: this.members,
      availableRoles: this.availableRoles
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
        mergedMembers.push({
          email: em.user.email || '',
          given_name: em.user.given_name || '',
          family_name: em.user.family_name || '',
          course_group_title: '',
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
        availableRoles: this.availableRoles
      }
    });
  }

  protected async getWebviewContent(data?: {
    courseId: string;
    members: ImportMemberRow[];
    availableRoles: CourseRoleList[];
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
      <title>Course Member Import Preview</title>
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

      case 'bulkRoleChange':
        this.handleBulkRoleChange(message.data);
        break;

      case 'filterChanged':
        // Filtering is handled client-side in the webview
        break;
    }
  }

  private async handleSelectImportFile(): Promise<void> {
    const fileUri = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      filters: {
        'Excel XML Files': ['xml'],
        'All Files': ['*']
      },
      title: 'Select Excel XML file containing course members'
    });

    if (!fileUri || fileUri.length === 0) {
      return;
    }

    const firstFile = fileUri[0];
    if (!firstFile || !this.courseId) {
      return;
    }

    const filePath = firstFile.fsPath;

    try {
      const fs = await import('fs');
      const fileBuffer = await fs.promises.readFile(filePath);
      const fileContent = fileBuffer.toString('utf-8');

      // TODO: Implement proper XML parsing
      // For now, create mock data
      const mockMembers = this.parseMockXMLData(fileContent);

      await this.loadImportData(mockMembers);

      vscode.window.showInformationMessage('Import file loaded successfully');
    } catch (error: any) {
      console.error('Failed to load import file:', error);
      vscode.window.showErrorMessage(`Failed to load import file: ${error?.message || error}`);
    }
  }

  private parseMockXMLData(xmlContent: string): CourseMemberImportRow[] {
    void xmlContent;
    // TODO: Implement proper XML parsing
    return [
      {
        email: 'john.doe@example.com',
        given_name: 'John',
        family_name: 'Doe',
        course_group_title: 'Group A',
        course_role_id: '_student'
      },
      {
        email: 'jane.smith@example.com',
        given_name: 'Jane',
        family_name: 'Smith',
        course_group_title: 'Group B',
        course_role_id: '_student'
      },
      {
        email: 'bob.johnson@example.com',
        given_name: 'Bob',
        family_name: 'Johnson',
        course_group_title: 'Group A',
        course_role_id: '_student'
      }
    ];
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
            // TODO: Implement when import-single endpoint is available
            // const result = await this.apiService.importSingleCourseMember(
            //   this.courseId!,
            //   row.memberData,
            //   row.selectedRoleId,
            //   data.options
            // );

            // Mock success for now
            await new Promise(resolve => setTimeout(resolve, 100));

            this.panel?.webview.postMessage({
              command: 'importProgress',
              data: {
                rowNumber: row.rowNumber,
                result: {
                  status: 'success',
                  message: 'Member imported successfully (mock)'
                }
              }
            });

            successCount++;
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
