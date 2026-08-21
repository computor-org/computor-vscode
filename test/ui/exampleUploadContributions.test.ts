import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Uploading a changed example used to be reachable only from the `working`
 * child node (or the details webview), so right-clicking the example row —
 * where everyone looks — offered no upload at all.
 */

const pkg = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')
);

const EXAMPLES_VIEW = 'computor.lecturer.examples';
const UPLOAD = 'computor.lecturer.uploadExample';

interface MenuEntry { command: string; when?: string; group?: string }

const contextMenus: MenuEntry[] = pkg.contributes.menus['view/item/context'];

const uploadEntries = contextMenus.filter(
  entry => entry.command === UPLOAD && (entry.when || '').includes(`view == ${EXAMPLES_VIEW}`)
);

/** Menu entries on the examples view that would show for `contextValue`. */
function entriesFor(contextValue: string): MenuEntry[] {
  return uploadEntries.filter(entry => (entry.when || '').includes(`viewItem == ${contextValue}`));
}

describe('example upload contributions', () => {
  it('offers upload on the checked-out example row', () => {
    expect(entriesFor('exampleCheckedOut').length).to.be.greaterThan(0);
  });

  it('offers upload on a local-only example row', () => {
    // "Create New Example" produces a row with no remote counterpart; without
    // this entry a freshly authored example can never be pushed from the tree.
    expect(entriesFor('exampleLocalOnly').length).to.be.greaterThan(0);
  });

  it('keeps upload on the working copy node', () => {
    expect(entriesFor('checkedOutWorking').length).to.be.greaterThan(0);
  });

  it('gates every upload entry on the authoring role', () => {
    for (const entry of uploadEntries) {
      expect(entry.when, 'upload entry is ungated').to.contain('computor.examples.canAuthor');
    }
  });

  it('sorts upload above the destructive entries on every row it shows on', () => {
    const dangerGroups = contextMenus
      .filter(entry => (entry.when || '').includes(`view == ${EXAMPLES_VIEW}`))
      .filter(entry => (entry.group || '').startsWith('3_danger'))
      .map(entry => (entry.group || '').split('@')[0] as string);
    for (const entry of uploadEntries) {
      const group = (entry.group || '').split('@')[0] as string;
      for (const danger of dangerGroups) {
        expect(group < danger, `${group} sorts after ${danger}`).to.equal(true);
      }
    }
  });
});
