import * as vscode from 'vscode';

export class LecturerBreadcrumbStatusBar implements vscode.Disposable {
  private item: vscode.StatusBarItem;
  private visibleInView = false;
  private hasSelection = false;

  constructor() {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
    this.item.tooltip = 'Lecturer view: currently selected course path';
  }

  update(parts: { organization?: string | null; courseFamily?: string | null; course?: string | null }): void {
    const segments = [parts.organization, parts.courseFamily, parts.course]
      .map(s => (s || '').trim())
      .filter(s => s.length > 0);

    if (segments.length === 0) {
      this.hasSelection = false;
    } else {
      this.hasSelection = true;
      this.item.text = `$(mortar-board) ${segments.join(' / ')}`;
    }
    this.applyVisibility();
  }

  clear(): void {
    this.hasSelection = false;
    this.applyVisibility();
  }

  setViewVisible(visible: boolean): void {
    this.visibleInView = visible;
    this.applyVisibility();
  }

  private applyVisibility(): void {
    if (this.visibleInView && this.hasSelection) {
      this.item.show();
    } else {
      this.item.hide();
    }
  }

  dispose(): void {
    this.item.dispose();
  }
}
