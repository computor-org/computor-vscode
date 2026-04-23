import { expect } from 'chai';
import { CourseChannelSubscription } from '../../../src/ui/tree/courseChannelSubscription';
import type { WebSocketService, WebSocketEventHandlers } from '../../../src/services/WebSocketService';

type SubscribeCall = { channels: string[]; handlerId: string; handlers: WebSocketEventHandlers };
type UnsubscribeCall = { channels: string[]; handlerId: string };

function fakeWebSocketService(): {
  ws: WebSocketService;
  subscribeCalls: SubscribeCall[];
  unsubscribeCalls: UnsubscribeCall[];
} {
  const subscribeCalls: SubscribeCall[] = [];
  const unsubscribeCalls: UnsubscribeCall[] = [];
  const ws = {
    subscribe(channels: string[], handlerId: string, handlers: WebSocketEventHandlers) {
      subscribeCalls.push({ channels: [...channels], handlerId, handlers });
    },
    unsubscribe(channels: string[], handlerId: string) {
      unsubscribeCalls.push({ channels: [...channels], handlerId });
    }
  } as unknown as WebSocketService;
  return { ws, subscribeCalls, unsubscribeCalls };
}

const emptyHandlers: WebSocketEventHandlers = {};

describe('CourseChannelSubscription', () => {
  it('is a no-op before a WebSocketService is set', () => {
    const sub = new CourseChannelSubscription('test-tree');
    sub.subscribeCourses(['c1'], emptyHandlers);
    sub.switchToCourse('c2', emptyHandlers);
    sub.unsubscribeAll();
    // Nothing throws; state silently drops.
  });

  describe('subscribeCourses', () => {
    it('subscribes each course: prefix once and tags the call with the handler id', () => {
      const { ws, subscribeCalls } = fakeWebSocketService();
      const sub = new CourseChannelSubscription('lecturer-tree');
      sub.setService(ws);

      sub.subscribeCourses(['c1', 'c2'], emptyHandlers);

      expect(subscribeCalls).to.have.length(1);
      expect(subscribeCalls[0]!.channels).to.deep.equal(['course:c1', 'course:c2']);
      expect(subscribeCalls[0]!.handlerId).to.equal('lecturer-tree');
    });

    it('skips channels that are already subscribed', () => {
      const { ws, subscribeCalls } = fakeWebSocketService();
      const sub = new CourseChannelSubscription('lecturer-tree');
      sub.setService(ws);

      sub.subscribeCourses(['c1', 'c2'], emptyHandlers);
      sub.subscribeCourses(['c2', 'c3'], emptyHandlers);

      expect(subscribeCalls).to.have.length(2);
      expect(subscribeCalls[1]!.channels).to.deep.equal(['course:c3']);
    });

    it('is a no-op when every channel is already subscribed', () => {
      const { ws, subscribeCalls } = fakeWebSocketService();
      const sub = new CourseChannelSubscription('lecturer-tree');
      sub.setService(ws);

      sub.subscribeCourses(['c1', 'c2'], emptyHandlers);
      sub.subscribeCourses(['c1', 'c2'], emptyHandlers);

      expect(subscribeCalls).to.have.length(1);
    });
  });

  describe('switchToCourse', () => {
    it('subscribes to the target when nothing is active', () => {
      const { ws, subscribeCalls, unsubscribeCalls } = fakeWebSocketService();
      const sub = new CourseChannelSubscription('tutor-tree');
      sub.setService(ws);

      sub.switchToCourse('c1', emptyHandlers);

      expect(unsubscribeCalls).to.have.length(0);
      expect(subscribeCalls).to.have.length(1);
      expect(subscribeCalls[0]!.channels).to.deep.equal(['course:c1']);
    });

    it('unsubscribes the previous course and subscribes the new one on switch', () => {
      const { ws, subscribeCalls, unsubscribeCalls } = fakeWebSocketService();
      const sub = new CourseChannelSubscription('tutor-tree');
      sub.setService(ws);

      sub.switchToCourse('c1', emptyHandlers);
      sub.switchToCourse('c2', emptyHandlers);

      expect(unsubscribeCalls).to.have.length(1);
      expect(unsubscribeCalls[0]!.channels).to.deep.equal(['course:c1']);
      expect(subscribeCalls).to.have.length(2);
      expect(subscribeCalls[1]!.channels).to.deep.equal(['course:c2']);
    });

    it('is a no-op when switching to the already-active channel', () => {
      const { ws, subscribeCalls, unsubscribeCalls } = fakeWebSocketService();
      const sub = new CourseChannelSubscription('tutor-tree');
      sub.setService(ws);

      sub.switchToCourse('c1', emptyHandlers);
      sub.switchToCourse('c1', emptyHandlers);

      expect(subscribeCalls).to.have.length(1);
      expect(unsubscribeCalls).to.have.length(0);
    });

    it('drops all other channels when called after subscribeCourses with multiple', () => {
      const { ws, subscribeCalls, unsubscribeCalls } = fakeWebSocketService();
      const sub = new CourseChannelSubscription('tutor-tree');
      sub.setService(ws);

      sub.subscribeCourses(['c1', 'c2', 'c3'], emptyHandlers);
      sub.switchToCourse('c2', emptyHandlers);

      expect(unsubscribeCalls).to.have.length(1);
      expect(unsubscribeCalls[0]!.channels.sort()).to.deep.equal(['course:c1', 'course:c3']);
      // c2 was already subscribed, so no extra subscribe
      expect(subscribeCalls).to.have.length(1);
    });
  });

  describe('unsubscribeAll', () => {
    it('sends a single unsubscribe for every tracked channel and clears state', () => {
      const { ws, subscribeCalls, unsubscribeCalls } = fakeWebSocketService();
      const sub = new CourseChannelSubscription('student-tree');
      sub.setService(ws);

      sub.subscribeCourses(['c1', 'c2'], emptyHandlers);
      sub.unsubscribeAll();

      expect(unsubscribeCalls).to.have.length(1);
      expect(unsubscribeCalls[0]!.channels).to.deep.equal(['course:c1', 'course:c2']);

      // After the purge we should be able to subscribe to the same courses again.
      sub.subscribeCourses(['c1'], emptyHandlers);
      expect(subscribeCalls).to.have.length(2);
    });

    it('is a no-op when nothing is tracked', () => {
      const { ws, unsubscribeCalls } = fakeWebSocketService();
      const sub = new CourseChannelSubscription('student-tree');
      sub.setService(ws);

      sub.unsubscribeAll();
      expect(unsubscribeCalls).to.have.length(0);
    });
  });

  describe('setService(undefined)', () => {
    it('stops further subscribe/unsubscribe calls from reaching the service', () => {
      const { ws, subscribeCalls, unsubscribeCalls } = fakeWebSocketService();
      const sub = new CourseChannelSubscription('lecturer-tree');
      sub.setService(ws);
      sub.subscribeCourses(['c1'], emptyHandlers);

      sub.setService(undefined);
      sub.subscribeCourses(['c2'], emptyHandlers);
      sub.switchToCourse('c3', emptyHandlers);
      sub.unsubscribeAll();

      expect(subscribeCalls).to.have.length(1);
      expect(unsubscribeCalls).to.have.length(0);
    });
  });
});
