import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

import { renderWebviewPage } from './shared/webviewPage';
import { escapeHtml } from './shared/webviewHelpers';

/**
 * Handing a file to the student's own computer from code-server.
 *
 * Under code-server everything this extension writes lands on the *server*:
 * `showSaveDialog` browses the server's disk and its "local" branch is refused
 * by the browser sandbox, which is what students ran into when exporting their
 * course (computor-org/issues#353). The workbench's own `explorer.download` is
 * no help either — its handler ignores any argument and downloads whatever the
 * Explorer has selected, falling back to the *workspace roots*, so invoking it
 * blind risks downloading the student's entire home directory.
 *
 * A webview can do it safely: VS Code gives the webview iframe `allow-downloads`
 * whenever scripts are enabled, so a blob URL behind an `<a download>` reaches
 * the browser's own download machinery and nothing else.
 */

/**
 * The bytes travel to the webview in slices of this size: one message per
 * slice, assembled into a Blob on the other side. A single message used to
 * carry everything, and its practical ceiling made a 32 MB folder ZIP
 * undeliverable (#361).
 */
const CHUNK_BYTES = 8 * 1024 * 1024;

/**
 * Above this the assembled Blob starts to strain the browser tab itself;
 * callers fall back to pointing at the file on disk.
 */
const MAX_DOWNLOAD_BYTES = 512 * 1024 * 1024;

export async function downloadFileInBrowser(
  extensionUri: vscode.Uri,
  filePath: string,
  mimeType: string = 'application/octet-stream'
): Promise<boolean> {
  let size: number;
  try {
    size = (await fs.promises.stat(filePath)).size;
  } catch {
    return false;
  }
  if (size > MAX_DOWNLOAD_BYTES) {
    return false;
  }

  const bytes = await fs.promises.readFile(filePath);
  return downloadBytesInBrowser(extensionUri, path.basename(filePath), bytes, mimeType);
}

/**
 * The same hand-off for bytes that were never a file on disk — a ZIP built in
 * memory, say. Callers that already hold a path should use
 * {@link downloadFileInBrowser}.
 */
export async function downloadBytesInBrowser(
  extensionUri: vscode.Uri,
  name: string,
  contents: Buffer,
  mimeType: string = 'application/octet-stream'
): Promise<boolean> {
  if (contents.byteLength > MAX_DOWNLOAD_BYTES) {
    return false;
  }

  const panel = vscode.window.createWebviewPanel(
    'computor.browserDownload',
    `Download ${name}`,
    { viewColumn: vscode.ViewColumn.Active, preserveFocus: false },
    { enableScripts: true }
  );

  // The panel deliberately stays open: browsers sometimes refuse a download
  // that no click initiated, and then the button on the page is the way out.
  panel.webview.html = renderWebviewPage(panel.webview, extensionUri, {
    title: `Download ${name}`,
    container: true,
    bodyHtml: `
      <h1>Download ${escapeHtml(name)}</h1>
      <p id="status">Preparing your download…</p>
      <p>
        <button id="again" class="btn" hidden>Download again</button>
      </p>
      <p class="text-muted">
        If nothing happened, your browser may have blocked the download. Use the
        button above, and allow downloads from this site if prompted.
      </p>
    `,
    inlineScript: DOWNLOAD_SCRIPT
  });

  const started = new Promise<boolean>((resolve) => {
    const subscription = panel.webview.onDidReceiveMessage((message: any) => {
      if (message?.command === 'downloaded') {
        subscription.dispose();
        resolve(true);
      } else if (message?.command === 'failed') {
        console.warn('[browserDownload] The webview could not start the download:', message?.data?.message);
        subscription.dispose();
        resolve(false);
      }
    });
    panel.onDidDispose(() => {
      subscription.dispose();
      resolve(false);
    });
  });

  const totalChunks = Math.max(1, Math.ceil(contents.byteLength / CHUNK_BYTES));
  await panel.webview.postMessage({
    command: 'begin',
    data: { name, mimeType, totalChunks, totalBytes: contents.byteLength }
  });
  for (let index = 0; index < totalChunks; index++) {
    const slice = contents.subarray(index * CHUNK_BYTES, (index + 1) * CHUNK_BYTES);
    await panel.webview.postMessage({
      command: 'chunk',
      data: { index, base64: slice.toString('base64') }
    });
  }
  return started;
}

const DOWNLOAD_SCRIPT = `
  let pending;
  let incoming;

  function decode(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) { bytes[i] = binary.charCodeAt(i); }
    return bytes;
  }

  function start(payload) {
    const url = URL.createObjectURL(
      new Blob(payload.parts, { type: payload.mimeType || 'application/octet-stream' })
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = payload.name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
  }

  window.addEventListener('message', function (event) {
    const message = event.data;
    if (!message) { return; }
    try {
      if (message.command === 'begin') {
        incoming = {
          name: message.data.name,
          mimeType: message.data.mimeType,
          totalChunks: message.data.totalChunks,
          received: 0,
          parts: new Array(message.data.totalChunks)
        };
        return;
      }
      if (message.command !== 'chunk' || !incoming) { return; }
      incoming.parts[message.data.index] = decode(message.data.base64);
      incoming.received += 1;
      if (incoming.received < incoming.totalChunks) {
        document.getElementById('status').textContent =
          'Receiving ' + incoming.name + '… (' + incoming.received + '/' + incoming.totalChunks + ')';
        return;
      }
      pending = incoming;
      incoming = undefined;
      start(pending);
      document.getElementById('status').textContent =
        'Your download of ' + pending.name + ' has started.';
      document.getElementById('again').hidden = false;
      vscode.postMessage({ command: 'downloaded' });
    } catch (error) {
      document.getElementById('status').textContent = 'The download could not be prepared.';
      vscode.postMessage({ command: 'failed', data: { message: String(error) } });
    }
  });

  document.getElementById('again').addEventListener('click', function () {
    if (pending) { start(pending); }
  });
`;
