import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';
import { window } from '../helpers/vscode-stub';
import { RETRY_COURSE_SETUP_COMMAND, StudentCourseContentTreeProvider } from '../../src/ui/tree/student/StudentCourseContentTreeProvider';
import { pickUiLanguage, setUiCourseLanguage, setUiProfileLanguage } from '../../src/utils/uiLanguage';
import { workbenchNames } from '../../src/ui/webviews/welcome/welcomeContent';

/**
 * Integration round 1 (N17): Test and Submit only appeared after an assignment
 * had been expanded, a failed repository setup said so only in a hidden
 * English notification naming an internal host, and a screen reader heard the
 * row's tooltip without its title.
 */
describe('student repository setup feedback', () => {
  const win = window as any;
  let warnings: string[];

  beforeEach(() => {
    warnings = [];
    win.withProgress = async (_options: any, task: any) => task({ report() {} }, { isCancellationRequested: false });
    win.showWarningMessage = async (message: string) => { warnings.push(message); return undefined; };
  });
  afterEach(() => {
    delete win.withProgress;
    setUiProfileLanguage(undefined);
    setUiCourseLanguage(undefined);
  });

  function fixture(outcome: any, mode = 'managed') {
    const api = {
      getStudentCourses: async () => [{ id: 'launch', title: 'Kurs', path: 'launch', organization_id: 'org', course_family_id: 'family' }],
      getStudentCourseContents: async () => [],
      getCourseContentKinds: async () => [],
      getCourseGitDescriptor: async () => ({ configured: true, student_repo_modes: [mode] }),
      getCourseRepository: async () => null,
      getOrganization: async () => ({ id: 'org', title: 'Organization', path: 'org' })
    };
    const tree = new StudentCourseContentTreeProvider(api as any, { getCurrentCourseId: () => undefined } as any);
    let setups = 0;
    (tree as any).provisioning = { setUpRepository: async () => { setups++; return outcome; } };
    tree.setWorkspaceCourse('launch');
    return { tree, setups: () => setups };
  }

  async function courseChildren(tree: StudentCourseContentTreeProvider) {
    const roots = await tree.getChildren();
    return tree.getChildren(roots[0]);
  }

  it('sets up the launched course repository once, without waiting for an expansion', async () => {
    const { tree, setups } = fixture({ status: 'cloned', path: '/tmp/repo' });

    await tree.prepareCourseRepository('launch');
    await tree.prepareCourseRepository('launch');

    expect(setups()).to.equal(1);
    expect(warnings).to.deep.equal([]);
  });

  it('leaves external and download courses to the expansion, which may ask the learner', async () => {
    const { tree, setups } = fixture({ status: 'cloned', path: '/tmp/repo' }, 'external');

    await tree.prepareCourseRepository('launch');

    expect(setups()).to.equal(0);
  });

  it('puts a German retry row on top of the course when the git account is missing, without the internal host', async () => {
    setUiProfileLanguage('de');
    const { tree } = fixture({ status: 'forgejo-login-required', repo: { server_url: 'http://computor-git', web_url: null } });

    await tree.prepareCourseRepository('launch');
    const [first] = await courseChildren(tree);

    expect(first!.label).to.equal('Repository fehlt');
    expect(first!.description).to.equal('zum erneuten Versuch klicken');
    expect(first!.command?.command).to.equal(RETRY_COURSE_SETUP_COMMAND);
    expect(first!.command?.arguments).to.deep.equal(['launch']);
    expect(String(first!.tooltip)).to.contain('deshalb fehlen Testen und Abgeben');
    expect(warnings).to.have.length(1);
    expect(warnings[0]).to.contain('Problem melden');
    expect(warnings[0]).to.not.contain('computor-git');
  });

  it('removes the row once a retry succeeds, and speaks English by default', async () => {
    const outcome: any = { status: 'forgejo-login-required', repo: { server_url: 'http://computor-git' } };
    const { tree } = fixture(outcome);
    await tree.prepareCourseRepository('launch');
    expect((await courseChildren(tree))[0]!.label).to.equal('Repository missing');

    outcome.status = 'cloned';
    outcome.path = '/tmp/repo';
    await tree.retryCourseRepository('launch');

    expect((await courseChildren(tree)).map(item => item.id)).to.not.include('setup-problem-launch');
  });
});

describe('student assignment row accessibility', () => {
  afterEach(() => setUiProfileLanguage(undefined));

  function row(content: any): any {
    const provider = new StudentCourseContentTreeProvider({} as any, { getCurrentCourseId: () => undefined } as any);
    const node = {
      isUnit: false,
      children: new Map([['a', {
        children: new Map(), isUnit: false,
        courseContent: { id: 'a', path: 'week_1.constants', title: 'Mathematische Konstanten', position: 1, ...content },
        submissionGroup: content.submission_group,
        contentType: { id: 't', course_content_kind_id: 'assignment', slug: 'assignment', title: 'Aufgabe' }
      }]])
    };
    return (provider as any).createTreeItems(node)[0];
  }

  it('names the row by its title, then its state, in the learner language', () => {
    setUiProfileLanguage('de');
    const item = row({ result_count: 1, result: { id: 'r', result: 0.5 }, submitted: true });

    expect(item.accessibilityInformation.label).to.equal('Mathematische Konstanten, Aufgabe, zuletzt getestet: 50 %, abgegeben');
    expect(item.tooltip).to.contain('Typ: Aufgabe');
  });

  it('names a unit row by its title and type, with a German tooltip', () => {
    setUiProfileLanguage('de');
    const provider = new StudentCourseContentTreeProvider({} as any, { getCurrentCourseId: () => undefined } as any);
    const node = {
      isUnit: false,
      children: new Map([['Woche 1', {
        isUnit: true, children: new Map(),
        courseContent: { id: 'u', path: 'week_1', title: 'Woche 1', position: 1, status: 'not_reviewed' },
        contentType: { id: 'w', course_content_kind_id: 'unit', slug: 'week', title: 'Woche' }
      }]])
    };
    const unit = (provider as any).createTreeItems(node)[0];

    expect(unit.accessibilityInformation.label).to.equal('Woche 1, Woche');
    expect(unit.tooltip).to.equal('Einheit: Woche 1\n0 Einträge\nTyp: Woche\nStatus: Nicht bewertet');
  });

  it('has no empty repository line in the tooltip', () => {
    const item = row({ result_count: 0, submission_group: { id: 'sg', count: 0, repository: { full_path: '' } } });

    expect(item.tooltip).to.not.contain('Repository:');
    expect(item.accessibilityInformation.label).to.equal('Mathematische Konstanten, Aufgabe');
  });
});

describe('extension text language', () => {
  it('takes the profile, then the course, then the VS Code display language', () => {
    expect(pickUiLanguage('de-AT', 'en', 'en')).to.equal('de');
    expect(pickUiLanguage(undefined, 'de', 'en')).to.equal('de');
    expect(pickUiLanguage('en', 'de', 'de')).to.equal('en');
    expect(pickUiLanguage(undefined, undefined, 'de')).to.equal('de');
    expect(pickUiLanguage(undefined, undefined, undefined)).to.equal('en');
  });
});

describe('command and view names in both languages', () => {
  const root = path.resolve(__dirname, '../..');
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const en = JSON.parse(fs.readFileSync(path.join(root, 'package.nls.json'), 'utf8'));
  const de = JSON.parse(fs.readFileSync(path.join(root, 'package.nls.de.json'), 'utf8'));
  const contributed = new Map<string, string>([
    ...pkg.contributes.commands.map((c: any) => [c.command, c.title]),
    ...Object.values(pkg.contributes.viewsContainers).flat().map((c: any) => [c.id, c.title]),
    ...Object.values(pkg.contributes.views).flat().map((v: any) => [v.id, v.name])
  ] as Array<[string, string]>);

  it('names on the welcome page are the ones VS Code shows, in English and German', () => {
    for (const [id, [english, german]] of Object.entries(workbenchNames)) {
      const key = /^%(.+)%$/.exec(contributed.get(id) ?? '')?.[1];
      expect(key, id).to.be.a('string');
      expect(en[key!], id).to.equal(english);
      expect(de[key!], id).to.equal(german);
    }
  });

  it('every localized key has both languages', () => {
    expect(Object.keys(de).sort()).to.deep.equal(Object.keys(en).sort());
  });
});
