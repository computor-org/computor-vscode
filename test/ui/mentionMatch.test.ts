import { expect } from 'chai';

// Plain-JS webview asset with a CommonJS export for Node-side testing.
// Default-imported because the export is assigned inside an IIFE, which the
// ESM named-export lexer can't see.
// @ts-ignore -- no type declarations for the plain-JS asset
import mentionAsset from '../../webview-ui/shared/mention.js';

const { matchMentionTrigger, mentionMatches, formatMentionName, foldName } =
  mentionAsset as {
    matchMentionTrigger: (before: unknown) => { query: string } | null;
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
