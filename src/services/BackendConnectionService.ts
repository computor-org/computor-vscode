import * as vscode from 'vscode';
import { say, sayFailed } from '../utils/uiLanguage';
import fetch from 'node-fetch';
import { notify } from '../utils/notify';

export interface BackendStatus {
  isReachable: boolean;
  error?: 'NOT_RUNNING' | 'NETWORK_ERROR' | 'VPN_REQUIRED' | 'TIMEOUT' | 'UNKNOWN';
  message?: string;
  lastCheckTime: Date;
}

export class BackendConnectionService {
  private static instance: BackendConnectionService;
  private lastStatus: BackendStatus | null = null;
  private retryCount = 0;
  private maxRetries = 3;
  private statusBarItem: vscode.StatusBarItem;
  private checkInterval: NodeJS.Timeout | null = null;
  private currentBaseUrl: string = 'http://localhost:8000';
  
  private constructor() {
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100
    );
    this.statusBarItem.command = 'computor.checkBackendConnection';
  }
  
  static getInstance(): BackendConnectionService {
    if (!BackendConnectionService.instance) {
      BackendConnectionService.instance = new BackendConnectionService();
    }
    return BackendConnectionService.instance;
  }
  
  /**
   * Check backend connectivity and provide detailed error information
   */
  async checkBackendConnection(baseUrl: string): Promise<BackendStatus> {
    const startTime = Date.now();
    
    try {
      // Try to reach the backend health endpoint
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000); // 5 second timeout
      
      await fetch(`${baseUrl}/`, {
        method: 'HEAD',
        signal: controller.signal,
        headers: {
          'Accept': 'application/json'
        }
      });
      
      clearTimeout(timeout);
      
      // Any HTTP response means the server is reachable
      this.retryCount = 0;
      const status: BackendStatus = {
        isReachable: true,
        lastCheckTime: new Date()
      };
      this.lastStatus = status;
      this.updateStatusBar('connected');
      return status;
      
    } catch (error: any) {
      const elapsedTime = Date.now() - startTime;
      let errorType: BackendStatus['error'] = 'UNKNOWN';
      let message = say('Unknown error occurred', 'Unbekannter Fehler.');
      
      if (error.name === 'AbortError' || elapsedTime >= 5000) {
        // Timeout - likely backend not running or very slow network
        errorType = 'TIMEOUT';
        message = say('Connection timeout - backend may not be running or network is very slow',
          'Zeitüberschreitung: Der Server läuft vielleicht nicht, oder das Netzwerk ist sehr langsam.');
      } else if (error.code === 'ECONNREFUSED') {
        // Connection refused - backend not running
        errorType = 'NOT_RUNNING';
        message = say('Cannot connect to Computor.', 'Keine Verbindung zu Computor.');
      } else if (error.code === 'ENOTFOUND' || error.code === 'ENETUNREACH') {
        // Network unreachable - possible VPN issue
        errorType = 'VPN_REQUIRED';
        message = say('Cannot reach backend. Check your network connection or VPN settings.',
          'Der Server ist nicht erreichbar. Prüfe deine Netzwerkverbindung oder die VPN-Einstellungen.');
      } else if (error.code === 'ETIMEDOUT' || error.code === 'ESOCKETTIMEDOUT') {
        // Network timeout - slow or blocked connection
        errorType = 'NETWORK_ERROR';
        message = say('Network timeout. Check your internet connection or firewall settings.',
          'Zeitüberschreitung im Netzwerk. Prüfe deine Internetverbindung oder die Firewall-Einstellungen.');
      } else if (error.message?.includes('fetch')) {
        // General network error
        errorType = 'NETWORK_ERROR';
        message = sayFailed('Network error', 'Netzwerkfehler', error.message);
      }
      
      this.retryCount++;
      
      const status: BackendStatus = {
        isReachable: false,
        error: errorType,
        message,
        lastCheckTime: new Date()
      };
      
      this.lastStatus = status;
      this.updateStatusBar('disconnected', this.errorHintFor(errorType));
      return status;
    }
  }
  
  /**
   * Set the current base URL
   */
  setBaseUrl(baseUrl: string): void {
    this.currentBaseUrl = baseUrl;
    this.retryCount = 0;
  }
  
  /**
   * Get the current base URL
   */
  getBaseUrl(): string {
    return this.currentBaseUrl;
  }
  
  /**
   * Start periodic backend health checks
   */
  startHealthCheck(baseUrl: string, intervalMs: number = 180000): void {
    this.stopHealthCheck();
    this.currentBaseUrl = baseUrl;
    
    // Initial check
    this.checkBackendConnection(baseUrl);
    
    // Set up periodic checks
    this.checkInterval = setInterval(async () => {
      await this.checkBackendConnection(this.currentBaseUrl);
    }, intervalMs);
  }
  
  /**
   * Stop periodic health checks
   */
  stopHealthCheck(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }
  
  /**
   * Update status bar based on connection status
   */
  private updateStatusBar(status: 'connected' | 'disconnected' | 'error', errorHint?: string): void {
    switch (status) {
      case 'connected':
        this.statusBarItem.text = `$(check) ${say('Backend Connected', 'Server verbunden')}`;
        this.statusBarItem.backgroundColor = undefined;
        this.statusBarItem.tooltip = say('Backend is connected and responding', 'Der Computor-Server ist verbunden und antwortet');
        break;
      case 'disconnected':
        this.statusBarItem.text = `$(x) ${say('Backend Disconnected', 'Server nicht erreichbar')}`;
        this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
        this.statusBarItem.tooltip = errorHint
          ? `${say('Backend is not reachable', 'Der Server ist nicht erreichbar')}: ${errorHint}`
          : say('Backend is not reachable', 'Der Server ist nicht erreichbar');
        break;
      case 'error':
        this.statusBarItem.text = `$(warning) ${say('Backend Error', 'Serverfehler')}`;
        this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
        this.statusBarItem.tooltip = say('Backend returned an error response', 'Der Server hat mit einem Fehler geantwortet');
        break;
    }
    
    this.statusBarItem.show();
  }
  
  private errorHintFor(errorType: BackendStatus['error']): string {
    switch (errorType) {
      case 'NOT_RUNNING': return say('server not running', 'Server läuft nicht');
      case 'TIMEOUT': return say('connection timed out', 'Zeitüberschreitung');
      case 'VPN_REQUIRED': return say('network unreachable', 'Netzwerk nicht erreichbar');
      case 'NETWORK_ERROR': return say('network error', 'Netzwerkfehler');
      default: return say('unknown error', 'unbekannter Fehler');
    }
  }

  /**
   * Get the last known backend status
   */
  getLastStatus(): BackendStatus | null {
    return this.lastStatus;
  }
  
  /**
   * Show detailed error message based on backend status
   */
  async showConnectionError(status: BackendStatus): Promise<void> {
    let message = status.message || say('Backend connection failed', 'Die Verbindung zum Server ist fehlgeschlagen.');
    let detail = '';
    const retry = say('Retry', 'Erneut versuchen');
    const checkSettings = say('Check Settings', 'Einstellungen prüfen');
    const actions: string[] = [retry];
    
    switch (status.error) {
      case 'NOT_RUNNING':
        detail = say('Unable to reach the backend server.\n\n' +
                'Possible causes:\n' +
                '• Backend is temporarily unavailable\n' +
                '• Network or VPN connection issues\n' +
                '• Incorrect backend URL configuration',
          'Der Server ist nicht erreichbar.\n\n' +
                'Mögliche Ursachen:\n' +
                '• Der Server ist vorübergehend nicht verfügbar\n' +
                '• Probleme mit dem Netzwerk oder dem VPN\n' +
                '• Eine falsch eingestellte Server-URL');
        actions.push(checkSettings);
        break;
        
      case 'VPN_REQUIRED':
        detail = say('Cannot reach the backend server.\n\n' +
                'Possible causes:\n' +
                '• VPN connection required but not connected\n' +
                '• Network firewall blocking the connection\n' +
                '• Incorrect backend URL configuration',
          'Der Server ist nicht erreichbar.\n\n' +
                'Mögliche Ursachen:\n' +
                '• Ein VPN ist nötig, aber nicht verbunden\n' +
                '• Eine Firewall blockiert die Verbindung\n' +
                '• Eine falsch eingestellte Server-URL');
        actions.push(checkSettings);
        break;
        
      case 'TIMEOUT':
        detail = say('Connection to backend timed out.\n\n' +
                'This usually means:\n' +
                '• Backend is starting up (please wait)\n' +
                '• Backend is not running\n' +
                '• Network is very slow or unstable',
          'Die Verbindung zum Server hat zu lange gedauert.\n\n' +
                'Meist bedeutet das:\n' +
                '• Der Server startet gerade (bitte warte kurz)\n' +
                '• Der Server läuft nicht\n' +
                '• Das Netzwerk ist sehr langsam oder instabil');
        break;
        
      case 'NETWORK_ERROR':
        detail = say('Network error while connecting to backend.\n\n' +
                'Please check:\n' +
                '• Your internet connection\n' +
                '• Firewall or proxy settings\n' +
                '• Backend URL configuration',
          'Netzwerkfehler beim Verbinden mit dem Server.\n\n' +
                'Prüfe bitte:\n' +
                '• deine Internetverbindung\n' +
                '• die Firewall- oder Proxy-Einstellungen\n' +
                '• die eingestellte Server-URL');
        actions.push(checkSettings);
        break;
    }
    
    if (this.retryCount >= this.maxRetries) {
      detail += say('\n\nMaximum retry attempts reached. Please resolve the issue and try again.',
        '\n\nDie Höchstzahl an Versuchen ist erreicht. Behebe bitte das Problem und versuche es dann noch einmal.');
    }
    
    const selection = await notify.modal('error', message, { detail, actions });
    
    if (selection === retry) {
      await this.checkBackendConnection(this.currentBaseUrl);
    } else if (selection === 'Open Terminal') {
      vscode.commands.executeCommand('workbench.action.terminal.new');
    } else if (selection === checkSettings) {
      vscode.commands.executeCommand('workbench.action.openSettings', 'computor.backend');
    }
  }
  
  /**
   * Dispose of resources
   */
  dispose(): void {
    this.stopHealthCheck();
    this.statusBarItem.dispose();
  }
}
