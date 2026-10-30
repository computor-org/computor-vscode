import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';
import { runInNewContext } from 'vm';

import { CourseContentWebviewFactory } from '../../src/ui/webviews/content/CourseContentWebviewFactory';
import { setUiProfileLanguage } from '../../src/utils/uiLanguage';

const root = path.resolve(__dirname, '../..');
const read = (file: string) => fs.readFileSync(path.join(root, 'webview-ui', file), 'utf8');

/** Load base.js and the given scripts as a webview page in `lang` would. */
function loadPage(lang: string, scripts: string[], initialState: any): { app: { innerHTML: string }; window: any } {
  const app = { innerHTML: '' };
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
    __INITIAL_STATE__: initialState
  };
  const context: any = { window, document, acquireVsCodeApi: window.acquireVsCodeApi, console };
  runInNewContext(read('shared/base.js'), context);
  for (const script of scripts) {
    runInNewContext(read(script), context);
  }
  return { app, window };
}

const exampleState = {
  example: { id: 'e', title: 'Plot', identifier: 'itpcp.plot', directory: 'plot', category: 'Numerik' },
  repository: { name: 'Beispiele' },
  versions: [],
  isDownloaded: false
};

describe('lecturer webviews follow the page language', () => {
  afterEach(() => setUiProfileLanguage(undefined));

  it('renders the example details page in German', () => {
    const html = loadPage('de', ['content/example-details.js'], exampleState).app.innerHTML;
    expect(html).to.contain('Neueste auschecken');
    expect(html).to.contain('Nur auf dem Server');
    expect(html).to.contain('Versionen (0)');
    expect(html).to.contain('<dt>Kategorie</dt>');
    expect(html).not.to.contain('Checkout Latest');
  });

  it('keeps the example details page English on an English page', () => {
    const html = loadPage('en', ['content/example-details.js'], exampleState).app.innerHTML;
    expect(html).to.contain('Checkout Latest');
    expect(html).to.contain('Versions (0)');
  });

  it('names the course content panel kind in German', () => {
    setUiProfileLanguage('de');
    expect(CourseContentWebviewFactory.getProviderType({ submittable: true } as any)).to.equal('Aufgabe');
    expect(CourseContentWebviewFactory.getProviderType({ submittable: false, has_descendants: true } as any)).to.equal('Einheit');
  });
});
