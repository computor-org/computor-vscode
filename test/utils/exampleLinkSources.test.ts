import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { bundleFromDirectory, bundleFromFiles } from '../../src/utils/exampleLinkSources';

/**
 * Reading an example for the link checker (computor-org/issues#362).
 *
 * The same example arrives two ways — as the working copy a lecturer is editing
 * in the Examples view, and as a version downloaded from the server — and both
 * have to come out the same shape, or the crawler behaves differently depending
 * on where it was started. The working copy is the one that matters most: it is
 * the only moment a broken link is cheap to fix.
 *
 * Every file counts as a name, because that is what a relative link resolves
 * against; only readable ones are opened, so a folder of figures costs nothing.
 */
describe('exampleLinkSources', () => {
  describe('bundleFromDirectory', () => {
    let root: string;

    beforeEach(() => {
      root = fs.mkdtempSync(path.join(os.tmpdir(), 'example-bundle-'));
      const write = (relative: string, contents: string) => {
        const target = path.join(root, relative);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, contents);
      };

      write('meta.yaml', 'title: Quadratic\nlinks:\n  - url: https://example.org/paper\n');
      write('content/index.md', '![plot](mediaFiles/plot.png)\nSee https://example.org/docs\n');
      write('content/mediaFiles/plot.png', 'not really a png');
      write('solution.py', '# https://example.org/api\n');
      write('.computor-example.json', '{"exampleId":"x"}');
      write('.git/config', 'nothing to see');
      write('node_modules/dep/readme.md', 'https://example.org/should-not-be-read');
    });

    afterEach(() => {
      fs.rmSync(root, { recursive: true, force: true });
    });

    it('lists every file, binaries included, with forward slashes', () => {
      const bundle = bundleFromDirectory(root);
      expect(Array.from(bundle.fileNames).sort()).to.deep.equal([
        'content/index.md',
        'content/mediaFiles/plot.png',
        'meta.yaml',
        'solution.py'
      ]);
    });

    it('reads only the files worth reading', () => {
      const bundle = bundleFromDirectory(root);
      expect(Array.from(bundle.texts.keys()).sort()).to.deep.equal([
        'content/index.md',
        'meta.yaml',
        'solution.py'
      ]);
    });

    it('skips the checkout bookkeeping and the repository internals', () => {
      const bundle = bundleFromDirectory(root);
      expect(bundle.fileNames.has('.computor-example.json')).to.be.false;
      expect(Array.from(bundle.fileNames).some(name => name.startsWith('.git/'))).to.be.false;
      expect(Array.from(bundle.fileNames).some(name => name.startsWith('node_modules/'))).to.be.false;
    });

    it('parses meta.yaml from the working copy', () => {
      const bundle = bundleFromDirectory(root) as any;
      expect(bundle.meta.title).to.equal('Quadratic');
      expect(bundle.meta.links[0].url).to.equal('https://example.org/paper');
    });

    it('survives a meta.yaml that does not parse', () => {
      fs.writeFileSync(path.join(root, 'meta.yaml'), 'title: [unclosed\n');
      const bundle = bundleFromDirectory(root);
      expect(bundle.meta).to.be.undefined;
      // The rest of the example is still readable.
      expect(bundle.texts.has('content/index.md')).to.be.true;
    });

    it('has nothing to say about a directory that is not there', () => {
      const bundle = bundleFromDirectory(path.join(root, 'nope'));
      expect(bundle.fileNames.size).to.equal(0);
      expect(bundle.texts.size).to.equal(0);
    });
  });

  describe('bundleFromFiles', () => {
    it('keeps every name and reads the readable ones', () => {
      const bundle = bundleFromFiles(
        {
          'meta.yaml': 'title: X\n',
          'content/index.md': '# X',
          'content/mediaFiles/plot.png': 'binary-ish'
        },
        { title: 'X' }
      );

      expect(Array.from(bundle.fileNames).sort()).to.deep.equal([
        'content/index.md',
        'content/mediaFiles/plot.png',
        'meta.yaml'
      ]);
      expect(Array.from(bundle.texts.keys()).sort()).to.deep.equal([
        'content/index.md',
        'meta.yaml'
      ]);
    });

    it('prefers the meta the server already parsed', () => {
      const bundle = bundleFromFiles({ 'meta.yaml': 'title: on-disk\n' }, { title: 'from-server' });
      expect((bundle.meta as any).title).to.equal('from-server');
    });

    it('falls back to parsing meta.yaml when the server sent none', () => {
      const bundle = bundleFromFiles({ 'meta.yaml': 'title: on-disk\n' }, undefined);
      expect((bundle.meta as any).title).to.equal('on-disk');
    });

    it('has nothing to say about an example with no files', () => {
      const bundle = bundleFromFiles(undefined, undefined);
      expect(bundle.fileNames.size).to.equal(0);
      expect(bundle.meta).to.be.undefined;
    });
  });
});
