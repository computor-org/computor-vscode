import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';

import {
  DRAFT_DESCRIPTION_COMMAND,
  DRAFT_UNIT_DESCRIPTIONS_COMMAND,
  LENA_DRAFTS_CONTEXT_KEY,
  draftFailureMessage,
  unitsWithAssignments,
  waitForDraft
} from '../../src/commands/LenaDescriptionDraftCommands';

/**
 * Lena drafts of a unit description (computor-org/issues#559): which units
 * are offered, how a job is waited for, and where the menu entries appear.
 */
describe('Lena description drafts', () => {
  describe('unitsWithAssignments', () => {
    const contents = [
      { id: 'w2', path: 'week2', title: 'Week 2', position: 2, is_submittable: false, description: 'Has one' },
      { id: 'w1', path: 'week1', title: 'Week 1', position: 1, is_submittable: false, description: '  ' },
      { id: 'w1a', path: 'week1.loops', title: 'Loops', position: 1, is_submittable: true },
      { id: 'w2a', path: 'week2.lists', title: 'Lists', position: 1, is_submittable: true },
      { id: 'w3', path: 'week3', title: 'Week 3 (empty)', position: 3, is_submittable: false },
      { id: 'p', path: 'intro', title: 'Intro page', position: 0, is_submittable: false }
    ];

    it('offers units with assignments, in tree order', () => {
      expect(unitsWithAssignments(contents)).to.deep.equal([
        { id: 'w1', label: 'Week 1', hasDescription: false },
        { id: 'w2', label: 'Week 2', hasDescription: true }
      ]);
    });

    it('does not count a sibling with a common prefix as a child', () => {
      const rows = [
        { id: 'a', path: 'week1', position: 1, is_submittable: false },
        { id: 'b', path: 'week10.task', position: 1, is_submittable: true }
      ];
      expect(unitsWithAssignments(rows)).to.deep.equal([]);
    });
  });

  describe('waitForDraft', () => {
    function api(states: any[]) {
      const calls: string[] = [];
      return {
        calls,
        getDescriptionDraft: async (jobId: string) => {
          calls.push(jobId);
          return states.shift();
        },
        requestDescriptionDraft: async () => ({ id: 'j', state: 'queued' as const }),
        getDescriptionDraftAvailability: async () => true
      };
    }
    const noWait = async () => undefined;

    it('polls until the drafts are there', async () => {
      const drafts = [{ language: 'en', description: 'Week 1 covers loops.' }];
      const fake = api([{ id: 'j', state: 'queued' }, { id: 'j', state: 'running' }, { id: 'j', state: 'done', drafts }]);
      const outcome = await waitForDraft(fake as any, 'j', { wait: noWait });
      expect(outcome).to.deep.equal({ kind: 'done', drafts });
      expect(fake.calls).to.have.length(3);
    });

    it('turns a failed job into its message', async () => {
      const outcome = await waitForDraft(api([{ id: 'j', state: 'failed', error: 'too_long' }]) as any, 'j', { wait: noWait });
      expect(outcome).to.deep.equal({ kind: 'failed', message: draftFailureMessage('too_long') });
      expect(draftFailureMessage('too_long')).to.contain('too long');
    });

    it('stops when cancelled', async () => {
      const fake = api([{ id: 'j', state: 'running' }]);
      const outcome = await waitForDraft(fake as any, 'j', { wait: noWait, isCancelled: () => true });
      expect(outcome).to.deep.equal({ kind: 'cancelled' });
      expect(fake.calls).to.have.length(0);
    });

    it('gives up after the timeout', async () => {
      const running = Array.from({ length: 10 }, () => ({ id: 'j', state: 'running' }));
      const outcome = await waitForDraft(api(running) as any, 'j', { wait: noWait, intervalMs: 1, timeoutMs: 3 });
      expect(outcome.kind).to.equal('failed');
    });
  });

  describe('contributions', () => {
    const root = process.cwd();
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    const en = JSON.parse(fs.readFileSync(path.join(root, 'package.nls.json'), 'utf8'));
    const de = JSON.parse(fs.readFileSync(path.join(root, 'package.nls.de.json'), 'utf8'));
    const menus: Array<{ command: string; when?: string }> = pkg.contributes.menus['view/item/context'];

    function viewItemRegex(command: string): RegExp {
      const entry = menus.find((m) => m.command === command);
      expect(entry, command).to.not.equal(undefined);
      expect(entry!.when).to.contain(LENA_DRAFTS_CONTEXT_KEY);
      return new RegExp(entry!.when!.match(/viewItem =~ \/(.+?)\/(?=\s|$)/)![1] as string);
    }

    it('offers the unit action on units only, while Lena is available', () => {
      const unit = viewItemRegex(DRAFT_DESCRIPTION_COMMAND);
      expect(unit.test('courseContent.nonSubmittable.unit')).to.equal(true);
      expect(unit.test('courseContent.nonSubmittable.unit.hasDescription')).to.equal(true);
      expect(unit.test('courseContent.submittable.assignment')).to.equal(false);
    });

    it('offers the course action on live courses only', () => {
      const course = viewItemRegex(DRAFT_UNIT_DESCRIPTIONS_COMMAND);
      expect(course.test('course')).to.equal(true);
      expect(course.test('course.hasDescription')).to.equal(true);
      expect(course.test('course.archived')).to.equal(false);
    });

    it('keeps both out of the command palette and titles them in both languages', () => {
      const palette: Array<{ command: string; when?: string }> = pkg.contributes.menus.commandPalette;
      for (const command of [DRAFT_DESCRIPTION_COMMAND, DRAFT_UNIT_DESCRIPTIONS_COMMAND]) {
        expect(palette.find((p) => p.command === command)?.when).to.equal('false');
        const title = pkg.contributes.commands.find((c: any) => c.command === command).title;
        const key = title.slice(1, -1);
        expect(en[key]).to.contain('Lena');
        expect(de[key]).to.contain('Lena');
      }
    });
  });
});
