import { expect } from 'chai';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { parse } from 'jsonc-parser';
import { readingLanguage } from '../../src/services/WorkspaceCourseLanding';
import { collectWelcomeFacts } from '../../src/ui/webviews/welcome/welcomeContent';
import { descriptionInLanguage } from '../../src/utils/contentLanguage';
import { WorkspaceLaunchContext } from '../../src/services/WorkspaceLaunchContextService';
import { WorkspaceDisplayLocale, workspaceLocaleFile, withDisplayLocale } from '../../src/services/WorkspaceDisplayLocale';
import { uiLanguage } from '../../src/utils/uiLanguage';

describe('WorkspaceDisplayLocale', () => {
  let directory: string;
  let argvFile: string;
  let language: string | undefined;
  let launch: WorkspaceLaunchContext | null;
  let effective: string | undefined;
  let reloads: number;
  let calls: number;
  let values: Map<string, unknown>;
  const services: WorkspaceDisplayLocale[] = [];

  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'computor-locale-'));
    argvFile = path.join(directory, 'argv.json');
    language = 'de';
    launch = null;
    effective = undefined;
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
    expect([...values.values()]).to.deep.include({ locale: 'de', display: 'en-US' });
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

  it('uses the web launch language for Automatic in this activation only, without storing it', async () => {
    language = '';
    launch = context('de');
    const first = service('en');
    await first.poll();
    expect(parse(await fs.readFile(argvFile, 'utf8')).locale).to.equal('de');
    expect(reloads).to.equal(1);
    expect(uiLanguage()).to.equal('de');
    launch = null;
    await first.poll(); // An expired context does not flip this activation back.
    expect(uiLanguage()).to.equal('de');
    first.dispose();
    await service('de').poll();
    expect(reloads).to.equal(1);
    expect([...values.keys()]).to.deep.equal(['computor.workspaceDisplayLocale.reloadAttempt']);
    expect(uiLanguage()).to.equal('en'); // The stub's display language: no stored launch language.
  });

  it('forgets the launch language that earlier versions stored', async () => {
    language = '';
    values.set('computor.workspaceDisplayLocale.launchLanguage', 'de');
    await service('en').poll();
    expect(values.get('computor.workspaceDisplayLocale.launchLanguage')).to.equal(undefined);
    expect(reloads).to.equal(0);
    let exists = true;
    try { await fs.access(argvFile); } catch { exists = false; }
    expect(exists).to.equal(false);
    expect(uiLanguage()).to.equal('en');
  });

  it('tries a failed reload again once the display language has changed since', async () => {
    values.set('computor.workspaceDisplayLocale.reloadAttempt', 'de'); // as earlier versions stored it
    await service('en').poll();
    expect(reloads).to.equal(1);
    await service('en').poll();
    expect(reloads).to.equal(1);
    await service('fr').poll();
    expect(reloads).to.equal(2);
    await service('fr').poll();
    expect(reloads).to.equal(2);
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
    expect(uiLanguage()).to.equal('en');
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
      getUserAccount: async () => ({ profile: { language_code: language }, effective_language: effective }),
      getCourse: async () => ({ title: 'Course', language_code: courseLanguage }),
      getUserViews: async () => ['student'],
      getStudentCourses: async () => [],
      getTutorCourses: async () => [],
      getLecturerCourses: async () => [],
      getInstanceInfo: async () => undefined,
      getStudentCourseContents: async () => []
    };
    const languages = [
      await readingLanguage(api),
      (await collectWelcomeFacts(api, 'course-1')).language
    ];
    expect(languages).to.deep.equal([expected, expected]);
    for (const selected of languages) {
      expect(descriptionInLanguage('<!-- lang: de -->\nDeutsch\n<!-- lang: en -->\nEnglish', selected!))
        .to.equal(expected === 'de' ? 'Deutsch' : 'English');
    }
  }

  for (const target of ['de', 'en'] as const) {
    const opposite = target === 'de' ? 'en' : 'de';
    it(`uses shared ${target} launch language for a new Automatic reader and the display language after the reload`, async () => {
      language = '';
      effective = opposite; // what the backend derives from the workspace's display language
      launch = context(target);
      const first = service(opposite);
      await first.poll();
      await assertReadingLanguage(target, opposite);
      first.dispose();
      launch = null;
      effective = target; // the reload switched the display language
      await service(target).poll();
      await assertReadingLanguage(target, opposite);
    });

    it(`keeps explicit ${target} ahead of the opposite launch and course for every reader`, async () => {
      language = target;
      launch = context(opposite);
      await service(target).poll();
      await assertReadingLanguage(target, opposite);
    });

    it(`never reads a ${target} course in its own language against the ${opposite} reading language`, async () => {
      language = '';
      effective = opposite;
      await assertReadingLanguage(opposite, target);
      language = target;
      await assertReadingLanguage(target, opposite);
    });
    // Start and open from the workspace list names no course; the launch
    // still carries the browser's language, against the workspace's own.
    it(`switches the editor and welcome page to ${target} for a launch without a course`, async () => {
      language = '';
      effective = opposite; // derived from the workspace's display language
      launch = { request_id: 'language-only', expires_at: new Date(Date.now() + 60000).toISOString(), ui_language: target };
      await service(opposite).poll();
      expect(parse(await fs.readFile(argvFile, 'utf8')).locale).to.equal(target);
      expect(reloads).to.equal(1);
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
