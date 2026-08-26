import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { buildCourseExportZip } from '../../src/utils/courseExportZip';

/**
 * One example may be used by two contents of the same course -- the same
 * exercise in week 2 and week 5 (computor-org/issues#150). They deliberately
 * land in different directories, so the export must name its folders after the
 * deployment directory. Naming them after the example identifier, which is the
 * same string for both, collapsed the two assignments into one folder and lost
 * whichever was written first.
 */
describe('course export naming', () => {
  const EXAMPLE = 'mathematical_constants';
  let workspaceRoot: string;

  function content(id: string, contentPath: string, directory: string) {
    return {
      id,
      path: contentPath,
      title: contentPath,
      directory,
      submission_group: {
        id: `sg-${id}`,
        example_identifier: EXAMPLE,
        repository: { full_path: 'course/student' }
      }
    } as any;
  }

  beforeEach(() => {
    workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'computor-export-'));
    const repo = path.join(workspaceRoot, 'student', 'course.student');
    for (const dir of [EXAMPLE, `${EXAMPLE}-week5`]) {
      fs.mkdirSync(path.join(repo, dir), { recursive: true });
      fs.writeFileSync(path.join(repo, dir, 'main.py'), dir);
    }
  });

  afterEach(() => {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it('gives two contents on one example two folders', async () => {
    const result = await buildCourseExportZip({
      contents: [
        content('c1', 'week2.constants', EXAMPLE),
        content('c2', 'week5.constants', `${EXAMPLE}-week5`)
      ],
      workspaceRoot,
      format: 'flat'
    } as any);

    expect(result.packaged).to.equal(2);
    const folders = new Set(
      Object.keys(result.zip.files).map(f => f.split('/')[0])
    );
    expect(folders).to.include(EXAMPLE);
    expect(folders).to.include(`${EXAMPLE}-week5`);
  });

  it('keeps the two files apart', async () => {
    const result = await buildCourseExportZip({
      contents: [
        content('c1', 'week2.constants', EXAMPLE),
        content('c2', 'week5.constants', `${EXAMPLE}-week5`)
      ],
      workspaceRoot,
      format: 'flat'
    } as any);

    const first = result.zip.file(`${EXAMPLE}/main.py`);
    const second = result.zip.file(`${EXAMPLE}-week5/main.py`);
    expect(first, 'week 2 folder').to.not.equal(null);
    expect(second, 'week 5 folder').to.not.equal(null);
    expect(await second!.async('string')).to.equal(`${EXAMPLE}-week5`);
  });
});
