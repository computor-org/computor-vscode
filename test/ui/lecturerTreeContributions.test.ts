import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Pins the lecturer course tree's action set (issue #356).
 *
 * Two of its entries wrote into the assignments repository clone, which is only
 * ever pulled — nothing created there could reach a student — so they are gone.
 * The rest of the file pins the wording that made the remaining actions
 * guessable: what "Rename" renames, and that the two per-assignment budgets are
 * reachable without opening the details view.
 */

const pkg = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')
);

const LECTURER_VIEW = 'computor.lecturer.courses';

interface Command { command: string; title: string }
interface MenuEntry { command: string; when?: string; group?: string }

const commands: Command[] = pkg.contributes.commands;
const contextMenus: MenuEntry[] = pkg.contributes.menus['view/item/context'];

function command(id: string): Command | undefined {
  return commands.find(c => c.command === id);
}

function lecturerEntries(id: string): MenuEntry[] {
  return contextMenus.filter(
    entry => entry.command === id && (entry.when || '').includes(`view == ${LECTURER_VIEW}`)
  );
}

describe('lecturer tree contributions', () => {
  describe('file creation is gone', () => {
    // The clone under `reference/<courseId>` is refreshed with `git pull
    // --ff-only` and never committed or pushed, so a file created in it was
    // invisible to everyone and discarded by the next forced re-clone.
    for (const id of [
      'computor.lecturer.createAssignmentFolder',
      'computor.lecturer.createAssignmentFile'
    ]) {
      it(`declares no ${id} command`, () => {
        expect(command(id)).to.equal(undefined);
      });

      it(`offers no ${id} menu entry`, () => {
        expect(lecturerEntries(id)).to.have.length(0);
      });
    }
  });

  describe('Reveal Deployed Files', () => {
    it('says it reveals what is deployed, not that it opens an editable folder', () => {
      const reveal = command('computor.lecturer.openAssignmentFolder');
      expect(reveal?.title).to.equal('Reveal Deployed Files');
    });

    it('stays on assignment rows', () => {
      expect(lecturerEntries('computor.lecturer.openAssignmentFolder').length).to.be.greaterThan(0);
    });
  });

  describe('Rename', () => {
    it('names the field it changes', () => {
      // There are three "Rename" entries in this one view; a bare "Rename" on a
      // content row read as though it might move the path or edit meta.yaml.
      expect(command('computor.lecturer.renameCourseContent')?.title).to.equal('Rename Title...');
    });
  });

  describe('test and submission budgets', () => {
    for (const [id, title] of [
      ['computor.lecturer.setMaxTestRuns', 'Set Max Test Runs...'],
      ['computor.lecturer.setMaxSubmissions', 'Set Max Submissions...']
    ] as const) {
      it(`declares ${title}`, () => {
        expect(command(id)?.title).to.equal(title);
      });

      it(`puts ${title} on assignment rows`, () => {
        const entries = lecturerEntries(id);
        expect(entries.length).to.be.greaterThan(0);
        expect(entries.every(e => (e.when || '').includes('assignment'))).to.equal(true);
      });
    }
  });
});
