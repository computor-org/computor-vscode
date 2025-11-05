import * as vscode from 'vscode';
import { BaseWebviewProvider } from './BaseWebviewProvider';
import { CourseContentTypeGet, CourseList, CourseContentKindList } from '../../types/generated';
import { ComputorApiService } from '../../services/ComputorApiService';
import { LecturerTreeDataProvider } from '../tree/lecturer/LecturerTreeDataProvider';

export class CourseContentTypeWebviewProvider extends BaseWebviewProvider {
  private apiService: ComputorApiService;
  private treeDataProvider?: LecturerTreeDataProvider;

  constructor(context: vscode.ExtensionContext, apiService: ComputorApiService, treeDataProvider?: LecturerTreeDataProvider) {
    super(context, 'computor.courseContentTypeView');
    this.apiService = apiService;
    this.treeDataProvider = treeDataProvider;
  }

  protected async getWebviewContent(data?: {
    contentType: CourseContentTypeGet;
    course: CourseList;
    contentKind?: CourseContentKindList;
  }): Promise<string> {
    if (!this.panel) {
      return this.getBaseHtml('Content Type', '<p>Loading...</p>');
    }

    if (!data) {
      return this.getBaseHtml('Content Type', '<p>No content type data available</p>');
    }

    const { contentType, course, contentKind } = data;

    // Get content kind info if not provided
    let kind = contentKind;
    if (!kind) {
      try {
        const kinds = await this.apiService.getCourseContentKinds();
        kind = kinds.find(k => k.id === contentType.course_content_kind_id);
      } catch (error) {
        console.error('Failed to get content kind:', error);
      }
    }

    const webview = this.panel.webview;
    const nonce = this.getNonce();
    const initialState = JSON.stringify({ contentType, course, contentKind: kind });
    const cssUri = this.getWebviewUri(webview, 'webview-ui', 'course-content-type-details.css');
    const scriptUri = this.getWebviewUri(webview, 'webview-ui', 'course-content-type-details.js');

    return `<!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; img-src ${webview.cspSource} https: data:; script-src 'nonce-${nonce}';">
      <title>Content Type: ${contentType.title || contentType.slug}</title>
      <link rel="stylesheet" href="${cssUri}">
    </head>
    <body>
      <div id="app" class="view-root"></div>
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
      case 'updateContentType':
        try {
          await this.apiService.updateCourseContentType(message.data.typeId, message.data.updates);
          vscode.window.showInformationMessage('Content type updated successfully');
          
          // Update tree with changes
          if (this.treeDataProvider) {
            // Get the course ID from the data to provide context for the update
            const courseData = this.currentData as { course: CourseList };
            this.treeDataProvider.updateNode('courseContentType', message.data.typeId, {
              ...message.data.updates,
              course_id: courseData?.course.id
            });
          } else {
            vscode.commands.executeCommand('computor.lecturer.refresh');
          }
        } catch (error) {
          vscode.window.showErrorMessage(`Failed to update content type: ${error}`);
        }
        break;

      case 'refresh':
        // Reload the webview with fresh data
        if (message.data.typeId) {
          try {
            const freshContentType = await this.apiService.getCourseContentType(message.data.typeId);
            if (freshContentType && this.currentData) {
              // Also refresh content kind info if needed
              let contentKind = this.currentData.contentKind;
              if (freshContentType.course_content_kind_id) {
                try {
                  const kinds = await this.apiService.getCourseContentKinds();
                  const freshKind = kinds.find(k => k.id === freshContentType.course_content_kind_id);
                  if (freshKind) {
                    contentKind = freshKind;
                  }
                } catch (error) {
                  console.error('Failed to refresh content kind:', error);
                }
              }
              
              // Update the current data and re-render the entire webview
              this.currentData.contentType = freshContentType;
              this.currentData.contentKind = contentKind;
              const content = await this.getWebviewContent(this.currentData);
              if (this.panel) {
                this.panel.webview.html = content;
              }
              vscode.window.showInformationMessage('Content type refreshed');
            }
          } catch (error) {
            vscode.window.showErrorMessage(`Failed to refresh: ${error}`);
          }
        }
        break;

      case 'findUsage':
        vscode.window.showInformationMessage('Finding content type usage coming soon!');
        break;

      case 'deleteContentType':
        vscode.commands.executeCommand('computor.deleteCourseContentType', message.data);
        this.panel?.dispose();
        break;
    }
  }
}