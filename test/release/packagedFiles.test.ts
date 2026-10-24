import { expect } from 'chai';
import { spawnSync } from 'child_process';
import * as path from 'path';

/**
 * Files the extension reads at run time must be in the VSIX. The welcome
 * page's assignment row (media/welcome) was left out by .vscodeignore, so the
 * installed page showed no picture although every unit test passed.
 */
describe('packaged files', function () {
  this.timeout(30000);

  it('ship the welcome row picture, the icon and both language files', () => {
    const root = path.resolve(__dirname, '../..');
    const vsce = require.resolve('@vscode/vsce/vsce', { paths: [root] });
    const listing = spawnSync(process.execPath, [vsce, 'ls', '--no-dependencies', '--no-yarn'], { cwd: root, encoding: 'utf8' });
    expect(listing.status, listing.stderr).to.equal(0);
    const files = listing.stdout.split(/\r?\n/);
    for (const file of ['media/welcome/assignment-row.svg', 'media/icon.png', 'package.nls.json', 'package.nls.de.json']) {
      expect(files, file).to.include(file);
    }
  });
});
