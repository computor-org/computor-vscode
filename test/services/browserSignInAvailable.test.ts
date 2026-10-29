import * as assert from 'assert';
import * as vscode from 'vscode';

import { browserSignInAvailable } from '../../src/authentication/SsoLoginService';

/**
 * The browser sign-in hands its tokens to a loopback receiver on the extension
 * host, which only a browser on the same machine can reach. In a hosted
 * workspace "Sign in" opened nothing (computor.at, 2026-10-29), so it is not
 * offered there.
 */
describe('browserSignInAvailable', () => {
  const env = vscode.env as { uiKind: number; remoteName: string | undefined };
  const saved = { uiKind: env.uiKind, remoteName: env.remoteName };

  afterEach(() => {
    env.uiKind = saved.uiKind;
    env.remoteName = saved.remoteName;
  });

  it('is available in desktop VS Code without a remote', () => {
    env.uiKind = vscode.UIKind.Desktop;
    env.remoteName = undefined;
    assert.strictEqual(browserSignInAvailable(), true);
  });

  it('is not available in a browser workspace', () => {
    env.uiKind = vscode.UIKind.Web;
    env.remoteName = undefined;
    assert.strictEqual(browserSignInAvailable(), false);
  });

  it('is not available in a remote window', () => {
    env.uiKind = vscode.UIKind.Desktop;
    env.remoteName = 'ssh-remote';
    assert.strictEqual(browserSignInAvailable(), false);
  });
});
