import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';

import {
  DRAFT_DESCRIPTION_COMMAND,
  DRAFT_UNIT_DESCRIPTIONS_COMMAND,
  LENA_DRAFTS_CONTEXT_KEY,
  aiNote,
  draftFailureMessage,
  draftRequestErrorMessage,
  requestAndWait,
  unitsWithAssignments,
  waitForDraft
} from '../../src/commands/LenaDescriptionDraftCommands';
import { HttpError, NetworkError } from '../../src/exceptions/errors';

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

    it('labels units in the reading language, as the tree does', () => {
      const rows = [
        { id: 'u', path: 'week1', title: 'Woche 1', title_i18n: { de: 'Woche 1', en: 'Week 1' }, position: 1, is_submittable: false },
        { id: 'a', path: 'week1.task', position: 1, is_submittable: true }
      ];
      expect(unitsWithAssignments(rows, 'en')[0]!.label).to.equal('Week 1');
      expect(unitsWithAssignments(rows, 'de')[0]!.label).to.equal('Woche 1');
    });

    it('does not count a sibling with a common prefix as a child', () => {
      const rows = [
        { id: 'a', path: 'week1', position: 1, is_submittable: false },
        { id: 'b', path: 'week10.task', position: 1, is_submittable: true }
      ];
      expect(unitsWithAssignments(rows)).to.deep.equal([]);
    });
  });

  const unavailable = () => new HttpError('Service Unavailable', 503, 'Service Unavailable');

  // Each poll answers with the next entry; an Error entry is thrown.
  function api(states: any[], request: () => Promise<any> = async () => ({ id: 'j', state: 'queued' as const })) {
    const calls: string[] = [];
    const cancelled: string[] = [];
    return {
      calls,
      cancelled,
      getDescriptionDraft: async (jobId: string) => {
        calls.push(jobId);
        const next = states.shift();
        if (next instanceof Error) {
          throw next;
        }
        return next;
      },
      requestDescriptionDraft: request,
      cancelDescriptionDraft: async (jobId: string) => {
        cancelled.push(jobId);
      },
      getDescriptionDraftAvailability: async () => true
    };
  }

  describe('waitForDraft', () => {
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

    it('rides out a few failed polls, such as a backend restart', async () => {
      const drafts = [{ language: 'en', description: 'Week 1 covers loops.' }];
      const fake = api([unavailable(), new NetworkError('reset'), { id: 'j', state: 'running' }, unavailable(), { id: 'j', state: 'done', drafts }]);
      const outcome = await waitForDraft(fake as any, 'j', { wait: noWait });
      expect(outcome).to.deep.equal({ kind: 'done', drafts });
    });

    it('fails, without throwing, after too many failed polls in a row', async () => {
      const fake = api(Array.from({ length: 20 }, unavailable));
      const outcome = await waitForDraft(fake as any, 'j', { wait: noWait });
      expect(outcome.kind).to.equal('failed');
      expect(fake.calls.length).to.be.lessThan(20);
    });

    it('fails at once when the job is gone', async () => {
      const fake = api([new HttpError('Not Found', 404, 'Not Found')]);
      const outcome = await waitForDraft(fake as any, 'j', { wait: noWait });
      expect(outcome).to.deep.equal({ kind: 'failed', message: draftRequestErrorMessage(new HttpError('', 404, '')) });
      expect(fake.calls).to.have.length(1);
    });
  });

  describe('requestAndWait', () => {
    const noWait = async () => undefined;

    it('marks a refused request as busy, so a batch stops, and asks for nothing more', async () => {
      const fake = api([], async () => {
        throw new HttpError('Too Many Requests', 429, 'Too Many Requests');
      });
      const outcome = await requestAndWait(fake as any, 'u', '', () => false, { wait: noWait });
      expect(outcome).to.deep.equal({
        kind: 'failed',
        message: draftRequestErrorMessage(new HttpError('', 429, '')),
        busy: true
      });
      expect(fake.calls).to.have.length(0);
      expect(fake.cancelled).to.have.length(0);
    });

    it('cancels the job on the server when the lecturer cancels', async () => {
      let cancel = false;
      const fake = api([{ id: 'j', state: 'running' }, { id: 'j', state: 'running' }]);
      const outcome = await requestAndWait(fake as any, 'u', '', () => cancel, {
        wait: async () => {
          cancel = true;
        }
      });
      expect(outcome).to.deep.equal({ kind: 'cancelled' });
      expect(fake.cancelled).to.deep.equal(['j']);
    });

    it('cancels the job on the server when it takes too long', async () => {
      const running = Array.from({ length: 10 }, () => ({ id: 'j', state: 'running' }));
      const fake = api(running);
      const outcome = await requestAndWait(fake as any, 'u', '', () => false, { wait: noWait, intervalMs: 1, timeoutMs: 3 });
      expect(outcome.kind).to.equal('failed');
      expect(fake.cancelled).to.deep.equal(['j']);
    });

    it('keeps a finished job and survives a failing cancel', async () => {
      const drafts = [{ language: 'de', description: 'Woche 1 behandelt Schleifen.' }];
      const done = api([{ id: 'j', state: 'done', drafts }]);
      expect(await requestAndWait(done as any, 'u', '', () => false, { wait: noWait })).to.deep.equal({ kind: 'done', drafts });
      expect(done.cancelled).to.have.length(0);

      const lost = api([new HttpError('Not Found', 404, 'Not Found')]);
      lost.cancelDescriptionDraft = async () => {
        throw unavailable();
      };
      const outcome = await requestAndWait(lost as any, 'u', '', () => false, { wait: noWait });
      expect(outcome.kind).to.equal('failed');
    });
  });

  describe('messages', () => {
    it('maps the server refusals to texts of its own, not the English detail', () => {
      for (const status of [400, 403, 404, 429, 503]) {
        const message = draftRequestErrorMessage(new HttpError('server detail', status, '', { detail: 'server detail' }));
        expect(message, String(status)).to.not.contain('server detail');
        expect(message, String(status)).to.contain(status === 403 ? 'lecturers' : status === 400 ? 'assignments' : 'Lena');
      }
    });

    it('words the AI note for how the drafts were opened', () => {
      expect(aiNote(['replace'])).to.contain('publishes it');
      expect(aiNote(['compare'])).to.contain('beside the current description');
      expect(aiNote(['replace', 'compare'])).to.not.equal(aiNote(['compare']));
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

    it('offers the unit action on live units with children only, while Lena is available', () => {
      // Tokens as CourseContentTreeItem.getContextValue() and withDescription() set them.
      const unit = viewItemRegex(DRAFT_DESCRIPTION_COMMAND);
      expect(unit.test('courseContent.nonSubmittable.hasChildren')).to.equal(true);
      expect(unit.test('courseContent.nonSubmittable.hasChildren.hidden.hiddenHere.hasDescription')).to.equal(true);
      expect(unit.test('courseContent.nonSubmittable')).to.equal(false);
      expect(unit.test('courseContent.nonSubmittable.hasChildren.archived')).to.equal(false);
      expect(unit.test('courseContent.submittable.assignment.hasExample')).to.equal(false);
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
