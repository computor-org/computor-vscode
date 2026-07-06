import * as vscode from 'vscode';
import { HttpError } from '../http/errors/HttpError';

/**
 * GDPR consent gate handling.
 *
 * When the backend consent gate is active, EVERY gated API call is blocked with
 * the same 403 until the user accepts the current privacy policy in the web app.
 * The backend body is stable: `{ error: "consent_required", required_version,
 * error_code: "AUTHZ_006", message }`. Without special handling the extension
 * only shows an opaque "HTTP 403: Forbidden"; this module detects that 403 and
 * surfaces an actionable, throttled prompt that deep-links to the web app's
 * consent page instead.
 */

const CONSENT_ERROR = 'consent_required';

/** True iff `error` is the backend consent gate's 403 (keyed on the stable `error` field). */
export function isConsentRequiredError(error: unknown): error is HttpError {
  return (
    error instanceof HttpError &&
    error.status === 403 &&
    (error.response as any)?.error === CONSENT_ERROR
  );
}

/** The policy version the caller must accept, if the error carries it. */
export function requiredConsentVersion(error: unknown): string | undefined {
  if (!isConsentRequiredError(error)) {
    return undefined;
  }
  const v = (error.response as any)?.required_version;
  return typeof v === 'string' ? v : undefined;
}

/**
 * Resolve the web app URL via GET /instance-info. That endpoint is whitelisted
 * in the consent gate, so it still succeeds while the caller is consent-blocked.
 * Uses a dynamic import to avoid a static dependency cycle with the API service.
 */
async function resolveWebUrl(): Promise<string | undefined> {
  try {
    const { ComputorApiService } = await import('../services/ComputorApiService');
    const info = await ComputorApiService.getInstance()?.getInstanceInfo();
    return info?.web_url ?? undefined;
  } catch {
    return undefined;
  }
}

/** Open the web app's consent page, or explain where to go if the URL is unknown. */
export async function openConsentPage(): Promise<void> {
  const webUrl = await resolveWebUrl();
  if (webUrl) {
    const consentUrl = `${webUrl.replace(/\/+$/, '')}/consent`;
    await vscode.env.openExternal(vscode.Uri.parse(consentUrl));
    return;
  }
  await vscode.window.showInformationMessage(
    'Open the Computor web app and accept the current privacy policy to continue.'
  );
}

// The gate 403s every gated call, so many providers/commands can trip it almost
// simultaneously. Surface the prompt at most once per interval.
let lastNotifiedAt = 0;
const NOTIFY_INTERVAL_MS = 15_000;

/**
 * If `error` is the consent gate's 403, surface an actionable, throttled
 * notification and return true (handled). Otherwise return false so the caller
 * falls back to its normal error handling.
 */
export async function handleConsentError(error: unknown): Promise<boolean> {
  if (!isConsentRequiredError(error)) {
    return false;
  }

  const now = Date.now();
  if (now - lastNotifiedAt < NOTIFY_INTERVAL_MS) {
    return true; // already surfaced recently; still "handled"
  }
  lastNotifiedAt = now;

  const detail =
    (error.response as any)?.message ||
    'You must accept the current privacy policy before you can continue.';

  const OPEN = 'Open Web App';
  const choice = await vscode.window.showWarningMessage(`Computor: ${detail}`, OPEN);
  if (choice === OPEN) {
    await openConsentPage();
  }
  return true;
}
