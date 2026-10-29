import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';
import { runInNewContext } from 'vm';

const root = path.resolve(__dirname, '../..');
const read = (file: string) => fs.readFileSync(path.join(root, 'webview-ui', file), 'utf8');

/** Render the tutor's member progress page as the webview would, in `lang`. */
function renderMemberProgress(lang: string, memberGradings: any): string {
  const app = { innerHTML: '', addEventListener() {} };
  const document = {
    documentElement: { lang },
    readyState: 'complete',
    getElementById: (id: string) => (id === 'app' ? app : null),
    querySelectorAll: () => [],
    addEventListener() {}
  };
  const window: any = {
    acquireVsCodeApi: () => ({ postMessage() {}, getState() {}, setState() {} }),
    addEventListener() {},
    __INITIAL_STATE__: { memberGradings }
  };
  const context: any = { window, document, acquireVsCodeApi: window.acquireVsCodeApi, console };
  runInNewContext(read('shared/base.js'), context);
  runInNewContext(read('courses/charts.js'), context);
  context.ComputorCharts = window.ComputorCharts;
  runInNewContext(read('courses/course-member-progress.js'), context);
  return app.innerHTML;
}

const gradings = {
  given_name: 'Ada',
  family_name: 'Lovelace',
  latest_submission_at: null,
  total_max_assignments: 4,
  total_submitted_assignments: 1,
  by_content_type: [],
  nodes: []
};

describe('tutor progress pages follow the page language', () => {
  it('renders the member progress page in German', () => {
    const html = renderMemberProgress('de', gradings);
    expect(html).to.contain('Gesamtfortschritt');
    expect(html).to.contain('Zuletzt aktiv: Nie');
    expect(html).to.contain('Abgegeben:');
    expect(html).not.to.contain('Overall Progress');
  });

  it('keeps English on an English page', () => {
    const html = renderMemberProgress('en', gradings);
    expect(html).to.contain('Overall Progress');
    expect(html).to.contain('Last active: Never');
  });

  it('says in German when there is no data', () => {
    expect(renderMemberProgress('de', null)).to.contain('Keine Daten');
  });
});
