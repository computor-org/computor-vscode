import { expect } from 'chai';

import * as vscode from 'vscode';

import { LecturerExampleTreeProvider } from '../../../src/ui/tree/lecturer/LecturerExampleTreeProvider';
import { WorkspaceStructureManager } from '../../../src/utils/workspaceStructure';

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

/**
 * The bulk actions on the [Examples] row -- checkout, cleanup, replace -- are
 * all specified as acting "according to the filter settings"
 * (computor-org/issues#339, #340, #341). They read the same list the tree
 * renders, so the guarantee is structural rather than a second filter
 * implementation kept in step by hand.
 */

function example(overrides: Record<string, unknown> = {}): any {
  return {
    id: 'ex-1',
    directory: 'alpha',
    identifier: 'alpha',
    title: 'Alpha',
    category: null,
    tags: [],
    example_repository_id: 'repo-1',
    ...overrides
  };
}

function providerWith(examplesByRepo: Record<string, any[]>, state: StoredState = {}): LecturerExampleTreeProvider {
  const api = {
    getExampleRepositories: async () =>
      Object.keys(examplesByRepo).map(id => ({ id, name: `Repo ${id}`, source_type: 'git' })),
    getExamples: async (repositoryId: string) => examplesByRepo[repositoryId] ?? []
  };
  return new LecturerExampleTreeProvider(fakeContext(state), api as any);
}

async function filteredIdentifiers(provider: LecturerExampleTreeProvider): Promise<string[]> {
  const merged = await provider.getFilteredMergedExamples();
  return merged.map(m => m.identifier);
}

describe('example filters drive the bulk actions', () => {
  beforeEach(() => {
    // No workspace: the local scan stays empty, so these cases are purely
    // about the filter chain over the remote list.
    (vscode.workspace as any).workspaceFolders = undefined;
    (WorkspaceStructureManager as any).instance = undefined;
  });

  it('returns every example when nothing is filtered', async () => {
    const provider = providerWith({
      'repo-1': [example(), example({ id: 'ex-2', identifier: 'beta', title: 'Beta', directory: 'beta' })]
    });

    expect(await filteredIdentifiers(provider)).to.deep.equal(['alpha', 'beta']);
  });

  it('narrows by search across title, identifier and tags', async () => {
    const provider = providerWith({
      'repo-1': [
        example({ title: 'Matrix multiplication' }),
        example({ id: 'ex-2', identifier: 'beta', title: 'Beta', directory: 'beta' }),
        example({ id: 'ex-3', identifier: 'gamma', title: 'Gamma', directory: 'gamma', tags: ['matrix'] })
      ]
    });

    provider.setSearchQuery('matrix');
    expect(await filteredIdentifiers(provider)).to.deep.equal(['alpha', 'gamma']);
  });

  it('narrows by category', async () => {
    const provider = providerWith({
      'repo-1': [
        example({ category: 'Advanced' }),
        example({ id: 'ex-2', identifier: 'beta', directory: 'beta', category: 'Basic' })
      ]
    });

    provider.setCategory('Advanced');
    expect(await filteredIdentifiers(provider)).to.deep.equal(['alpha']);
  });

  it('requires every selected tag, not just one of them', async () => {
    const provider = providerWith({
      'repo-1': [
        example({ tags: ['loops', 'arrays'] }),
        example({ id: 'ex-2', identifier: 'beta', directory: 'beta', tags: ['loops'] })
      ]
    });

    provider.setTags(['loops', 'arrays']);
    expect(await filteredIdentifiers(provider)).to.deep.equal(['alpha']);
  });

  it('narrows by repository', async () => {
    const provider = providerWith({
      'repo-1': [example()],
      'repo-2': [example({ id: 'ex-2', identifier: 'beta', directory: 'beta', example_repository_id: 'repo-2' })]
    });

    provider.toggleRepositoryFilter('repo-2');
    expect(await filteredIdentifiers(provider)).to.deep.equal(['beta']);
  });

  it('combines filters rather than letting the last one win', async () => {
    const provider = providerWith({
      'repo-1': [
        example({ category: 'Advanced', tags: ['loops'] }),
        example({ id: 'ex-2', identifier: 'beta', directory: 'beta', category: 'Advanced', tags: [] }),
        example({ id: 'ex-3', identifier: 'gamma', directory: 'gamma', category: 'Basic', tags: ['loops'] })
      ]
    });

    provider.setCategory('Advanced');
    provider.setTags(['loops']);
    expect(await filteredIdentifiers(provider)).to.deep.equal(['alpha']);
  });

  it('hands the bulk actions exactly the rows the tree is showing', async () => {
    const provider = providerWith({
      'repo-1': [
        example({ category: 'Advanced' }),
        example({ id: 'ex-2', identifier: 'beta', directory: 'beta', category: 'Basic' })
      ]
    });
    provider.setCategory('Advanced');

    const roots = await provider.getChildren();
    const section = roots.find((item) => item.id === 'root-examples');
    const rows = await provider.getChildren(section);

    expect(rows.map((row) => String(row.label))).to.deep.equal(await filteredIdentifiers(provider));
  });

  it('describes the active filters for the confirmation dialogs', async () => {
    const provider = providerWith({ 'repo-1': [] });
    expect(provider.describeActiveFilters()).to.deep.equal([]);

    provider.setSearchQuery('matrix');
    provider.setCategory('Advanced');
    provider.setTags(['loops', 'arrays']);
    provider.toggleRepositoryFilter('repo-1');

    expect(provider.describeActiveFilters()).to.deep.equal([
      'search: "matrix"',
      'category: Advanced',
      'tags: loops, arrays',
      'repositories: 1 selected'
    ]);
  });
});
