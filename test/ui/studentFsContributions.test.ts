import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';

/**
 * The student filesystem commands are gated entirely by `when` clauses, so the
 * contributions ARE the behaviour — a wrong regex silently shows a destructive
 * command on the wrong row, or hides a working one.
 *
 * The regression this file mainly exists for: adding `.hasRepo` / `.hasDirectory`
 * to the course-root and unit context values would have stopped every
 * pre-existing `$`-anchored menu clause from matching, quietly removing
 * setup/download/update/export/help from the course root.
 */

// mocha runs from the repo root, and reading at module scope keeps every
// assertion below working against the real manifest.
const pkg = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')
);

const STUDENT_VIEW = 'computor.student.courses';

const FS_COMMANDS = [
  'newFile', 'newFolder', 'rename', 'delete', 'duplicate',
  'cut', 'copy', 'paste', 'revealInOS', 'copyPath', 'copyRelativePath'
].map(name => `computor.student.fs.${name}`);

interface MenuEntry { command: string; when?: string; group?: string }

const contextMenus: MenuEntry[] = pkg.contributes.menus['view/item/context'];

function studentEntries(command: string): MenuEntry[] {
  return contextMenus.filter(
    entry => entry.command === command && (entry.when || '').includes(`view == ${STUDENT_VIEW}`)
  );
}

/** Pull the `viewItem =~ /.../` pattern out of a when-clause and apply it. */
function matchesViewItem(when: string, contextValue: string): boolean {
  const marker = 'viewItem =~ /';
  const start = when.indexOf(marker);
  if (start < 0) { throw new Error(`no viewItem regex in: ${when}`); }
  const from = start + marker.length;
  const end = when.indexOf('/', from);
  if (end < 0) { throw new Error(`unterminated regex in: ${when}`); }
  return new RegExp(when.slice(from, end)).test(contextValue);
}

/** Every when-clause on the student view that gates on `command`. */
function whensFor(command: string): string[] {
  return studentEntries(command).map(entry => entry.when as string);
}

describe('student filesystem contributions', () => {
  it('declares every filesystem command', () => {
    const declared = new Set(pkg.contributes.commands.map((c: any) => c.command));
    for (const command of FS_COMMANDS) {
      expect(declared.has(command), `${command} not declared`).to.equal(true);
    }
  });

  it('files every filesystem command under the student category', () => {
    for (const command of FS_COMMANDS) {
      const declaration = pkg.contributes.commands.find((c: any) => c.command === command);
      expect(declaration.category).to.equal('Computor Student');
    }
  });

  it('gives every filesystem command a student context-menu entry', () => {
    for (const command of FS_COMMANDS) {
      expect(studentEntries(command).length, `${command} has no menu entry`).to.be.greaterThan(0);
    }
  });

  it('keeps the filesystem commands out of the inline row', () => {
    // The student view already carries seven inline buttons; these belong in
    // the context menu only.
    for (const command of FS_COMMANDS) {
      for (const entry of studentEntries(command)) {
        expect(entry.group || '', `${command} is inline`).to.not.match(/^inline/);
      }
    }
  });

  it('shows Paste only while something is on the clipboard', () => {
    for (const when of whensFor('computor.student.fs.paste')) {
      expect(when).to.contain('computor.student.fs.hasClipboard');
    }
  });
});

describe('student filesystem when-clauses', () => {
  const CONTAINERS = [
    'studentCourseContent.assignment.withRepository.cloned',
    'studentCourseContent.assignment.withRepository.cloned.gitManaged.individual',
    'studentFolder'
  ];

  // Course and unit rows are logical groupings whose directories the tree never
  // lists, so they get no filesystem actions at all.
  const NOT_CONTAINERS = [
    'studentCourseRoot',
    'studentCourseRoot.hasDescription',
    'studentCourseUnit',
    'studentCourseUnit.hasDescription',
    'studentCourseContent.assignment.withRepository.notCloned.gitManaged',
    'studentCourseContent.reading.individual',
    'studentFile'
  ];

  for (const command of ['computor.student.fs.newFile', 'computor.student.fs.newFolder']) {
    it(`offers ${command} on every node with a real directory`, () => {
      const when = whensFor(command)[0]!;
      for (const value of CONTAINERS) {
        expect(matchesViewItem(when, value), `expected match: ${value}`).to.equal(true);
      }
    });

    it(`hides ${command} where no directory exists`, () => {
      const when = whensFor(command)[0]!;
      for (const value of NOT_CONTAINERS) {
        expect(matchesViewItem(when, value), `expected no match: ${value}`).to.equal(false);
      }
    });
  }

  it('acts on filesystem rows only for rename/delete/duplicate/cut/copy', () => {
    const entryCommands = ['rename', 'delete', 'duplicate', 'cut', 'copy']
      .map(n => `computor.student.fs.${n}`);
    for (const command of entryCommands) {
      const when = whensFor(command)[0]!;
      expect(matchesViewItem(when, 'studentFile'), command).to.equal(true);
      expect(matchesViewItem(when, 'studentFolder'), command).to.equal(true);
      // An assignment row is not something a student may rename or delete.
      expect(
        matchesViewItem(when, 'studentCourseContent.assignment.withRepository.cloned'),
        command
      ).to.equal(false);
      expect(matchesViewItem(when, 'studentCourseRoot'), command).to.equal(false);
    }
  });

  it('offers Copy Path on files as well as containers', () => {
    for (const name of ['revealInOS', 'copyPath', 'copyRelativePath']) {
      const when = whensFor(`computor.student.fs.${name}`)[0]!;
      expect(matchesViewItem(when, 'studentFile'), name).to.equal(true);
      expect(
        matchesViewItem(when, 'studentCourseContent.assignment.withRepository.cloned'),
        name
      ).to.equal(true);
      expect(matchesViewItem(when, 'studentCourseRoot'), name).to.equal(false);
    }
  });
});

describe('course and unit rows keep their own menus untouched', () => {
  // The filesystem work deliberately left these context values alone; if a
  // later change starts appending suffixes, these $-anchored clauses are what
  // will silently stop matching.
  const ROOT_COMMANDS = [
    'computor.student.setupCourseRepository',
    'computor.student.downloadTemplate',
    'computor.student.updateFromTemplate',
    'computor.student.exportCourseExamples',
    'computor.student.help'
  ];

  it('still offers every course-root command on a plain root', () => {
    for (const command of ROOT_COMMANDS) {
      const whens = whensFor(command).filter(w => w.includes('studentCourseRoot'));
      expect(whens.length, `${command} lost its root entry`).to.be.greaterThan(0);
      for (const when of whens) {
        expect(matchesViewItem(when, 'studentCourseRoot'), command).to.equal(true);
        expect(matchesViewItem(when, 'studentCourseRoot.hasDescription'), command).to.equal(true);
      }
    }
  });

  it('offers no filesystem command on a course or unit row', () => {
    for (const command of FS_COMMANDS) {
      for (const when of whensFor(command)) {
        expect(matchesViewItem(when, 'studentCourseRoot'), command).to.equal(false);
        expect(matchesViewItem(when, 'studentCourseRoot.hasDescription'), command).to.equal(false);
        expect(matchesViewItem(when, 'studentCourseUnit'), command).to.equal(false);
        expect(matchesViewItem(when, 'studentCourseUnit.hasDescription'), command).to.equal(false);
      }
    }
  });
});
