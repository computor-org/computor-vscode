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
  'newFile', 'newFolder', 'copyTo', 'moveTo', 'deleteFile', 'deleteFolder',
  'rename', 'duplicate', 'cut', 'copy', 'paste',
  'revealInOS', 'copyPath', 'copyRelativePath'
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

  it('keeps the argument-hungry filesystem commands out of the palette', () => {
    // Every one of these needs a tree node; from the palette they would be
    // invoked with nothing and silently do nothing.
    const palette: MenuEntry[] = pkg.contributes.menus.commandPalette || [];
    for (const command of FS_COMMANDS) {
      const entry = palette.find(e => e.command === command);
      expect(entry, `${command} is still in the command palette`).to.not.equal(undefined);
      expect(entry!.when).to.equal('false');
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

  it('acts on filesystem rows only for rename/duplicate/cut/copy/copyTo/moveTo', () => {
    const entryCommands = ['rename', 'duplicate', 'cut', 'copy', 'copyTo', 'moveTo']
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
      expect(matchesViewItem(when, 'studentCourseRoot.gitManaged.cloned'), command).to.equal(false);
    }
  });

  it('splits Delete into the file and folder entries the menu shows', () => {
    const file = whensFor('computor.student.fs.deleteFile')[0]!;
    expect(matchesViewItem(file, 'studentFile')).to.equal(true);
    expect(matchesViewItem(file, 'studentFolder')).to.equal(false);

    const folder = whensFor('computor.student.fs.deleteFolder')[0]!;
    expect(matchesViewItem(folder, 'studentFolder')).to.equal(true);
    expect(matchesViewItem(folder, 'studentFile')).to.equal(false);
  });

  it('keeps the explorer actions in one contiguous block', () => {
    // The issue asked for Copy/Move/Delete to sit with New File and New Folder;
    // a different group name would render them as a separate section.
    for (const name of ['newFile', 'newFolder', 'copyTo', 'moveTo', 'deleteFile', 'deleteFolder']) {
      for (const entry of studentEntries(`computor.student.fs.${name}`)) {
        expect(entry.group || '', name).to.match(/^4_explorer@/);
      }
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

describe('course row menus follow the repository state', () => {
  // The course row now carries its git binding, so the menu can drop the
  // actions that do not apply. These are the shapes CourseRootItem emits.
  const MANAGED_CLONED = 'studentCourseRoot.gitManaged.cloned';
  const MANAGED_CLONED_DESC = 'studentCourseRoot.gitManaged.cloned.hasDescription';
  const MANAGED_FRESH = 'studentCourseRoot.gitManaged.notCloned';
  const EXTERNAL_CLONED = 'studentCourseRoot.gitExternal.cloned';
  const DOWNLOAD = 'studentCourseRoot.gitDownload.cloned';
  const UNKNOWN = 'studentCourseRoot.gitUnknown.notCloned';
  const EVERY_ROOT = [MANAGED_CLONED, MANAGED_CLONED_DESC, MANAGED_FRESH, EXTERNAL_CLONED, DOWNLOAD, UNKNOWN];

  const ALWAYS_AVAILABLE = [
    'computor.student.exportCourseExamples',
    'computor.student.help',
    'computor.student.showMessages'
  ];

  it('keeps the always-available course commands on every course row', () => {
    for (const command of ALWAYS_AVAILABLE) {
      const whens = whensFor(command).filter(w => w.includes('studentCourseRoot'));
      expect(whens.length, `${command} lost its root entry`).to.be.greaterThan(0);
      for (const when of whens) {
        for (const value of EVERY_ROOT) {
          expect(matchesViewItem(when, value), `${command} on ${value}`).to.equal(true);
        }
      }
    }
  });

  it('offers Set up Repository only where there is no clone yet', () => {
    for (const when of whensFor('computor.student.setupCourseRepository')) {
      expect(matchesViewItem(when, MANAGED_FRESH)).to.equal(true);
      expect(matchesViewItem(when, UNKNOWN)).to.equal(true);
      expect(matchesViewItem(when, MANAGED_CLONED)).to.equal(false);
      // Download-mode courses are served by Download Template instead.
      expect(matchesViewItem(when, DOWNLOAD)).to.equal(false);
    }
  });

  it('offers Download Template only to download-mode courses', () => {
    for (const when of whensFor('computor.student.downloadTemplate')) {
      expect(matchesViewItem(when, DOWNLOAD)).to.equal(true);
      expect(matchesViewItem(when, MANAGED_CLONED)).to.equal(false);
      expect(matchesViewItem(when, MANAGED_FRESH)).to.equal(false);
    }
  });

  it('offers the git actions only on a cloned git-backed course', () => {
    for (const command of [
      'computor.student.updateFromTemplate',
      'computor.student.commitCourse',
      'computor.student.fixRepositoryAuth'
    ]) {
      const whens = whensFor(command);
      expect(whens.length, `${command} has no course-root entry`).to.be.greaterThan(0);
      for (const when of whens) {
        expect(matchesViewItem(when, MANAGED_CLONED), command).to.equal(true);
        expect(matchesViewItem(when, MANAGED_CLONED_DESC), command).to.equal(true);
        expect(matchesViewItem(when, EXTERNAL_CLONED), command).to.equal(true);
        expect(matchesViewItem(when, MANAGED_FRESH), command).to.equal(false);
        expect(matchesViewItem(when, DOWNLOAD), command).to.equal(false);
      }
    }
  });

  it('offers no filesystem command on a course or unit row', () => {
    for (const command of FS_COMMANDS) {
      for (const when of whensFor(command)) {
        for (const value of EVERY_ROOT) {
          expect(matchesViewItem(when, value), `${command} on ${value}`).to.equal(false);
        }
        expect(matchesViewItem(when, 'studentCourseUnit'), command).to.equal(false);
        expect(matchesViewItem(when, 'studentCourseUnit.hasDescription'), command).to.equal(false);
      }
    }
  });
});

describe('every inline icon has a context-menu twin', () => {
  // "All actions which can be used from an icon should also be part of the
  // context menu" (computor-org/issues#353): an icon is easy to miss, and the
  // context menu is where students look for the full set.
  it('pairs each inline student entry with a non-inline one', () => {
    const inline = contextMenus.filter(
      entry => (entry.when || '').includes(`view == ${STUDENT_VIEW}`)
        && (entry.group || '').startsWith('inline')
    );
    expect(inline.length).to.be.greaterThan(0);
    for (const entry of inline) {
      // Matched by command, not by clause: `showMessages` is inline on
      // assignments and in the menu under a clause that covers every content
      // row, which is the same action reaching the same node.
      const twin = contextMenus.find(other =>
        other.command === entry.command
        && (other.when || '').includes(`view == ${STUDENT_VIEW}`)
        && !(other.group || '').startsWith('inline'));
      expect(twin, `${entry.command} is inline only`).to.not.equal(undefined);
    }
  });
});
