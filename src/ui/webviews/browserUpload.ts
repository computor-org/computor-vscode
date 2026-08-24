import * as vscode from 'vscode';

import { renderWebviewPage } from './shared/webviewPage';
import { escapeHtml } from './shared/webviewHelpers';

/**
 * Taking files off the lecturer's own computer from code-server.
 *
 * Every ingestion path the Documents tree had reads the *server's* disk:
 * `showOpenDialog` browses it, and the tree's drag-and-drop handler accepts
 * only `file:` URIs and copies them with `fs.copyFile`. Under code-server that
 * means a lecturer could upload nothing that was not already on the server —
 * which is exactly the case that matters, because the source of a document is
 * usually PowerPoint or Keynote on their laptop (computor-org/issues#361).
 *
 * A webview can reach the real machine: an `<input type="file">` is the
 * browser's own picker, and `webkitdirectory` makes it a folder picker that
 * reports each file's path within the chosen folder. The files are read with
 * `FileReader` and handed back over the extension-host message channel. The
 * same approach already carries a screenshot into an issue report and a CSV
 * into the member import.
 */

/** Guards the base64 hand-off across the message channel, per file. */
const MAX_FILE_BYTES = 32 * 1024 * 1024;

/** And in total, so a mistakenly chosen folder cannot wedge the host. */
const MAX_TOTAL_BYTES = 128 * 1024 * 1024;

export interface PickedFile {
  /** Path relative to the chosen folder, or a bare filename for single files. */
  relativePath: string;
  contents: Buffer;
}

/**
 * Open the browser's file or folder picker and return what the lecturer chose.
 * Resolves to an empty array when they cancel or close the panel.
 */
export async function pickFilesFromBrowser(
  extensionUri: vscode.Uri,
  options: { folder: boolean; title: string }
): Promise<PickedFile[]> {
  const panel = vscode.window.createWebviewPanel(
    'computor.browserUpload',
    options.title,
    { viewColumn: vscode.ViewColumn.Active, preserveFocus: false },
    { enableScripts: true }
  );

  panel.webview.html = renderWebviewPage(panel.webview, extensionUri, {
    title: options.title,
    container: true,
    bodyHtml: `
      <h1>${escapeHtml(options.title)}</h1>
      <p id="status">
        Choose ${options.folder ? 'a folder' : 'one or more files'} from your computer.
      </p>
      <p>
        <input id="picker" type="file" ${options.folder ? 'webkitdirectory directory' : 'multiple'}>
      </p>
      <p>
        <button id="send" class="btn" disabled>Upload</button>
        <button id="cancel" class="btn btn-secondary">Cancel</button>
      </p>
      <ul id="list" class="text-muted"></ul>
    `,
    initialState: { maxFileBytes: MAX_FILE_BYTES, maxTotalBytes: MAX_TOTAL_BYTES },
    inlineScript: UPLOAD_SCRIPT
  });

  const picked = await new Promise<PickedFile[]>((resolve) => {
    const subscription = panel.webview.onDidReceiveMessage((message: any) => {
      if (message?.command === 'files') {
        const files: PickedFile[] = (message.data?.files ?? []).map((file: any) => ({
          relativePath: String(file.relativePath),
          contents: Buffer.from(String(file.base64), 'base64')
        }));
        subscription.dispose();
        resolve(files);
      } else if (message?.command === 'cancel') {
        subscription.dispose();
        resolve([]);
      }
    });
    panel.onDidDispose(() => {
      subscription.dispose();
      resolve([]);
    });
  });

  panel.dispose();
  return picked;
}

const UPLOAD_SCRIPT = `
  (function () {
    var limits = window.__INITIAL_STATE__ || {};
    var picker = document.getElementById('picker');
    var send = document.getElementById('send');
    var cancel = document.getElementById('cancel');
    var status = document.getElementById('status');
    var list = document.getElementById('list');
    var chosen = [];

    function describe(bytes) {
      if (bytes < 1024) { return bytes + ' B'; }
      var units = ['KB', 'MB', 'GB'];
      var value = bytes / 1024;
      var unit = 0;
      while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }
      return (value < 10 ? value.toFixed(1) : Math.round(value)) + ' ' + units[unit];
    }

    picker.addEventListener('change', function () {
      chosen = Array.prototype.slice.call(picker.files || []);
      list.innerHTML = '';
      var total = 0;
      var rejected = [];

      chosen = chosen.filter(function (file) {
        if (file.size > limits.maxFileBytes) {
          rejected.push(file.name + ' (' + describe(file.size) + ')');
          return false;
        }
        total += file.size;
        return true;
      });

      if (total > limits.maxTotalBytes) {
        status.textContent = 'That is ' + describe(total) +
          ' in total, more than can be sent in one go. Choose fewer files.';
        send.disabled = true;
        return;
      }

      chosen.slice(0, 50).forEach(function (file) {
        var row = document.createElement('li');
        row.textContent = (file.webkitRelativePath || file.name) + ' · ' + describe(file.size);
        list.appendChild(row);
      });
      if (chosen.length > 50) {
        var more = document.createElement('li');
        more.textContent = 'and ' + (chosen.length - 50) + ' more…';
        list.appendChild(more);
      }

      // Named, not silently dropped: a missing file is worse than a refusal.
      rejected.forEach(function (name) {
        var row = document.createElement('li');
        row.textContent = 'Too large to upload: ' + name;
        list.appendChild(row);
      });

      status.textContent = chosen.length === 0
        ? 'Nothing to upload.'
        : chosen.length + ' file' + (chosen.length === 1 ? '' : 's') +
          ' · ' + describe(total);
      send.disabled = chosen.length === 0;
    });

    function read(file) {
      return new Promise(function (resolve, reject) {
        var reader = new FileReader();
        reader.onload = function () {
          var result = String(reader.result || '');
          // "data:<mime>;base64,<payload>" — keep the payload.
          resolve({
            relativePath: file.webkitRelativePath || file.name,
            base64: result.slice(result.indexOf(',') + 1)
          });
        };
        reader.onerror = function () { reject(reader.error); };
        reader.readAsDataURL(file);
      });
    }

    send.addEventListener('click', function () {
      send.disabled = true;
      cancel.disabled = true;
      status.textContent = 'Reading ' + chosen.length + ' file' +
        (chosen.length === 1 ? '' : 's') + '…';

      Promise.all(chosen.map(read)).then(function (files) {
        vscode.postMessage({ command: 'files', data: { files: files } });
      }).catch(function (error) {
        status.textContent = 'Could not read the files: ' + String(error);
        send.disabled = false;
        cancel.disabled = false;
      });
    });

    cancel.addEventListener('click', function () {
      vscode.postMessage({ command: 'cancel' });
    });
  })();
`;
