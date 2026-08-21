import * as vscode from 'vscode';
import { notify } from './notify';

/**
 * The single entry point for putting text on the user's clipboard.
 *
 * `vscode.env.clipboard.writeText` is not dependable under code-server: the
 * extension host proxies the write to the browser, where it happens outside any
 * user-activation window and can be refused without throwing. The previous
 * clipboard content then simply stays put, so the student pastes whatever they
 * copied last and reports that the command "copies the wrong thing"
 * (computor-org/issues#353).
 *
 * So: write, read back to check it landed, confirm to the user when it did, and
 * otherwise hand the text over in an input box they can copy from by hand —
 * the only fallback a browser sandbox leaves us.
 */
export async function copyToClipboard(
  text: string,
  label = 'Path',
  successMessage?: string
): Promise<boolean> {
  try {
    await vscode.env.clipboard.writeText(text);
    if (await writeLanded(text)) {
      void notify.info(successMessage ?? `${label} copied to clipboard: ${text}`);
      return true;
    }
  } catch (error) {
    console.warn('[clipboard] Failed to write to the clipboard:', error);
  }

  await offerManualCopy(text, label);
  return false;
}

/**
 * Did the value actually reach the clipboard? A clipboard we cannot read back
 * counts as success — the write itself did not throw, and nagging on every copy
 * where only `readText` is unavailable would be worse than the bug.
 */
async function writeLanded(text: string): Promise<boolean> {
  try {
    return (await vscode.env.clipboard.readText()) === text;
  } catch {
    return true;
  }
}

/** Last resort: show the text somewhere the user can select and copy it. */
async function offerManualCopy(text: string, label: string): Promise<void> {
  await vscode.window.showInputBox({
    title: `${label} — press Ctrl/Cmd+C to copy`,
    prompt: 'Your browser did not allow Computor to write to the clipboard directly.',
    value: text,
    ignoreFocusOut: true
  });
}
