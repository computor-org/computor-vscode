import { expect } from 'chai';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { parse } from 'jsonc-parser';
import { readingLanguage } from '../../src/services/WorkspaceCourseLanding';
import { StudentCommands } from '../../src/commands/StudentCommands';
import { collectWelcomeFacts } from '../../src/ui/webviews/welcome/welcomeContent';
import { descriptionInLanguage } from '../../src/utils/contentLanguage';
import { WorkspaceLaunchContext } from '../../src/services/WorkspaceLaunchContextService';
import { WorkspaceDisplayLocale, workspaceLocaleFile, withDisplayLocale } from '../../src/services/WorkspaceDisplayLocale';

describe('WorkspaceDisplayLocale', () => {
  let directory: string;
  let argvFile: string;
  let language: string | undefined;
  let launch: WorkspaceLaunchContext | null;
  let resolved: (string | null | undefined)[];
  let reloads: number;
  let calls: number;
  let values: Map<string, unknown>;
  const services: WorkspaceDisplayLocale[] = [];

  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'computor-locale-'));
    argvFile = path.join(directory, 'argv.json');
    language = 'de';
    launch = null;
    resolved = [];
    reloads = 0;
    calls = 0;
    values = new Map();
  });

  afterEach(async () => {
    for (const service of services.splice(0)) service.dispose();
    await fs.rm(directory, { recursive: true, force: true });
  });

  function service(displayLanguage = 'en', fetchLanguage = async () => { calls++; return language; }): WorkspaceDisplayLocale {
    const instance = new WorkspaceDisplayLocale({
      argvFile, displayLanguage, fetchLanguage,
      fetchLaunchContext: async () => launch,
      onLanguage: value => { resolved.push(value); },
      state: {
        get: <T>(key: string) => values.get(key) as T | undefined,
        update: async (key, value) => { values.set(key, value); }
      },
      reload: async () => { reloads++; }
    });
    services.push(instance);
    return instance;
  }

  it('only resolves the settings file in a marked browser workspace', () => {
    const storage = { scheme: 'file', fsPath: '/data/code-server-test/User/globalStorage/computor.computor' };
    expect(workspaceLocaleFile('true', true, storage)).to.equal('/data/code-server-test/User/argv.json');
    expect(workspaceLocaleFile(undefined, true, storage)).to.equal(undefined);
    expect(workspaceLocaleFile('true', false, storage)).to.equal(undefined);
    expect(workspaceLocaleFile('true', true, { ...storage, scheme: 'vscode-userdata' })).to.equal(undefined);
    expect(workspaceLocaleFile('true', true, { ...storage, fsPath: '/unexpected/computor' })).to.equal(undefined);
  });

  it('preserves JSONC comments, unrelated settings and Windows line endings', () => {
    const text = '{\r\n  // keep this\r\n  "locale": "en",\r\n  "disable-hardware-acceleration": true,\r\n}\r\n';
    const updated = withDisplayLocale(text, 'de');
    expect(updated).to.equal(text.replace('"en"', '"de"'));
    expect(parse(updated)).to.deep.equal({ locale: 'de', 'disable-hardware-acceleration': true });
    expect(() => withDisplayLocale('{ "locale": ', 'de')).to.throw();
    expect(() => withDisplayLocale('[]', 'de')).to.throw();
  });

  it('creates the explicit profile locale and reloads when the editor differs', async () => {
    language = 'de-AT';
    await service('en-US').poll();
    expect(parse(await fs.readFile(argvFile, 'utf8')).locale).to.equal('de');
    expect(reloads).to.equal(1);
    expect([...values.values()]).to.contain('de');
  });

  it('persists English ahead of a German browser even when the editor already uses English', async () => {
    language = 'en';
    await service('en').poll();
    expect(parse(await fs.readFile(argvFile, 'utf8')).locale).to.equal('en');
    expect(reloads).to.equal(0);
  });

  it('never repeats an unsuccessful reload across polling or activation', async () => {
    const first = service('en');
    await first.poll();
    await first.poll();
    first.dispose();
    await service('en').poll();
    expect(reloads).to.equal(1);
    expect(calls).to.equal(3);
  });

  it('applies a preference changed while running and allows a later switch back', async () => {
    const first = service('en');
    await first.poll(); // requests German
    const german = service('de');
    await german.poll(); // successful reload clears the failed-attempt guard
    language = 'en';
    await german.poll();
    expect(parse(await fs.readFile(argvFile, 'utf8')).locale).to.equal('en');
    expect(reloads).to.equal(2);
    const english = service('en');
    await english.poll();
    language = 'de';
    await english.poll();
    expect(reloads).to.equal(3);
  });

  it('does not overwrite an editor preference without a supported profile language', async () => {
    const text = '{ "locale": "fr", "other": true }';
    await fs.writeFile(argvFile, text);
    const instance = service();
    for (language of [undefined, '', 'fr']) await instance.poll();
    expect(await fs.readFile(argvFile, 'utf8')).to.equal(text);
    expect(reloads).to.equal(0);
  });

  function context(uiLanguage: 'de' | 'en', requestId = 'launch-1'): WorkspaceLaunchContext {
    return { course_id: 'course-1', request_id: requestId,
      expires_at: new Date(Date.now() + 60000).toISOString(), ui_language: uiLanguage };
  }

  it('uses the web launch language for Automatic and retains it across reload and context expiry', async () => {
    language = '';
    launch = context('de');
    await service('en').poll();
    expect(parse(await fs.readFile(argvFile, 'utf8')).locale).to.equal('de');
    expect(reloads).to.equal(1);
    launch = null;
    await service('en').poll(); // Failed reload still cannot loop after context expiry.
    expect(reloads).to.equal(1);
    await service('de').poll();
    expect(resolved).to.deep.equal(['de', 'de', 'de']);
    expect(parse(await fs.readFile(argvFile, 'utf8')).locale).to.equal('de');
  });

  it('accepts a later launch language for Automatic without changing the profile preference', async () => {
    language = '';
    launch = context('de');
    const instance = service('de');
    await instance.poll();
    launch = context('en', 'launch-2');
    await instance.poll();
    expect(language).to.equal('');
    expect(reloads).to.equal(1);
    expect(resolved).to.deep.equal(['de', 'en']);
    expect(parse(await fs.readFile(argvFile, 'utf8')).locale).to.equal('en');
  });

  it('keeps an explicit profile first while remembering the latest launch for a later Automatic choice', async () => {
    language = 'de';
    launch = context('en');
    const instance = service('de');
    await instance.poll();
    expect(reloads).to.equal(0);
    expect(parse(await fs.readFile(argvFile, 'utf8')).locale).to.equal('de');
    launch = null;
    language = '';
    await instance.poll();
    expect(reloads).to.equal(1);
    expect(parse(await fs.readFile(argvFile, 'utf8')).locale).to.equal('en');
    language = 'de';
    await service('en').poll();
    expect(reloads).to.equal(2);
    expect(resolved).to.deep.equal(['de', 'en', 'de']);
  });

  it('does not derive Automatic from an expired or malformed launch', async () => {
    language = '';
    launch = { ...context('de'), expires_at: new Date(Date.now() - 1).toISOString() };
    const instance = service();
    await instance.poll();
    launch = { ...context('de'), ui_language: 'fr' } as unknown as WorkspaceLaunchContext;
    await instance.poll();
    expect([...values.values()]).to.deep.equal([]);
    expect(reloads).to.equal(0);
  });

  async function assertReadingLanguage(expected: 'de' | 'en', courseLanguage: string | undefined): Promise<void> {
    const api = {
      getUserAccount: async () => ({ profile: { language_code: language } }),
      getCourse: async () => ({ title: 'Course', language_code: courseLanguage }),
      getUserViews: async () => ['student'],
      getStudentCourses: async () => [],
      getTutorCourses: async () => [],
      getLecturerCourses: async () => [],
      getInstanceInfo: async () => undefined,
      getStudentCourseContents: async () => []
    };
    const commands = Object.create(StudentCommands.prototype) as any;
    commands.apiService = api;
    const languages = [
      await readingLanguage(api as any, 'course-1'),
      await commands.contentLanguage('course-1'),
      (await collectWelcomeFacts(api, 'course-1')).language
    ];
    expect(languages).to.deep.equal([expected, expected, expected]);
    for (const selected of languages) {
      expect(descriptionInLanguage('<!-- lang: de -->\nDeutsch\n<!-- lang: en -->\nEnglish', selected!))
        .to.equal(expected === 'de' ? 'Deutsch' : 'English');
    }
  }

  for (const target of ['de', 'en'] as const) {
    const opposite = target === 'de' ? 'en' : 'de';
    it(`uses shared ${target} launch language for new and returning Automatic readers`, async () => {
      language = '';
      launch = context(target);
      const first = service(opposite);
      await first.poll();
      await assertReadingLanguage(target, opposite);
      first.dispose();
      launch = null;
      await service(target).poll();
      await assertReadingLanguage(target, opposite);
    });

    it(`keeps explicit ${target} ahead of the opposite launch and course for every reader`, async () => {
      language = target;
      launch = context(opposite);
      await service(target).poll();
      await assertReadingLanguage(target, opposite);
    });

    it(`preserves ${target} course fallback without a managed launch and explicit profile precedence`, async () => {
      language = '';
      await assertReadingLanguage(target, target);
      language = target;
      await assertReadingLanguage(target, opposite);
    });
  }

  it('keeps English as the safe default without a profile, launch or course language', async () => {
    language = '';
    await assertReadingLanguage('en', undefined);
  });

  it('awaits an initial in-flight resolution before rendering the course body', async () => {
    language = '';
    launch = context('en');
    let resolve!: (value: string) => void;
    const account = new Promise<string>(done => { resolve = done; });
    const instance = service('de', async () => account);
    const initial = instance.poll();
    let rendered = false;
    const opening = instance.poll().then(async () => {
      await assertReadingLanguage('en', 'de');
      rendered = true;
    });
    await new Promise<void>(done => setImmediate(done));
    expect(rendered).to.equal(false);
    resolve('');
    await Promise.all([initial, opening]);
    expect(rendered).to.equal(true);
    expect(parse(await fs.readFile(argvFile, 'utf8')).locale).to.equal('en');
    expect(reloads).to.equal(1);
  });

  it('does not overlap reads or change settings after disposal during a read', async () => {
    let resolve!: (value: string) => void;
    const result = new Promise<string>(done => { resolve = done; });
    const instance = service('en', async () => { calls++; return result; });
    const pending = instance.poll();
    const overlapping = instance.poll();
    expect(overlapping).to.equal(pending);
    instance.dispose();
    resolve('de');
    await Promise.all([pending, overlapping]);
    await instance.poll();
    expect(calls).to.equal(1);
    expect(reloads).to.equal(0);
    let exists = true;
    try { await fs.access(argvFile); } catch { exists = false; }
    expect(exists).to.equal(false);
  });

  it('leaves malformed settings untouched and does not reload', async () => {
    const text = '{ "locale": "en" broken }';
    await fs.writeFile(argvFile, text);
    await service().poll();
    expect(await fs.readFile(argvFile, 'utf8')).to.equal(text);
    expect(reloads).to.equal(0);
  });
});
