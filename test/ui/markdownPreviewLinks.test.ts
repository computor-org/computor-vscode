import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { resolveMarkdownLink } from '../../src/ui/webviews/markdownPreview';

/**
 * The help pages link to each other ("Learn about Units and Folders"), and
 * those links were dead: the preview is a webview, so a relative href resolved
 * against its vscode-webview: origin and VS Code silently dropped the
 * navigation (computor-org/issues#325). Links are now sent to the host, which
 * resolves them here — sibling markdown only, and never out of the document's
 * own tree.
 */
describe('markdown preview links', () => {
  let root: string;
  let docs: string;
  let extensionPath: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'computor-md-'));
    docs = path.join(root, 'docs');
    extensionPath = path.join(root, 'extension');
    fs.mkdirSync(docs);
    fs.mkdirSync(path.join(extensionPath, 'help'), { recursive: true });
    fs.writeFileSync(path.join(docs, 'first.md'), '# first');
    fs.writeFileSync(path.join(docs, 'second.md'), '# second');
    fs.writeFileSync(path.join(root, 'secret.md'), '# outside the document tree');
    fs.writeFileSync(path.join(extensionPath, 'help', 'bundled.md'), '# bundled');
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('follows a link to a sibling document', () => {
    expect(resolveMarkdownLink('second.md', docs, extensionPath)).to.equal(
      path.join(docs, 'second.md')
    );
  });

  it('follows an explicitly relative link', () => {
    expect(resolveMarkdownLink('./second.md', docs, extensionPath)).to.equal(
      path.join(docs, 'second.md')
    );
  });

  it('keeps the document when the link carries a heading fragment', () => {
    expect(resolveMarkdownLink('second.md#getting-started', docs, extensionPath)).to.equal(
      path.join(docs, 'second.md')
    );
  });

  it('follows a bundled help page even from another directory', () => {
    expect(resolveMarkdownLink('help/bundled.md', extensionPath, extensionPath)).to.equal(
      path.join(extensionPath, 'help', 'bundled.md')
    );
  });

  it('refuses to walk out of the document tree', () => {
    expect(resolveMarkdownLink('../secret.md', docs, extensionPath)).to.equal(undefined);
  });

  it('ignores links that are not markdown', () => {
    fs.writeFileSync(path.join(docs, 'notes.txt'), 'plain');
    expect(resolveMarkdownLink('notes.txt', docs, extensionPath)).to.equal(undefined);
  });

  it('ignores a link to a document that does not exist', () => {
    expect(resolveMarkdownLink('missing.md', docs, extensionPath)).to.equal(undefined);
  });

  it('resolves every cross-link the shipped help pages contain', () => {
    const helpDir = path.resolve(__dirname, '../../docs/help');
    const pages = fs.readdirSync(helpDir).filter((file) => file.endsWith('.md'));
    expect(pages.length).to.be.greaterThan(0);

    const links: Array<{ page: string; href: string }> = [];
    for (const page of pages) {
      const markdown = fs.readFileSync(path.join(helpDir, page), 'utf8');
      for (const match of markdown.matchAll(/\[[^\]]*\]\(([^)\s]+\.md[^)\s]*)\)/g)) {
        links.push({ page, href: match[1] as string });
      }
    }
    expect(links.length).to.be.greaterThan(0);

    for (const { page, href } of links) {
      expect(
        resolveMarkdownLink(href, helpDir, path.resolve(__dirname, '../..')),
        `${page} links to ${href}`
      ).to.be.a('string');
    }
  });
});
