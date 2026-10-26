import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

import { StudentCommands } from '../../src/commands/StudentCommands';
import { HttpError } from '../../src/exceptions/errors/HttpError';
import { setUiProfileLanguage } from '../../src/utils/uiLanguage';
import { isSubmittablePath } from '../../src/utils/submittableFiles';

// "Aufgabe testen" on an untouched assignment answered "Es gibt noch nichts
// abzugeben ... gib sie dann ab": the pre-flight counted the non-empty README
// and media as work, the upload went out, and the backend's SUBMIT_014 was shown
// in submit wording. The backend drops README, media and hidden files before it
// looks for content, so the pre-flight must too, and a test must speak of testing.

describe('isSubmittablePath mirrors what the backend keeps', () => {
  it('keeps solution files', () => {
    expect(isSubmittablePath('basis2.py')).to.equal(true);
    expect(isSubmittablePath('src/solution.m')).to.equal(true);
  });

  it('drops README, media, hidden and cache files', () => {
    for (const p of ['README_de.md', 'README.md', 'readme.txt', 'mediaFiles/plot.png',
      'media/a.png', '.vscode/settings.json', '.gitignore', '__pycache__/x.pyc',
      'notes.bak', 'x.py~', 'tool.exe']) {
      expect(isSubmittablePath(p), p).to.equal(false);
    }
  });
});

describe('Test Assignment with nothing to test', () => {
  let dir: string;
  let handlers: Map<string, (...args: any[]) => any>;
  let warnings: string[];
  let errors: string[];
  let uploads: number;
  let uploadError: Error | undefined;
  const original: Record<string, any> = {};

  const item = () => ({
    courseContent: { id: 'cc-1', path: 'w1.basis2', title: 'Einfacher Plot', directory: dir },
    submissionGroup: { id: 'sg-1' }
  });

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-empty-'));
    fs.writeFileSync(path.join(dir, 'basis2.py'), '');
    fs.writeFileSync(path.join(dir, 'README_de.md'), '# Einfacher Plot\n\nAufgabentext.\n');
    fs.mkdirSync(path.join(dir, 'mediaFiles'));
    fs.writeFileSync(path.join(dir, 'mediaFiles', 'plot.png'), 'not really a png');

    handlers = new Map();
    warnings = [];
    errors = [];
    uploads = 0;
    uploadError = undefined;

    original.register = vscode.commands.registerCommand;
    original.warning = vscode.window.showWarningMessage;
    original.error = vscode.window.showErrorMessage;
    original.withProgress = (vscode.window as any).withProgress;
    original.textDocuments = (vscode.workspace as any).textDocuments;

    (vscode.commands as any).registerCommand = (id: string, handler: any) => {
      handlers.set(id, handler);
      return { dispose() {} };
    };
    (vscode.window as any).showWarningMessage = async (message: string) => { warnings.push(message); };
    (vscode.window as any).showErrorMessage = async (message: string) => { errors.push(message); };
    (vscode.window as any).withProgress = async (_opts: any, task: any) => task({ report() {} });
    (vscode.workspace as any).textDocuments = [];

    const student = Object.create(StudentCommands.prototype) as any;
    student.context = { subscriptions: [] };
    student.apiService = {
      listStudentSubmissionArtifacts: async () => [],
      createStudentSubmission: async () => {
        uploads += 1;
        if (uploadError) { throw uploadError; }
        return { artifacts: ['a-1'] };
      }
    };
    student.gitService = {
      hasChanges: async () => false,
      getLatestCommitHash: async () => 'commit-1'
    };
    student.testResultService = {
      submitTestByArtifactAndAwaitResults: async () => { throw new Error('test run must not start'); }
    };
    student.registerCommands();
  });

  afterEach(() => {
    (vscode.commands as any).registerCommand = original.register;
    (vscode.window as any).showWarningMessage = original.warning;
    (vscode.window as any).showErrorMessage = original.error;
    (vscode.window as any).withProgress = original.withProgress;
    (vscode.workspace as any).textDocuments = original.textDocuments;
    setUiProfileLanguage(undefined);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('answers in test wording without uploading, although README and media are not empty', async () => {
    setUiProfileLanguage('de');
    await handlers.get('computor.student.testAssignment')!(item());

    expect(uploads).to.equal(0);
    expect(errors).to.deep.equal([]);
    expect(warnings).to.have.length(1);
    expect(warnings[0]).to.contain('nichts zu testen');
    expect(warnings[0]).to.contain('teste sie dann');
    expect(warnings[0]).not.to.contain('abzugeben');
  });

  it('says the same in English', async () => {
    setUiProfileLanguage('en');
    await handlers.get('computor.student.testAssignment')!(item());

    expect(uploads).to.equal(0);
    expect(warnings[0]).to.match(/^Nothing to test yet/);
    expect(warnings[0]).not.to.match(/submit/i);
  });

  it('turns a backend SUBMIT_014 on the test upload into test wording', async () => {
    // A file the client counts but the server drops (or a rule that drifted)
    // still reaches the backend; its refusal must not talk about submitting.
    fs.writeFileSync(path.join(dir, 'basis2.py'), 'x_start = -3\n');
    uploadError = new HttpError('Bad Request', 400, 'Bad Request', {
      error_code: 'SUBMIT_014',
      detail: 'Your submission contains no submittable files. Write your solution in the provided files, then submit again.'
    });
    setUiProfileLanguage('de');
    await handlers.get('computor.student.testAssignment')!(item());

    expect(uploads).to.equal(1);
    expect(errors).to.deep.equal([]);
    expect(warnings).to.have.length(1);
    expect(warnings[0]).to.contain('nichts zu testen');
    expect(warnings[0]).not.to.contain('abzugeben');
  });
});
