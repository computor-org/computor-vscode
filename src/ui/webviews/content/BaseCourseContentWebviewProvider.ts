import * as vscode from 'vscode';
import { BaseWebviewProvider } from '../BaseWebviewProvider';
import { CourseContentGet, CourseList, CourseContentTypeList, CourseContentKindList, ExampleGet, ExampleVersionGet } from '../../../types/generated';
import { ComputorApiService } from '../../../services/ComputorApiService';
import { LecturerTreeDataProvider } from '../../tree/lecturer/LecturerTreeDataProvider';

export interface CourseContentWebviewData {
  courseContent: CourseContentGet;
  course: CourseList;
  contentType?: CourseContentTypeList;
  contentKind?: CourseContentKindList;
  exampleInfo?: ExampleGet | null;
  exampleVersionInfo?: ExampleVersionGet | null;
  isSubmittable: boolean;
}

interface WebviewMessage {
  command: string;
  data?: Record<string, unknown>;
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

  protected abstract getWebviewContent(data?: CourseContentWebviewData): Promise<string>;

  protected async handleMessage(message: WebviewMessage): Promise<void> {
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

      case 'createChild':
        await this.handleCreateChild(message.data);
        break;

      case 'deleteContent':
        await this.handleDeleteContent(message.data);
        break;

      default:
        await this.handleCustomMessage(message);
        break;
    }
  }

  protected async handleCustomMessage(message: WebviewMessage): Promise<void> {
    void message;
  }

  protected async handleUpdateContent(data?: Record<string, unknown>): Promise<void> {
    if (!data) { return; }
    try {
      await this.apiService.updateCourseContent(
        data.courseId as string,
        data.contentId as string,
        data.updates as Record<string, unknown>
      );
      vscode.window.showInformationMessage('Content updated successfully');

      if (this.treeDataProvider) {
        this.treeDataProvider.updateNode('courseContent', data.contentId as string, {
          ...(data.updates as Record<string, unknown>),
          course_id: data.courseId as string
        });
      }
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to update content: ${error}`);
    }
  }

  protected async handleRefresh(data?: Record<string, unknown>): Promise<void> {
    if (!data?.contentId) { return; }

    try {
      const freshContent = await this.apiService.getCourseContent(data.contentId as string);
      if (freshContent && this.currentData) {
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

  protected async handleAssignExample(data?: Record<string, unknown>): Promise<void> {
    await vscode.commands.executeCommand('computor.lecturer.assignExample', data);
  }

  protected async handleUnassignExample(data?: Record<string, unknown>): Promise<void> {
    await vscode.commands.executeCommand('computor.lecturer.unassignExample', data);
  }

  protected async handleCreateChild(data?: Record<string, unknown>): Promise<void> {
    await vscode.commands.executeCommand('computor.lecturer.createCourseContent', data);
  }

  protected async handleDeleteContent(data?: Record<string, unknown>): Promise<void> {
    await vscode.commands.executeCommand('computor.lecturer.deleteCourseContent', data);
    this.panel?.dispose();
  }
}
