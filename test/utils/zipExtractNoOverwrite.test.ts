import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import JSZip from 'jszip';

import { extractZipBuffer } from '../../src/utils/zipHelpers';

/**
 * Download-mode setup (and its "Try again") extracts the course template into
 * the learner's repository, which already holds their work.
 */
describe('extractZipBuffer with overwrite: false', () => {
  let dest: string;
  let archive: Buffer;

  beforeEach(async () => {
    dest = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'computor-extract-'));
    const zip = new JSZip();
    zip.file('repo-abc/week_1/solution.py', 'template\n');
    zip.file('repo-abc/week_1/README.md', 'readme\n');
    archive = await zip.generateAsync({ type: 'nodebuffer' });
  });

  afterEach(async () => {
    await fs.promises.rm(dest, { recursive: true, force: true });
  });

  it('keeps a learner-modified file and restores a missing one', async () => {
    await extractZipBuffer(archive, dest, { overwrite: false });
    const solution = path.join(dest, 'week_1', 'solution.py');
    await fs.promises.writeFile(solution, 'my work\n');
    await fs.promises.rm(path.join(dest, 'week_1', 'README.md'));

    const written = await extractZipBuffer(archive, dest, { overwrite: false });

    expect(await fs.promises.readFile(solution, 'utf8')).to.equal('my work\n');
    expect(await fs.promises.readFile(path.join(dest, 'week_1', 'README.md'), 'utf8')).to.equal('readme\n');
    expect(written).to.equal(1);
  });

  it('still overwrites by default', async () => {
    await extractZipBuffer(archive, dest);
    const solution = path.join(dest, 'week_1', 'solution.py');
    await fs.promises.writeFile(solution, 'edited\n');
    await extractZipBuffer(archive, dest);
    expect(await fs.promises.readFile(solution, 'utf8')).to.equal('template\n');
  });
});
