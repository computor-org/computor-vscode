/*
 * Math-aware markdown rendering for preview webviews.
 *
 * Loaded after base.js (and after lib/marked.min.js + lib/katex.min.js in
 * views that want math). Exposes `window.ComputorWebview.renderMarkdown`.
 *
 * Math must be lifted out of the source BEFORE marked runs: marked treats
 * `\\` as an escaped backslash and `_` as emphasis, so TeX that reaches the
 * markdown parser comes out mangled (issue #267). Each math segment is
 * swapped for an opaque placeholder token, the masked source goes through
 * marked, and the tokens are then replaced with KaTeX output in the HTML.
 *
 * Also consumed by the unit tests via CommonJS (no DOM required).
 */
(function (global, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  if (global) {
    global.ComputorWebview = global.ComputorWebview || {};
    global.ComputorWebview.renderMarkdown = api.renderMarkdown;
  }
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  const HTML_ESCAPE_MAP = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };

  function escapeHtml(value) {
    if (value === null || value === undefined || value === '') {
      return '';
    }
    return String(value).replace(/[&<>"']/g, (m) => HTML_ESCAPE_MAP[m]);
  }

  /**
   * Replaces math segments in markdown source with placeholder tokens.
   *
   * Recognized (outside fenced code blocks and inline code spans):
   *   $$ ... $$   display, may span lines
   *   \[ ... \]   display
   *   \( ... \)   inline
   *   $ ... $     inline, single line, with currency guards: the opening $
   *               must be followed by a non-space, the closing $ preceded by
   *               a non-space and not followed by a digit, and a span that
   *               contains whitespace must also contain a TeX-ish character
   *               ("$5 and $10", "$10, or 100$" and "100$" pass through
   *               untouched; "$a + b$" renders). \$ never opens math.
   *
   * Indented (4-space) code blocks are not tracked; a $$ inside one would be
   * extracted. Accepted: rare in practice and the math still renders visibly.
   *
   * Returns { masked, segments: [{ token, tex, displayMode }] }.
   */
  function extractMath(source) {
    const text = String(source);
    const n = text.length;
    const out = [];
    const segments = [];

    let nonce = Math.random().toString(36).slice(2, 10);
    while (text.indexOf('@@MATH-' + nonce) !== -1) {
      nonce = Math.random().toString(36).slice(2, 10);
    }

    function takeMath(tex, displayMode) {
      const token = '@@MATH-' + nonce + '-' + segments.length + '@@';
      segments.push({ token: token, tex: tex, displayMode: displayMode });
      out.push(token);
    }

    const atLineStart = (idx) => idx === 0 || text[idx - 1] === '\n';

    // Prose like "$10, or 100$" satisfies the boundary guards; require a
    // spaced span to look like TeX before treating it as math.
    const texLikely = (content) => !/\s/.test(content) || /[\\^_{}=+*/<>|()]/.test(content);

    let i = 0;
    while (i < n) {
      const ch = text[i];

      if (ch === '\\') {
        const next = text[i + 1];
        if (next === '[' || next === '(') {
          const closeSeq = next === '[' ? '\\]' : '\\)';
          const close = text.indexOf(closeSeq, i + 2);
          if (close !== -1) {
            takeMath(text.slice(i + 2, close), next === '[');
            i = close + 2;
            continue;
          }
        }
        // Any other escape (incl. \$) passes through as a unit so the
        // escaped character can't be re-read as a math delimiter.
        out.push(text.slice(i, i + 2));
        i += 2;
        continue;
      }

      // Fenced code block: ``` or ~~~ (3+) at line start, closed by a line
      // holding at least as many of the same character, or EOF.
      if ((ch === '`' || ch === '~') && atLineStart(i)) {
        let runEnd = i;
        while (runEnd < n && text[runEnd] === ch) runEnd++;
        const runLen = runEnd - i;
        if (runLen >= 3) {
          const lineEnd = text.indexOf('\n', runEnd);
          if (lineEnd === -1) {
            out.push(text.slice(i));
            i = n;
            continue;
          }
          const closeRe = new RegExp('^' + ch + '{' + runLen + ',}[ \\t]*$', 'm');
          const match = closeRe.exec(text.slice(lineEnd + 1));
          const end = match ? lineEnd + 1 + match.index + match[0].length : n;
          out.push(text.slice(i, end));
          i = end;
          continue;
        }
      }

      // Inline code span: a backtick run closes at the next run of the same
      // length; everything inside is untouched.
      if (ch === '`') {
        let runEnd = i;
        while (runEnd < n && text[runEnd] === '`') runEnd++;
        const runLen = runEnd - i;
        let j = runEnd;
        let close = -1;
        while (j < n) {
          if (text[j] === '`') {
            let k = j;
            while (k < n && text[k] === '`') k++;
            if (k - j === runLen) {
              close = k;
              break;
            }
            j = k;
          } else {
            j++;
          }
        }
        if (close !== -1) {
          out.push(text.slice(i, close));
          i = close;
        } else {
          out.push(text.slice(i, runEnd));
          i = runEnd;
        }
        continue;
      }

      if (ch === '$' && text[i + 1] === '$') {
        const close = text.indexOf('$$', i + 2);
        if (close !== -1) {
          takeMath(text.slice(i + 2, close), true);
          i = close + 2;
          continue;
        }
        out.push('$$');
        i += 2;
        continue;
      }

      if (ch === '$') {
        const next = text[i + 1];
        if (next && next !== ' ' && next !== '\t' && next !== '\n') {
          let j = i + 1;
          let close = -1;
          while (j < n && text[j] !== '\n') {
            if (text[j] === '$' && text[j - 1] !== '\\') {
              const prev = text[j - 1];
              const after = text[j + 1];
              if (prev !== ' ' && prev !== '\t' && !(after >= '0' && after <= '9')) {
                close = j;
              }
              break; // stop at the first unescaped $, guarded or not
            }
            j++;
          }
          if (close !== -1 && close > i + 1 && texLikely(text.slice(i + 1, close))) {
            takeMath(text.slice(i + 1, close), false);
            i = close + 1;
            continue;
          }
        }
        out.push('$');
        i += 1;
        continue;
      }

      // Plain text: copy up to the next character that could start a
      // construct we care about.
      let j = i + 1;
      while (j < n) {
        const c = text[j];
        if (c === '`' || c === '$' || c === '\\' || (c === '~' && text[j - 1] === '\n')) {
          break;
        }
        j++;
      }
      out.push(text.slice(i, j));
      i = j;
    }

    return { masked: out.join(''), segments: segments };
  }

  function renderTex(segment, katex) {
    if (katex && typeof katex.renderToString === 'function') {
      try {
        return katex.renderToString(segment.tex, {
          throwOnError: false,
          displayMode: segment.displayMode
        });
      } catch (err) {
        // fall through to the escaped-source form
      }
    }
    return '<code>' + escapeHtml(segment.tex) + '</code>';
  }

  /**
   * Markdown → HTML with math. `opts.math: false` disables the math pass;
   * `opts.marked` / `opts.katex` override the globals (used by unit tests).
   * Degrades gracefully: without katex the TeX source shows as escaped
   * code, without marked the text renders as escaped lines.
   */
  function renderMarkdown(markdown, opts) {
    opts = opts || {};
    const marked = opts.marked || (typeof window !== 'undefined' ? window.marked : undefined);
    const katex = opts.katex || (typeof window !== 'undefined' ? window.katex : undefined);
    const text = String(markdown === null || markdown === undefined ? '' : markdown).replace(/\r\n?/g, '\n');

    if (!marked || typeof marked.parse !== 'function') {
      return escapeHtml(text).replace(/\n/g, '<br/>');
    }
    if (opts.math === false) {
      return marked.parse(text);
    }

    const extraction = extractMath(text);
    let html = marked.parse(extraction.masked);
    extraction.segments.forEach((segment) => {
      // Replacement via function so `$` sequences in KaTeX output are not
      // interpreted as replacement patterns.
      html = html.replace(segment.token, () => renderTex(segment, katex));
    });
    return html;
  }

  return {
    renderMarkdown: renderMarkdown,
    extractMath: extractMath,
    escapeHtml: escapeHtml
  };
});
