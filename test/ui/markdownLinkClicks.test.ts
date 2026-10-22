import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { webviewPanels, window } from '../helpers/vscode-stub';
import { showMarkdownPreview } from '../../src/ui/webviews/markdownPreview';

// Plain-JS webview assets with CommonJS exports for Node-side testing.
// @ts-ignore -- no type declarations for the plain-JS asset
import linksAsset from '../../webview-ui/shared/markdown-links.js';
// @ts-ignore -- vendored UMD bundle, the same one the preview webview loads
import markedAsset from '../../webview-ui/vendor/marked.min.js';

const { handleMarkdownLinkClick, scrollToFragment } = linksAsset as {
  handleMarkdownLinkClick: (
    event: unknown,
    doc: unknown,
    postMessage: (message: unknown) => void
  ) => string | undefined;
  scrollToFragment: (doc: unknown, fragment: string) => boolean;
};
const { marked } = markedAsset as { marked: { parse: (s: string) => string } };

interface FakeClick {
  event: {
    target: { closest: (selector: string) => unknown };
    preventDefault: () => void;
    stopPropagation: () => void;
  };
  prevented: () => boolean;
  stopped: () => boolean;
}

function clickOn(href: string): FakeClick {
  let prevented = false;
  let stopped = false;
  const anchor = { getAttribute: (name: string) => (name === 'href' ? href : null) };
  return {
    event: {
      target: { closest: (selector: string) => (selector === 'a[href]' ? anchor : null) },
      preventDefault: () => { prevented = true; },
      stopPropagation: () => { stopped = true; }
    },
    prevented: () => prevented,
    stopped: () => stopped
  };
}

function fakeDocument(ids: string[]): { doc: unknown; scrolled: string[] } {
  const scrolled: string[] = [];
  const doc = {
    getElementById: (id: string) =>
      ids.includes(id) ? { scrollIntoView: () => scrolled.push(id) } : null
  };
  return { doc, scrolled };
}

/**
 * VS Code's webview host listens for clicks on the frame's window, ignores
 * defaultPrevented, and opens each anchor's resolved href. On code-server a
 * relative help link therefore became a new browser tab saying "Not found"
 * (computor-org/issues#325). A link the preview handles itself must stop
 * propagating; a real URL must still reach VS Code, which opens it externally.
 */
describe('markdown preview link clicks', () => {
  it('opens a sibling help page through the host and keeps the click from VS Code', () => {
    const click = clickOn('student-course.md#the-marks-on-a-row');
    const posted: unknown[] = [];
    const { doc } = fakeDocument([]);

    expect(handleMarkdownLinkClick(click.event, doc, (m) => posted.push(m))).to.equal('document');
    expect(posted).to.deep.equal([
      { command: 'openRelativeDocument', href: 'student-course.md#the-marks-on-a-row' }
    ]);
    expect(click.prevented()).to.equal(true);
    expect(click.stopped()).to.equal(true);
  });

  it('scrolls to an in-page heading and keeps the click from VS Code', () => {
    const click = clickOn('#getting-a-file-back');
    const posted: unknown[] = [];
    const { doc, scrolled } = fakeDocument(['getting-a-file-back']);

    expect(handleMarkdownLinkClick(click.event, doc, (m) => posted.push(m))).to.equal('anchor');
    expect(scrolled).to.deep.equal(['getting-a-file-back']);
    expect(posted).to.deep.equal([]);
    expect(click.stopped()).to.equal(true);
  });

  for (const href of ['https://computor.at/', 'http://example.org/a.md', 'mailto:a@b.c']) {
    it(`leaves ${href} to VS Code`, () => {
      const click = clickOn(href);
      const posted: unknown[] = [];
      const { doc } = fakeDocument([]);

      expect(handleMarkdownLinkClick(click.event, doc, (m) => posted.push(m))).to.equal(undefined);
      expect(posted).to.deep.equal([]);
      expect(click.prevented()).to.equal(false);
      expect(click.stopped()).to.equal(false);
    });
  }

  it('ignores clicks outside links', () => {
    let touched = false;
    const event = {
      target: { closest: () => null },
      preventDefault: () => { touched = true; },
      stopPropagation: () => { touched = true; }
    };
    expect(handleMarkdownLinkClick(event, fakeDocument([]).doc, () => { touched = true; }))
      .to.equal(undefined);
    expect(touched).to.equal(false);
  });

  it('every fragment in a shipped help link names a heading of its target page', () => {
    const helpDir = path.resolve(process.cwd(), 'docs/help');
    const ids = (page: string): string[] =>
      [...marked.parse(fs.readFileSync(path.join(helpDir, page), 'utf8'))
        .matchAll(/<h[1-6][^>]*\sid="([^"]+)"/g)].map((m) => m[1] as string);

    let checked = 0;
    for (const page of fs.readdirSync(helpDir).filter((file) => file.endsWith('.md'))) {
      const markdown = fs.readFileSync(path.join(helpDir, page), 'utf8');
      for (const match of markdown.matchAll(/\]\(([^)\s]*)#([^)\s]+)\)/g)) {
        const target = match[1] || page;
        const { doc, scrolled } = fakeDocument(ids(target));
        expect(scrollToFragment(doc, match[2] as string), `${page} links to ${match[0]}`)
          .to.equal(true);
        expect(scrolled).to.have.length(1);
        checked++;
      }
    }
    expect(checked).to.be.greaterThan(0);
  });

  it('opens the linked help page in the same preview, at the linked heading', async () => {
    for (const panel of webviewPanels) panel.dispose();
    webviewPanels.length = 0;
    (window as any).tabGroups = { all: [{}, {}] };
    const root = process.cwd();
    const context = { subscriptions: [], extensionUri: vscode.Uri.file(root) } as unknown as
      vscode.ExtensionContext;

    await showMarkdownPreview(context, path.join(root, 'docs/help/student-unit.md'), {
      title: 'Computor Help'
    });
    const panel = webviewPanels[0]!;
    panel.fireMessage({ command: 'openRelativeDocument', href: 'student-course.md#the-marks-on-a-row' });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(webviewPanels).to.have.length(1);
    const course = fs.readFileSync(path.join(root, 'docs/help/student-course.md'), 'utf8');
    const state = JSON.stringify({ markdown: course }).slice(1, 60);
    expect(panel.webview.html).to.contain(state);
    expect(panel.webview.html).to.contain('"fragment":"the-marks-on-a-row"');
    panel.dispose();
    webviewPanels.length = 0;
  });
});
