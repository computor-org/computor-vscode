import { expect } from 'chai';

// Plain-JS webview asset with a CommonJS export for Node-side testing.
// Default-imported because the export is assigned inside an IIFE, which the
// ESM named-export lexer can't see.
// @ts-ignore -- no type declarations for the plain-JS asset
import markdownAsset from '../../webview-ui/shared/markdown.js';

const { renderMarkdown, extractMath } = markdownAsset as {
  renderMarkdown: (markdown: unknown, opts?: Record<string, unknown>) => string;
  extractMath: (source: string) => {
    masked: string;
    segments: Array<{ token: string; tex: string; displayMode: boolean }>;
  };
};

interface KatexCall {
  tex: string;
  displayMode: boolean;
}

function fakeDeps(): {
  marked: { parse: (s: string) => string };
  katex: { renderToString: (tex: string, opts: { displayMode: boolean }) => string };
  katexCalls: KatexCall[];
  markedInputs: string[];
} {
  const katexCalls: KatexCall[] = [];
  const markedInputs: string[] = [];
  return {
    marked: {
      parse: (s: string) => {
        markedInputs.push(s);
        return `<p>${s}</p>`;
      }
    },
    katex: {
      renderToString: (tex: string, opts: { displayMode: boolean }) => {
        katexCalls.push({ tex, displayMode: opts.displayMode });
        return `[katex:${opts.displayMode ? 'display' : 'inline'}]`;
      }
    },
    katexCalls,
    markedInputs
  };
}

describe('webview-ui/shared/markdown.js renderMarkdown', () => {
  it('lifts $$…$$ out before marked so \\\\ line breaks survive (issue #267)', () => {
    const deps = fakeDeps();
    const source =
      '$$ \\begin{aligned} s(t) &= v\\,t \\\\ x_1 &= \\pi/2 \\end{aligned} $$';
    const html = renderMarkdown(source, deps);

    expect(deps.katexCalls).to.have.length(1);
    expect(deps.katexCalls[0].tex).to.contain('\\\\');
    expect(deps.katexCalls[0].tex).to.contain('x_1');
    expect(deps.katexCalls[0].displayMode).to.equal(true);
    // marked never sees TeX source
    expect(deps.markedInputs[0]).to.not.contain('$$');
    expect(deps.markedInputs[0]).to.not.contain('\\begin');
    expect(html).to.contain('[katex:display]');
  });

  it('renders inline $…$, \\(…\\) and display \\[…\\]', () => {
    const deps = fakeDeps();
    renderMarkdown('a $x^2$ b \\(y\\) c \\[z\\] d', deps);
    expect(deps.katexCalls).to.deep.equal([
      { tex: 'x^2', displayMode: false },
      { tex: 'y', displayMode: false },
      { tex: 'z', displayMode: true }
    ]);
  });

  it('handles display blocks spanning multiple lines', () => {
    const deps = fakeDeps();
    renderMarkdown('$$\na = b\nc = d\n$$', deps);
    expect(deps.katexCalls).to.have.length(1);
    expect(deps.katexCalls[0].tex).to.contain('a = b\nc = d');
  });

  it('extracts adjacent inline math with underscores separately', () => {
    const deps = fakeDeps();
    renderMarkdown('$a_b$ vs $c_d$', deps);
    expect(deps.katexCalls.map((c) => c.tex)).to.deep.equal(['a_b', 'c_d']);
  });

  it('leaves currency untouched: "$5 and $10", trailing 100$', () => {
    const deps = fakeDeps();
    const html = renderMarkdown('costs $5 and $10, or 100$ flat', deps);
    expect(deps.katexCalls).to.have.length(0);
    expect(html).to.contain('$5 and $10, or 100$ flat');
  });

  it('still renders spaced spans that look like TeX: $a + b$', () => {
    const deps = fakeDeps();
    renderMarkdown('sum $a + b$ here', deps);
    expect(deps.katexCalls).to.deep.equal([{ tex: 'a + b', displayMode: false }]);
  });

  it('never opens math on an escaped \\$', () => {
    const deps = fakeDeps();
    const html = renderMarkdown('pay \\$5$ now', deps);
    expect(deps.katexCalls).to.have.length(0);
    expect(html).to.contain('\\$5$ now');
  });

  it('ignores math inside fenced code blocks and inline code', () => {
    const deps = fakeDeps();
    const source = '```\n$$x$$\n```\nand `$y$` inline\n\n~~~\n$z$\n~~~';
    const html = renderMarkdown(source, deps);
    expect(deps.katexCalls).to.have.length(0);
    expect(html).to.contain('$$x$$');
    expect(html).to.contain('`$y$`');
    expect(html).to.contain('$z$');
  });

  it('still extracts math after a code fence closes', () => {
    const deps = fakeDeps();
    renderMarkdown('```\ncode\n```\n\n$x$', deps);
    expect(deps.katexCalls).to.deep.equal([{ tex: 'x', displayMode: false }]);
  });

  it('normalizes CRLF line endings', () => {
    const deps = fakeDeps();
    renderMarkdown('$$\r\na = b\r\n$$\r\n', deps);
    expect(deps.katexCalls).to.have.length(1);
    expect(deps.katexCalls[0].tex).to.equal('\na = b\n');
  });

  it('is immune to literal @@MATH-…@@ text in the document', () => {
    const deps = fakeDeps();
    const html = renderMarkdown('fake @@MATH-abcdefgh-0@@ token and $x$', deps);
    expect(deps.katexCalls).to.deep.equal([{ tex: 'x', displayMode: false }]);
    expect(html).to.contain('@@MATH-abcdefgh-0@@');
    expect(html).to.contain('[katex:inline]');
  });

  it('falls back to escaped <code> TeX when katex is missing', () => {
    const deps = fakeDeps();
    const html = renderMarkdown('$a<b$', { marked: deps.marked });
    expect(html).to.contain('<code>a&lt;b</code>');
  });

  it('falls back to escaped text with <br/> when marked is missing', () => {
    const html = renderMarkdown('<b>x</b>\nline2', {});
    expect(html).to.equal('&lt;b&gt;x&lt;/b&gt;<br/>line2');
  });

  it('math pass can be disabled', () => {
    const deps = fakeDeps();
    const html = renderMarkdown('$x$', { ...deps, math: false });
    expect(deps.katexCalls).to.have.length(0);
    expect(html).to.contain('$x$');
  });
});

describe('webview-ui/shared/markdown.js extractMath', () => {
  it('masks each segment with a unique token and reports it', () => {
    const { masked, segments } = extractMath('$a$ and $$b$$');
    expect(segments).to.have.length(2);
    expect(masked).to.contain(segments[0].token);
    expect(masked).to.contain(segments[1].token);
    expect(segments[0]).to.include({ tex: 'a', displayMode: false });
    expect(segments[1]).to.include({ tex: 'b', displayMode: true });
  });

  it('leaves an unclosed $$ alone', () => {
    const { masked, segments } = extractMath('broken $$ math');
    expect(segments).to.have.length(0);
    expect(masked).to.equal('broken $$ math');
  });
});
