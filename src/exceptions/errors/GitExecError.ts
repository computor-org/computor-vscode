export class GitTimeoutError extends Error {
  constructor(command: string, timeoutMs: number) {
    super(`Git operation timed out after ${timeoutMs / 1000}s: ${command}`);
    this.name = 'GitTimeoutError';
  }
}

export class GitCancelledError extends Error {
  constructor(command: string) {
    super(`Git operation cancelled: ${command}`);
    this.name = 'GitCancelledError';
  }
}
