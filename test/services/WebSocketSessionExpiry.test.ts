import { expect } from 'chai';
import {
  WebSocketService,
  WS_CLOSE_AUTH_FAILED,
  WS_CLOSE_TOKEN_EXPIRED
} from '../../src/services/WebSocketService';
import { CredentialRecoveryService } from '../../src/services/CredentialRecoveryService';
import { HttpError } from '../../src/exceptions/errors/HttpError';

/**
 * The client half of computor-org/issues#257.
 *
 * The backend now closes a socket whose credential expired with its own code,
 * 4003. Before that, the extension lumped 4003 in with 4001 and simply stopped
 * reconnecting — so a session that had merely rolled over (the editor left open
 * over lunch) looked exactly like a rejected token, and the student was left
 * with a dead socket and no explanation while HTTP started failing beside it.
 *
 * What is pinned here:
 *
 * 1. 4003 is recoverable: refresh silently and come back, without a
 *    notification, because nothing is actually wrong yet.
 * 2. A refresh that does not renew is the end of the road — report through the
 *    one credential-recovery surface (#247), do not invent a second one.
 * 3. Never reconnect with a token the server already closed us on. That loop is
 *    what turned a dead session into endless retries.
 * 4. The expiry warning is answered in place, so the connection and its
 *    subscriptions survive a session boundary.
 */
describe('WebSocketService session expiry (#257)', () => {
  let service: any;
  let reported: number;
  let connects: number;
  let sent: any[];
  let token: string;
  /** What the next refreshAuth() call leaves in getAccessToken(). */
  let refreshedTo: string | undefined;

  const recovery = CredentialRecoveryService.getInstance() as any;
  const originalReportExpired = recovery.reportExpired;

  beforeEach(() => {
    reported = 0;
    connects = 0;
    sent = [];
    token = 'session-1';
    refreshedTo = undefined;

    recovery.reportExpired = async () => { reported++; };

    service = WebSocketService.getInstance({
      getSettings: async () => ({ authentication: { baseUrl: 'http://localhost:8000' } })
    } as any);

    service.setHttpClient({
      getAccessToken: () => token,
      refreshAuth: async () => {
        if (refreshedTo !== undefined) {
          token = refreshedTo;
        }
      },
      get: async () => ({ data: {} })
    } as any);

    // The transport itself is out of scope here — these tests are about which
    // recovery path a close code selects, not about opening sockets.
    service.connect = async () => { connects++; };
    service.send = (message: any) => { sent.push(message); };
    service.rejectedToken = undefined;
    service.sessionRecoveryAttempts = 0;
    // Stand in for an established connection: this is the token it was opened
    // with, which is what a reauth has to improve on to be worth sending.
    service.activeToken = token;
  });

  afterEach(() => {
    recovery.reportExpired = originalReportExpired;
    service.dispose();
  });

  it('treats an expired session as recoverable and reconnects silently', async () => {
    refreshedTo = 'session-2';

    await service.recoverExpiredSession('session-1');

    expect(connects, 'should have reconnected with the renewed token').to.equal(1);
    expect(reported, 'a renewable session must not bother the user').to.equal(0);
  });

  it('gives up to the credential recovery flow when the refresh does not renew', async () => {
    // refreshAuth() succeeds but hands back the same credential: the session is
    // really gone, and reconnecting would just be closed again.
    refreshedTo = undefined;

    await service.recoverExpiredSession('session-1');

    expect(connects).to.equal(0);
    expect(reported, 'the #247 flow owns telling the user').to.equal(1);
  });

  it('stops after a bounded number of recovery attempts', async () => {
    service.sessionRecoveryAttempts = service.maxSessionRecoveryAttempts;
    refreshedTo = 'session-2';

    await service.recoverExpiredSession('session-1');

    expect(connects, 'past the cap it must not keep trying').to.equal(0);
    expect(reported).to.equal(1);
  });

  it('refuses to connect with a token the server already rejected', async () => {
    // Restore the real connect() so its own guard runs; the WebSocket
    // constructor below must never be reached.
    delete service.connect;
    service.rejectedToken = 'session-1';

    await service.connect();

    expect(reported, 'the dead token should surface, not silently retry').to.equal(1);
    expect(service.connectionState).to.equal('disconnected');
  });

  it('answers the expiry warning in place instead of dropping the connection', async () => {
    refreshedTo = 'session-2';
    service.isConnected = () => true;

    service.handleMessage(JSON.stringify({
      type: 'system:auth_expiring',
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      seconds_remaining: 60
    }));
    // handleMessage fires the refresh without awaiting it.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(sent, 'the renewed token should be handed to the open socket').to.deep.equal([
      { type: 'system:reauth', token: 'session-2' }
    ]);
    expect(connects, 'a re-arm in place must not reconnect').to.equal(0);
  });

  it('does not send a reauth it has nothing new to offer', async () => {
    refreshedTo = undefined;
    service.isConnected = () => true;

    await service.reauthenticateInPlace();

    expect(sent).to.deep.equal([]);
  });

  it('clears the rejected token once the server confirms a reauth', () => {
    service.rejectedToken = 'session-1';
    service.sessionRecoveryAttempts = 2;

    service.handleMessage(JSON.stringify({
      type: 'system:reauthed',
      user_id: 'u-1',
      expires_at: new Date(Date.now() + 3_600_000).toISOString()
    }));

    expect(service.rejectedToken).to.equal(undefined);
    expect(service.sessionRecoveryAttempts).to.equal(0);
  });

  it('names the session when it stops reconnecting because of a 401', async () => {
    // The reported state: socket gone, UI half-alive, HTTP returning 401. A
    // close code cannot tell that apart from a dead network, so one probe does.
    service.httpClient.get = async () => { throw new HttpError('nope', 401, 'Unauthorized'); };

    await service.diagnoseGivingUp();

    expect(reported).to.equal(1);
  });

  it('stays quiet when it stops reconnecting because of the network', async () => {
    service.httpClient.get = async () => { throw new Error('ECONNREFUSED'); };

    await service.diagnoseGivingUp();

    expect(reported, 'a network outage is not a credential problem').to.equal(0);
  });

  it('keeps the two auth close codes apart', () => {
    // 4001 asks the user for a new credential; 4003 is fixed by a refresh they
    // never see. Collapsing them is the bug this issue reported.
    expect(WS_CLOSE_TOKEN_EXPIRED).to.not.equal(WS_CLOSE_AUTH_FAILED);
  });
});
