import * as vscode from 'vscode';
import { ComputorApiService } from '../../../services/ComputorApiService';
import { CourseContentKindList } from '../../../types/generated';
import { LecturerTreeDataProvider } from '../../tree/lecturer/LecturerTreeDataProvider';
import { BaseCourseContentWebviewProvider } from './BaseCourseContentWebviewProvider';
import { AssignmentContentWebviewProvider } from './AssignmentContentWebviewProvider';
import { UnitContentWebviewProvider } from './UnitContentWebviewProvider';
import { GenericContentWebviewProvider } from './GenericContentWebviewProvider';

/**
 * Factory for creating appropriate course content webview provider
 * based on the content kind (assignment, unit, generic).
 */
export class CourseContentWebviewFactory {
  /**
   * Create a webview provider based on content kind characteristics.
   *
   * @param context - VS Code extension context
   * @param apiService - API service for backend communication
   * @param contentKind - The kind of content (defines behavior)
   * @param treeDataProvider - Optional tree provider for updates
   * @returns Appropriate webview provider instance
   */
  static create(
    context: vscode.ExtensionContext,
    apiService: ComputorApiService,
    contentKind: CourseContentKindList,
    treeDataProvider?: LecturerTreeDataProvider
  ): BaseCourseContentWebviewProvider {

    // Assignment content (submittable)
    if (contentKind.submittable) {
      return new AssignmentContentWebviewProvider(
        context,
        apiService,
        treeDataProvider
      );
    }

    // Unit content (container with children)
    if (contentKind.has_descendants) {
      return new UnitContentWebviewProvider(
        context,
        apiService,
        treeDataProvider
      );
    }

    // Generic content (lecture, reading, etc.)
    return new GenericContentWebviewProvider(
      context,
      apiService,
      treeDataProvider
    );
  }

  /**
   * Get a human-readable description of what provider will be created
   * for the given content kind.
   */
  static getProviderType(contentKind: CourseContentKindList): string {
    if (contentKind.submittable) {
      return 'Assignment';
    }
    if (contentKind.has_descendants) {
      return 'Unit';
    }
    return 'Generic';
  }
}
