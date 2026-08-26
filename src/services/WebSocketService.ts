import * as vscode from 'vscode';
import { ComputorSettingsManager } from '../settings/ComputorSettingsManager';
import type { BearerTokenHttpClient } from '../http/BearerTokenHttpClient';
import type { WSDeploymentStatusChanged, WSDeploymentAssigned, WSDeploymentUnassigned, WSCourseContentUpdated, WSCourseUpdated } from '../types/generated/websocket';
import { CredentialRecoveryService } from './CredentialRecoveryService';
import { notify } from '../utils/notify';

// WebSocket message types from server
export interface WsMessageNew {
  type: 'message:new';
  channel: string;
  data: Record<string, unknown>;
}

export interface WsMessageUpdate {
  type: 'message:update';
  channel: string;
  /** Absent on the wire today — the id arrives nested inside `data`. */
  message_id?: string;
  data: Record<string, unknown>;
}

export interface WsMessageDelete {
  type: 'message:delete';
  channel: string;
  /** Absent on the wire today — the id arrives nested inside `data`. */
  message_id?: string;
  data?: { message_id?: string };
}

export interface WsTypingUpdate {
  type: 'typing:update';
  channel: string;
  user_id: string;
  user_name: string;
  is_typing: boolean;
}

export interface WsReadUpdate {
  type: 'read:update';
  channel: string;
  message_id: string;
  user_id: string;
  /** True when marked read, false when marked unread. Optional for older payloads. */
  read?: boolean;
}

export interface WsPong {
  type: 'pong';
}

export interface WsSystemPong {
  type: 'system:pong';
  timestamp: string;
}

export interface WsChannelSubscribed {
  type: 'channel:subscribed';
  channels: string[];
}

export interface WsChannelUnsubscribed {
  type: 'channel:unsubscribed';
  channels: string[];
}

export interface WsError {
  type: 'error';
  message: string;
}

export interface WsMaintenanceActivated {
  type: 'maintenance:activated';
  active: boolean;
  message: string;
  activated_at: string;
}

export interface WsMaintenanceDeactivated {
  type: 'maintenance:deactivated';
  active: boolean;
  message: string;
}

export interface WsMaintenanceScheduled {
  type: 'maintenance:scheduled';
  scheduled_at: string;
  message: string;
}

export interface WsMaintenanceCancelled {
  type: 'maintenance:cancelled';
  message: string;
}

export interface WsMaintenanceReminder {
  type: 'maintenance:reminder';
  data: {
    minutes_remaining: number;
    scheduled_at: string;
    message: string;
  };
}

export interface WsSystemConnected {
  type: 'system:connected';
  user_id: string;
  /** When the credential behind this connection expires; absent when it never does. */
  expires_at?: string | null;
}

/**
 * The session behind this socket is about to expire (computor-org/issues#257).
 * The server sends this once, shortly before it closes the connection with
 * {@link WS_CLOSE_TOKEN_EXPIRED} — it is the window in which a refresh can
 * keep the connection instead of losing it.
 */
export interface WsAuthExpiring {
  type: 'system:auth_expiring';
  expires_at: string;
  seconds_remaining: number;
}

/** The server accepted a `system:reauth`; the connection lives on. */
export interface WsReauthed {
  type: 'system:reauthed';
  user_id: string;
  expires_at?: string | null;
}

// Re-export deployment/course event types from generated types
export type WsDeploymentStatusChanged = WSDeploymentStatusChanged & { type: 'deployment:status_changed' };
export type WsDeploymentAssigned = WSDeploymentAssigned & { type: 'deployment:assigned' };
export type WsDeploymentUnassigned = WSDeploymentUnassigned & { type: 'deployment:unassigned' };
export type WsCourseContentUpdated = WSCourseContentUpdated & { type: 'course:content_updated' };
export type WsCourseUpdated = WSCourseUpdated & { type: 'course:updated' };

export type WsServerMessage = WsMessageNew | WsMessageUpdate | WsMessageDelete | WsTypingUpdate | WsReadUpdate | WsPong | WsSystemPong | WsSystemConnected | WsAuthExpiring | WsReauthed | WsChannelSubscribed | WsChannelUnsubscribed | WsError | WsMaintenanceActivated | WsMaintenanceDeactivated | WsMaintenanceScheduled | WsMaintenanceCancelled | WsMaintenanceReminder | WsDeploymentStatusChanged | WsDeploymentAssigned | WsDeploymentUnassigned | WsCourseContentUpdated | WsCourseUpdated;

// WebSocket message types to server
export interface WsSubscribe {
  type: 'channel:subscribe';
  channels: string[];
}

export interface WsUnsubscribe {
  type: 'channel:unsubscribe';
  channels: string[];
}

export interface WsTypingStart {
  type: 'typing:start';
  channel: string;
}

export interface WsTypingStop {
  type: 'typing:stop';
  channel: string;
}

export interface WsReadMark {
  type: 'read:mark';
  channel: string;
  message_id: string;
}

export interface WsPing {
  type: 'system:ping';
}

/** Hand the server a freshly refreshed token so this connection survives. */
export interface WsReauth {
  type: 'system:reauth';
  token: string;
}

export type WsClientMessage = WsSubscribe | WsUnsubscribe | WsTypingStart | WsTypingStop | WsReadMark | WsPing | WsReauth;

/**
 * The credential was rejected outright — the user needs to supply a new one.
 */
export const WS_CLOSE_AUTH_FAILED = 4001;

/**
 * The credential that opened this connection has since expired
 * (computor-org/issues#257). Distinct from {@link WS_CLOSE_AUTH_FAILED} on
 * purpose: this one is usually fixed by a silent session refresh, so it must
 * not send the user to a sign-in prompt on the first occurrence.
 */
export const WS_CLOSE_TOKEN_EXPIRED = 4003;

// Channel scope types
export type ChannelScope = 'submission_group' | 'course_content' | 'course';

export interface WebSocketEventHandlers {
  onMessageNew?: (channel: string, data: Record<string, unknown>) => void;
  onMessageUpdate?: (channel: string, messageId: string | undefined, data: Record<string, unknown>) => void;
  onMessageDelete?: (channel: string, messageId: string | undefined) => void;
  onTypingUpdate?: (channel: string, userId: string, userName: string, isTyping: boolean) => void;
  onReadUpdate?: (channel: string, messageId: string, userId: string, read?: boolean) => void;
  onMaintenanceActivated?: (message: string, activatedAt: string) => void;
  onMaintenanceDeactivated?: (message: string) => void;
  onMaintenanceScheduled?: (scheduledAt: string, message: string) => void;
  onMaintenanceCancelled?: (message: string) => void;
  onMaintenanceReminder?: (minutesRemaining: number, scheduledAt: string, message: string) => void;
  onDeploymentStatusChanged?: (event: WsDeploymentStatusChanged) => void;
  onDeploymentAssigned?: (event: WsDeploymentAssigned) => void;
  onDeploymentUnassigned?: (event: WsDeploymentUnassigned) => void;
  onCourseContentUpdated?: (event: WsCourseContentUpdated) => void;
  onCourseUpdated?: (event: WsCourseUpdated) => void;
  onConnected?: () => void;
  onDisconnected?: () => void;
  onError?: (error: string) => void;
}

type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

export class WebSocketService {
  private static instance?: WebSocketService;

  private ws?: WebSocket;
  private settingsManager: ComputorSettingsManager;
  private httpClient?: BearerTokenHttpClient;
  private subscribedChannels: Set<string> = new Set();
  private eventHandlers: Map<string, WebSocketEventHandlers> = new Map();
  private connectionState: ConnectionState = 'disconnected';
  private pingInterval?: ReturnType<typeof setInterval>;
  private reconnectTimeout?: ReturnType<typeof setTimeout>;
  private connectionTimeout?: ReturnType<typeof setTimeout>;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelayMs = 1000;
  private connectionTimeoutMs = 10000; // 10 seconds to establish connection
  private typingTimeouts: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private readonly typingTimeoutMs = 5000;
  private statusBarItem: vscode.StatusBarItem;
  private maintenanceStatusBarItem: vscode.StatusBarItem;
  /**
   * The token the server last closed us on. Reconnecting with it would be
   * answered by the same close, forever — the loop that made an expired
   * session look like a flapping network (computor-org/issues#257).
   */
  private rejectedToken?: string;
  /** The token the current connection was opened (or last re-armed) with. */
  private activeToken?: string;
  /** Consecutive failed attempts to recover an expired session. */
  private sessionRecoveryAttempts = 0;
  private readonly maxSessionRecoveryAttempts = 3;

  private constructor(settingsManager: ComputorSettingsManager) {
    this.settingsManager = settingsManager;
    this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99);
    this.maintenanceStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    this.updateStatusBar();
  }

  public static getInstance(settingsManager: ComputorSettingsManager): WebSocketService {
    if (!WebSocketService.instance) {
      WebSocketService.instance = new WebSocketService(settingsManager);
    }
    return WebSocketService.instance;
  }

  public setHttpClient(httpClient: BearerTokenHttpClient): void {
    this.httpClient = httpClient;
  }

  public async connect(): Promise<void> {
    if (this.connectionState === 'connected' || this.connectionState === 'connecting') {
      return;
    }

    if (!this.httpClient) {
      console.warn('[WebSocket] No HTTP client set, cannot connect');
      return;
    }

    // Ensure token is fresh before connecting
    await this.ensureFreshToken();

    const token = this.httpClient.getAccessToken();
    if (!token) {
      console.warn('[WebSocket] No access token available, cannot connect');
      return;
    }

    // Never hand the server back a token it has already closed us on: it will
    // close us again, and the reconnect ladder turns a dead session into an
    // endless retry loop that never tells anyone anything (#257).
    if (token === this.rejectedToken) {
      console.warn('[WebSocket] Refusing to reconnect with an already-rejected token');
      this.connectionState = 'disconnected';
      this.updateStatusBar();
      await this.reportSessionExpired();
      return;
    }

    this.connectionState = 'connecting';
    this.activeToken = token;
    this.updateStatusBar();
    const connectStartTime = Date.now();

    try {
      const settings = await this.settingsManager.getSettings();
      const baseUrl = settings.authentication.baseUrl;

      // Convert http(s) to ws(s)
      const wsUrl = baseUrl.replace(/^http/, 'ws');
      const fullUrl = `${wsUrl}/ws?token=${encodeURIComponent(token)}`;

      console.log(`[WebSocket] Connecting to ${wsUrl}/ws (timeout: ${this.connectionTimeoutMs}ms)`);
      this.ws = new WebSocket(fullUrl);

      // Set connection timeout - if we don't connect within this time, consider it failed
      this.connectionTimeout = setTimeout(() => {
        if (this.connectionState === 'connecting') {
          const elapsed = Date.now() - connectStartTime;
          console.warn(`[WebSocket] Connection timeout after ${elapsed}ms`);
          this.ws?.close();
          this.connectionState = 'disconnected';
          this.updateStatusBar();
          this.scheduleReconnect();
        }
      }, this.connectionTimeoutMs);

      this.ws.onopen = () => {
        const elapsed = Date.now() - connectStartTime;
        console.log(`[WebSocket] Connected (took ${elapsed}ms)`);
        this.clearConnectionTimeout();
        this.connectionState = 'connected';
        this.reconnectAttempts = 0;
        this.sessionRecoveryAttempts = 0;
        this.updateStatusBar();
        this.startPingInterval();

        // Resubscribe to channels
        if (this.subscribedChannels.size > 0) {
          this.send({
            type: 'channel:subscribe',
            channels: Array.from(this.subscribedChannels)
          });
        }

        // Notify handlers
        this.eventHandlers.forEach((handlers) => {
          handlers.onConnected?.();
        });
      };

      this.ws.onclose = (event) => {
        const elapsed = Date.now() - connectStartTime;
        console.log(`[WebSocket] Disconnected after ${elapsed}ms: code=${event.code} reason=${event.reason || 'none'}`);
        this.clearConnectionTimeout();
        this.connectionState = 'disconnected';
        this.updateStatusBar();
        this.stopPingInterval();

        // Notify handlers
        this.eventHandlers.forEach((handlers) => {
          handlers.onDisconnected?.();
        });

        if (event.code === 1000) {
          // Intentional client-side close.
          return;
        }

        if (event.code === WS_CLOSE_TOKEN_EXPIRED) {
          // The session died under a healthy connection. This is recoverable
          // without troubling the user, and used to be indistinguishable from
          // a hard auth failure: the socket just stopped and stayed stopped
          // while HTTP started returning 401 (#257).
          void this.recoverExpiredSession(token);
          return;
        }

        if (event.code === WS_CLOSE_AUTH_FAILED) {
          console.warn('[WebSocket] Token rejected at handshake, not reconnecting');
          this.rejectedToken = token;
          void this.reportSessionExpired();
          return;
        }

        this.scheduleReconnect();
      };

      this.ws.onerror = (event) => {
        const elapsed = Date.now() - connectStartTime;
        const errorMessage = (event as ErrorEvent)?.message || 'Unknown error';
        console.error(`[WebSocket] Error after ${elapsed}ms: ${errorMessage}`);
        this.eventHandlers.forEach((handlers) => {
          handlers.onError?.('WebSocket connection error');
        });
      };

      this.ws.onmessage = (event) => {
        this.handleMessage(event.data);
      };
    } catch (error) {
      console.error('[WebSocket] Connection error:', error);
      this.connectionState = 'disconnected';
      this.updateStatusBar();
      this.scheduleReconnect();
    }
  }

  public disconnect(): void {
    this.connectionState = 'disconnected';
    this.updateStatusBar();
    this.stopPingInterval();
    this.clearConnectionTimeout();

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = undefined;
    }

    if (this.ws) {
      this.ws.close(1000, 'Client disconnect');
      this.ws = undefined;
    }

    this.subscribedChannels.clear();
    this.typingTimeouts.forEach((timeout) => clearTimeout(timeout));
    this.typingTimeouts.clear();
  }

  public subscribe(channels: string[], handlerId: string, handlers: WebSocketEventHandlers): void {
    this.eventHandlers.set(handlerId, handlers);

    const newChannels = channels.filter((ch) => !this.subscribedChannels.has(ch));
    newChannels.forEach((ch) => this.subscribedChannels.add(ch));

    if (newChannels.length > 0 && this.isConnected()) {
      this.send({
        type: 'channel:subscribe',
        channels: newChannels
      });
    }
  }

  public unsubscribe(channels: string[], handlerId: string): void {
    this.eventHandlers.delete(handlerId);

    // Only unsubscribe from channels that no other handler needs
    const channelsToRemove = channels.filter((ch) => {
      // Check if any other handler still needs this channel
      let stillNeeded = false;
      this.eventHandlers.forEach(() => {
        // In a more complex implementation, we'd track which handlers need which channels
        // For now, we only unsubscribe if no handlers remain
        stillNeeded = this.eventHandlers.size > 0;
      });
      return !stillNeeded;
    });

    if (channelsToRemove.length > 0) {
      channelsToRemove.forEach((ch) => this.subscribedChannels.delete(ch));

      if (this.isConnected()) {
        this.send({
          type: 'channel:unsubscribe',
          channels: channelsToRemove
        });
      }
    }
  }

  public startTyping(channel: string): void {
    if (!this.isConnected()) {
      return;
    }

    // Clear existing timeout for this channel
    const existingTimeout = this.typingTimeouts.get(channel);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
    }

    this.send({
      type: 'typing:start',
      channel
    });

    // Auto-stop typing after timeout
    const timeout = setTimeout(() => {
      this.stopTyping(channel);
    }, this.typingTimeoutMs);

    this.typingTimeouts.set(channel, timeout);
  }

  public stopTyping(channel: string): void {
    const existingTimeout = this.typingTimeouts.get(channel);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
      this.typingTimeouts.delete(channel);
    }

    if (!this.isConnected()) {
      return;
    }

    this.send({
      type: 'typing:stop',
      channel
    });
  }

  public markMessageRead(channel: string, messageId: string): void {
    if (!this.isConnected()) {
      return;
    }

    this.send({
      type: 'read:mark',
      channel,
      message_id: messageId
    });
  }

  public isConnected(): boolean {
    return this.connectionState === 'connected' && this.ws?.readyState === WebSocket.OPEN;
  }

  public getConnectionState(): ConnectionState {
    return this.connectionState;
  }

  public async reconnect(): Promise<void> {
    console.log('[WebSocket] Manual reconnect requested');
    this.reconnectAttempts = 0;
    // An explicit reconnect is the user saying "try again" — usually right
    // after fixing their credentials — so the refusal to reuse a rejected
    // token is lifted here. If it really is still dead the server says so
    // again and we are back where we were.
    this.rejectedToken = undefined;
    this.sessionRecoveryAttempts = 0;
    this.disconnect();
    await this.connect();
  }

  public static buildChannel(scope: ChannelScope, id: string): string {
    return `${scope}:${id}`;
  }

  private send(message: WsClientMessage): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn('[WebSocket] Cannot send message, not connected');
      return;
    }

    this.ws.send(JSON.stringify(message));
  }

  private handleMessage(data: string): void {
    try {
      const message = JSON.parse(data) as WsServerMessage;

      switch (message.type) {
        case 'message:new':
          this.eventHandlers.forEach((handlers) => {
            handlers.onMessageNew?.(message.channel, message.data);
          });
          break;

        case 'message:update': {
          // The broadcast payload nests the envelope: message.data is
          // {channel, message_id, data: MessageGet}. Reading message_id off
          // the top level yielded undefined, and every handler dropped the
          // event — an edited message never re-rendered
          // (computor-org/issues#316). Top level is still read first in case
          // the backend ever flattens the shape.
          const inner = (message.data ?? {}) as { message_id?: string; data?: { id?: string } };
          const messageId = message.message_id ?? inner.message_id ?? inner.data?.id;
          this.eventHandlers.forEach((handlers) => {
            handlers.onMessageUpdate?.(message.channel, messageId, message.data);
          });
          break;
        }

        case 'message:delete': {
          const inner = (message.data ?? {}) as { message_id?: string };
          const messageId = message.message_id ?? inner.message_id;
          this.eventHandlers.forEach((handlers) => {
            handlers.onMessageDelete?.(message.channel, messageId);
          });
          break;
        }

        case 'typing:update':
          console.log('[WebSocket] Received typing:update raw message:', JSON.stringify(message));
          this.eventHandlers.forEach((handlers) => {
            handlers.onTypingUpdate?.(message.channel, message.user_id, message.user_name, message.is_typing);
          });
          break;

        case 'read:update':
          this.eventHandlers.forEach((handlers) => {
            handlers.onReadUpdate?.(message.channel, message.message_id, message.user_id, message.read);
          });
          break;

        case 'system:connected':
          console.log('[WebSocket] Connected as user:', message.user_id);
          break;

        case 'system:auth_expiring':
          // The window before close 4003. Refreshing now keeps the socket and
          // its subscriptions; ignoring it just means we reconnect instead.
          console.log(`[WebSocket] Session expires in ${message.seconds_remaining}s, re-authenticating`);
          void this.reauthenticateInPlace();
          break;

        case 'system:reauthed':
          console.log('[WebSocket] Re-authenticated, connection valid until', message.expires_at ?? 'further notice');
          this.rejectedToken = undefined;
          this.sessionRecoveryAttempts = 0;
          break;

        case 'pong':
        case 'system:pong':
          // Pong received, connection is alive
          break;

        case 'channel:subscribed':
          // Confirmation of channel subscription
          console.log('[WebSocket] Subscribed to channels:', (message as any).channels);
          break;

        case 'channel:unsubscribed':
          // Confirmation of channel unsubscription
          console.log('[WebSocket] Unsubscribed from channels:', (message as any).channels);
          break;

        case 'error':
          console.error('[WebSocket] Server error:', message.message);
          this.eventHandlers.forEach((handlers) => {
            handlers.onError?.(message.message);
          });
          break;

        case 'maintenance:activated': {
          const activatedData = (message as any).data || message;
          console.log('[WebSocket] Maintenance activated:', activatedData.message);
          this.httpClient?.setMaintenanceMode(true, activatedData.message);
          this.updateMaintenanceStatusBar('active', activatedData.message);
          notify.warning(`Maintenance Mode Active: ${activatedData.message}`);
          this.eventHandlers.forEach((handlers) => {
            handlers.onMaintenanceActivated?.(activatedData.message, activatedData.activated_at);
          });
          break;
        }

        case 'maintenance:deactivated': {
          const deactivatedData = (message as any).data || message;
          console.log('[WebSocket] Maintenance deactivated');
          this.httpClient?.setMaintenanceMode(false);
          this.updateMaintenanceStatusBar('inactive');
          notify.info(`Maintenance Complete: ${deactivatedData.message}`);
          this.eventHandlers.forEach((handlers) => {
            handlers.onMaintenanceDeactivated?.(deactivatedData.message);
          });
          break;
        }

        case 'maintenance:scheduled': {
          const scheduledData = (message as any).data || message;
          console.log('[WebSocket] Maintenance scheduled:', scheduledData.scheduled_at);
          this.updateMaintenanceStatusBar('scheduled', scheduledData.message, scheduledData.scheduled_at);
          notify.info(`Maintenance Scheduled for ${new Date(scheduledData.scheduled_at).toLocaleString()}: ${scheduledData.message}`);
          this.eventHandlers.forEach((handlers) => {
            handlers.onMaintenanceScheduled?.(scheduledData.scheduled_at, scheduledData.message);
          });
          break;
        }

        case 'maintenance:cancelled': {
          const cancelledData = (message as any).data || message;
          console.log('[WebSocket] Maintenance cancelled');
          this.updateMaintenanceStatusBar('inactive');
          notify.info('Scheduled maintenance has been cancelled.');
          this.eventHandlers.forEach((handlers) => {
            handlers.onMaintenanceCancelled?.(cancelledData.message);
          });
          break;
        }

        case 'maintenance:reminder': {
          const reminderData = (message as any).data || message;
          const minutesRemaining: number = reminderData.minutes_remaining;
          const reminderMessage: string = reminderData.message || 'Maintenance is approaching';

          console.log(`[WebSocket] Maintenance reminder: ${minutesRemaining}min remaining`);

          // Update status bar with countdown
          this.maintenanceStatusBarItem.text = `$(clock) Maint. ${minutesRemaining}m`;
          this.maintenanceStatusBarItem.tooltip = `Maintenance in ${minutesRemaining} minute(s): ${reminderMessage}`;

          // Escalate notification urgency based on time remaining
          if (minutesRemaining <= 5) {
            this.maintenanceStatusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
            notify.error(`Maintenance in ${minutesRemaining} minute(s): ${reminderMessage}`);
          } else if (minutesRemaining <= 10) {
            this.maintenanceStatusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
            notify.warning(`Maintenance in ${minutesRemaining} minutes: ${reminderMessage}`);
          } else {
            this.maintenanceStatusBarItem.backgroundColor = undefined;
            notify.info(`Maintenance in ${minutesRemaining} minutes: ${reminderMessage}`);
          }

          this.maintenanceStatusBarItem.show();

          this.eventHandlers.forEach((handlers) => {
            handlers.onMaintenanceReminder?.(minutesRemaining, reminderData.scheduled_at, reminderMessage);
          });
          break;
        }

        case 'deployment:status_changed': {
          const statusData = (message as any).data || message;
          console.log(`[WebSocket] Deployment status changed: ${statusData.course_content_id} ${statusData.previous_status} -> ${statusData.new_status}`);
          this.eventHandlers.forEach((handlers) => {
            handlers.onDeploymentStatusChanged?.({ ...statusData, type: 'deployment:status_changed' } as WsDeploymentStatusChanged);
          });
          break;
        }

        case 'deployment:assigned': {
          const assignedData = (message as any).data || message;
          console.log(`[WebSocket] Deployment assigned: ${assignedData.course_content_id} example=${assignedData.example_identifier}`);
          this.eventHandlers.forEach((handlers) => {
            handlers.onDeploymentAssigned?.({ ...assignedData, type: 'deployment:assigned' } as WsDeploymentAssigned);
          });
          break;
        }

        case 'deployment:unassigned': {
          const unassignedData = (message as any).data || message;
          console.log(`[WebSocket] Deployment unassigned: ${unassignedData.course_content_id}`);
          this.eventHandlers.forEach((handlers) => {
            handlers.onDeploymentUnassigned?.({ ...unassignedData, type: 'deployment:unassigned' } as WsDeploymentUnassigned);
          });
          break;
        }

        case 'course:content_updated': {
          const contentData = (message as any).data || message;
          console.log(`[WebSocket] Course content updated: ${contentData.course_content_id} change=${contentData.change_type}`);
          this.eventHandlers.forEach((handlers) => {
            handlers.onCourseContentUpdated?.({ ...contentData, type: 'course:content_updated' } as WsCourseContentUpdated);
          });
          break;
        }

        case 'course:updated': {
          // Course-level settings changed. `visible` can move the whole
          // content tree in or out of view (issue #338), so subscribers
          // refetch the course rather than patching a single row.
          const courseData = (message as any).data || message;
          console.log(`[WebSocket] Course updated: ${courseData.course_id} change=${courseData.change_type}`);
          this.eventHandlers.forEach((handlers) => {
            handlers.onCourseUpdated?.({ ...courseData, type: 'course:updated' } as WsCourseUpdated);
          });
          break;
        }

        default:
          console.warn('[WebSocket] Unknown message type:', message);
      }
    } catch (error) {
      console.error('[WebSocket] Failed to parse message:', error);
    }
  }

  private startPingInterval(): void {
    this.stopPingInterval();

    // Send ping every 25 seconds to keep connection alive (as per backend docs)
    this.pingInterval = setInterval(() => {
      if (this.isConnected()) {
        this.send({ type: 'system:ping' });
      }
    }, 25000);
  }

  private stopPingInterval(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = undefined;
    }
  }

  private async ensureFreshToken(): Promise<void> {
    if (!this.httpClient) {
      return;
    }

    try {
      await this.httpClient.refreshAuth();
      console.log('[WebSocket] Token refreshed before connect');
    } catch (error) {
      console.warn('[WebSocket] Token refresh failed, using existing token:', error);
    }
  }

  /**
   * The server closed us because our session expired (close 4003).
   *
   * Refresh silently and come back — a session that is still renewable should
   * cost the user nothing, and this is the common case: they left the editor
   * open over lunch. Only when the refresh stops producing a *different*
   * token is the session really gone, and then the #247 recovery flow takes
   * over rather than a second, parallel "please sign in" path being invented
   * here.
   *
   * @param deadToken the token the server just closed us on
   */
  private async recoverExpiredSession(deadToken: string): Promise<void> {
    this.rejectedToken = deadToken;
    this.sessionRecoveryAttempts++;

    if (this.sessionRecoveryAttempts > this.maxSessionRecoveryAttempts) {
      console.warn('[WebSocket] Session could not be renewed, handing over to credential recovery');
      await this.reportSessionExpired();
      return;
    }

    console.log(
      `[WebSocket] Session expired, refreshing (attempt ${this.sessionRecoveryAttempts}/${this.maxSessionRecoveryAttempts})`
    );
    await this.ensureFreshToken();

    if (this.httpClient?.getAccessToken() === deadToken) {
      // Refresh returned the same credential, so there is nothing new to try.
      // Reconnecting here is what produced the retry loop this replaced.
      console.warn('[WebSocket] Refresh did not renew the session');
      await this.reportSessionExpired();
      return;
    }

    this.connectionState = 'reconnecting';
    this.updateStatusBar();
    await this.connect();
  }

  /**
   * Give up quietly on our side and let the one credential-recovery surface
   * (#247) tell the user, so an expired session says the same thing here as it
   * does on a failed request.
   */
  private async reportSessionExpired(): Promise<void> {
    await CredentialRecoveryService.getInstance().reportExpired({ kind: 'backend' });
  }

  /**
   * Answer the server's expiry warning by re-arming the connection in place.
   *
   * Reconnecting would also work, but it drops every subscription and
   * re-establishes it a moment later; refreshing and sending the new token
   * keeps the socket, so an hour-long session boundary is invisible.
   */
  private async reauthenticateInPlace(): Promise<void> {
    if (!this.httpClient || !this.isConnected()) {
      return;
    }

    await this.ensureFreshToken();
    const token = this.httpClient.getAccessToken();
    if (!token || token === this.rejectedToken || token === this.activeToken) {
      // Nothing was renewed. Re-sending the credential the connection already
      // holds cannot move its deadline — the server will not extend a session
      // just because a socket asked — so let the close come and recover from
      // there instead of pretending.
      console.warn('[WebSocket] No renewed token to re-authenticate with; waiting for close');
      return;
    }

    this.activeToken = token;
    this.send({ type: 'system:reauth', token });
  }

  private clearConnectionTimeout(): void {
    if (this.connectionTimeout) {
      clearTimeout(this.connectionTimeout);
      this.connectionTimeout = undefined;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.warn('[WebSocket] Max reconnect attempts reached');
      this.connectionState = 'disconnected';
      this.updateStatusBar();
      return;
    }

    if (this.reconnectTimeout) {
      return;
    }

    this.connectionState = 'reconnecting';
    const delay = this.reconnectDelayMs * Math.pow(2, this.reconnectAttempts);
    this.reconnectAttempts++;
    this.updateStatusBar();

    console.log(`[WebSocket] Scheduling reconnect in ${delay}ms (attempt ${this.reconnectAttempts})`);

    this.reconnectTimeout = setTimeout(() => {
      this.reconnectTimeout = undefined;
      void this.connect();
    }, delay);
  }

  private updateStatusBar(): void {
    switch (this.connectionState) {
      case 'connected':
        this.statusBarItem.text = '$(check) WS';
        this.statusBarItem.backgroundColor = undefined;
        this.statusBarItem.tooltip = 'WebSocket connected';
        this.statusBarItem.command = undefined;
        break;
      case 'connecting':
        this.statusBarItem.text = '$(sync~spin) WS';
        this.statusBarItem.backgroundColor = undefined;
        this.statusBarItem.tooltip = 'WebSocket connecting...';
        this.statusBarItem.command = undefined;
        break;
      case 'reconnecting':
        this.statusBarItem.text = '$(sync~spin) WS';
        this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
        this.statusBarItem.tooltip = `WebSocket reconnecting (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`;
        this.statusBarItem.command = undefined;
        break;
      case 'disconnected':
        this.statusBarItem.text = '$(x) WS';
        this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
        this.statusBarItem.tooltip = 'WebSocket disconnected - Click to reconnect';
        this.statusBarItem.command = 'computor.websocket.reconnect';
        break;
    }
    this.statusBarItem.show();
  }

  public updateMaintenanceStatusBar(state: 'active' | 'scheduled' | 'inactive', message?: string, scheduledAt?: string): void {
    switch (state) {
      case 'active':
        this.maintenanceStatusBarItem.text = '$(warning) Maintenance';
        this.maintenanceStatusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
        this.maintenanceStatusBarItem.tooltip = message || 'System is under maintenance';
        this.maintenanceStatusBarItem.show();
        break;
      case 'scheduled':
        this.maintenanceStatusBarItem.text = '$(clock) Maint. scheduled';
        this.maintenanceStatusBarItem.backgroundColor = undefined;
        this.maintenanceStatusBarItem.tooltip = scheduledAt
          ? `Maintenance scheduled: ${new Date(scheduledAt).toLocaleString()}${message ? ' — ' + message : ''}`
          : message || 'Maintenance scheduled';
        this.maintenanceStatusBarItem.show();
        break;
      case 'inactive':
        this.maintenanceStatusBarItem.hide();
        break;
    }
  }

  public dispose(): void {
    this.disconnect();
    this.eventHandlers.clear();
    this.statusBarItem.dispose();
    this.maintenanceStatusBarItem.dispose();
    WebSocketService.instance = undefined;
  }
}
