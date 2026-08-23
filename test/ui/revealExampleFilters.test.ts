import { expect } from 'chai';

import { LecturerExampleTreeProvider } from '../../src/ui/tree/lecturer/LecturerExampleTreeProvider';

/**
 * "Reveal in Examples" against the Examples view's persisted filters (#356).
 *
 * The lookup runs over the *unfiltered* merged list, but only filtered rows are
 * ever built as children of the section. A filter that excluded the target
 * therefore asked `TreeView.reveal()` for a row that was not in the tree: it
 * did nothing, and the method still answered `true`, so the caller's "Example
 * not found" warning never fired and the command looked dead.
 */
describe('revealExample and the examples filters', () => {
  interface Harness {
    self: any;
    revealed: string[];
    filtersCleared: number;
  }

  function harness(options: { merged: any[]; visible: any[] }): Harness {
    const revealed: string[] = [];
    const state = { filtersCleared: 0 };

    const self: any = {
      treeView: {
        reveal: async (item: any) => { revealed.push(item.id); }
      },
      parentMap: new Map<string, any>(),
      visible: options.visible,
      getMergedExamples: async () => options.merged,
      getFilteredMergedExamples: async () => self.visible,
      clearFilters: () => {
        state.filtersCleared += 1;
        // The real one drops every filter, so everything becomes visible.
        self.visible = options.merged;
      },
      getMergedExampleItems: async () => []
    };

    return {
      self,
      revealed,
      get filtersCleared() { return state.filtersCleared; }
    } as Harness;
  }

  function example(identifier: string, extra: any = {}): any {
    return {
      identifier,
      title: identifier,
      repositoryId: 'repo-1',
      repositoryName: 'Repository',
      remote: { id: `remote-${identifier}` },
      ...extra
    };
  }

  const reveal = (self: any, params: any): Promise<boolean> =>
    (LecturerExampleTreeProvider.prototype as any).revealExample.call(self, params);

  it('reveals a row that the current filters already show', async () => {
    const target = example('ex-1');
    const h = harness({ merged: [target], visible: [target] });

    expect(await reveal(h.self, { identifier: 'ex-1' })).to.equal(true);
    expect(h.revealed).to.have.length(1);
    expect(h.filtersCleared).to.equal(0);
  });

  it('clears the filters that hide the target, then reveals it', async () => {
    const target = example('ex-hidden');
    const h = harness({ merged: [target, example('ex-shown')], visible: [example('ex-shown')] });

    expect(await reveal(h.self, { identifier: 'ex-hidden' })).to.equal(true);
    expect(h.filtersCleared).to.equal(1);
    expect(h.revealed).to.have.length(1);
  });

  it('answers false when no example matches, so the caller can warn', async () => {
    const h = harness({ merged: [example('ex-1')], visible: [example('ex-1')] });

    expect(await reveal(h.self, { identifier: 'ex-absent' })).to.equal(false);
    expect(h.revealed).to.have.length(0);
    // Nothing to show is not a filter problem — leave the lecturer's filters be.
    expect(h.filtersCleared).to.equal(0);
  });

  it('matches on the remote id when the row carries no identifier', async () => {
    const target = example('ex-1');
    const h = harness({ merged: [target], visible: [target] });

    expect(await reveal(h.self, { id: 'remote-ex-1' })).to.equal(true);
  });

  it('keeps a repository-scoped lookup from matching a same-named example elsewhere', async () => {
    const target = example('shared-name', { repositoryId: 'repo-2', remote: { id: 'remote-b' } });
    const h = harness({ merged: [example('shared-name'), target], visible: [] });

    expect(await reveal(h.self, { identifier: 'shared-name', repositoryId: 'repo-2' })).to.equal(true);
    expect(h.revealed[0]).to.contain('repo-2');
  });

  describe('findMergedExample', () => {
    const find = (self: any, params: any): Promise<any> =>
      (LecturerExampleTreeProvider.prototype as any).findMergedExample.call(self, params);

    it('reports the checkout state the reveal command branches on', async () => {
      const checkedOut = example('ex-local', { local: { directory: 'ex-local' } });
      const h = harness({ merged: [checkedOut, example('ex-remote')], visible: [] });

      expect((await find(h.self, { identifier: 'ex-local' })).local).to.not.equal(undefined);
      expect((await find(h.self, { identifier: 'ex-remote' })).local).to.equal(undefined);
    });

    it('is undefined for an unknown example', async () => {
      const h = harness({ merged: [example('ex-1')], visible: [] });
      expect(await find(h.self, { identifier: 'nope' })).to.equal(undefined);
    });
  });
});
