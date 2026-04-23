import { expect } from 'chai';
import * as vscode from 'vscode';
import { commandRegistrar } from '../../src/commands/commandHelpers';

// The vscode module is a singleton, so mutating its `commands.registerCommand`
// stub is visible inside `commandRegistrar` immediately — no module reload
// required.
type RegisterCall = { id: string; handler: (...args: any[]) => any };

describe('commandHelpers', () => {
  let originalRegister: typeof vscode.commands.registerCommand;
  let registrations: RegisterCall[];

  beforeEach(() => {
    registrations = [];
    originalRegister = vscode.commands.registerCommand;
    (vscode.commands as any).registerCommand = (id: string, handler: (...args: any[]) => any) => {
      registrations.push({ id, handler });
      return { dispose() {} };
    };
  });

  afterEach(() => {
    (vscode.commands as any).registerCommand = originalRegister;
  });

  it('commandRegistrar returns a function bound to the provided context', () => {
    const subs: { dispose(): void }[] = [];
    const ctx = { subscriptions: subs } as unknown as vscode.ExtensionContext;

    const register = commandRegistrar(ctx);
    expect(register).to.be.a('function');

    const handler = () => 42;
    register('computor.test.alpha', handler);

    expect(registrations).to.have.length(1);
    expect(registrations[0]!.id).to.equal('computor.test.alpha');
    expect(registrations[0]!.handler).to.equal(handler);
    expect(subs).to.have.length(1);
  });

  it('each call pushes a new disposable onto the supplied context', () => {
    const subs: { dispose(): void }[] = [];
    const ctx = { subscriptions: subs } as unknown as vscode.ExtensionContext;

    const register = commandRegistrar(ctx);
    register('computor.test.one', () => 1);
    register('computor.test.two', () => 2);
    register('computor.test.three', () => 3);

    expect(registrations.map(r => r.id)).to.deep.equal([
      'computor.test.one',
      'computor.test.two',
      'computor.test.three'
    ]);
    expect(subs).to.have.length(3);
    for (const d of subs) expect(d).to.have.property('dispose').that.is.a('function');
  });

  it('two registrars bound to different contexts do not cross-push', () => {
    const subsA: { dispose(): void }[] = [];
    const subsB: { dispose(): void }[] = [];
    const ctxA = { subscriptions: subsA } as unknown as vscode.ExtensionContext;
    const ctxB = { subscriptions: subsB } as unknown as vscode.ExtensionContext;

    const registerA = commandRegistrar(ctxA);
    const registerB = commandRegistrar(ctxB);

    registerA('computor.a', () => 'a');
    registerB('computor.b1', () => 'b1');
    registerB('computor.b2', () => 'b2');

    expect(subsA).to.have.length(1);
    expect(subsB).to.have.length(2);
  });
});
