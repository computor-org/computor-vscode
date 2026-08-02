import * as vscode from 'vscode';
import type { ComputorSettingsManager } from '../settings/ComputorSettingsManager';

/**
 * What the workspace looked like when you left it.
 *
 * Reopening a workspace used to drop you somewhere else entirely: a different
 * activity-bar container, every tree collapsed, nothing selected
 * (computor-org/issues#285). VS Code cannot do this for us — for a tree view
 * contributed by an extension the only cross-reload lever is the
 * `collapsibleState` the provider returns on the first render, so the
 * extension has to remember and reapply it.
 *
 * It was half-remembered before, in three different places: expansion for
 * three of the nine trees in ~/.computor/config.json, the tutor's selection in
 * globalState, and nothing at all for the rest. This is the one owner.
 *
 * Reads are synchronous against an in-memory copy loaded at construction.
 * That matters: the old expansion store was loaded by a fire-and-forget
 * `void loadExpandedStates()` in each provider's constructor, which getChildren
 * could and did outrun, so the first render after a reload saw an empty map
 * and collapsed the tree it was supposed to restore.
 */

/** One namespace per tree, so two trees can't collide on a node id. */
export type TreeScope =
  | 'lecturer'
  | 'lecturerExamples'
  | 'lecturerDocuments'
  | 'student'
  | 'studentOffline'
  | 'tutorFilters'
  | 'tutorContent'
  | 'chat'
  | 'userManager';

interface UiState {
  /** Activity-bar container id, e.g. "computor-tutor". */
  activeContainer?: string;
  /** Per tree: node id -> expanded. Absent means collapsed. */
  expanded?: Partial<Record<TreeScope, Record<string, true>>>;
  /** Per view id: the id of the selected tree item. */
  selection?: Record<string, string>;
}

const STATE_KEY = 'computor.ui.state';

/** Expansion arrives in bursts (expand-all, restore); coalesce the writes. */
const FLUSH_DEBOUNCE_MS = 300;

export class UiStateService {
  private static instance: UiStateService | undefined;

  private state: UiState;
  private timer: NodeJS.Timeout | undefined;
  private writing: Promise<void> = Promise.resolve();

  private constructor(private readonly context: vscode.ExtensionContext) {
    this.state = context.globalState.get<UiState>(STATE_KEY) ?? {};
  }

  static initialize(context: vscode.ExtensionContext): UiStateService {
    if (!this.instance) {
      this.instance = new UiStateService(context);
    }
    return this.instance;
  }

  /** Undefined before activation wires it up, so callers can stay optional. */
  static getInstanceOrUndefined(): UiStateService | undefined {
    return this.instance;
  }

  /**
   * Carry expansion over from ~/.computor/config.json, once.
   *
   * Only lecturer, student and tutor-filter expansion ever lived there. Users
   * would otherwise find their trees collapsed the first time they picked this
   * change up, which is precisely the complaint being fixed.
   */
  async migrateLegacyExpansion(settings: ComputorSettingsManager): Promise<void> {
    if (this.state.expanded) {
      return;
    }
    const legacy: Array<[TreeScope, () => Promise<Record<string, boolean>>]> = [
      ['lecturer', () => settings.getTreeExpandedStates()],
      ['student', () => settings.getStudentTreeExpandedStates()],
      ['tutorFilters', () => settings.getTutorTreeExpandedStates()]
    ];
    const expanded: UiState['expanded'] = {};
    for (const [scope, read] of legacy) {
      try {
        const states = await read();
        const kept: Record<string, true> = {};
        for (const [nodeId, value] of Object.entries(states)) {
          if (value) {
            kept[nodeId] = true;
          }
        }
        if (Object.keys(kept).length > 0) {
          expanded[scope] = kept;
        }
      } catch (error) {
        console.warn(`[UiState] Could not migrate ${scope} expansion:`, error);
      }
    }
    this.state.expanded = expanded;
    this.schedule();
  }

  getActiveContainer(): string | undefined {
    return this.state.activeContainer;
  }

  setActiveContainer(containerId: string): void {
    if (this.state.activeContainer === containerId) {
      return;
    }
    this.state.activeContainer = containerId;
    this.schedule();
  }

  isExpanded(scope: TreeScope, nodeId: string): boolean {
    return this.state.expanded?.[scope]?.[nodeId] === true;
  }

  expandedNodes(scope: TreeScope): Record<string, true> {
    return this.state.expanded?.[scope] ?? {};
  }

  setExpanded(scope: TreeScope, nodeId: string, expanded: boolean): void {
    if (!nodeId) {
      return;
    }
    const all = (this.state.expanded ??= {});
    const forScope = (all[scope] ??= {});
    if (expanded) {
      if (forScope[nodeId]) {
        return;
      }
      forScope[nodeId] = true;
    } else {
      if (!forScope[nodeId]) {
        return;
      }
      delete forScope[nodeId];
    }
    this.schedule();
  }

  getSelection(viewId: string): string | undefined {
    return this.state.selection?.[viewId];
  }

  setSelection(viewId: string, itemId: string | undefined): void {
    const selection = (this.state.selection ??= {});
    if (itemId === undefined) {
      if (!(viewId in selection)) {
        return;
      }
      delete selection[viewId];
    } else {
      if (selection[viewId] === itemId) {
        return;
      }
      selection[viewId] = itemId;
    }
    this.schedule();
  }

  /** Forget everything. Logout's job, and only logout's. */
  async clear(): Promise<void> {
    this.state = {};
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    await this.context.globalState.update(STATE_KEY, undefined);
  }

  private schedule(): void {
    if (this.timer) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.flush();
    }, FLUSH_DEBOUNCE_MS);
  }

  /** Persist now. Chained so two flushes cannot interleave. */
  flush(): Promise<void> {
    const snapshot = JSON.parse(JSON.stringify(this.state)) as UiState;
    this.writing = this.writing
      .catch(() => undefined)
      .then(async () => {
        try {
          await this.context.globalState.update(STATE_KEY, snapshot);
        } catch (error) {
          console.warn('[UiState] Could not persist UI state:', error);
        }
      });
    return this.writing;
  }
}
