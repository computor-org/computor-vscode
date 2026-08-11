import { expect } from 'chai';

// Plain-JS webview asset with a CommonJS export for Node-side testing.
// Default-imported because the export is assigned inside an IIFE, which the
// ESM named-export lexer can't see.
// @ts-ignore -- no type declarations for the plain-JS asset
import threadsAsset from '../../webview-ui/shared/messageThreads.js';

type Msg = {
  id: string;
  created_at?: string;
  updated_at?: string;
  parent_id?: string | null;
  level?: number;
};

const { buildThreads, flattenThreads, compareWritten } = threadsAsset as {
  buildThreads: (m: Msg[], o?: { newestFirst?: boolean }) => any[];
  flattenThreads: (t: any[], d?: number) => any[];
  compareWritten: (a: Msg, b: Msg) => number;
};

const at = (min: number) => `2026-08-11T12:${String(min).padStart(2, '0')}:00Z`;

const msg = (id: string, min: number, parent_id: string | null = null): Msg => ({
  id,
  created_at: at(min),
  parent_id
});

const ids = (nodes: any[]) => nodes.map((n) => n.id);

describe('webview-ui/shared/messageThreads — ordering', () => {
  it('orders a conversation oldest first', () => {
    const roots = buildThreads([msg('c', 3), msg('a', 1), msg('b', 2)]);
    expect(ids(roots)).to.deep.equal(['a', 'b', 'c']);
  });

  it('orders an announcement board newest first', () => {
    const roots = buildThreads([msg('a', 1), msg('b', 2), msg('c', 3)], {
      newestFirst: true
    });
    expect(ids(roots)).to.deep.equal(['c', 'b', 'a']);
  });

  it('never reorders on an edit', () => {
    // Sorting on `updated_at || created_at` moved a three-week-old message to
    // the bottom of the thread the moment someone fixed a typo in it.
    const old = { ...msg('old', 1), updated_at: at(59) };
    const recent = msg('recent', 30);
    expect(ids(buildThreads([old, recent]))).to.deep.equal(['old', 'recent']);
  });

  it('is stable when timestamps collide', () => {
    const a = { id: 'a', created_at: at(5), parent_id: null };
    const b = { id: 'b', created_at: at(5), parent_id: null };
    expect(ids(buildThreads([b, a]))).to.deep.equal(['a', 'b']);
    expect(compareWritten(a, b)).to.be.lessThan(0);
  });

  it('tolerates messages with no timestamp', () => {
    const roots = buildThreads([{ id: 'z' } as Msg, msg('a', 1)]);
    expect(ids(roots)).to.have.members(['a', 'z']);
  });
});

describe('webview-ui/shared/messageThreads — nesting', () => {
  it('hangs replies off their parent', () => {
    const roots = buildThreads([msg('root', 1), msg('reply', 2, 'root')]);
    expect(ids(roots)).to.deep.equal(['root']);
    expect(ids(roots[0].children)).to.deep.equal(['reply']);
  });

  it('keeps replies in written order even under a newest-first list', () => {
    // A thread only makes sense forwards; only the roots flip.
    const roots = buildThreads(
      [
        msg('t1', 1),
        msg('t1r1', 2, 't1'),
        msg('t1r2', 3, 't1'),
        msg('t2', 10)
      ],
      { newestFirst: true }
    );
    expect(ids(roots)).to.deep.equal(['t2', 't1']);
    expect(ids(roots[1].children)).to.deep.equal(['t1r1', 't1r2']);
  });

  it('promotes a reply whose parent is not in this page', () => {
    // The parent may be filtered out or on another page — the reply must not
    // vanish with it.
    const roots = buildThreads([msg('orphan', 2, 'missing-parent')]);
    expect(ids(roots)).to.deep.equal(['orphan']);
  });

  it('does not mutate the input messages', () => {
    const input = [msg('root', 1), msg('reply', 2, 'root')];
    buildThreads(input);
    expect(input[0]).to.not.have.property('children');
  });

  it('handles an empty or missing list', () => {
    expect(buildThreads([])).to.deep.equal([]);
    expect(buildThreads(undefined as never)).to.deep.equal([]);
  });
});

describe('webview-ui/shared/messageThreads — flattening', () => {
  it('stamps depth by nesting, not by the stored level', () => {
    const roots = buildThreads([
      msg('root', 1),
      msg('r1', 2, 'root'),
      msg('r2', 3, 'r1')
    ]);
    const flat = flattenThreads(roots);
    expect(flat.map((m) => [m.id, m.level])).to.deep.equal([
      ['root', 0],
      ['r1', 1],
      ['r2', 2]
    ]);
  });

  it('keeps an orphaned reply indented via its stored level', () => {
    // Its parent is gone, but it is still a reply — flattening it to the
    // margin would read as a new top-level message.
    const orphan = { ...msg('orphan', 2, 'missing'), level: 1 };
    const flat = flattenThreads(buildThreads([orphan]));
    expect(flat[0].level).to.equal(1);
  });

  it('renders depth-first, parent immediately before its subtree', () => {
    const roots = buildThreads([
      msg('a', 1),
      msg('a1', 2, 'a'),
      msg('b', 5),
      msg('b1', 6, 'b')
    ]);
    expect(flattenThreads(roots).map((m) => m.id)).to.deep.equal([
      'a',
      'a1',
      'b',
      'b1'
    ]);
  });
});
