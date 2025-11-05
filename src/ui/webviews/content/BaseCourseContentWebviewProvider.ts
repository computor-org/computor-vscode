import * as vscode from 'vscode';
import { BaseWebviewProvider } from '../BaseWebviewProvider';
import { CourseContentGet, CourseList, CourseContentTypeList, CourseContentKindList } from '../../../types/generated';
import { ComputorApiService } from '../../../services/ComputorApiService';
import { LecturerTreeDataProvider } from '../../tree/lecturer/LecturerTreeDataProvider';

export interface CourseContentWebviewData {
  courseContent: CourseContentGet;
  course: CourseList;
  contentType?: CourseContentTypeList;
  contentKind?: CourseContentKindList;
  exampleInfo?: any;
  isSubmittable: boolean;
}

/**
 * Abstract base class for all course content webview providers.
 * Different content kinds (assignment, unit, generic) extend this class.
 */
export abstract class BaseCourseContentWebviewProvider extends BaseWebviewProvider {
  protected apiService: ComputorApiService;
  protected treeDataProvider?: LecturerTreeDataProvider;

  constructor(
    context: vscode.ExtensionContext,
    viewType: string,
    apiService: ComputorApiService,
    treeDataProvider?: LecturerTreeDataProvider
  ) {
    super(context, viewType);
    this.apiService = apiService;
    this.treeDataProvider = treeDataProvider;
  }

  /**
   * Get the HTML content for the webview.
   * Each content kind implements this differently.
   */
  protected abstract getWebviewContent(data?: CourseContentWebviewData): Promise<string>;

  /**
   * Common message handling for all content types.
   * Subclasses can override to add kind-specific handlers.
   */
  protected async handleMessage(message: any): Promise<void> {
    switch (message.command) {
      case 'updateContent':
        await this.handleUpdateContent(message.data);
        break;

      case 'refresh':
        await this.handleRefresh(message.data);
        break;

      case 'assignExample':
        await this.handleAssignExample(message.data);
        break;

      case 'unassignExample':
        await this.handleUnassignExample(message.data);
        break;

      case 'updateExample':
        await this.handleUpdateExample(message.data);
        break;

      case 'createChild':
        await this.handleCreateChild(message.data);
        break;

      case 'moveContent':
        await this.handleMoveContent(message.data);
        break;

      case 'deleteContent':
        await this.handleDeleteContent(message.data);
        break;

      default:
        // Allow subclasses to handle additional messages
        await this.handleCustomMessage(message);
        break;
    }
  }

  /**
   * Handle custom messages specific to content kind.
   * Override in subclasses for kind-specific messages.
   */
  protected async handleCustomMessage(message: any): Promise<void> {
    void message;
    // Default: do nothing
  }

  /**
   * Update course content
   */
  protected async handleUpdateContent(data: any): Promise<void> {
    try {
      await this.apiService.updateCourseContent(
        data.courseId,
        data.contentId,
        data.updates
      );
      vscode.window.showInformationMessage('Content updated successfully');

      // Update tree with changes
      if (this.treeDataProvider) {
        this.treeDataProvider.updateNode('courseContent', data.contentId, {
          ...data.updates,
          course_id: data.courseId
        });
      }
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to update content: ${error}`);
    }
  }

  /**
   * Refresh content data
   */
  protected async handleRefresh(data: any): Promise<void> {
    if (!data.contentId) return;

    try {
      const freshContent = await this.apiService.getCourseContent(data.contentId);
      if (freshContent && this.currentData) {
        // Update the current data and re-render
        const webviewData = this.currentData as CourseContentWebviewData;
        webviewData.courseContent = freshContent;

        const content = await this.getWebviewContent(webviewData);
        if (this.panel) {
          this.panel.webview.html = content;
        }
        vscode.window.showInformationMessage('Content refreshed');
      }
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to refresh: ${error}`);
    }
  }

  /**
   * Assign example to content
   */
  protected async handleAssignExample(data: any): Promise<void> {
    await vscode.commands.executeCommand('computor.lecturer.assignExample', data);
  }

  /**
   * Unassign example from content
   */
  protected async handleUnassignExample(data: any): Promise<void> {
    await vscode.commands.executeCommand('computor.lecturer.unassignExample', data);
  }

  /**
   * Update assigned example
   */
  protected async handleUpdateExample(data: any): Promise<void> {
    vscode.window.showInformationMessage('Example update functionality coming soon!');
  }

  /**
   * Create child content
   */
  protected async handleCreateChild(data: any): Promise<void> {
    await vscode.commands.executeCommand('computor.lecturer.createCourseContent', data);
  }

  /**
   * Move/reorder content
   */
  protected async handleMoveContent(data: any): Promise<void> {
    vscode.window.showInformationMessage('Content reordering coming soon!');
  }

  /**
   * Delete content
   */
  protected async handleDeleteContent(data: any): Promise<void> {
    await vscode.commands.executeCommand('computor.lecturer.deleteCourseContent', data);
    this.panel?.dispose();
  }
}
