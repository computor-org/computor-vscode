import * as vscode from 'vscode';
import { ComputorApiService } from '../services/ComputorApiService';
import type { DescriptionDraft, DescriptionDraftStatus } from '../types/generated/courses';
import {
  DescriptionTarget,
  openDescriptionDraft,
  targetFromTreeItem
} from '../ui/descriptionEditor';
import { notify } from '../utils/notify';
import { say } from '../utils/uiLanguage';

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

export type DraftApi = Pick<
  ComputorApiService,
  'requestDescriptionDraft' | 'getDescriptionDraft' | 'getDescriptionDraftAvailability'
>;

type DraftOutcome =
  | { kind: 'done'; drafts: DescriptionDraft[] }
  | { kind: 'failed'; message: string }
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

/** Poll a draft job until it is finished, cancelled or too old. */
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
  for (let waited = 0; waited <= timeoutMs; waited += intervalMs) {
    if (options.isCancelled?.()) {
      return { kind: 'cancelled' };
    }
    const status = await api.getDescriptionDraft(jobId);
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

/** Units of a course that hold at least one assignment, in tree order. */
export function unitsWithAssignments(contents: ContentRow[]): DraftableUnit[] {
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
      label: String(unit.title || unit.path),
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

async function requestAndWait(
  api: DraftApi,
  unitId: string,
  instruction: string,
  isCancelled: () => boolean
): Promise<DraftOutcome> {
  let jobId: string;
  try {
    const job = await api.requestDescriptionDraft(unitId, { instruction: instruction.trim() || null });
    jobId = job.id;
  } catch (error: any) {
    const detail = error?.response?.data?.detail || error?.message || String(error);
    return { kind: 'failed', message: typeof detail === 'string' ? detail : JSON.stringify(detail) };
  }
  return waitForDraft(api, jobId, { isCancelled });
}

const aiNote = () =>
  say(
    "Lena is an AI: check the draft. It is not saved — Ctrl+S/Cmd+S publishes it, closing without saving discards it.",
    'Lena ist eine KI: Prüfe den Entwurf. Er ist nicht gespeichert — Strg+S/Cmd+S veröffentlicht ihn, Schließen ohne Speichern verwirft ihn.'
  );

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
    let mode: 'replace' | 'compare' = 'replace';
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
    await this.open(target, draft, mode);
    notify.info(aiNote());
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
          progress.report({
            message: `${unit.label} (${index + 1}/${picked.length})`,
            increment: 100 / picked.length
          });
          const outcome = await requestAndWait(this.api, unit.id, instruction, () => token.isCancellationRequested);
          if (outcome.kind === 'cancelled') {
            break;
          }
          results.push({ unit, outcome });
        }
      }
    );

    let opened = 0;
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
      if (await this.open(target, draft, unit.hasDescription ? 'compare' : 'replace')) {
        opened++;
      }
    }
    if (failed.length > 0) {
      notify.warning(
        say(`Lena could not draft ${failed.length} unit(s).`, `Lena konnte ${failed.length} Einheit(en) nicht entwerfen.`)
          + '\n' + failed.join('\n')
      );
    }
    if (opened > 0) {
      notify.info(aiNote());
    }
  }

  private open(target: DescriptionTarget, draft: DescriptionDraft, mode: 'replace' | 'compare'): Promise<boolean> {
    const label = say(`Lena draft, ${languageName(draft.language)}`, `Entwurf von Lena, ${languageName(draft.language)}`);
    return openDescriptionDraft(this.context, this.api, target, draft.description, mode, label);
  }
}
