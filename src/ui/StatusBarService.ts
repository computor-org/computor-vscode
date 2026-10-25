import * as vscode from 'vscode';
import { say } from '../utils/uiLanguage';

/**
 * The course the Student view is on, in the status bar.
 *
 * A "Sync" item used to sit beside it. Its command was removed with the old
 * student features and nothing set its state any more, so it was an English
 * label that did nothing when clicked; it is gone until sync returns.
 */
export class StatusBarService implements vscode.Disposable {
    private static instance: StatusBarService;
    private courseItem: vscode.StatusBarItem;

    private constructor(context: vscode.ExtensionContext) {
        void context; // Mark as intentionally unused
        this.courseItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Left,
            100
        );
        this.courseItem.command = 'computor.student.selectCourse';
        this.courseItem.show();
    }

    static initialize(context: vscode.ExtensionContext): StatusBarService {
        if (!StatusBarService.instance) {
            StatusBarService.instance = new StatusBarService(context);
        }
        return StatusBarService.instance;
    }

    static getInstance(): StatusBarService {
        if (!StatusBarService.instance) {
            throw new Error('StatusBarService not initialized');
        }
        return StatusBarService.instance;
    }

    updateCourse(courseName: string): void {
        this.courseItem.text = `$(book) ${courseName}`;
        this.courseItem.tooltip = say('Click to switch course', 'Klicken, um den Kurs zu wechseln');
        this.courseItem.backgroundColor = undefined;
    }

    clearCourse(): void {
        this.courseItem.text = `$(book) ${say('No course selected', 'Kein Kurs ausgewählt')}`;
        this.courseItem.tooltip = say('Click to choose a course', 'Klicken, um einen Kurs auszuwählen');
        this.courseItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    }

    dispose(): void {
        this.courseItem.dispose();
    }
}
