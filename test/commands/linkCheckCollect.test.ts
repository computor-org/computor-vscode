import { expect } from 'chai';

import { collectFromBundle } from '../../src/commands/LinkCheckCommands';
import { bundleFromFiles } from '../../src/utils/exampleLinkSources';

/**
 * What one example contributes to a link report (computor-org/issues#362).
 *
 * This is the piece both entry points share — the Examples view and the course
 * tree — so it is the piece worth pinning down: whichever level a lecturer
 * starts from, an example has to yield the same findings.
 */
describe('link check: collecting from one example', () => {
  const collect = (files: Record<string, string>, meta?: unknown) => {
    const web: any[] = [];
    const missing: any[] = [];
    collectFromBundle(bundleFromFiles(files, meta), 'Quadratic', web, missing);
    return { web, missing };
  };

  it('finds links in the README and in meta.yaml', () => {
    const { web } = collect(
      { 'content/index.md': 'See https://example.org/docs\n' },
      { links: [{ url: 'https://example.org/paper' }] }
    );
    expect(web.map(f => f.url).sort()).to.deep.equal([
      'https://example.org/docs',
      'https://example.org/paper'
    ]);
  });

  it('does not report a meta.yaml link twice', () => {
    // meta.yaml is both a parsed document and a readable file; reading it as
    // both would double every link it carries.
    const { web } = collect(
      { 'meta.yaml': 'links:\n  - url: https://example.org/paper\n' },
      { links: [{ url: 'https://example.org/paper' }] }
    );
    expect(web).to.have.length(1);
  });

  it('names the example every finding belongs to', () => {
    const { web } = collect({ 'content/index.md': 'https://example.org/x' });
    expect(web[0].where).to.equal('Quadratic');
    expect(web[0].source).to.equal('content/index.md');
  });

  it('reads every language variant of the README', () => {
    const { web } = collect({
      'content/index.md': 'https://example.org/en',
      'content/index_de.md': 'https://example.org/de'
    });
    expect(web.map(f => f.url).sort()).to.deep.equal([
      'https://example.org/de',
      'https://example.org/en'
    ]);
  });

  it('accepts a relative link whose file is there', () => {
    const { missing } = collect({
      'content/index.md': '![plot](mediaFiles/plot.png)',
      'content/mediaFiles/plot.png': 'x'
    });
    expect(missing).to.be.empty;
  });

  /** The slip this check exists for: the folder is `mediaFiles`, not `MediaFiles`. */
  it('catches a relative link whose capitalisation is wrong', () => {
    const { missing } = collect({
      'content/index.md': '![plot](MediaFiles/plot.png)',
      'content/mediaFiles/plot.png': 'x'
    });
    expect(missing).to.have.length(1);
    expect(missing[0].url).to.equal('MediaFiles/plot.png');
    expect(missing[0].resolved).to.equal('content/MediaFiles/plot.png');
  });

  it('catches a relative link to a file that simply is not there', () => {
    const { missing } = collect({ 'content/index.md': '[data](data/values.csv)' });
    expect(missing.map((m: any) => m.url)).to.deep.equal(['data/values.csv']);
  });

  it('keeps relative links out of the web list, and web links out of the missing list', () => {
    const { web, missing } = collect({
      'content/index.md': '![p](mediaFiles/p.png) and https://example.org/x'
    });
    expect(web.map(f => f.url)).to.deep.equal(['https://example.org/x']);
    expect(missing.map((m: any) => m.url)).to.deep.equal(['mediaFiles/p.png']);
  });

  it('ignores what it cannot check', () => {
    const { web, missing } = collect({
      'content/index.md': '[mail](mailto:x@example.org) [top](#section)'
    });
    expect(web).to.be.empty;
    expect(missing).to.be.empty;
  });

  it('has nothing to say about an example with no links', () => {
    const { web, missing } = collect({ 'content/index.md': '# Title\n\nJust prose.\n' });
    expect(web).to.be.empty;
    expect(missing).to.be.empty;
  });
});
