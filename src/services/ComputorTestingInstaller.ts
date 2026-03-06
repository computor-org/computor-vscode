import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { execAsync } from '../utils/exec';
import { WorkspaceStructureManager } from '../utils/workspaceStructure';

const REPO_URL = 'https://github.com/computor-org/computor-backend.git';
const SPARSE_DIRS = ['computor-types', 'computor-testing'];

export class ComputorTestingInstaller {
  private static instance: ComputorTestingInstaller;
  private outputChannel: vscode.OutputChannel;

  private constructor() {
    this.outputChannel = vscode.window.createOutputChannel('Computor Testing');
  }

  static getInstance(): ComputorTestingInstaller {
    if (!ComputorTestingInstaller.instance) {
      ComputorTestingInstaller.instance = new ComputorTestingInstaller();
    }
    return ComputorTestingInstaller.instance;
  }

  private getToolsDir(): string {
    return WorkspaceStructureManager.getInstance().getToolsPath();
  }

  private getRepoDir(): string {
    return path.join(this.getToolsDir(), 'computor-fullstack');
  }

  private getVenvDir(): string {
    return path.join(this.getRepoDir(), '.venv');
  }

  private getActivatePrefix(): string {
    return `source "${path.join(this.getVenvDir(), 'bin', 'activate')}"`;
  }

  isInstalled(): boolean {
    const computorTestBin = path.join(this.getVenvDir(), 'bin', 'computor-test');
    return fs.existsSync(computorTestBin);
  }

  private log(message: string): void {
    this.outputChannel.appendLine(message);
  }

  async install(): Promise<boolean> {
    if (this.isInstalled()) {
      const action = await vscode.window.showInformationMessage(
        'Computor Testing is already installed. Reinstall?',
        'Reinstall', 'Cancel'
      );
      if (action !== 'Reinstall') { return true; }
    }

    const pythonPath = await this.findPython();
    if (!pythonPath) {
      vscode.window.showErrorMessage('Python 3.10+ is required. Please install Python and try again.');
      return false;
    }

    this.outputChannel.show(true);
    this.log('=== Installing Computor Testing Tools ===\n');

    return vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Installing Computor Testing',
        cancellable: false
      },
      async (progress) => {
        try {
          const toolsDir = this.getToolsDir();
          const repoDir = this.getRepoDir();

          // Step 1: Sparse clone
          progress.report({ message: 'Cloning repository (sparse)...', increment: 0 });
          this.log('Step 1: Sparse clone of computor-backend...');

          if (fs.existsSync(repoDir)) {
            this.log('  Removing existing directory...');
            fs.rmSync(repoDir, { recursive: true, force: true });
          }
          fs.mkdirSync(toolsDir, { recursive: true });

          await this.exec(
            `git clone --filter=blob:none --sparse "${REPO_URL}" "${repoDir}"`,
            toolsDir
          );
          await this.exec(
            `git sparse-checkout set ${SPARSE_DIRS.join(' ')}`,
            repoDir
          );
          this.log('  Clone complete.\n');

          // Step 2: Create venv
          progress.report({ message: 'Creating virtual environment...', increment: 30 });
          this.log('Step 2: Creating virtual environment...');
          await this.exec(`"${pythonPath}" -m venv .venv`, repoDir);
          this.log('  Virtual environment created.\n');

          // Step 3: Install packages
          progress.report({ message: 'Installing computor-types...', increment: 20 });
          this.log('Step 3: Installing computor-types...');
          await this.exec(
            `${this.getActivatePrefix()} && pip install computor-types/`,
            repoDir,
            120_000
          );
          this.log('  computor-types installed.\n');

          progress.report({ message: 'Installing computor-testing...', increment: 20 });
          this.log('Step 4: Installing computor-testing...');
          await this.exec(
            `${this.getActivatePrefix()} && pip install computor-testing/`,
            repoDir,
            120_000
          );
          this.log('  computor-testing installed.\n');

          // Step 4: Verify
          progress.report({ message: 'Verifying installation...', increment: 20 });
          this.log('Step 5: Verifying installation...');
          const { stdout: version } = await this.exec(
            `${this.getActivatePrefix()} && computor-test --version`,
            repoDir
          );
          this.log(`  Version: ${version.trim()}`);

          this.log('\n=== Installation complete! ===');
          vscode.window.showInformationMessage('Computor Testing installed successfully.');
          return true;
        } catch (error) {
          this.log(`\n=== Installation failed ===\n${error}`);
          vscode.window.showErrorMessage(`Installation failed: ${error}`);
          return false;
        }
      }
    );
  }

  async update(): Promise<boolean> {
    if (!this.isInstalled()) {
      vscode.window.showErrorMessage('Computor Testing is not installed. Install it first.');
      return false;
    }

    this.outputChannel.show(true);
    this.log('=== Updating Computor Testing Tools ===\n');

    return vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Updating Computor Testing',
        cancellable: false
      },
      async (progress) => {
        try {
          const repoDir = this.getRepoDir();

          progress.report({ message: 'Pulling latest changes...', increment: 0 });
          this.log('Step 1: Pulling latest changes...');
          await this.exec('git pull', repoDir);
          this.log('  Pull complete.\n');

          progress.report({ message: 'Reinstalling computor-types...', increment: 30 });
          this.log('Step 2: Reinstalling computor-types...');
          await this.exec(
            `${this.getActivatePrefix()} && pip install computor-types/`,
            repoDir,
            120_000
          );

          progress.report({ message: 'Reinstalling computor-testing...', increment: 30 });
          this.log('Step 3: Reinstalling computor-testing...');
          await this.exec(
            `${this.getActivatePrefix()} && pip install computor-testing/`,
            repoDir,
            120_000
          );

          progress.report({ message: 'Verifying...', increment: 30 });
          const { stdout: version } = await this.exec(
            `${this.getActivatePrefix()} && computor-test --version`,
            repoDir
          );
          this.log(`  Version: ${version.trim()}`);

          this.log('\n=== Update complete! ===');
          vscode.window.showInformationMessage('Computor Testing updated successfully.');
          return true;
        } catch (error) {
          this.log(`\n=== Update failed ===\n${error}`);
          vscode.window.showErrorMessage(`Update failed: ${error}`);
          return false;
        }
      }
    );
  }

  async runTests(exampleDir: string): Promise<void> {
    if (!this.isInstalled()) {
      const action = await vscode.window.showWarningMessage(
        'Computor Testing is not installed. Install it now?',
        'Install', 'Cancel'
      );
      if (action !== 'Install') { return; }
      const success = await this.install();
      if (!success) { return; }
    }

    const language = this.readTestYamlLanguage(exampleDir);
    if (!language) {
      vscode.window.showErrorMessage('Could not determine language from test.yaml. Make sure test.yaml exists and has a "type" field.');
      return;
    }

    const target = await this.pickTestTarget(exampleDir);
    if (!target) { return; }

    const tmpDir = this.createTestRunDir(exampleDir, target);

    const command = `computor-test ${language} run -T test.yaml`;

    const terminal = vscode.window.createTerminal({
      name: 'Computor Test',
      cwd: tmpDir,
      env: {
        PATH: `${path.join(this.getVenvDir(), 'bin')}:${process.env['PATH'] || ''}`,
        VIRTUAL_ENV: this.getVenvDir()
      }
    });
    terminal.show();
    terminal.sendText(command);
  }

  private createTestRunDir(exampleDir: string, target: string): string {
    const dirs = WorkspaceStructureManager.getInstance().getDirectories();
    const exampleName = path.basename(exampleDir);
    const tmpDir = path.join(dirs.tmp, `test-run-${exampleName}`);

    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
    fs.cpSync(exampleDir, tmpDir, { recursive: true });

    if (target !== '.') {
      const targetSourceDir = path.join(exampleDir, target);
      const entries = fs.readdirSync(targetSourceDir);
      for (const entry of entries) {
        fs.cpSync(
          path.join(targetSourceDir, entry),
          path.join(tmpDir, entry),
          { recursive: true, force: true }
        );
      }
    }

    return tmpDir;
  }

  private readTestYamlLanguage(exampleDir: string): string | undefined {
    const testYamlPath = path.join(exampleDir, 'test.yaml');
    if (!fs.existsSync(testYamlPath)) { return undefined; }
    try {
      const yaml = require('js-yaml');
      const content = fs.readFileSync(testYamlPath, 'utf8');
      const data = yaml.load(content) as Record<string, unknown>;
      return typeof data?.type === 'string' ? data.type : undefined;
    } catch {
      return undefined;
    }
  }

  private async pickTestTarget(exampleDir: string): Promise<string | undefined> {
    const items: vscode.QuickPickItem[] = [
      { label: 'Example Root', description: 'Run tests against files in the example directory', detail: '.' }
    ];

    const localTestsDir = path.join(exampleDir, 'localTests');
    if (fs.existsSync(localTestsDir)) {
      try {
        const entries = fs.readdirSync(localTestsDir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory()) {
            items.push({
              label: entry.name,
              description: `localTests/${entry.name}`,
              detail: `localTests/${entry.name}`
            });
          }
        }
      } catch {
        // ignore read errors
      }
    }

    if (items.length === 1) {
      return items[0]!.detail;
    }

    const picked = await vscode.window.showQuickPick(items, {
      placeHolder: 'Select test target'
    });
    return picked?.detail;
  }

  async uninstall(): Promise<void> {
    const toolsDir = this.getToolsDir();
    if (!fs.existsSync(toolsDir)) {
      vscode.window.showInformationMessage('Computor Testing is not installed.');
      return;
    }

    const action = await vscode.window.showWarningMessage(
      'Remove Computor Testing tools? This will delete the .computor-tools directory.',
      'Remove', 'Cancel'
    );
    if (action !== 'Remove') { return; }

    fs.rmSync(toolsDir, { recursive: true, force: true });
    vscode.window.showInformationMessage('Computor Testing tools removed.');
  }

  private async exec(
    command: string,
    cwd: string,
    timeout = 60_000
  ): Promise<{ stdout: string; stderr: string }> {
    this.log(`  $ ${command}`);
    const result = await execAsync(command, {
      cwd,
      timeout,
      shell: '/bin/bash',
      maxBuffer: 10 * 1024 * 1024
    });
    if (result.stdout.trim()) {
      this.log(`  ${result.stdout.trim()}`);
    }
    if (result.stderr.trim()) {
      this.log(`  ${result.stderr.trim()}`);
    }
    return result;
  }

  private async findPython(): Promise<string | undefined> {
    const candidates = [
      'python3.13', 'python3.12', 'python3.11', 'python3.10',
      'python3', 'python'
    ];

    let bestCmd: string | undefined;
    let bestMinor = -1;

    for (const cmd of candidates) {
      try {
        const { stdout } = await execAsync(`${cmd} --version`);
        const match = stdout.trim().match(/Python (\d+)\.(\d+)/);
        if (match) {
          const major = parseInt(match[1]!, 10);
          const minor = parseInt(match[2]!, 10);
          if (major >= 3 && minor >= 10 && minor > bestMinor) {
            bestCmd = cmd;
            bestMinor = minor;
            this.log(`Found ${stdout.trim()} at ${cmd}`);
          }
        }
      } catch {
        continue;
      }
    }

    return bestCmd;
  }
}
