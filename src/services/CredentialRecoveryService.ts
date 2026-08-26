import * as vscode from 'vscode';
import { HttpError } from '../exceptions/errors/HttpError';
import { extractAuthFailureOrigin, isGitAuthenticationError } from '../utils/gitErrors';
import { notify } from '../utils/notify';

/**
 * The one place that answers "a credential just died — now what?"
 * (computor-org/issues#247).
 *
 * Before this, a dead token surfaced as whatever generic message happened to be
 * nearest: the same "authentication failed" a backend outage produced, pointing
 * at the Settings View's root, and the action the student was in the middle of
 * was simply gone. Three things are fixed here, in one place so #248
 * (self-rotation) and a forced re-login can land on the same rails:
 *
 *   1. **Identity.** A rejected credential has its own wording, distinct from
 *      "the backend is unreachable" (BackendConnectionService owns that one —
 *      computor-org/issues#117 settled its wording). The two failures look
 *      identical from a call site and are fixed in completely different places,
 *      so they must never share a title.
 *   2. **Destination.** The notification's button opens the Settings View
 *      already scrolled to — and focused on — the token entry for the realm
 *      that failed, not the view root.
 *   3. **Continuity.** The command that was blocked is kept, and offered back
 *      once the credential is replaced, so the student does not have to
 *      remember what they were doing and navigate there again.
 */

export type CredentialKind = 'backend' | 'gitProvider';

export interface CredentialRealm {
  kind: CredentialKind;
  /**
   * Origin of the git provider whose token was rejected. Empty for the backend
   * (there is one session, not one per URL) and for a git failure whose remote
   * git did not name.
   */
  url?: string;
}

/** The command that could not run, kept so it can be offered back verbatim. */
export interface BlockedAction {
  command: string;
  args: unknown[];
  label: string;
}

/**
 * Commands that only read. These are replayed the moment the credential is
 * back, without asking — the student asked for this data once already, and a
 * re-read cannot do anything they did not ask for. Everything else (submits,
 * pushes, releases) gets a button, because silently re-running a write after an
 * unrelated Settings visit is not a retry, it is a surprise.
 */
const IDEMPOTENT_COMMANDS = new Set<string>([
  'computor.lecturer.refresh',
  'computor.lecturer.refreshExamples',
  'computor.student.refresh',
  'computor.student.refreshTree',
  'computor.student.offline.refresh',
  'computor.tutor.refresh',
  'computor.tutor.refreshTree',
  'computor.userManager.refresh'
]);

/** `computor.student.submitAssignment` → `Submit assignment`. */
export function humanizeCommandId(command: string): string {
  const last = command.split('.').pop() || command;
  const spaced = last
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim();
  if (!spaced) {
    return command;
  }
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

export class CredentialRecoveryService {
  private static instance: CredentialRecoveryService | undefined;

  /** One blocked action per realm — the most recent one, keyed by realm. */
  private readonly blocked = new Map<string, BlockedAction>();

  /** Realms with a notification already on screen, so a burst shows once. */
  private readonly notifying = new Set<string>();

  static getInstance(): CredentialRecoveryService {
    if (!CredentialRecoveryService.instance) {
      CredentialRecoveryService.instance = new CredentialRecoveryService();
    }
    return CredentialRecoveryService.instance;
  }

  /**
   * Is this error a rejected credential, and whose? Undefined for everything
   * else — a caller that gets undefined must fall back to its normal error
   * reporting rather than blaming the token.
   */
  classify(error: unknown): CredentialRealm | undefined {
    // The backend answers 403 for permission denials, so a 401 always means the
    // credential itself — never "you may not do that".
    if (error instanceof HttpError && error.status === 401) {
      return { kind: 'backend' };
    }
    if (error instanceof Error && error.name === 'AuthenticationError') {
      return { kind: 'backend' };
    }
    if (isGitAuthenticationError(error)) {
      return { kind: 'gitProvider', url: extractAuthFailureOrigin(error) };
    }
    return undefined;
  }

  /** Remember what a dead credential interrupted, so it can be offered back. */
  remember(realm: CredentialRealm, action: BlockedAction): void {
    this.blocked.set(realmKey(realm), action);
  }

  /**
   * The `commandRegistrar` safety net's credential branch: returns true when
   * the failure was a dead credential and has been reported (with the command
   * kept for retry), false when the caller should report it normally.
   */
  async handleCommandFailure(command: string, args: unknown[], error: unknown): Promise<boolean> {
    const realm = this.classify(error);
    if (!realm) {
      return false;
    }
    this.remember(realm, { command, args, label: humanizeCommandId(command) });
    await this.reportExpired(realm);
    return true;
  }

  /**
   * Tell the user which credential died and hand them the button that fixes
   * exactly it. Safe to call from a burst of failures: while one realm's
   * notification is on screen, further reports for that realm are dropped.
   */
  async reportExpired(realm: CredentialRealm): Promise<void> {
    const key = realmKey(realm);
    if (this.notifying.has(key)) {
      return;
    }
    this.notifying.add(key);
    try {
      if (realm.kind === 'backend') {
        await this.reportBackendExpired();
      } else {
        await this.reportProviderExpired(realm.url);
      }
    } finally {
      this.notifying.delete(key);
    }
  }

  /**
   * A credential for this realm was accepted and stored. Replays the blocked
   * read, or offers the blocked write back. A no-op when nothing was blocked,
   * which is the normal case for an ordinary sign-in.
   */
  async credentialRestored(realm: CredentialRealm): Promise<void> {
    const key = realmKey(realm);
    const action = this.blocked.get(key);
    if (!action) {
      return;
    }
    this.blocked.delete(key);

    if (IDEMPOTENT_COMMANDS.has(action.command)) {
      await vscode.commands.executeCommand(action.command, ...action.args);
      return;
    }

    const choice = await notify.info(
      `Credentials updated. Retry "${action.label}"?`,
      'Retry',
      'Not Now'
    );
    if (choice === 'Retry') {
      await vscode.commands.executeCommand(action.command, ...action.args);
    }
  }

  /** Drop a realm's pending action without running it (e.g. on sign-out). */
  forget(realm: CredentialRealm): void {
    this.blocked.delete(realmKey(realm));
  }

  /** Visible for tests: what is currently queued for this realm. */
  pendingAction(realm: CredentialRealm): BlockedAction | undefined {
    return this.blocked.get(realmKey(realm));
  }

  private async reportBackendExpired(): Promise<void> {
    const choice = await notify.warning(
      'Your Computor sign-in has expired. Sign in again to continue — your work on this machine is untouched.',
      'Sign in',
      'Use API Token'
    );
    if (choice === 'Sign in') {
      await vscode.commands.executeCommand('computor.login');
    } else if (choice === 'Use API Token') {
      await vscode.commands.executeCommand('computor.loginWithApiToken');
    }
  }

  private async reportProviderExpired(url?: string): Promise<void> {
    const message = url
      ? `Your access token for ${url} was rejected — it has expired or been revoked. Replace it to reach your repositories again.`
      : 'Your git provider access token was rejected — it has expired or been revoked. Replace it to reach your repositories again.';

    const choice = await notify.error(message, 'Update Token', 'Not Now');
    if (choice !== 'Update Token') {
      return;
    }
    await vscode.commands.executeCommand('computor.settingsView', {
      section: 'gitProvider',
      url
    });
  }
}

function realmKey(realm: CredentialRealm): string {
  return realm.kind === 'backend' ? 'backend' : `gitProvider:${realm.url || ''}`;
}
