/**
 * Does this error (from a git exec) indicate a rejected credential — as opposed
 * to a network failure, timeout, or any other git error? Git surfaces auth
 * rejections only as stderr text, so string matching is all there is; the exec
 * error's message carries that stderr.
 */
export function isGitAuthenticationError(error: unknown): boolean {
  const message = (error as any)?.message || (error as any)?.toString?.() || '';
  return message.includes('Authentication failed') ||
         message.includes('Access denied') ||
         message.includes('HTTP Basic') ||
         message.includes('401');
}
