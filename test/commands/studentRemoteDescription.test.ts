import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import JSZip from 'jszip';

import { StudentCommands } from '../../src/commands/StudentCommands';
import { CourseSelectionService } from '../../src/services/CourseSelectionService';
import * as markdownPreview from '../../src/ui/webviews/markdownPreview';

type Handler = (...args: any[]) => Promise<unknown>;

async function archive(files: Record<string, string | Buffer>): Promise<Buffer> {
  const zip = new JSZip();
  for (const [name, content] of Object.entries(files)) zip.file(name, content);
  return zip.generateAsync({ type: 'nodebuffer' });
}

function assignment(id: string, extra: Record<string, unknown> = {}): any {
  return {
    id, title: `Exercise ${id}`, path: `course.${id}`,
    course_content_kind_id: 'assignment', visible_effective: true,
    deployment: { deployment_status: 'deployed' }, ...extra
  };
}

describe('Student description commands before cloning an assignment', () => {
  let root: string;
  let handlers: Map<string, Handler>;
  let downloads: string[];
  let archives: Map<string, Buffer>;
  let rendered: Array<{ text: string; title: string; options: any }>;
  let localPreviews: string[];
  let notices: string[];
  let quickPicks: any[][];
  let pickedLabel: string | undefined;
  let contents: any[];
  let preferredLanguage: string | undefined;
  let courseLanguage: string | undefined;
  let original: Record<string, any>;
  let provisioningCalls: number;
  let studentCommands: StudentCommands;
  let localOptions: any[];

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'computor-remote-readme-'));
    handlers = new Map();
    downloads = [];
    archives = new Map();
    rendered = [];
    localPreviews = [];
    notices = [];
    quickPicks = [];
    pickedLabel = undefined;
    contents = [];
    preferredLanguage = 'de';
    courseLanguage = 'en';
    provisioningCalls = 0;
    localOptions = [];
    original = {
      registerCommand: vscode.commands.registerCommand,
      showQuickPick: vscode.window.showQuickPick,
      showInformationMessage: vscode.window.showInformationMessage,
      showWarningMessage: vscode.window.showWarningMessage,
      showErrorMessage: vscode.window.showErrorMessage,
      activeTextEditor: Object.getOwnPropertyDescriptor(vscode.window, 'activeTextEditor'),
      getInstance: CourseSelectionService.getInstance,
      showMarkdownPreview: markdownPreview.showMarkdownPreview,
      showMarkdownTextPreview: markdownPreview.showMarkdownTextPreview
    };
    (vscode.commands as any).registerCommand = (id: string, handler: Handler) => {
      handlers.set(id, handler);
      return { dispose() {} };
    };
    (vscode.window as any).activeTextEditor = undefined;
    (vscode.window as any).showQuickPick = async (items: any[] | Promise<any[]>) => {
      const choices = await items;
      quickPicks.push(choices);
      return choices.find(item => item.label === pickedLabel);
    };
    for (const method of ['showInformationMessage', 'showWarningMessage', 'showErrorMessage']) {
      (vscode.window as any)[method] = async (message: string) => {
        notices.push(message);
        return undefined;
      };
    }
    (CourseSelectionService as any).getInstance = () => ({ getCurrentCourseId: () => 'selected-course' });
    (markdownPreview as any).showMarkdownPreview = async (_context: any, file: string, options: any) => {
      localPreviews.push(file);
      localOptions.push(options);
    };
    (markdownPreview as any).showMarkdownTextPreview = async (_context: any, text: string, title: string, options: any) => {
      rendered.push({ text, title, options });
    };

    const commands = Object.create(StudentCommands.prototype) as any;
    studentCommands = commands;
    commands.context = { subscriptions: [], extensionUri: vscode.Uri.file(root) };
    commands.apiService = {
      getUserAccount: async () => ({ profile: { language_code: preferredLanguage } }),
      getCourse: async () => ({ language_code: courseLanguage }),
      getStudentCourseContents: async (courseId: string) => {
        expect(courseId).to.equal('selected-course');
        return contents;
      },
      getLanguages: async () => [
        { code: 'en', name: 'English', native_name: 'English' },
        { code: 'de', name: 'German', native_name: 'Deutsch' }
      ],
      downloadStudentCourseContentDescription: async (id: string) => {
        downloads.push(id);
        const bytes = archives.get(id);
        if (!bytes) throw new Error(`Unexpected description download: ${id}`);
        return bytes;
      }
    };
    commands.provisioningService = new Proxy({}, {
      get: () => () => {
        provisioningCalls++;
        throw new Error('Reading a description must not provision a repository');
      }
    });
    commands.registerCommands();
  });

  afterEach(() => {
    (vscode.commands as any).registerCommand = original.registerCommand;
    for (const method of ['showQuickPick', 'showInformationMessage', 'showWarningMessage', 'showErrorMessage']) {
      (vscode.window as any)[method] = original[method];
    }
    if (original.activeTextEditor) {
      Object.defineProperty(vscode.window, 'activeTextEditor', original.activeTextEditor);
    } else {
      delete (vscode.window as any).activeTextEditor;
    }
    (CourseSelectionService as any).getInstance = original.getInstance;
    (markdownPreview as any).showMarkdownPreview = original.showMarkdownPreview;
    (markdownPreview as any).showMarkdownTextPreview = original.showMarkdownTextPreview;
    fs.rmSync(root, { recursive: true, force: true });
    expect(provisioningCalls).to.equal(0);
  });

  async function run(command: string, item?: any): Promise<void> {
    const handler = handlers.get(command);
    expect(handler, `${command} is registered`).to.be.a('function');
    await handler!(item);
  }

  it('previews a remote assignment in the profile language without a local directory', async () => {
    archives.set('remote', await archive({
      'README.md': '# Default', 'README_en.md': '# English', 'README_de.md': '# Deutsch',
      'figures/example.png': Buffer.from([137, 80, 78, 71])
    }));

    await run('computor.student.showPreview', { courseContent: assignment('remote') });

    expect(downloads).to.deep.equal(['remote']);
    expect(localPreviews).to.be.empty;
    expect(rendered).to.have.lengthOf(1);
    expect(rendered[0]!.text).to.equal('# Deutsch');
    expect(rendered[0]!.options.inlineImages['figures/example.png']).to.equal('data:image/png;base64,iVBORw==');
    expect(notices).to.be.empty;
  });

  it('previews the selected exercise README remotely with images, tree focus and cancellation options', async () => {
    archives.set('selected', await archive({ 'README_de.md': '# Selected exercise', 'image.png': Buffer.from([137, 80]) }));
    const isCurrent = () => true;
    await studentCommands.previewDescription({ courseContent: assignment('selected') }, {
      silent: true, preserveFocus: true, isCurrent
    });
    expect(downloads).to.deep.equal(['selected']);
    expect(rendered[0]!.text).to.equal('# Selected exercise');
    expect(rendered[0]!.options).to.include({ preserveFocus: true, isCurrent });
    expect(rendered[0]!.options.inlineImages).to.have.property('image.png');
    expect(notices).to.be.empty;
  });

  it('keeps a selected exercise local README authoritative and preserves tree focus', async () => {
    fs.writeFileSync(path.join(root, 'README_de.md'), '# Local selected exercise');
    await studentCommands.previewDescription({ courseContent: assignment('selected', { directory: root }) }, {
      silent: true, preserveFocus: true
    });
    expect(localPreviews).to.deep.equal([path.join(root, 'README_de.md')]);
    expect(localOptions[0]).to.include({ preserveFocus: true });
    expect(downloads).to.be.empty;
    expect(notices).to.be.empty;
  });

  it('keeps selection of an exercise without released instructions silent', async () => {
    (studentCommands as any).apiService.downloadStudentCourseContentDescription = async () => undefined;
    await studentCommands.previewDescription({ courseContent: assignment('empty') }, { silent: true });
    expect(rendered).to.be.empty;
    expect(notices).to.be.empty;
    await run('computor.student.showPreview', { courseContent: assignment('empty') });
    expect(notices).to.deep.equal(['This assignment has no published description.']);
  });

  it('discards an exercise download if another row was selected before it finished', async () => {
    let finish!: (bytes: Buffer) => void;
    let current = true;
    (studentCommands as any).apiService.downloadStudentCourseContentDescription = async () =>
      new Promise<Buffer>(resolve => { finish = resolve; });
    const pending = studentCommands.previewDescription({ courseContent: assignment('late') }, {
      silent: true, preserveFocus: true, isCurrent: () => current
    });
    current = false;
    finish(await archive({ 'README.md': '# Old exercise' }));
    await pending;
    expect(rendered).to.be.empty;
    expect(notices).to.be.empty;
  });

  it('falls back to the remote description when the stored assignment directory no longer exists', async () => {
    archives.set('remote', await archive({ 'index_de.md': '# Remote instructions' }));

    await run('computor.student.showPreview', {
      courseContent: assignment('remote', { directory: path.join(root, 'missing') })
    });

    expect(downloads).to.deep.equal(['remote']);
    expect(rendered.map(preview => preview.text)).to.deep.equal(['# Remote instructions']);
    expect(notices).to.be.empty;
  });

  it('keeps a local README authoritative instead of downloading the released copy', async () => {
    fs.writeFileSync(path.join(root, 'README_de.md'), '# Edited locally');

    await run('computor.student.showPreview', { courseContent: assignment('local', { directory: root }) });

    expect(localPreviews).to.deep.equal([path.join(root, 'README_de.md')]);
    expect(downloads).to.be.empty;
    expect(rendered).to.be.empty;
    expect(notices).to.be.empty;
  });

  it('loads the released description if a local checkout contains no README', async () => {
    fs.writeFileSync(path.join(root, 'main.py'), 'print(1)');
    archives.set('remote', await archive({ 'README_de.md': '# Instructions' }));

    await run('computor.student.showPreview', { courseContent: assignment('remote', { directory: root }) });

    expect(downloads).to.deep.equal(['remote']);
    expect(rendered.map(preview => preview.text)).to.deep.equal(['# Instructions']);
    expect(localPreviews).to.be.empty;
    expect(notices).to.be.empty;
  });

  it('offers visible released assignments and downloads only the selected description', async () => {
    contents = [
      assignment('deployed'),
      assignment('older-release', { deployment: { deployment_status: 'pending', deployed_at: '2026-10-01T00:00:00Z' } }),
      assignment('local', { deployment: undefined, directory: root }),
      assignment('hidden', { visible_effective: false }),
      assignment('module', { course_content_kind_id: 'unit', directory: root }),
      assignment('unreleased', { has_deployment: true, deployment: { deployment_status: 'pending', deployed_at: null } })
    ];
    archives.set('older-release', await archive({ 'README_de.md': '# Selected exercise' }));
    pickedLabel = 'Exercise older-release';

    await run('computor.student.showPreview');

    expect(quickPicks).to.have.lengthOf(1);
    expect(quickPicks[0]!.map(item => item.label)).to.have.members([
      'Exercise deployed', 'Exercise older-release', 'Exercise local'
    ]);
    expect(downloads).to.deep.equal(['older-release']);
    expect(rendered.map(preview => preview.text)).to.deep.equal(['# Selected exercise']);
    expect(notices).to.be.empty;
  });

  it('does not download descriptions if the assignment picker is canceled', async () => {
    contents = [assignment('one'), assignment('two')];

    await run('computor.student.showPreview');

    expect(quickPicks).to.have.lengthOf(1);
    expect(downloads).to.be.empty;
    expect(rendered).to.be.empty;
    expect(localPreviews).to.be.empty;
    expect(notices).to.be.empty;
  });

  it('uses readable language names for remote README and index translations', async () => {
    archives.set('remote', await archive({
      'README.md': '# Original', 'README_en.md': '# English', 'index_de.md': '# Deutsch',
      'figures/example.png': Buffer.from([137, 80, 78, 71])
    }));
    pickedLabel = 'German (Deutsch)';

    await run('computor.student.previewDescriptionLanguage', { courseContent: assignment('remote') });

    expect(quickPicks[0]!.map(item => item.label)).to.have.members(['English', 'German (Deutsch)', 'Default']);
    expect(rendered).to.have.lengthOf(1);
    expect(rendered[0]!.text).to.equal('# Deutsch');
    expect(rendered[0]!.options.inlineImages['figures/example.png']).to.equal('data:image/png;base64,iVBORw==');
    expect(downloads).to.deep.equal(['remote']);
    expect(notices).to.be.empty;
  });

  it('selects the unsuffixed description explicitly when Default is chosen', async () => {
    archives.set('remote', await archive({ 'README.md': '# Original', 'README_en.md': '# English' }));
    pickedLabel = 'Default';

    await run('computor.student.previewDescriptionLanguage', { courseContent: assignment('remote') });

    expect(rendered.map(preview => preview.text)).to.deep.equal(['# Original']);
    expect(notices).to.be.empty;
  });

  it('does not render a remote description when its language picker is canceled', async () => {
    archives.set('remote', await archive({ 'README.md': '# Original', 'index_de.md': '# Deutsch' }));

    await run('computor.student.previewDescriptionLanguage', { courseContent: assignment('remote') });

    expect(quickPicks).to.have.lengthOf(1);
    expect(rendered).to.be.empty;
    expect(localPreviews).to.be.empty;
    expect(notices).to.be.empty;
  });

  it('keeps local translations authoritative in the language picker', async () => {
    fs.writeFileSync(path.join(root, 'README.md'), '# Local default');
    fs.writeFileSync(path.join(root, 'README_en.md'), '# Local English');
    pickedLabel = 'Default';

    await run('computor.student.previewDescriptionLanguage', {
      courseContent: assignment('local', { directory: root })
    });

    expect(localPreviews).to.deep.equal([path.join(root, 'README.md')]);
    expect(downloads).to.be.empty;
    expect(rendered).to.be.empty;
    expect(notices).to.be.empty;
  });
});
