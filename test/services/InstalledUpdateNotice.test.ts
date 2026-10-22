import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { readInstalledUpdate, reloadAction, watchInstalledUpdates } from '../../src/services/InstalledUpdateNotice';

/**
 * The marker is written by the workspace installer in computor-backend
 * (ops/coder/templates/*\/extension-sync.mjs) as {"version", "previous",
 * "installedAt"}; these tests write it the same way.
 */
describe('InstalledUpdateNotice', () => {
  let dir: string;
  let marker: string;
  let shown: string[];
  let executed: string[];
  let answer: string | undefined;
  const window = vscode.window as any;
  const commands = vscode.commands as any;
  const original = { info: window.showInformationMessage, exec: commands.executeCommand };

  const write = (version: string) =>
    fs.writeFileSync(marker, JSON.stringify({ version, previous: '2026.10.5', installedAt: new Date().toISOString() }));

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'computor-update-'));
    marker = path.join(dir, 'computor-extension-update.json');
    shown = [];
    executed = [];
    answer = reloadAction;
    window.showInformationMessage = (message: string) => { shown.push(message); return Promise.resolve(answer); };
    commands.executeCommand = (command: string) => { executed.push(command); return Promise.resolve(); };
  });

  afterEach(() => {
    window.showInformationMessage = original.info;
    commands.executeCommand = original.exec;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('reports only a version newer than the running one', () => {
    expect(readInstalledUpdate(marker, '2027.3.4')).to.equal(undefined); // no marker yet
    write('2027.3.4');
    expect(readInstalledUpdate(marker, '2027.3.4')).to.equal(undefined); // installed at start
    expect(readInstalledUpdate(marker, '2027.3.10')).to.equal(undefined);
    expect(readInstalledUpdate(marker, '2026.10.5')).to.equal('2027.3.4');
    write('2027.3.10');
    expect(readInstalledUpdate(marker, '2027.3.9')).to.equal('2027.3.10');
    fs.writeFileSync(marker, '{not json');
    expect(readInstalledUpdate(marker, '2026.10.5')).to.equal(undefined);
  });

  it('offers a reload once per installed version and reloads only when asked', async () => {
    write('2027.3.4');
    const watcher = watchInstalledUpdates(marker, '2026.10.5', 20);
    await new Promise((resolve) => setTimeout(resolve, 120));
    watcher.dispose();
    expect(shown).to.have.length(1);
    expect(shown[0]).to.contain('Computor 2027.3.4 has been installed');
    expect(executed).to.deep.equal(['workbench.action.reloadWindow']);
  });

  it('does not reload when the notice is dismissed', async () => {
    answer = undefined;
    write('2027.3.4');
    watchInstalledUpdates(marker, '2026.10.5', 20).dispose();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(shown).to.have.length(1);
    expect(executed).to.deep.equal([]);
  });

  it('does nothing outside a workspace that sets the marker', () => {
    watchInstalledUpdates(undefined, '2026.10.5').dispose();
    expect(shown).to.deep.equal([]);
  });
});
