import { expect } from 'chai';

import { LecturerExampleCommands } from '../../src/commands/LecturerExampleCommands';
import type { MergedExample } from '../../src/ui/tree/lecturer/LecturerExampleTreeProvider';
import type { CheckedOutExampleGroup } from '../../src/utils/checkedOutExampleManager';

/**
 * The bulk actions on the [Examples] row overwrite and delete local example
 * directories in one keystroke (computor-org/issues#339, #340). What they pick
 * up, and what they refuse to touch, is the whole safety story — so the rule
 * lives in a pure function rather than in the middle of a progress loop.
 */

const dirty = new Set<string>();
const isDirty = (group: CheckedOutExampleGroup) => dirty.has(group.directory);

function example(overrides: Partial<MergedExample> = {}): MergedExample {
  return {
    identifier: 'alpha',
    title: 'Alpha',
    repositoryId: 'repo-1',
    repositoryName: 'Repo One',
    remote: { id: 'ex-1', directory: 'alpha' } as any,
    ...overrides
  };
}

/** A checked-out example: working copy plus the snapshot it came from. */
function withWorkingCopy(identifier: string, overrides: Partial<MergedExample> = {}): MergedExample {
  const group = {
    directory: identifier,
    fullPath: `/ws/examples/${identifier}`,
    versions: [],
    workingVersion: { fullPath: `/ws/examples/${identifier}` }
  } as unknown as CheckedOutExampleGroup;
  return example({ identifier, local: group, ...overrides });
}

/** An example whose working copy is gone but whose snapshots remain. */
function snapshotOnly(identifier: string, overrides: Partial<MergedExample> = {}): MergedExample {
  const group = {
    directory: identifier,
    fullPath: `/ws/examples/${identifier}`,
    versions: [{ versionTag: '1.0.0' }]
  } as unknown as CheckedOutExampleGroup;
  return example({ identifier, local: group, ...overrides });
}

beforeEach(() => dirty.clear());

describe('selectForCheckout', () => {
  it('takes examples that are not checked out yet', () => {
    const result = LecturerExampleCommands.selectForCheckout([example({ identifier: 'alpha' })], isDirty);

    expect(result.selected.map(e => e.identifier)).to.deep.equal(['alpha']);
    expect(result.skipped).to.deep.equal([]);
  });

  it('overwrites a clean working copy rather than complaining it exists', () => {
    const result = LecturerExampleCommands.selectForCheckout([withWorkingCopy('alpha')], isDirty);

    expect(result.selected.map(e => e.identifier)).to.deep.equal(['alpha']);
  });

  it('never overwrites a working copy with local changes', () => {
    dirty.add('alpha');
    const result = LecturerExampleCommands.selectForCheckout(
      [withWorkingCopy('alpha'), withWorkingCopy('beta')],
      isDirty
    );

    expect(result.selected.map(e => e.identifier)).to.deep.equal(['beta']);
    expect(result.skipped).to.deep.equal(['alpha']);
  });

  it('ignores local-only rows, which have nothing to download', () => {
    const orphan = withWorkingCopy('orphan', { remote: undefined, repositoryId: null });
    const result = LecturerExampleCommands.selectForCheckout([orphan, example({ identifier: 'alpha' })], isDirty);

    expect(result.selected.map(e => e.identifier)).to.deep.equal(['alpha']);
    expect(result.skipped).to.deep.equal([]);
  });
});

describe('selectForCleanup', () => {
  it('takes clean working copies', () => {
    const result = LecturerExampleCommands.selectForCleanup([withWorkingCopy('alpha')], false, isDirty);

    expect(result.selected.map(e => e.identifier)).to.deep.equal(['alpha']);
  });

  it('never deletes an example marked as changed, at either depth', () => {
    dirty.add('alpha');

    for (const includeVersions of [false, true]) {
      const result = LecturerExampleCommands.selectForCleanup(
        [withWorkingCopy('alpha'), withWorkingCopy('beta')],
        includeVersions,
        isDirty
      );

      expect(result.selected.map(e => e.identifier)).to.deep.equal(['beta']);
      expect(result.skipped).to.deep.equal(['alpha']);
    }
  });

  it('leaves examples that were never checked out alone', () => {
    const result = LecturerExampleCommands.selectForCleanup([example({ identifier: 'alpha' })], true, isDirty);

    expect(result.selected).to.deep.equal([]);
    expect(result.skipped).to.deep.equal([]);
  });

  it('passes over a snapshot-only example when only working copies are swept', () => {
    const result = LecturerExampleCommands.selectForCleanup([snapshotOnly('alpha')], false, isDirty);

    expect(result.selected).to.deep.equal([]);
  });

  it('clears a snapshot-only example when versions are included — the only way it leaves the tree', () => {
    const result = LecturerExampleCommands.selectForCleanup([snapshotOnly('alpha')], true, isDirty);

    expect(result.selected.map(e => e.identifier)).to.deep.equal(['alpha']);
  });

  it('sweeps local-only orphans too, which no checkout would reclaim', () => {
    const orphan = withWorkingCopy('orphan', { remote: undefined, repositoryId: null });
    const result = LecturerExampleCommands.selectForCleanup([orphan], true, isDirty);

    expect(result.selected.map(e => e.identifier)).to.deep.equal(['orphan']);
  });
});
