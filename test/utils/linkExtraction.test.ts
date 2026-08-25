import { expect } from 'chai';

import {
  classifyLink,
  extractLinks,
  extractMetaLinks,
  resolveRelativeLink
} from '../../src/utils/linkExtraction';

/**
 * What counts as a link in courseware (computor-org/issues#362).
 *
 * The cost of the two mistakes is not symmetric. A link missed here is a
 * broken link that reaches students, which is the whole point of the feature.
 * A false positive is worse than it sounds though: a lecturer who finds three
 * invented problems in a report stops reading the real ones — hence the care
 * with code blocks and with the full stop at the end of a sentence.
 */
describe('linkExtraction', () => {
  describe('extractLinks', () => {
    it('finds a markdown inline link', () => {
      const found = extractLinks('See [the paper](https://example.org/paper.pdf) first.', 'README.md');
      expect(found.map(f => f.url)).to.deep.equal(['https://example.org/paper.pdf']);
      expect(found[0]?.source).to.equal('README.md');
    });

    it('finds an image target', () => {
      const found = extractLinks('![plot](mediaFiles/plot.png)', 'content/index.md');
      expect(found.map(f => f.url)).to.deep.equal(['mediaFiles/plot.png']);
    });

    it('finds a reference definition', () => {
      const found = extractLinks('[docs]: https://example.org/docs "Docs"', 'README.md');
      expect(found.map(f => f.url)).to.deep.equal(['https://example.org/docs']);
    });

    it('finds an autolink', () => {
      const found = extractLinks('Read <https://example.org/spec> carefully.', 'README.md');
      expect(found.map(f => f.url)).to.deep.equal(['https://example.org/spec']);
    });

    it('finds href and src in inline HTML', () => {
      const found = extractLinks(
        '<a href="https://example.org/a">a</a><img src="https://example.org/b.png">',
        'README.md'
      );
      expect(found.map(f => f.url)).to.have.members([
        'https://example.org/a',
        'https://example.org/b.png'
      ]);
    });

    it('finds a bare URL in running text', () => {
      const found = extractLinks('Documentation lives at https://example.org/docs', 'README.md');
      expect(found.map(f => f.url)).to.deep.equal(['https://example.org/docs']);
    });

    it('leaves the sentence\'s full stop out of a bare URL', () => {
      const found = extractLinks('See https://example.org/paper.', 'README.md');
      expect(found.map(f => f.url)).to.deep.equal(['https://example.org/paper']);
    });

    it('keeps a closing bracket that the URL itself opened', () => {
      const found = extractLinks(
        'See https://en.wikipedia.org/wiki/Bracket_(mathematics) for more.',
        'README.md'
      );
      expect(found.map(f => f.url)).to.deep.equal([
        'https://en.wikipedia.org/wiki/Bracket_(mathematics)'
      ]);
    });

    it('gives back a closing bracket that belonged to the sentence', () => {
      const found = extractLinks('(see https://example.org/x) for details', 'README.md');
      expect(found.map(f => f.url)).to.deep.equal(['https://example.org/x']);
    });

    it('reports the line a link was written on', () => {
      const text = 'first\nsecond\n[x](https://example.org/x)\n';
      expect(extractLinks(text, 'README.md')[0]?.line).to.equal(3);
    });

    it('ignores a URL inside a fenced code block', () => {
      const text = [
        'Intro https://example.org/real',
        '```bash',
        'curl http://localhost:8000/not-a-link',
        '```'
      ].join('\n');
      expect(extractLinks(text, 'README.md').map(f => f.url))
        .to.deep.equal(['https://example.org/real']);
    });

    it('ignores a URL inside an unterminated code block', () => {
      const text = ['```', 'curl http://localhost:8000/not-a-link'].join('\n');
      expect(extractLinks(text, 'README.md')).to.be.empty;
    });

    it('ignores a URL inside an inline code span', () => {
      const text = 'Set the host to `http://localhost:8000` before running.';
      expect(extractLinks(text, 'README.md')).to.be.empty;
    });

    it('reports one occurrence per line, not one per pattern that matched', () => {
      const found = extractLinks('[x](https://example.org/x)', 'README.md');
      expect(found).to.have.length(1);
    });

    it('has nothing to say about empty input', () => {
      expect(extractLinks('', 'README.md')).to.be.empty;
    });
  });

  describe('extractMetaLinks', () => {
    it('reads the links and supportingMaterial of the current format', () => {
      const meta = {
        links: [{ description: 'Paper', url: 'https://example.org/paper' }],
        supportingMaterial: [{ description: 'Slides', url: 'https://example.org/slides' }]
      };
      expect(extractMetaLinks(meta, 'meta.yaml').map(f => f.url)).to.deep.equal([
        'https://example.org/paper',
        'https://example.org/slides'
      ]);
    });

    it('reads the material lists of the new format too', () => {
      const meta = { courseMaterials: [{ name: 'Book', url: 'https://example.org/book' }] };
      expect(extractMetaLinks(meta, 'meta.yaml').map(f => f.url))
        .to.deep.equal(['https://example.org/book']);
    });

    it('reads links written into the description', () => {
      const meta = { description: 'Based on [this](https://example.org/source).' };
      expect(extractMetaLinks(meta, 'meta.yaml').map(f => f.url))
        .to.deep.equal(['https://example.org/source']);
    });

    it('names the field a link came from', () => {
      const meta = { links: [{ url: 'https://example.org/x' }] };
      expect(extractMetaLinks(meta, 'meta.yaml')[0]?.source).to.equal('meta.yaml (links)');
    });

    it('survives a meta.yaml that is not a document', () => {
      expect(extractMetaLinks(null, 'meta.yaml')).to.be.empty;
      expect(extractMetaLinks('nonsense', 'meta.yaml')).to.be.empty;
      expect(extractMetaLinks({ links: 'not a list' }, 'meta.yaml')).to.be.empty;
    });
  });

  describe('classifyLink', () => {
    it('recognises what can be probed', () => {
      expect(classifyLink('https://example.org')).to.equal('web');
      expect(classifyLink('http://example.org')).to.equal('web');
    });

    it('recognises what points inside the example', () => {
      expect(classifyLink('mediaFiles/plot.png')).to.equal('relative');
      expect(classifyLink('./other.md')).to.equal('relative');
      expect(classifyLink('../shared/x.md')).to.equal('relative');
    });

    it('recognises an anchor', () => {
      expect(classifyLink('#section')).to.equal('anchor');
    });

    it('leaves alone what it cannot check', () => {
      expect(classifyLink('mailto:someone@example.org')).to.equal('other');
      expect(classifyLink('tel:+43123')).to.equal('other');
      expect(classifyLink('data:image/png;base64,AAA')).to.equal('other');
      expect(classifyLink('//example.org/x')).to.equal('other');
      expect(classifyLink('')).to.equal('other');
    });
  });

  describe('resolveRelativeLink', () => {
    it('resolves against the directory the link was written in', () => {
      expect(resolveRelativeLink('mediaFiles/plot.png', 'content/index.md'))
        .to.equal('content/mediaFiles/plot.png');
    });

    it('handles a leading ./', () => {
      expect(resolveRelativeLink('./plot.png', 'content/index.md'))
        .to.equal('content/plot.png');
    });

    it('walks up with ..', () => {
      expect(resolveRelativeLink('../meta.yaml', 'content/index.md')).to.equal('meta.yaml');
    });

    it('resolves an absolute path against the example root', () => {
      expect(resolveRelativeLink('/content/index.md', 'content/other.md'))
        .to.equal('content/index.md');
    });

    it('decodes percent-encoded names', () => {
      expect(resolveRelativeLink('media%20files/a.png', 'index.md'))
        .to.equal('media files/a.png');
    });

    it('drops the anchor and query before resolving', () => {
      expect(resolveRelativeLink('other.md#part', 'index.md')).to.equal('other.md');
      expect(resolveRelativeLink('other.md?v=2', 'index.md')).to.equal('other.md');
    });

    /** A link reaching outside the example is broken by construction: only the
     *  example is deployed. */
    it('has no answer for a link that escapes the example', () => {
      expect(resolveRelativeLink('../../etc/passwd', 'content/index.md')).to.be.undefined;
    });

    it('has no answer for a bare anchor', () => {
      expect(resolveRelativeLink('#section', 'index.md')).to.be.undefined;
    });
  });
});
