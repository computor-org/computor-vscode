import * as vscode from 'vscode';
import { HttpError, MaintenanceError, NetworkError, TimeoutError } from '../exceptions/errors';
import { ComputorApiService } from '../services/ComputorApiService';
import type { DescriptionDraft, DescriptionDraftStatus } from '../types/generated/courses';
import {
  DescriptionTarget,
  openDescriptionDraft,
  targetFromTreeItem
} from '../ui/descriptionEditor';
import { localizedTitle, type TextMap } from '../utils/contentLanguage';
import { notify } from '../utils/notify';
import { say, uiLanguage } from '../utils/uiLanguage';

/**
 * Lena drafts of a unit description (computor-org/issues#559).
 *
 * A lecturer asks Lena for a draft of a unit's description, written from the
 * unit's assignments, on one unit or on several units of a course at once.
 * A draft is only ever put in front of the lecturer: in the description
 * editor as unsaved text, or beside the current description to compare.
 * Publishing stays the editor's Ctrl+S/Cmd+S.
 */

export const DRAFT_DESCRIPTION_COMMAND = 'computor.lecturer.draftDescriptionWithLena';
export const DRAFT_UNIT_DESCRIPTIONS_COMMAND = 'computor.lecturer.draftUnitDescriptionsWithLena';
/** Set while the server has a Lena worker for drafts; gates the menu entries. */
export const LENA_DRAFTS_CONTEXT_KEY = 'computor.lecturer.lenaDrafts';

const POLL_INTERVAL_MS = 3000;
const DRAFT_TIMEOUT_MS = 10 * 60 * 1000;
const AVAILABILITY_REFRESH_MS = 5 * 60 * 1000;
// Polling rides out this many failed polls in a row (network, timeout, a
// backend restart) before it gives up on the job.
const MAX_POLL_ERRORS = 5;

export type DraftApi = Pick<
  ComputorApiService,
  'requestDescriptionDraft' | 'getDescriptionDraft' | 'cancelDescriptionDraft' | 'getDescriptionDraftAvailability'
>;

export type DraftOutcome =
  | { kind: 'done'; drafts: DescriptionDraft[] }
  // `busy`: the server refused because this lecturer's previous draft is still
  // pending or the queue is full, so the next unit of a batch would fail too.
  | { kind: 'failed'; message: string; busy?: boolean }
  | { kind: 'cancelled' };

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function draftFailureMessage(error: DescriptionDraftStatus['error']): string {
  switch (error) {
    case 'too_long':
      return say(
        "Lena's draft was too long for a description. Try again with an instruction such as \"shorter\".",
        'Lenas Entwurf war zu lang für eine Beschreibung. Versuche es mit einer Anweisung wie „kürzer“ erneut.'
      );
    case 'invalid_output':
      return say(
        'Lena did not return a usable draft. Try again.',
        'Lena hat keinen brauchbaren Entwurf geliefert. Versuche es erneut.'
      );
    default:
      return say(
        'Lena could not write a draft just now. Try again later.',
        'Lena konnte gerade keinen Entwurf schreiben. Versuche es später erneut.'
      );
  }
}

/** A failure that may be gone on the next try: no HTTP status, or a 408/5xx. */
function isTransient(error: unknown): boolean {
  if (error instanceof HttpError) {
    return error.status === 408 || error.status >= 500;
  }
  return error instanceof NetworkError || error instanceof TimeoutError || error instanceof MaintenanceError;
}

/** The lecturer-facing text for a failed draft request or poll. */
export function draftRequestErrorMessage(error: unknown): string {
  const status = error instanceof HttpError ? error.status : undefined;
  switch (status) {
    case 429:
      return say(
        'Lena is still writing your previous draft or is busy. Try again in a few minutes.',
        'Lena schreibt noch an deinem vorigen Entwurf oder ist ausgelastet. Versuche es in ein paar Minuten erneut.'
      );
    case 503:
      return say(
        'Lena cannot write description drafts at the moment.',
        'Lena kann gerade keine Beschreibungsentwürfe schreiben.'
      );
    case 400:
      return say(
        'This unit has no assignments for Lena to describe.',
        'Diese Einheit hat keine Aufgaben, aus denen Lena eine Beschreibung schreiben könnte.'
      );
    case 403:
      return say(
        'Only lecturers of this course can ask Lena for a description draft.',
        'Nur Lehrende dieses Kurses können Lena um einen Beschreibungsentwurf bitten.'
      );
    case 404:
      return say(
        'The draft is no longer available. Ask Lena again.',
        'Der Entwurf ist nicht mehr verfügbar. Frage Lena erneut.'
      );
  }
  if (isTransient(error)) {
    return say(
      'Computor could not be reached. Try again later.',
      'Computor war nicht erreichbar. Versuche es später erneut.'
    );
  }
  // Anything else (a signed-out session, an unexpected refusal) keeps its own reason.
  const detail = error instanceof HttpError ? error.serverDetail || error.message : error instanceof Error ? error.message : '';
  return detail || say('Lena could not take the request.', 'Lena konnte die Anfrage nicht annehmen.');
}

/**
 * Poll a draft job until it is finished, cancelled or too old. Never throws:
 * a few failed polls in a row are ridden out, anything else is a failure.
 */
export async function waitForDraft(
  api: DraftApi,
  jobId: string,
  options: {
    intervalMs?: number;
    timeoutMs?: number;
    isCancelled?: () => boolean;
    wait?: (ms: number) => Promise<void>;
  } = {}
): Promise<DraftOutcome> {
  const intervalMs = options.intervalMs ?? POLL_INTERVAL_MS;
  const timeoutMs = options.timeoutMs ?? DRAFT_TIMEOUT_MS;
  const wait = options.wait ?? sleep;
  let errors = 0;
  for (let waited = 0; waited <= timeoutMs; waited += intervalMs) {
    if (options.isCancelled?.()) {
      return { kind: 'cancelled' };
    }
    let status: DescriptionDraftStatus;
    try {
      status = await api.getDescriptionDraft(jobId);
      errors = 0;
    } catch (error) {
      errors++;
      if (!isTransient(error) || errors >= MAX_POLL_ERRORS) {
        return { kind: 'failed', message: draftRequestErrorMessage(error) };
      }
      await wait(intervalMs);
      continue;
    }
    if (status.state === 'done' && status.drafts && status.drafts.length > 0) {
      return { kind: 'done', drafts: status.drafts };
    }
    if (status.state === 'failed' || status.state === 'done') {
      return { kind: 'failed', message: draftFailureMessage(status.error) };
    }
    await wait(intervalMs);
  }
  return {
    kind: 'failed',
    message: say(
      'Lena did not finish the draft in time. Try again later.',
      'Lena ist mit dem Entwurf nicht rechtzeitig fertig geworden. Versuche es später erneut.'
    )
  };
}

interface ContentRow {
  id: string;
  path: string;
  title?: string | null;
  title_i18n?: TextMap;
  description?: string | null;
  position?: number | null;
  is_submittable?: boolean | null;
  archived_at?: string | null;
}

export interface DraftableUnit {
  id: string;
  label: string;
  hasDescription: boolean;
}

/**
 * Units of a course that hold at least one assignment, in tree order, labelled
 * in the reading language as the course tree labels them.
 */
export function unitsWithAssignments(contents: ContentRow[], language: string = uiLanguage()): DraftableUnit[] {
  const live = contents.filter((c) => !c.archived_at);
  const positions = new Map(live.map((c) => [c.path, c.position ?? 0]));
  const order = (c: ContentRow) => {
    const labels = c.path.split('.');
    return labels.map((_, i) => positions.get(labels.slice(0, i + 1).join('.')) ?? 0);
  };
  const compare = (a: ContentRow, b: ContentRow) => {
    const oa = order(a);
    const ob = order(b);
    for (let i = 0; i < Math.max(oa.length, ob.length); i++) {
      const diff = (oa[i] ?? -Infinity) - (ob[i] ?? -Infinity);
      if (diff !== 0) {
        return diff;
      }
    }
    return a.path.localeCompare(b.path);
  };
  return live
    .filter((c) => !c.is_submittable)
    .filter((unit) => live.some((c) => c.is_submittable && c.path.startsWith(`${unit.path}.`)))
    .sort(compare)
    .map((unit) => ({
      id: String(unit.id),
      label: String(localizedTitle(unit, language) || unit.path),
      hasDescription: (unit.description ?? '').trim().length > 0
    }));
}

function languageName(code: string): string {
  const names: Record<string, [string, string]> = {
    de: ['German', 'Deutsch'],
    en: ['English', 'Englisch']
  };
  const name = names[code];
  return name ? say(name[0], name[1]) : code;
}

/** One draft; asks for the language when Lena wrote several. */
async function pickDraft(drafts: DescriptionDraft[], unitLabel: string): Promise<DescriptionDraft | undefined> {
  if (drafts.length === 1) {
    return drafts[0];
  }
  const picked = await vscode.window.showQuickPick(
    drafts.map((draft) => ({
      label: languageName(draft.language),
      detail: draft.description.replace(/\s+/g, ' ').slice(0, 160),
      draft
    })),
    {
      title: say(`Lena's drafts for “${unitLabel}”`, `Lenas Entwürfe für „${unitLabel}“`),
      placeHolder: say('Which language?', 'Welche Sprache?'),
      ignoreFocusOut: true
    }
  );
  return picked?.draft;
}

async function askInstruction(): Promise<string | undefined> {
  return vscode.window.showInputBox({
    title: say('Draft with Lena', 'Entwurf von Lena'),
    prompt: say(
      'Optional: an extra instruction for Lena. Leave empty and press Enter for none.',
      'Optional: eine zusätzliche Anweisung für Lena. Leer lassen und Enter drücken für keine.'
    ),
    placeHolder: say('e.g. "mention that week 3 builds on week 2"', 'z. B. „Erwähne, dass Woche 3 auf Woche 2 aufbaut“'),
    ignoreFocusOut: true,
    validateInput: (value) =>
      value.length > 1000 ? say('At most 1000 characters.', 'Höchstens 1000 Zeichen.') : undefined
  });
}

/**
 * Ask for a draft and wait for it. Never throws. A job that is given up on
 * (cancelled, timed out, lost) is cancelled on the server too, so the
 * lecturer's one pending draft is free for the next request at once.
 */
export async function requestAndWait(
  api: DraftApi,
  unitId: string,
  instruction: string,
  isCancelled: () => boolean,
  options: Parameters<typeof waitForDraft>[2] = {}
): Promise<DraftOutcome> {
  let jobId: string;
  try {
    const job = await api.requestDescriptionDraft(unitId, { instruction: instruction.trim() || null });
    jobId = job.id;
  } catch (error) {
    const busy = error instanceof HttpError && error.status === 429;
    return { kind: 'failed', message: draftRequestErrorMessage(error), busy };
  }
  let outcome: DraftOutcome;
  try {
    outcome = await waitForDraft(api, jobId, { ...options, isCancelled });
  } catch (error) {
    outcome = { kind: 'failed', message: draftRequestErrorMessage(error) };
  }
  if (outcome.kind !== 'done') {
    try {
      await api.cancelDescriptionDraft(jobId);
    } catch {
      // Best effort: the server's lock expires on its own.
    }
  }
  return outcome;
}

export type DraftMode = 'replace' | 'compare';

/** The AI note after opening drafts, worded for how they were opened. */
export function aiNote(modes: Iterable<DraftMode>): string {
  const used = new Set(modes);
  if (!used.has('compare')) {
    return say(
      'Lena is an AI: check the draft. It is not saved — Ctrl+S/Cmd+S publishes it, closing without saving discards it.',
      'Lena ist eine KI: Prüfe den Entwurf. Er ist nicht gespeichert — Strg+S/Cmd+S veröffentlicht ihn, Schließen ohne Speichern verwirft ihn.'
    );
  }
  if (!used.has('replace')) {
    return say(
      'Lena is an AI: check the draft. It opens beside the current description and is never saved itself — carry over what you want; Ctrl+S/Cmd+S publishes the description on the right.',
      'Lena ist eine KI: Prüfe den Entwurf. Er öffnet sich neben der aktuellen Beschreibung und wird selbst nie gespeichert — übernimm, was du willst; Strg+S/Cmd+S veröffentlicht die Beschreibung rechts.'
    );
  }
  return say(
    'Lena is an AI: check the drafts. Nothing is saved — Ctrl+S/Cmd+S publishes a description editor; a draft shown beside a description is never saved itself.',
    'Lena ist eine KI: Prüfe die Entwürfe. Nichts ist gespeichert — Strg+S/Cmd+S veröffentlicht einen Beschreibungseditor; ein Entwurf neben einer Beschreibung wird selbst nie gespeichert.'
  );
}

export class LenaDescriptionDraftCommands {
  private available = false;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly api: ComputorApiService
  ) {}

  register(): void {
    this.context.subscriptions.push(
      vscode.commands.registerCommand(DRAFT_DESCRIPTION_COMMAND, (item?: unknown) => this.draftOne(item)),
      vscode.commands.registerCommand(DRAFT_UNIT_DESCRIPTIONS_COMMAND, (item?: unknown) => this.draftMany(item))
    );
    void this.refreshAvailability();
    // The server offers drafts only while a Lena worker runs; it can come and go.
    const timer = setInterval(() => void this.refreshAvailability(), AVAILABILITY_REFRESH_MS);
    this.context.subscriptions.push({ dispose: () => clearInterval(timer) });
  }

  async refreshAvailability(): Promise<boolean> {
    this.available = await this.api.getDescriptionDraftAvailability();
    await vscode.commands.executeCommand('setContext', LENA_DRAFTS_CONTEXT_KEY, this.available);
    return this.available;
  }

  private async ensureAvailable(): Promise<boolean> {
    if (await this.refreshAvailability()) {
      return true;
    }
    notify.info(say(
      'Lena cannot write description drafts at the moment.',
      'Lena kann gerade keine Beschreibungsentwürfe schreiben.'
    ));
    return false;
  }

  private async draftOne(item: unknown): Promise<void> {
    const target = targetFromTreeItem(item);
    if (!target || target.kind !== 'content') {
      notify.warning(say('Choose a unit in the course tree.', 'Wähle eine Einheit im Kursbaum.'));
      return;
    }
    if (!(await this.ensureAvailable())) {
      return;
    }
    const instruction = await askInstruction();
    if (instruction === undefined) {
      return;
    }

    const outcome = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: say(`Lena is drafting a description of “${target.label}”…`, `Lena entwirft eine Beschreibung für „${target.label}“ …`),
        cancellable: true
      },
      (_progress, token) => requestAndWait(this.api, target.contentId, instruction, () => token.isCancellationRequested)
    );
    if (outcome.kind === 'cancelled') {
      return;
    }
    if (outcome.kind === 'failed') {
      notify.error(outcome.message);
      return;
    }

    const draft = await pickDraft(outcome.drafts, target.label);
    if (!draft) {
      return;
    }
    const current = await this.api.getCourseContent(target.contentId);
    let mode: DraftMode = 'replace';
    if (((current as any)?.description ?? '').trim().length > 0) {
      const replace = say('Replace in the editor', 'Im Editor ersetzen');
      const compare = say('Compare with the current description', 'Mit der aktuellen Beschreibung vergleichen');
      const choice = await vscode.window.showQuickPick(
        [
          { label: replace, detail: say('The draft replaces the text in the description editor, unsaved.', 'Der Entwurf ersetzt den Text im Beschreibungseditor, ungespeichert.') },
          { label: compare, detail: say('The draft opens beside the current description.', 'Der Entwurf öffnet sich neben der aktuellen Beschreibung.') }
        ],
        {
          title: say(`“${target.label}” already has a description`, `„${target.label}“ hat schon eine Beschreibung`),
          ignoreFocusOut: true
        }
      );
      if (!choice) {
        return;
      }
      mode = choice.label === replace ? 'replace' : 'compare';
    }
    const used = await this.open(target, draft, mode);
    if (used) {
      notify.info(aiNote([used]));
    }
  }

  private async draftMany(item: any): Promise<void> {
    const courseId = item?.course?.id ? String(item.course.id) : undefined;
    if (!courseId) {
      notify.warning(say('Choose a course in the course tree.', 'Wähle einen Kurs im Kursbaum.'));
      return;
    }
    if (!(await this.ensureAvailable())) {
      return;
    }
    const units = unitsWithAssignments((await this.api.getCourseContents(courseId, true)) as any[]);
    if (units.length === 0) {
      notify.info(say('This course has no units with assignments.', 'Dieser Kurs hat keine Einheiten mit Aufgaben.'));
      return;
    }
    const picked = await vscode.window.showQuickPick(
      units.map((unit) => ({
        label: unit.label,
        description: unit.hasDescription ? say('has a description', 'hat eine Beschreibung') : undefined,
        picked: !unit.hasDescription,
        unit
      })),
      {
        title: say('Draft unit descriptions with Lena', 'Einheitenbeschreibungen von Lena entwerfen'),
        placeHolder: say('Which units?', 'Welche Einheiten?'),
        canPickMany: true,
        ignoreFocusOut: true
      }
    );
    if (!picked || picked.length === 0) {
      return;
    }
    const instruction = await askInstruction();
    if (instruction === undefined) {
      return;
    }

    const results: Array<{ unit: DraftableUnit; outcome: DraftOutcome }> = [];
    let notReached: DraftableUnit[] = [];
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: say('Lena is drafting unit descriptions', 'Lena entwirft Einheitenbeschreibungen'),
        cancellable: true
      },
      async (progress, token) => {
        // One at a time: the server keeps one pending draft per lecturer.
        for (const [index, { unit }] of picked.entries()) {
          if (token.isCancellationRequested) {
            break;
          }
          progress.report({ message: `${unit.label} (${index + 1}/${picked.length})` });
          const outcome = await requestAndWait(this.api, unit.id, instruction, () => token.isCancellationRequested);
          progress.report({ increment: 100 / picked.length });
          if (outcome.kind === 'cancelled') {
            break;
          }
          results.push({ unit, outcome });
          if (outcome.kind === 'failed' && outcome.busy) {
            // Every remaining unit would be refused the same way.
            notReached = picked.slice(index + 1).map((p) => p.unit);
            break;
          }
        }
      }
    );

    // Whatever happened to later units, the drafts that are done open.
    const modes: DraftMode[] = [];
    const failed: string[] = [];
    for (const { unit, outcome } of results) {
      if (outcome.kind !== 'done') {
        failed.push(`${unit.label}: ${outcome.kind === 'failed' ? outcome.message : ''}`);
        continue;
      }
      const draft = await pickDraft(outcome.drafts, unit.label);
      if (!draft) {
        continue;
      }
      const target: DescriptionTarget = { kind: 'content', courseId, contentId: unit.id, label: unit.label };
      // No question per unit: an empty description gets the draft, an
      // existing one is compared side by side.
      try {
        const used = await this.open(target, draft, unit.hasDescription ? 'compare' : 'replace');
        if (used) {
          modes.push(used);
        }
      } catch (error) {
        failed.push(`${unit.label}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    // Notifications show one line, so the list is joined inline.
    if (failed.length > 0) {
      notify.warning(
        say(`Lena could not draft ${failed.length} unit(s).`, `Lena konnte ${failed.length} Einheit(en) nicht entwerfen.`)
          + ' ' + failed.join(' · ')
      );
    }
    if (notReached.length > 0) {
      notify.warning(
        say(
          `Lena stopped before ${notReached.length} unit(s): ${notReached.map((u) => u.label).join(', ')}. Ask again in a few minutes.`,
          `Lena hat vor ${notReached.length} Einheit(en) aufgehört: ${notReached.map((u) => u.label).join(', ')}. Frage in ein paar Minuten erneut.`
        )
      );
    }
    if (modes.length > 0) {
      notify.info(aiNote(modes));
    }
  }

  private open(target: DescriptionTarget, draft: DescriptionDraft, mode: DraftMode): Promise<DraftMode | undefined> {
    const label = say(`Lena draft, ${languageName(draft.language)}`, `Entwurf von Lena, ${languageName(draft.language)}`);
    return openDescriptionDraft(this.context, this.api, target, draft.description, mode, label);
  }
}
