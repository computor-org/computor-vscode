import { expect } from 'chai';

import { LecturerExampleTreeProvider } from '../../../src/ui/tree/lecturer/LecturerExampleTreeProvider';

/**
 * Search and the category/tag filters lived only as icons in the view's title
 * bar. VS Code lets anyone hide those from the right-click menu, permanently
 * and in storage the extension cannot reach, and a lecturer who did that was
 * left with a filtered tree and nothing saying so — no way back short of
 * "Reset Menu" (computor-org/issues#329).
 *
 * The filters are now rows inside the tree, always present, showing their own
 * state; and they survive a reload, as the repository filter already did.
 */

interface StoredState { [key: string]: unknown }

function fakeContext(state: StoredState = {}): any {
  return {
    globalState: {
      get: (key: string, fallback?: unknown) => (key in state ? state[key] : fallback),
      update: (key: string, value: unknown) => {
        state[key] = value;
        return Promise.resolve();
      }
    },
    subscriptions: [],
    extensionUri: { fsPath: '/tmp' }
  };
}

function makeProvider(state: StoredState = {}): LecturerExampleTreeProvider {
  // The API service is never touched by the root/filter rows.
  return new LecturerExampleTreeProvider(fakeContext(state), {} as any);
}

async function rootLabels(provider: LecturerExampleTreeProvider): Promise<string[]> {
  const roots = await provider.getChildren();
  return roots.map((item) => String(item.label));
}

async function filterRows(provider: LecturerExampleTreeProvider): Promise<any[]> {
  const roots = await provider.getChildren();
  const filters = roots.find((item) => item.id === 'root-filters');
  expect(filters, 'the tree has a Filters section').to.not.equal(undefined);
  return provider.getChildren(filters);
}

describe('example tree filters', () => {
  it('shows the filter rows even when nothing is filtered', async () => {
    const provider = makeProvider();

    expect(await rootLabels(provider)).to.deep.equal(['Filters', 'Repositories', 'Examples']);

    const rows = await filterRows(provider);
    expect(rows.map((row) => String(row.label))).to.deep.equal(['Search', 'Category', 'Tags']);
    expect(rows.map((row) => String(row.description))).to.deep.equal(['none', 'none', 'none']);
  });

  it('shows what each filter is currently set to', async () => {
    const provider = makeProvider();
    provider.setSearchQuery('matrix');
    provider.setCategory('Advanced');
    provider.setTags(['loops', 'arrays']);

    const rows = await filterRows(provider);
    expect(rows.map((row) => String(row.description))).to.deep.equal([
      'matrix',
      'Advanced',
      'loops, arrays'
    ]);
  });

  it('opens the picker on click instead of clearing the filter', async () => {
    const provider = makeProvider();
    provider.setSearchQuery('matrix');

    const [search] = await filterRows(provider);
    expect(search.command?.command).to.equal('computor.lecturer.searchExamples');
  });

  it('offers the clear action only while a filter is set', async () => {
    const provider = makeProvider();

    let [search] = await filterRows(provider);
    expect(search.contextValue).to.equal('exampleFilter_search');

    provider.setSearchQuery('matrix');
    [search] = await filterRows(provider);
    expect(search.contextValue).to.equal('exampleFilter_search_active');
  });

  it('keeps the filters through a reload', async () => {
    const state: StoredState = {};
    const first = makeProvider(state);
    first.setSearchQuery('matrix');
    first.setCategory('Advanced');
    first.setTags(['loops']);

    const reopened = makeProvider(state);
    expect(reopened.getSearchQuery()).to.equal('matrix');
    expect(reopened.getSelectedCategory()).to.equal('Advanced');
    expect(reopened.getSelectedTags()).to.deep.equal(['loops']);
  });

  it('forgets a filter once it is cleared', async () => {
    const state: StoredState = {};
    const first = makeProvider(state);
    first.setSearchQuery('matrix');
    first.clearSearch();

    expect(makeProvider(state).getSearchQuery()).to.equal('');
  });
});
