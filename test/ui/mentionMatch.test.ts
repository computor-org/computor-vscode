import { expect } from 'chai';

// Plain-JS webview asset with a CommonJS export for Node-side testing.
// Default-imported because the export is assigned inside an IIFE, which the
// ESM named-export lexer can't see.
// @ts-ignore -- no type declarations for the plain-JS asset
import mentionAsset from '../../webview-ui/shared/mention.js';

type Placement = { top: number | null; bottom: number | null; left: number; maxHeight: number };

const { matchMentionTrigger, mentionMatches, formatMentionName, foldName, hasTutorAliases, placeMentionList } =
  mentionAsset as {
    matchMentionTrigger: (before: unknown) => { query: string } | null;
    placeMentionList: (o: Record<string, unknown>) => Placement;
    hasTutorAliases: (users: unknown) => boolean;
    mentionMatches: (u: Record<string, unknown>, q: string) => boolean;
    formatMentionName: (u: Record<string, unknown> | null | undefined) => string;
    foldName: (s: unknown) => string;
  };

describe('webview-ui/shared/mention.js matchMentionTrigger', () => {
  it('captures an ASCII query after @', () => {
    expect(matchMentionTrigger('@Max')).to.deep.equal({ query: 'Max' });
  });

  it('keeps matching through non-ASCII letters (issue #278)', () => {
    // The old \w-based regex closed the dropdown on the first umlaut/accent,
    // which is exactly what the reporter hit typing German/Austrian names.
    expect(matchMentionTrigger('@Grü')).to.deep.equal({ query: 'Grü' });
    expect(matchMentionTrigger('Hi @Müller')).to.deep.equal({ query: 'Müller' });
    expect(matchMentionTrigger('@Schäfer')).to.deep.equal({ query: 'Schäfer' });
    expect(matchMentionTrigger('@Weiß')).to.deep.equal({ query: 'Weiß' });
    expect(matchMentionTrigger('@Jörg')).to.deep.equal({ query: 'Jörg' });
  });

  it('triggers on a bare @ with an empty query', () => {
    expect(matchMentionTrigger('@')).to.deep.equal({ query: '' });
    expect(matchMentionTrigger('hello @')).to.deep.equal({ query: '' });
  });

  it('allows dots, hyphens and underscores in the query', () => {
    expect(matchMentionTrigger('@anna-maria')).to.deep.equal({ query: 'anna-maria' });
    expect(matchMentionTrigger('@a.b_c')).to.deep.equal({ query: 'a.b_c' });
  });

  it('requires @ to start the text or follow whitespace (never mid-word)', () => {
    expect(matchMentionTrigger('foo@bar')).to.equal(null);
    expect(matchMentionTrigger('email@example')).to.equal(null);
  });

  it('does not trigger once the query is broken by a space', () => {
    expect(matchMentionTrigger('@Max Mu')).to.equal(null);
  });

  it('returns null when there is no @ context', () => {
    expect(matchMentionTrigger('hello world')).to.equal(null);
    expect(matchMentionTrigger('')).to.equal(null);
    expect(matchMentionTrigger(null)).to.equal(null);
  });
});

describe('webview-ui/shared/mention.js mentionMatches', () => {
  const muller = { given_name: 'Anna', family_name: 'Müller' };
  const weiss = { given_name: 'Jörg', family_name: 'Weiß' };

  it('finds the same Lena tutor by all three aliases and alias prefixes', () => {
    const tutor = { id: 'tutor-id', given_name: 'Lena', family_name: 'Tutor', aliases: ['lena', 'luna', 'ai'] };
    for (const query of ['lena', 'luna', 'ai', 'LUNA', 'AI', 'lu', 'a']) {
      expect(mentionMatches(tutor, query), query).to.equal(true);
      expect(formatMentionName(tutor)).to.equal('Lena Tutor');
    }
  });

  it('does not offer a same-named human for a reserved tutor alias', () => {
    for (const name of ['Lena', 'Luna', 'Ai']) {
      expect(mentionMatches({ given_name: name, family_name: 'Human', aliases: [] }, name)).to.equal(false);
    }
  });

  it('keeps name matching for older servers without alias metadata', () => {
    expect(mentionMatches({ given_name: 'Luna', family_name: 'Tutor' }, 'luna')).to.equal(true);
  });

  it('does not match a longer unrelated handle to the tutor', () => {
    const tutor = { given_name: 'Lena', aliases: ['lena', 'luna', 'ai'] };
    for (const query of ['lenabelle', 'lunatic', 'aimee']) {
      expect(mentionMatches(tutor, query)).to.equal(false);
    }
  });

  it('matches everything on an empty query', () => {
    expect(mentionMatches(muller, '')).to.equal(true);
  });

  it('is diacritic-insensitive both ways', () => {
    expect(mentionMatches(muller, 'muller')).to.equal(true); // typed without umlaut
    expect(mentionMatches(muller, 'Mül')).to.equal(true);    // typed with umlaut
    expect(mentionMatches(weiss, 'jorg')).to.equal(true);
  });

  it('folds German ß to ss', () => {
    expect(mentionMatches(weiss, 'weiss')).to.equal(true);
    expect(mentionMatches(weiss, 'weiß')).to.equal(true);
  });

  it('matches a substring of the full name and a prefix of either part', () => {
    expect(mentionMatches(muller, 'anna mü')).to.equal(true); // full-name substring
    expect(mentionMatches(muller, 'mü')).to.equal(true);      // family prefix
    expect(mentionMatches(muller, 'ann')).to.equal(true);     // given prefix
  });

  it('rejects a non-matching query', () => {
    expect(mentionMatches(muller, 'xyz')).to.equal(false);
  });
});

describe('webview-ui/shared/mention.js formatMentionName', () => {
  it('joins given and family names', () => {
    expect(formatMentionName({ given_name: 'Anna', family_name: 'Müller' })).to.equal('Anna Müller');
  });

  it('tolerates a missing part', () => {
    expect(formatMentionName({ given_name: 'Anna' })).to.equal('Anna');
    expect(formatMentionName({ family_name: 'Müller' })).to.equal('Müller');
  });

  it('falls back to "user" when there is no name', () => {
    expect(formatMentionName({})).to.equal('user');
    expect(formatMentionName(null)).to.equal('user');
  });
});

describe('webview-ui/shared/mention.js foldName', () => {
  it('strips diacritics and lower-cases', () => {
    expect(foldName('Grün')).to.equal('grun');
    expect(foldName('Schäfer')).to.equal('schafer');
  });

  it('handles nullish input', () => {
    expect(foldName(null)).to.equal('');
    expect(foldName(undefined)).to.equal('');
  });
});

describe('webview-ui/shared/mention.js hasTutorAliases', () => {
  it('is true only when the server advertises tutor aliases', () => {
    const tutor = { id: 't', given_name: 'Lena', aliases: ['lena', 'luna', 'ai'] };
    expect(hasTutorAliases([{ id: 'h', given_name: 'Anna', aliases: [] }, tutor])).to.equal(true);
  });

  it('is false for older servers without alias metadata or without the tutor', () => {
    expect(hasTutorAliases([{ id: 't', given_name: 'Luna', family_name: 'Tutor' }])).to.equal(false);
    expect(hasTutorAliases([{ id: 'h', given_name: 'Anna', aliases: [] }])).to.equal(false);
    expect(hasTutorAliases([])).to.equal(false);
    expect(hasTutorAliases(undefined)).to.equal(false);
  });
});

describe('webview-ui/shared/mention.js placeMentionList (issues#486)', () => {
  // A message panel docked at the bottom of the window: 180px tall, the caret
  // on the editor's first line. In flow below the editor, the list was clipped
  // here and showed no candidate at all.
  const base = { viewportWidth: 1400, listWidth: 200, max: 180, edge: 8, gap: 2 };

  it('opens below the caret when the list fits there', () => {
    const p = placeMentionList({ ...base, viewportHeight: 600, wanted: 150,
      caret: { top: 100, bottom: 118, left: 60 } });
    expect(p).to.deep.equal({ top: 120, bottom: null, left: 60, maxHeight: 180 });
  });

  it('opens above the caret in a short panel and caps the height to that room', () => {
    const p = placeMentionList({ ...base, viewportHeight: 180, wanted: 150,
      caret: { top: 110, bottom: 128, left: 60 } });
    expect(p.top).to.equal(null);
    expect(p.bottom).to.equal(180 - 110 + 2);
    expect(p.maxHeight).to.equal(110 - 8);
  });

  it('stays below when that side has more room, even if the list does not fit', () => {
    const p = placeMentionList({ ...base, viewportHeight: 200, wanted: 150,
      caret: { top: 40, bottom: 58, left: 60 } });
    expect(p.top).to.equal(60);
    expect(p.maxHeight).to.equal(200 - 58 - 8);
  });

  it('keeps the list inside a narrow panel', () => {
    const p = placeMentionList({ ...base, viewportWidth: 300, viewportHeight: 600, wanted: 100,
      caret: { top: 100, bottom: 118, left: 250 } });
    expect(p.left).to.equal(300 - 200 - 8);
  });
});
