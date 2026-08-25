import { expect } from 'chai';
import * as path from 'path';

import { safeExtractTarget } from '../../src/utils/zipHelpers';

/**
 * Zip entry names are attacker-controlled data. Submission archives are built
 * from student content and auto-extract on a TUTOR's machine when they expand a
 * tree node, so an entry named `../../.bashrc` would write outside the
 * destination on someone else's computer.
 */
describe('safeExtractTarget', () => {
  const dest = path.resolve('/tmp/computor/submission-42');

  it('resolves an ordinary entry inside the destination', () => {
    expect(safeExtractTarget(dest, 'week_1/solution.py'))
      .to.equal(path.join(dest, 'week_1', 'solution.py'));
  });

  it('refuses an entry that climbs out', () => {
    expect(safeExtractTarget(dest, '../../.bashrc')).to.equal(undefined);
    expect(safeExtractTarget(dest, 'week_1/../../../etc/passwd')).to.equal(undefined);
  });

  it('refuses an absolute entry', () => {
    expect(safeExtractTarget(dest, '/etc/passwd')).to.equal(undefined);
    expect(safeExtractTarget(dest, 'C:/Windows/system32/x')).to.equal(undefined);
  });

  it('refuses a backslash traversal', () => {
    // Zip names use forward slashes, but an archive can carry backslashes and
    // Windows treats them as separators.
    expect(safeExtractTarget(dest, '..\\..\\.bashrc')).to.equal(undefined);
  });

  it('refuses a sibling directory that shares the prefix', () => {
    // `/tmp/computor/submission-42-evil` starts with the destination string but
    // is not inside it.
    expect(safeExtractTarget(dest, '../submission-42-evil/x')).to.equal(undefined);
  });

  it('refuses an empty name', () => {
    expect(safeExtractTarget(dest, '')).to.equal(undefined);
  });

  it('allows internal traversal that stays inside', () => {
    expect(safeExtractTarget(dest, 'week_1/../week_2/notes.md'))
      .to.equal(path.join(dest, 'week_2', 'notes.md'));
  });
});
