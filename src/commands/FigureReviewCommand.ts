import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { courseAssistantBridge } from '../services/CourseAssistantBridge';

/** The learner explicitly selects a bounded image; no background file scan. */
export async function reviewSelectedFigure(): Promise<void> {
  const picked = await vscode.window.showOpenDialog({ canSelectMany: false, canSelectFiles: true,
    canSelectFolders: false, filters: { 'Plot images': ['png', 'jpg', 'jpeg'] }, openLabel: 'Review plot with Hackl' });
  const uri = picked?.[0];
  if (!uri || uri.scheme !== 'file') return;
  const file = await fs.promises.realpath(uri.fsPath);
  const roots = await Promise.all((vscode.workspace.workspaceFolders ?? []).map(folder => fs.promises.realpath(folder.uri.fsPath)));
  if (!roots.some(root => { const rel = path.relative(root, file); return !rel.startsWith('..') && !path.isAbsolute(rel); })) {
    void vscode.window.showWarningMessage('Select a plot inside the current workspace.');
    return;
  }
  const handle = await fs.promises.open(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  try {
    if (!(await handle.stat()).isFile()) throw new Error('Select a regular plot image file.');
    const bytes = Buffer.alloc(2 * 1024 * 1024 + 1);
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    if (bytesRead === bytes.length) throw new Error('Plot images must be at most 2 MB.');
    const mime = path.extname(file).toLowerCase() === '.png' ? 'png' : 'jpeg';
    await courseAssistantBridge.reviewFigure(`data:image/${mime};base64,${bytes.subarray(0, bytesRead).toString('base64')}`);
  } finally {
    await handle.close();
  }
}
