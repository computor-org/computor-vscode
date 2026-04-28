import * as vscode from 'vscode';
import { ComputorSettingsManager } from '../settings/ComputorSettingsManager';
import type { BearerTokenHttpClient } from '../http/BearerTokenHttpClient';
import type { WSDeploymentStatusChanged, WSDeploymentAssigned, WSDeploymentUnassigned, WSCourseContentUpdated } from '../types/generated/websocket';

// WebSocket message types from server
export interface WsMessageNew {
  type: 'message:new';
  channel: string;
  data: Record<string, unknown>;
}

export interface WsMessageUpdate {
  type: 'message:update';
  channel: string;
  message_id: string;
  data: Record<string, unknown>;
}

export interface WsMessageDelete {
  type: 'message:delete';
  channel: string;
  message_id: string;
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
}

// Re-export deployment/course event types from generated types
export type WsDeploymentStatusChanged = WSDeploymentStatusChanged & { type: 'deployment:status_changed' };
export type WsDeploymentAssigned = WSDeploymentAssigned & { type: 'deployment:assigned' };
export type WsDeploymentUnassigned = WSDeploymentUnassigned & { type: 'deployment:unassigned' };
export type WsCourseContentUpdated = WSCourseContentUpdated & { type: 'course:content_updated' };

export type WsServerMessage = WsMessageNew | WsMessageUpdate | WsMessageDelete | WsTypingUpdate | WsReadUpdate | WsPong | WsSystemPong | WsSystemConnected | WsChannelSubscribed | WsChannelUnsubscribed | WsError | WsMaintenanceActivated | WsMaintenanceDeactivated | WsMaintenanceScheduled | WsMaintenanceCancelled | WsMaintenanceReminder | WsDeploymentStatusChanged | WsDeploymentAssigned | WsDeploymentUnassigned | WsCourseContentUpdated;

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

export type WsClientMessage = WsSubscribe | WsUnsubscribe | WsTypingStart | WsTypingStop | WsReadMark | WsPing;

// Channel scope types
export type ChannelScope = 'submission_group' | 'course_content' | 'course';

export interface WebSocketEventHandlers {
  onMessageNew?: (channel: string, data: Record<string, unknown>) => void;
  onMessageUpdate?: (channel: string, messageId: string, data: Record<string, unknown>) => void;
  onMessageDelete?: (channel: string, messageId: string) => void;
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

    this.connectionState = 'connecting';
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

        // Attempt reconnect if not intentionally closed and not an auth failure
        if (event.code === 1000 || event.code === 4001 || event.code === 4003) {
          if (event.code !== 1000) {
            console.warn(`[WebSocket] Authentication failed (${event.code}), not reconnecting`);
          }
        } else {
          this.scheduleReconnect();
        }
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

        case 'message:update':
          this.eventHandlers.forEach((handlers) => {
            handlers.onMessageUpdate?.(message.channel, message.message_id, message.data);
          });
          break;

        case 'message:delete':
          this.eventHandlers.forEach((handlers) => {
            handlers.onMessageDelete?.(message.channel, message.message_id);
          });
          break;

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
          vscode.window.showWarningMessage(`Maintenance Mode Active: ${activatedData.message}`);
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
          vscode.window.showInformationMessage(`Maintenance Complete: ${deactivatedData.message}`);
          this.eventHandlers.forEach((handlers) => {
            handlers.onMaintenanceDeactivated?.(deactivatedData.message);
          });
          break;
        }

        case 'maintenance:scheduled': {
          const scheduledData = (message as any).data || message;
          console.log('[WebSocket] Maintenance scheduled:', scheduledData.scheduled_at);
          this.updateMaintenanceStatusBar('scheduled', scheduledData.message, scheduledData.scheduled_at);
          vscode.window.showInformationMessage(`Maintenance Scheduled for ${new Date(scheduledData.scheduled_at).toLocaleString()}: ${scheduledData.message}`);
          this.eventHandlers.forEach((handlers) => {
            handlers.onMaintenanceScheduled?.(scheduledData.scheduled_at, scheduledData.message);
          });
          break;
        }

        case 'maintenance:cancelled': {
          const cancelledData = (message as any).data || message;
          console.log('[WebSocket] Maintenance cancelled');
          this.updateMaintenanceStatusBar('inactive');
          vscode.window.showInformationMessage('Scheduled maintenance has been cancelled.');
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
            vscode.window.showErrorMessage(`Maintenance in ${minutesRemaining} minute(s): ${reminderMessage}`);
          } else if (minutesRemaining <= 10) {
            this.maintenanceStatusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
            vscode.window.showWarningMessage(`Maintenance in ${minutesRemaining} minutes: ${reminderMessage}`);
          } else {
            this.maintenanceStatusBarItem.backgroundColor = undefined;
            vscode.window.showInformationMessage(`Maintenance in ${minutesRemaining} minutes: ${reminderMessage}`);
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
