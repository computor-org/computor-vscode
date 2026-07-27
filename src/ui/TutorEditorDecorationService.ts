import * as vscode from 'vscode';
import * as path from 'path';
import { TutorSelectionService } from '../services/TutorSelectionService';

/**
 * Service that manages text editor decorations for tutor review files.
 * Displays student name as a subtle decoration at the top of files opened from the review directory.
 */
export class TutorEditorDecorationService implements vscode.Disposable {
  private static instance: TutorEditorDecorationService | null = null;

  private decorationType: vscode.TextEditorDecorationType;
  private selectionService: TutorSelectionService | null = null;
  private disposables: vscode.Disposable[] = [];
  private activeDecorations = new Map<string, vscode.TextEditorDecorationType>();

  private constructor() {
    this.decorationType = vscode.window.createTextEditorDecorationType({
      isWholeLine: true,
      rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
    });

    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor(editor => {
        if (editor) {
          this.updateDecorations(editor);
        }
      }),
      vscode.window.onDidChangeVisibleTextEditors(editors => {
        editors.forEach(editor => this.updateDecorations(editor));
      }),
      vscode.workspace.onDidOpenTextDocument(doc => {
        const editor = vscode.window.visibleTextEditors.find(e => e.document === doc);
        if (editor) {
          this.updateDecorations(editor);
        }
      })
    );

    if (vscode.window.activeTextEditor) {
      this.updateDecorations(vscode.window.activeTextEditor);
    }
  }

  static initialize(context: vscode.ExtensionContext): TutorEditorDecorationService {
    if (!this.instance) {
      this.instance = new TutorEditorDecorationService();
      context.subscriptions.push(this.instance);
    }
    return this.instance;
  }

  static getInstance(): TutorEditorDecorationService | null {
    return this.instance;
  }

  /**
   * Connect to selection service to receive updates when student selection changes
   */
  connectToSelectionService(selectionService: TutorSelectionService): void {
    this.selectionService = selectionService;

    const listener = selectionService.onDidChangeSelection(() => {
      this.refreshAllEditors();
    });
    this.disposables.push(listener);
  }

  /**
   * Refresh decorations for all visible editors
   */
  refreshAllEditors(): void {
    vscode.window.visibleTextEditors.forEach(editor => {
      this.updateDecorations(editor);
    });
  }

  /**
   * Update decorations for a specific editor
   */
  private updateDecorations(editor: vscode.TextEditor): void {
    const uri = editor.document.uri;
    const editorKey = uri.toString();

    const existingDecoration = this.activeDecorations.get(editorKey);
    if (existingDecoration) {
      editor.setDecorations(existingDecoration, []);
      existingDecoration.dispose();
      this.activeDecorations.delete(editorKey);
    }

    const fileType = this.getFileType(uri);
    if (fileType === 'none') {
      return;
    }

    let decoration: { type: vscode.TextEditorDecorationType; options: vscode.DecorationOptions[] } | null = null;

    if (fileType === 'reference') {
      decoration = this.createReferenceBannerDecoration(editor);
    } else if (fileType === 'student') {
      const memberLabel = this.selectionService?.getCurrentMemberLabel();
      if (memberLabel) {
        decoration = this.createStudentBannerDecoration(editor, memberLabel);
      }
    }

    if (decoration) {
      this.activeDecorations.set(editorKey, decoration.type);
      editor.setDecorations(decoration.type, decoration.options);
    }
  }

  /**
   * Create a decoration that displays student name at the top of the file
   */
  private createStudentBannerDecoration(
    editor: vscode.TextEditor,
    studentName: string
  ): { type: vscode.TextEditorDecorationType; options: vscode.DecorationOptions[] } | null {
    if (editor.document.lineCount === 0) {
      return null;
    }

    const decorationType = vscode.window.createTextEditorDecorationType({
      isWholeLine: true,
      rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
      after: {
        contentText: `  👤 ${studentName}`,
        color: new vscode.ThemeColor('editorLineNumber.foreground'),
        fontStyle: 'italic',
        margin: '0 0 0 2em',
      },
    });

    const firstLineRange = editor.document.lineAt(0).range;
    const decorationOptions: vscode.DecorationOptions[] = [
      {
        range: firstLineRange,
        hoverMessage: new vscode.MarkdownString(`**Student:** ${studentName}`),
      },
    ];

    return {
      type: decorationType,
      options: decorationOptions,
    };
  }

  /**
   * Create a decoration that displays "Reference" label at the top of the file
   */
  private createReferenceBannerDecoration(
    editor: vscode.TextEditor
  ): { type: vscode.TextEditorDecorationType; options: vscode.DecorationOptions[] } | null {
    if (editor.document.lineCount === 0) {
      return null;
    }

    const decorationType = vscode.window.createTextEditorDecorationType({
      isWholeLine: true,
      rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
      after: {
        contentText: '  📚 Reference',
        color: new vscode.ThemeColor('editorLineNumber.foreground'),
        fontStyle: 'italic',
        margin: '0 0 0 2em',
      },
    });

    const firstLineRange = editor.document.lineAt(0).range;
    const decorationOptions: vscode.DecorationOptions[] = [
      {
        range: firstLineRange,
        hoverMessage: new vscode.MarkdownString("**Reference:** Instructor's example solution"),
      },
    ];

    return {
      type: decorationType,
      options: decorationOptions,
    };
  }

  /**
   * Determine the type of file based on its location in the workspace.
   * Returns 'student' for submission/repository files, 'reference' for reference files, 'none' otherwise.
   */
  private getFileType(uri: vscode.Uri): 'student' | 'reference' | 'none' {
    if (uri.scheme !== 'file') {
      return 'none';
    }

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceFolder) {
      return 'none';
    }

    const filePath = uri.fsPath;
    const submissionsPath = path.join(workspaceFolder, 'review', 'submissions');
    const repositoriesPath = path.join(workspaceFolder, 'review', 'repositories');
    const referencePath = path.join(workspaceFolder, 'review', 'reference');

    if (filePath.startsWith(submissionsPath) || filePath.startsWith(repositoriesPath)) {
      return 'student';
    }

    if (filePath.startsWith(referencePath)) {
      return 'reference';
    }

    return 'none';
  }

  dispose(): void {
    this.disposables.forEach(d => d.dispose());
    this.decorationType.dispose();
    this.activeDecorations.forEach(d => d.dispose());
    this.activeDecorations.clear();
  }
}
