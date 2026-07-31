import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { customEditorProviders, fileSystemWatchers, window } from '../helpers/vscode-stub';
import { registerImageViewer } from '../../src/ui/panels/ImagePreviewPanel';

/**
 * The point of this viewer is what it does *not* emit. VS Code's own image
 * editor loads its picture, stylesheet and script from a host that exists only
 * inside the webview service worker, and under code-server the webview content
 * sits in a grandchild iframe whose requests Firefox never routes through that
 * worker — so a student on Firefox or older Safari saw two error panels and no
 * image (computor-org/issues#282). Everything here therefore has to travel
 * inside the document: assert on the absence of fetchable URLs, not just on
 * the presence of a picture.
 */
describe('ImagePreviewProvider', () => {
  /** The real extension root, so renderWebviewPage inlines its assets for real. */
  const extensionRoot = path.resolve(__dirname, '../..');
  const extensionUri = { fsPath: extensionRoot, path: extensionRoot, scheme: 'file' };

  /** A 1x1 PNG — small, valid, and enough to be base64'd into the document. */
  const onePixelPng = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64'
  );

  let directory: string;
  let context: any;

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'computor-image-'));
    context = { subscriptions: [], extensionUri };
    customEditorProviders.length = 0;
    fileSystemWatchers.length = 0;
  });

  afterEach(() => {
    context.subscriptions.forEach((d: any) => d?.dispose?.());
    fs.rmSync(directory, { recursive: true, force: true });
  });

  /** Open `name` through the provider and hand back the webview's document. */
  async function open(name: string): Promise<string> {
    registerImageViewer(context);
    const registration = customEditorProviders[customEditorProviders.length - 1]!;
    const file = path.join(directory, name);
    const uri = { fsPath: file, path: file, scheme: 'file' };
    const panel = window.createWebviewPanel('computor.imagePreview', name);
    await registration.provider.resolveCustomEditor({ uri, dispose: () => {} } as any, panel as any);
    return panel.webview.html;
  }

  it('registers itself as the Computor image editor', () => {
    registerImageViewer(context);

    expect(customEditorProviders.map((r) => r.viewType)).to.include('computor.imagePreview');
  });

  it('carries the image inside the document instead of linking to it', async () => {
    fs.writeFileSync(path.join(directory, 'figure.png'), onePixelPng);

    const html = await open('figure.png');

    expect(html).to.contain(`data:image/png;base64,${onePixelPng.toString('base64')}`);
  });

  /**
   * The regression that matters. Any one of these — a linked stylesheet, a
   * linked script, a vscode-resource image — puts the viewer straight back
   * into the service worker's hands and breaks it in Firefox again.
   */
  it('leaves nothing for a service worker to serve', async () => {
    fs.writeFileSync(path.join(directory, 'figure.png'), onePixelPng);

    const html = await open('figure.png');

    // The CSP names those hosts in its allowlist, which costs nothing — what
    // must not exist is anything that actually points at one.
    const withoutCsp = html.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, '');
    expect(withoutCsp).to.not.contain('vscode-cdn.net');
    expect(withoutCsp).to.not.contain('vscode-resource');
    expect(html).to.not.match(/<link[^>]+rel="stylesheet"[^>]+href=/);
    expect(html).to.not.match(/<script[^>]+src=/);
    // ...and the assets really were inlined rather than silently dropped.
    expect(html).to.contain('.image-canvas');
    expect(html).to.contain('imageStage');
  });

  it('picks the media type from the extension', async () => {
    fs.writeFileSync(path.join(directory, 'diagram.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');

    const html = await open('diagram.svg');

    expect(html).to.contain('data:image/svg+xml;base64,');
  });

  /**
   * Base64 in the document costs about a third more than the file, and the
   * whole string crosses the extension host boundary on every render. Past the
   * cap the viewer says so rather than building it anyway.
   */
  it('refuses an image too large to inline, without reading it', async () => {
    const huge = path.join(directory, 'huge.png');
    const handle = fs.openSync(huge, 'w');
    fs.ftruncateSync(handle, 32 * 1024 * 1024);
    fs.closeSync(handle);

    const html = await open('huge.png');

    expect(html).to.contain('too large to preview here');
    expect(html).to.not.contain('data:image/png;base64,');
  });

  it('says so when the file is not there', async () => {
    const html = await open('missing.png');

    expect(html).to.contain('no longer there');
    expect(html).to.not.contain('data:image/png;base64,');
  });

  /**
   * Re-running a test overwrites `fig-NNNNNN.png` rather than writing a new
   * file, so a preview that did not follow the bytes would quietly show the
   * previous run's plot.
   */
  it('re-renders when the file changes underneath it', async () => {
    const file = path.join(directory, 'figure.png');
    fs.writeFileSync(file, onePixelPng);

    registerImageViewer(context);
    const registration = customEditorProviders[customEditorProviders.length - 1]!;
    const uri = { fsPath: file, path: file, scheme: 'file' };
    const panel = window.createWebviewPanel('computor.imagePreview', 'figure.png');
    await registration.provider.resolveCustomEditor({ uri, dispose: () => {} } as any, panel as any);

    const before = panel.webview.html;
    // The same figure redrawn: a different picture at the same path.
    fs.writeFileSync(file, Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'base64'
    ));

    fileSystemWatchers[fileSystemWatchers.length - 1]!.fireChange(uri);
    await new Promise((resolve) => setTimeout(resolve, 400));

    expect(panel.webview.html).to.not.equal(before);
    expect(panel.webview.html).to.contain('data:image/png;base64,');
  });
});
