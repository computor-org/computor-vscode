import { expect } from 'chai';
import * as vscode from 'vscode';
import { WebSocketService, WS_CLOSE_AUTH_FAILED, WsClientMessage } from '../../src/services/WebSocketService';
import { CredentialRecoveryService } from '../../src/services/CredentialRecoveryService';
import { UiStateService } from '../../src/services/UiStateService';
import { CourseChannelSubscription } from '../../src/ui/tree/courseChannelSubscription';
import { HttpError } from '../../src/exceptions/errors/HttpError';

class Socket {
  static readonly OPEN = 1;
  static instances: Socket[] = [];
  readyState = 0;
  sent: WsClientMessage[] = [];
  onopen?: () => void;
  onclose?: (event: { code: number; reason: string }) => void;
  onmessage?: (event: { data: string }) => void;

  constructor(_url: string) { Socket.instances.push(this); }
  open(): void { this.readyState = Socket.OPEN; this.onopen?.(); }
  send(data: string): void { this.sent.push(JSON.parse(data)); }
  receive(message: unknown): void { this.onmessage?.({ data: JSON.stringify(message) }); }
  close(code = 1000, reason = ''): void {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.onclose?.({ code, reason });
  }
}

const settle = () => new Promise<void>(resolve => setTimeout(resolve, 10));

describe('WebSocketService status and channel ownership (#259)', () => {
  let service: WebSocketService;
  let uiState: UiStateService;
  let statuses: Array<{ visible: boolean; text: string; command?: string; show(): void; hide(): void; dispose(): void }>;
  const originalSocket = globalThis.WebSocket;
  const originalCreateStatus = vscode.window.createStatusBarItem;
  const recovery = CredentialRecoveryService.getInstance();
  const originalReportExpired = recovery.reportExpired;
  let reported: number;
  let probeError: Error | undefined;

  beforeEach(() => {
    Socket.instances = [];
    globalThis.WebSocket = Socket as unknown as typeof WebSocket;
    statuses = [];
    vscode.window.createStatusBarItem = (() => {
      const item = {
        visible: false, text: '', command: undefined,
        show() { this.visible = true; },
        hide() { this.visible = false; },
        dispose() { this.visible = false; }
      };
      statuses.push(item);
      return item;
    }) as unknown as typeof vscode.window.createStatusBarItem;
    reported = 0;
    probeError = undefined;
    recovery.reportExpired = async () => { reported++; };
    (UiStateService as any).instance = undefined;
    uiState = UiStateService.initialize({
      globalState: { get: () => ({ activeContainer: 'computor-tutor' }), update: async () => {} }
    } as any);
  });

  afterEach(async () => {
    service?.dispose();
    await uiState.clear();
    (UiStateService as any).instance = undefined;
    recovery.reportExpired = originalReportExpired;
    vscode.window.createStatusBarItem = originalCreateStatus;
    globalThis.WebSocket = originalSocket;
  });

  function createService(): void {
    service = WebSocketService.getInstance({
      getSettings: async () => ({ authentication: { baseUrl: 'http://localhost:8000' } })
    } as any);
    service.setHttpClient({
      getAccessToken: () => 'session-1', refreshAuth: async () => {},
      get: async () => { if (probeError) throw probeError; return { data: {} }; },
      setMaintenanceMode: () => {}
    } as any);
    // Exercise the real reconnect ladder without its production backoff.
    (service as any).reconnectDelayMs = 0;
    (service as any).maxReconnectAttempts = 2;
  }

  async function connect(): Promise<Socket> {
    createService();
    await service.connect();
    const socket = Socket.instances[0]!;
    socket.open();
    return socket;
  }

  it('shows nothing at construction even when a Computor view is visible', () => {
    uiState.setViewVisible('computor.tutor', true);
    createService();
    expect(statuses[0]!.visible).to.equal(false);
    expect(Socket.instances).to.have.length(0);
  });

  it('scopes connecting and connected status to live views while receiving hidden push events', async () => {
    createService();
    await service.connect();
    expect(statuses[0]!.visible, 'a remembered container is not a visible view').to.equal(false);
    uiState.setViewVisible('computor.tutor', true);
    expect(statuses[0]!.visible).to.equal(true);
    expect(statuses[0]!.text).to.contain('sync~spin');
    const socket = Socket.instances[0]!;
    socket.open();
    expect(statuses[0]!.text).to.contain('check');
    uiState.setViewVisible('computor.tutor', false);
    expect(statuses[0]!.visible).to.equal(false);

    let permissions = 0;
    service.subscribe([], 'permissions', { onPermissionsUpdated: () => { permissions++; } });
    socket.receive({ type: 'permissions:updated', channel: 'user:1', data: { user_id: '1' } });
    socket.receive({ type: 'maintenance:activated', active: true, message: 'Maintenance', activated_at: 'now' });
    expect(permissions).to.equal(1);
    expect(statuses[1]!.visible, 'session maintenance notices remain available').to.equal(true);
    expect(service.isConnected()).to.equal(true);

    service.dispose();
    uiState.setViewVisible('computor.tutor', true);
    expect(statuses[0]!.visible, 'disposed status must not react to view events').to.equal(false);
  });

  it('shows global reconnect attention only after the last automatic attempt fails', async () => {
    let socket = await connect();
    probeError = new Error('ECONNREFUSED');
    for (let attempt = 0; attempt < 2; attempt++) {
      socket.close(1006);
      expect(statuses[0]!.visible, 'background backoff stays hidden').to.equal(false);
      await settle();
      socket = Socket.instances[attempt + 1]!;
      expect(statuses[0]!.visible, 'an in-flight retry stays hidden').to.equal(false);
    }
    socket.close(1006);
    await settle();
    expect(statuses[0]!.visible).to.equal(true);
    expect(statuses[0]!.command).to.equal('computor.websocket.reconnect');
    await service.reconnect();
    expect(statuses[0]!.visible).to.equal(false);
    Socket.instances[3]!.open();
    expect(service.isConnected()).to.equal(true);
  });

  it('drops channels at their last holder and keeps remaining handler callbacks', async () => {
    const socket = await connect();
    let updates = 0;
    let permissions = 0;
    const courses = new CourseChannelSubscription('tree');
    courses.setService(service);
    courses.subscribeCourses(['one', 'two'], { onCourseUpdated: () => { updates++; } });
    service.subscribe(['course:two', 'course:three'], 'panel', {});
    service.subscribe([], 'permissions', { onPermissionsUpdated: () => { permissions++; } });
    expect(socket.sent).to.deep.equal([
      { type: 'channel:subscribe', channels: ['course:one', 'course:two'] },
      { type: 'channel:subscribe', channels: ['course:three'] }
    ]);
    socket.sent = [];

    courses.switchToCourse('two', {});
    service.unsubscribe(['course:two'], 'unknown');
    service.unsubscribe(['course:two'], 'panel');
    expect(socket.sent).to.deep.equal([{ type: 'channel:unsubscribe', channels: ['course:one'] }]);
    socket.receive({ type: 'course:updated', channel: 'course:two', data: { course_id: 'two' } });
    expect(updates, 'switching to an already-held course retains its callback').to.equal(1);

    courses.unsubscribeAll();
    service.unsubscribe(['course:three'], 'panel');
    expect(socket.sent).to.deep.equal([
      { type: 'channel:unsubscribe', channels: ['course:one'] },
      { type: 'channel:unsubscribe', channels: ['course:two'] },
      { type: 'channel:unsubscribe', channels: ['course:three'] }
    ]);
    socket.receive({ type: 'permissions:updated', channel: 'user:1', data: { user_id: '1' } });
    expect(permissions, 'channel cleanup keeps the permanent push handler').to.equal(1);
    service.unsubscribe([], 'permissions');
    expect(service.isConnected(), 'the session socket survives its last channel consumer').to.equal(true);
  });

  it('replaces exhausted-retry attention with credential recovery when the session probe returns 401', async () => {
    let socket = await connect();
    probeError = new HttpError('expired', 401, 'Unauthorized');
    for (let attempt = 0; attempt < 2; attempt++) {
      socket.close(1006);
      await settle();
      socket = Socket.instances[attempt + 1]!;
    }
    socket.close(1006);
    await settle();
    expect(reported).to.equal(1);
    expect(statuses[0]!.visible).to.equal(false);
    expect(Socket.instances).to.have.length(3);
  });

  it('adds channels to an existing handler without double-counting repeated subscriptions', async () => {
    const socket = await connect();
    service.subscribe(['course:one'], 'tree', {});
    service.subscribe(['course:one', 'course:two'], 'tree', {});
    service.subscribe(['course:two'], 'tree', {});
    socket.sent = [];
    service.unsubscribe(['course:one', 'course:one', 'course:two'], 'tree');
    expect(socket.sent).to.deep.equal([
      { type: 'channel:unsubscribe', channels: ['course:one', 'course:two'] }
    ]);
    expect(service.isConnected()).to.equal(true);
  });

  it('resubscribes only retained channels after both automatic and manual reconnect', async () => {
    const socket = await connect();
    service.subscribe(['course:one', 'course:two'], 'tree', {});
    socket.close(1006);
    service.unsubscribe(['course:one'], 'tree');
    await settle();
    const automatic = Socket.instances[1]!;
    automatic.open();
    expect(automatic.sent).to.deep.equal([{ type: 'channel:subscribe', channels: ['course:two'] }]);
    await service.reconnect();
    const manual = Socket.instances[2]!;
    manual.open();
    expect(manual.sent).to.deep.equal([{ type: 'channel:subscribe', channels: ['course:two'] }]);
    service.unsubscribe(['course:two'], 'tree');
    expect(manual.sent[1]).to.deep.equal({ type: 'channel:unsubscribe', channels: ['course:two'] });
  });

  it('hands an auth close to credential recovery without reconnecting or a global WS item', async () => {
    const socket = await connect();
    socket.close(WS_CLOSE_AUTH_FAILED);
    await settle();
    expect(reported).to.equal(1);
    expect(Socket.instances).to.have.length(1);
    expect(service.getConnectionState()).to.equal('disconnected');
    expect(statuses[0]!.visible).to.equal(false);
  });
});
