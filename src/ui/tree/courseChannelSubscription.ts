import type { WebSocketService, WebSocketEventHandlers } from '../../services/WebSocketService';

/**
 * Tracks `course:<id>` WebSocket channel subscriptions for a tree provider.
 * Handles duplicate-subscribe suppression and unsubscription bookkeeping so each
 * provider only needs to specify its handler callbacks.
 */
export class CourseChannelSubscription {
  private wsService?: WebSocketService;
  private readonly subscribed = new Set<string>();

  constructor(private readonly handlerId: string) {}

  setService(wsService: WebSocketService | undefined): void {
    this.wsService = wsService;
  }

  /**
   * Subscribe to the `course:<id>` channels that are not already subscribed.
   * No-op if the service is not set or every channel is already tracked.
   */
  subscribeCourses(courseIds: readonly string[], handlers: WebSocketEventHandlers): void {
    if (!this.wsService) return;
    const newChannels = courseIds
      .map(id => `course:${id}`)
      .filter(ch => !this.subscribed.has(ch));
    if (newChannels.length === 0) return;
    newChannels.forEach(ch => this.subscribed.add(ch));
    this.wsService.subscribe(newChannels, this.handlerId, handlers);
  }

  /**
   * Replace the currently-subscribed set with exactly `course:<courseId>`.
   * Unsubscribes any other channels first, then subscribes to the target channel.
   * No-op if already subscribed only to the target channel.
   */
  switchToCourse(courseId: string, handlers: WebSocketEventHandlers): void {
    if (!this.wsService) return;
    const target = `course:${courseId}`;
    const toDrop = [...this.subscribed].filter(ch => ch !== target);
    if (toDrop.length > 0) {
      this.wsService.unsubscribe(toDrop, this.handlerId);
      toDrop.forEach(ch => this.subscribed.delete(ch));
    }
    if (!this.subscribed.has(target)) {
      this.subscribed.add(target);
      this.wsService.subscribe([target], this.handlerId, handlers);
    }
  }

  unsubscribeAll(): void {
    if (!this.wsService || this.subscribed.size === 0) return;
    this.wsService.unsubscribe([...this.subscribed], this.handlerId);
    this.subscribed.clear();
  }
}
