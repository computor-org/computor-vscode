import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';
import { runInNewContext } from 'vm';

import blockRegistry from '../../src/data/block-registry.json';
import { hiddenBadge } from '../../src/ui/tree/visibility';
import { localizeBlockRegistry } from '../../src/ui/webviews/blockRegistryLanguage';
import { deploymentBadge } from '../../src/ui/webviews/shared/webviewHelpers';
import { localizedKindTitle } from '../../src/utils/contentLanguage';
import { localizedRoleTitle } from '../../src/utils/roleLabels';
import { setUiProfileLanguage } from '../../src/utils/uiLanguage';

const root = path.resolve(__dirname, '../..');

/** Render the organization / course family members page as the webview would, in `lang`. */
function renderScopeMembers(lang: string): string {
  const app = { innerHTML: '' };
  const document = {
    documentElement: { lang },
    readyState: 'complete',
    getElementById: (id: string) => (id === 'scope-membership-root' || id === 'app' ? app : null),
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {}
  };
  const window: any = {
    acquireVsCodeApi: () => ({ postMessage() {}, getState() {}, setState() {} }),
    addEventListener() {},
    __INITIAL_STATE__: {
      target: { kind: 'organization', scopeTitle: 'TU Graz' },
      members: [],
      availableRoles: [{ id: '_owner', title: 'Besitzer' }],
      canManage: true
    }
  };
  const context: any = { window, document, acquireVsCodeApi: window.acquireVsCodeApi, console };
  for (const file of ['shared/base.js', 'courses/scope-membership.js']) {
    runInNewContext(fs.readFileSync(path.join(root, 'webview-ui', file), 'utf8'), context);
  }
  return app.innerHTML;
}

describe('shared lecturer labels follow the reading language', () => {
  afterEach(() => setUiProfileLanguage(undefined));

  it('marks hidden rows, deployment states, kinds and roles in German', () => {
    setUiProfileLanguage('de');
    expect(hiddenBadge({ visible: false, visible_effective: false })).to.equal('👁 unsichtbar');
    expect(deploymentBadge('deployed')).to.contain('BEREITGESTELLT');
    expect(localizedKindTitle('unit', 'Unit', 'de')).to.equal('Einheit');
    expect(localizedRoleTitle('_lecturer', 'Lecturer')).to.equal('Lehrende');
  });

  it('keeps English and unknown values as sent', () => {
    setUiProfileLanguage('en');
    expect(hiddenBadge({ visible: false, visible_effective: false })).to.equal('👁 invisible');
    expect(deploymentBadge('weird')).to.contain('WEIRD');
    expect(localizedKindTitle('quiz', 'Quiz', 'de')).to.equal('Quiz');
    expect(localizedRoleTitle('_custom', 'Custom')).to.equal('Custom');
  });

  it('names test types and comparisons in German but keeps their ids and field names', () => {
    const python = localizeBlockRegistry(blockRegistry as any, 'de').languages.find((l: any) => l.id === 'python');
    const stdout = python.test_types.find((t: any) => t.id === 'stdout');
    expect(stdout.name).to.equal('Standardausgabe');
    expect(stdout.collection_fields.map((f: any) => f.name)).to.include('entryPoint');
    expect(python.qualifications.find((q: any) => q.id === 'contains').name).to.equal('Enthält');
    expect(localizeBlockRegistry(blockRegistry as any, 'en')).to.equal(blockRegistry);
  });

  it('renders the scope members page in German', () => {
    const html = renderScopeMembers('de');
    expect(html).to.contain('Mitglied hinzufügen');
    expect(html).to.contain('Noch keine Mitglieder.');
    expect(html).not.to.contain('Add Member');
  });
});
