import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  buildMatcher,
  countMatches,
  isProbablyBinary,
  prepareReplacement,
  planReplacements,
  applyReplacements,
  totalHits
} from '../../src/utils/exampleTextReplace';
import type { ReplaceOptions } from '../../src/utils/exampleTextReplace';

/**
 * The global replacer rewrites every file of every filtered example in one go
 * (computor-org/issues#341). There is no undo short of re-checking-out, so the
 * counting and the escaping are the parts that have to be right before the
 * dialog ever quotes a number.
 */

let workspace: string;

function options(overrides: Partial<ReplaceOptions> = {}): ReplaceOptions {
  return { find: 'TODO', replace: 'FIXME', regex: false, matchCase: false, ...overrides };
}

function writeExample(directory: string, files: Record<string, string | Buffer>): { directory: string; dirPath: string } {
  const dirPath = path.join(workspace, directory);
  for (const [relative, contents] of Object.entries(files)) {
    const full = path.join(dirPath, relative);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, contents as never);
  }
  return { directory, dirPath };
}

function read(target: { dirPath: string }, relative: string): string {
  return fs.readFileSync(path.join(target.dirPath, relative), 'utf8');
}

beforeEach(() => {
  workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'computor-replace-'));
});

afterEach(() => {
  fs.rmSync(workspace, { recursive: true, force: true });
});

describe('example text replace — matching', () => {
  it('treats the pattern literally unless regex is on', () => {
    expect(countMatches('a.c abc', buildMatcher(options({ find: 'a.c' })))).to.equal(1);
    expect(countMatches('a.c abc', buildMatcher(options({ find: 'a.c', regex: true })))).to.equal(2);
  });

  it('ignores case unless match case is on', () => {
    expect(countMatches('todo TODO ToDo', buildMatcher(options()))).to.equal(3);
    expect(countMatches('todo TODO ToDo', buildMatcher(options({ matchCase: true })))).to.equal(1);
  });

  it('does not hang on a pattern that matches the empty string', () => {
    expect(countMatches('aaa', buildMatcher(options({ find: 'b*', regex: true })))).to.equal(4);
  });

  it('keeps $ literal when regex is off', () => {
    expect(prepareReplacement(options({ replace: '$100' }))).to.equal('$$100');
    expect(prepareReplacement(options({ replace: '$100', regex: true }))).to.equal('$100');
  });
});

describe('example text replace — planning', () => {
  it('counts hits per file and per example, and skips examples with none', () => {
    const first = writeExample('alpha', {
      'main.py': '# TODO: one\n# TODO: two\n',
      'README.md': 'nothing here\n'
    });
    const second = writeExample('beta', { 'main.py': 'TODO\n' });
    const third = writeExample('gamma', { 'main.py': 'all done\n' });

    const plans = planReplacements([first, second, third], options());

    expect(plans.map(p => p.directory)).to.deep.equal(['alpha', 'beta']);
    expect(plans[0]!.total).to.equal(2);
    expect(plans[0]!.files.map(f => f.relativePath)).to.deep.equal(['main.py']);
    expect(totalHits(plans)).to.deep.equal({ files: 2, replacements: 3 });
  });

  it('finds files in nested directories', () => {
    const target = writeExample('alpha', { 'content/solution/task.py': 'TODO\n' });
    const plans = planReplacements([target], options());
    expect(plans[0]!.files[0]!.relativePath).to.equal('content/solution/task.py');
  });

  it('skips the excluded names the rest of the example tooling skips', () => {
    const target = writeExample('alpha', {
      'main.py': 'TODO\n',
      '.computor-example.json': '{"note":"TODO"}',
      'node_modules/pkg/index.js': 'TODO',
      '__pycache__/main.pyc': 'TODO'
    });

    const plans = planReplacements([target], options());
    expect(plans[0]!.files.map(f => f.relativePath)).to.deep.equal(['main.py']);
  });

  it('leaves binaries alone, by extension and by content', () => {
    const target = writeExample('alpha', {
      'main.py': 'TODO\n',
      'diagram.png': Buffer.from('TODO plus pixels'),
      'data.bin': Buffer.concat([Buffer.from('TODO'), Buffer.from([0x00]), Buffer.from('more')])
    });

    const plans = planReplacements([target], options());
    expect(plans[0]!.files.map(f => f.relativePath)).to.deep.equal(['main.py']);
  });

  it('recognises a NUL byte as binary regardless of extension', () => {
    expect(isProbablyBinary('notes.txt', Buffer.from('clean text'))).to.equal(false);
    expect(isProbablyBinary('notes.txt', Buffer.from([0x61, 0x00, 0x62]))).to.equal(true);
    expect(isProbablyBinary('diagram.png', Buffer.from('clean text'))).to.equal(true);
  });
});

describe('example text replace — applying', () => {
  it('rewrites every match and reports the totals', () => {
    const first = writeExample('alpha', { 'main.py': '# TODO: one\n# TODO: two\n' });
    const second = writeExample('beta', { 'main.py': 'TODO\n' });

    const opts = options();
    const summary = applyReplacements(planReplacements([first, second], opts), opts);

    expect(summary).to.deep.equal({ examples: 2, files: 2, replacements: 3, errors: [] });
    expect(read(first, 'main.py')).to.equal('# FIXME: one\n# FIXME: two\n');
    expect(read(second, 'main.py')).to.equal('FIXME\n');
  });

  it('supports capture groups in regex mode', () => {
    const target = writeExample('alpha', { 'meta.yaml': 'version: "v1.0"\nother: v2.0\n' });
    const opts = options({ find: 'v(\\d+)\\.0', replace: 'v$1.1', regex: true });

    applyReplacements(planReplacements([target], opts), opts);

    expect(read(target, 'meta.yaml')).to.equal('version: "v1.1"\nother: v2.1\n');
  });

  it('inserts $-signs verbatim in literal mode', () => {
    const target = writeExample('alpha', { 'main.py': 'cost = PRICE\n' });
    const opts = options({ find: 'PRICE', replace: '$100 & $&' });

    applyReplacements(planReplacements([target], opts), opts);

    expect(read(target, 'main.py')).to.equal('cost = $100 & $&\n');
  });

  it('deletes the matches when the replacement is empty', () => {
    const target = writeExample('alpha', { 'main.py': 'keep TODO keep\n' });
    const opts = options({ replace: '' });

    applyReplacements(planReplacements([target], opts), opts);

    expect(read(target, 'main.py')).to.equal('keep  keep\n');
  });

  it('reports a file it cannot read without abandoning the rest', () => {
    const target = writeExample('alpha', { 'main.py': 'TODO\n', 'other.py': 'TODO\n' });
    const plans = planReplacements([target], options());
    plans[0]!.files.push({
      filePath: path.join(target.dirPath, 'vanished.py'),
      relativePath: 'vanished.py',
      count: 1
    });

    const summary = applyReplacements(plans, options());

    expect(summary.replacements).to.equal(2);
    expect(summary.errors).to.have.lengthOf(1);
    expect(summary.errors[0]).to.contain('vanished.py');
  });
});
