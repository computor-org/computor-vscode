import { expect } from 'chai';
import * as vscode from 'vscode';
import {
  CredentialRecoveryService,
  humanizeCommandId
} from '../../src/services/CredentialRecoveryService';
import { AuthenticationError, HttpError } from '../../src/exceptions/errors/HttpError';

/**
 * The contract behind computor-org/issues#247: a dead credential must be told
 * apart from an unreachable backend, must point at the token entry that fixes
 * it, and must not lose the action it interrupted.
 */
describe('CredentialRecoveryService', () => {
  let svc: CredentialRecoveryService;
  let executed: Array<{ command: string; args: unknown[] }>;
  let shown: Array<{ severity: string; message: string; actions: string[] }>;
  /** What the next notification's user picks, in order. */
  let answers: Array<string | undefined>;

  const originals = {
    executeCommand: vscode.commands.executeCommand,
    info: vscode.window.showInformationMessage,
    warn: vscode.window.showWarningMessage,
    error: vscode.window.showErrorMessage
  };

  function record(severity: string) {
    return async (message: string, ...actions: string[]) => {
      shown.push({ severity, message, actions });
      return answers.shift();
    };
  }

  beforeEach(() => {
    svc = new CredentialRecoveryService();
    executed = [];
    shown = [];
    answers = [];
    (vscode.commands as any).executeCommand = async (command: string, ...args: unknown[]) => {
      executed.push({ command, args });
      return undefined;
    };
    (vscode.window as any).showInformationMessage = record('info');
    (vscode.window as any).showWarningMessage = record('warning');
    (vscode.window as any).showErrorMessage = record('error');
  });

  afterEach(() => {
    (vscode.commands as any).executeCommand = originals.executeCommand;
    (vscode.window as any).showInformationMessage = originals.info;
    (vscode.window as any).showWarningMessage = originals.warn;
    (vscode.window as any).showErrorMessage = originals.error;
  });

  describe('classify', () => {
    it('reads a 401 as the credential, not as a permission denial', () => {
      // The backend answers 403 for "you may not do that" — a 401 is always the
      // token itself.
      expect(svc.classify(new HttpError('nope', 401, 'Unauthorized'))).to.deep.equal({ kind: 'backend' });
      expect(svc.classify(new HttpError('nope', 403, 'Forbidden'))).to.equal(undefined);
    });

    it('recognises the session client giving up', () => {
      expect(svc.classify(new AuthenticationError('Session expired. Please sign in again.')))
        .to.deep.equal({ kind: 'backend' });
    });

    it('names the git server whose token was rejected', () => {
      expect(svc.classify({
        stderr: "fatal: Authentication failed for 'https://git.example.org/itp/student-42.git/'"
      })).to.deep.equal({ kind: 'gitProvider', url: 'https://git.example.org' });
    });

    it('still reports a git rejection git did not attach a URL to', () => {
      expect(svc.classify({ stderr: 'remote: HTTP Basic: Access denied' }))
        .to.deep.equal({ kind: 'gitProvider', url: undefined });
    });

    it('leaves everything else to normal error reporting', () => {
      expect(svc.classify(new Error('Could not resolve host: git.example.org'))).to.equal(undefined);
      expect(svc.classify(new HttpError('boom', 500, 'Server Error'))).to.equal(undefined);
      expect(svc.classify(undefined)).to.equal(undefined);
    });
  });

  describe('reportExpired', () => {
    it('deep-links to the failing realm, not to the view root', async () => {
      answers = ['Update Token'];
      await svc.reportExpired({ kind: 'gitProvider', url: 'https://git.example.org' });

      expect(shown).to.have.length(1);
      expect(shown[0]!.message).to.include('https://git.example.org');
      expect(executed).to.deep.equal([{
        command: 'computor.settingsView',
        args: [{ section: 'gitProvider', url: 'https://git.example.org' }]
      }]);
    });

    it('does not say the same thing as an unreachable backend', async () => {
      answers = [undefined, undefined];
      await svc.reportExpired({ kind: 'backend' });
      await svc.reportExpired({ kind: 'gitProvider', url: 'https://git.example.org' });

      const [backend, provider] = shown;
      expect(backend!.message).to.not.equal(provider!.message);
      // "unreachable" is BackendConnectionService's story (issues#117), not this one.
      for (const notice of shown) {
        expect(notice.message.toLowerCase()).to.not.include('unreachable');
        expect(notice.message.toLowerCase()).to.match(/expired|rejected|revoked/);
      }
    });

    it('offers sign-in for the backend, since its credential is not in Settings', async () => {
      answers = ['Sign in'];
      await svc.reportExpired({ kind: 'backend' });
      expect(executed).to.deep.equal([{ command: 'computor.login', args: [] }]);
    });

    it('shows one notification per realm while it is on screen', async () => {
      let release: () => void = () => {};
      const gate = new Promise<void>(resolve => { release = resolve; });
      (vscode.window as any).showErrorMessage = async (message: string, ...actions: string[]) => {
        shown.push({ severity: 'error', message, actions });
        await gate;
        return undefined;
      };

      const realm = { kind: 'gitProvider' as const, url: 'https://git.example.org' };
      const first = svc.reportExpired(realm);
      await svc.reportExpired(realm);
      expect(shown).to.have.length(1);

      release();
      await first;

      answers = [undefined];
      (vscode.window as any).showErrorMessage = record('error');
      await svc.reportExpired(realm);
      expect(shown).to.have.length(2);
    });
  });

  describe('credentialRestored', () => {
    it('offers the interrupted action back once the token is replaced', async () => {
      answers = [undefined];
      await svc.handleCommandFailure('computor.student.submitAssignment', ['content-7'], {
        stderr: "fatal: Authentication failed for 'https://git.example.org/itp/x.git/'"
      });
      expect(svc.pendingAction({ kind: 'gitProvider', url: 'https://git.example.org' }))
        .to.deep.equal({
          command: 'computor.student.submitAssignment',
          args: ['content-7'],
          label: 'Submit assignment'
        });

      executed = [];
      answers = ['Retry'];
      await svc.credentialRestored({ kind: 'gitProvider', url: 'https://git.example.org' });

      expect(executed).to.deep.equal([{
        command: 'computor.student.submitAssignment',
        args: ['content-7']
      }]);
    });

    it('never re-runs a write the user declined', async () => {
      svc.remember({ kind: 'backend' }, {
        command: 'computor.student.submitAssignment',
        args: [],
        label: 'Submit assignment'
      });
      answers = ['Not Now'];
      await svc.credentialRestored({ kind: 'backend' });
      expect(executed).to.be.empty;
    });

    it('replays a read without asking, and only once', async () => {
      svc.remember({ kind: 'backend' }, {
        command: 'computor.student.refresh',
        args: [],
        label: 'Refresh'
      });
      await svc.credentialRestored({ kind: 'backend' });
      expect(shown).to.be.empty;
      expect(executed).to.deep.equal([{ command: 'computor.student.refresh', args: [] }]);

      executed = [];
      await svc.credentialRestored({ kind: 'backend' });
      expect(executed).to.be.empty;
    });

    it('is silent when an ordinary sign-in interrupted nothing', async () => {
      await svc.credentialRestored({ kind: 'backend' });
      expect(shown).to.be.empty;
      expect(executed).to.be.empty;
    });

    it('keeps realms apart — a git token does not release a backend action', async () => {
      svc.remember({ kind: 'backend' }, { command: 'computor.student.refresh', args: [], label: 'Refresh' });
      await svc.credentialRestored({ kind: 'gitProvider', url: 'https://git.example.org' });
      expect(executed).to.be.empty;
      expect(svc.pendingAction({ kind: 'backend' })).to.not.equal(undefined);
    });
  });

  describe('handleCommandFailure', () => {
    it('leaves non-credential failures to the caller', async () => {
      const handled = await svc.handleCommandFailure('computor.student.refresh', [], new Error('disk full'));
      expect(handled).to.equal(false);
      expect(shown).to.be.empty;
    });
  });

  describe('humanizeCommandId', () => {
    it('turns a command id into something worth reading in a prompt', () => {
      expect(humanizeCommandId('computor.student.submitAssignment')).to.equal('Submit assignment');
      expect(humanizeCommandId('computor.lecturer.refreshExamples')).to.equal('Refresh examples');
      expect(humanizeCommandId('computor.student.refresh')).to.equal('Refresh');
      expect(humanizeCommandId('standalone')).to.equal('Standalone');
    });
  });
});
