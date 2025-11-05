import * as vscode from 'vscode';
import fetch from 'node-fetch';

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
      
      const response = await fetch(`${baseUrl}/`, {
        method: 'HEAD',
        signal: controller.signal,
        headers: {
          'Accept': 'application/json'
        }
      });
      
      clearTimeout(timeout);
      
      if (response.ok) {
        this.retryCount = 0;
        const status: BackendStatus = {
          isReachable: true,
          lastCheckTime: new Date()
        };
        this.lastStatus = status;
        this.updateStatusBar('connected');
        return status;
      }
      
      // Backend is reachable but returned an error
      const status: BackendStatus = {
        isReachable: false,
        error: 'UNKNOWN',
        message: `Backend returned ${response.status}: ${response.statusText}`,
        lastCheckTime: new Date()
      };
      this.lastStatus = status;
      this.updateStatusBar('error');
      return status;
      
    } catch (error: any) {
      const elapsedTime = Date.now() - startTime;
      let errorType: BackendStatus['error'] = 'UNKNOWN';
      let message = 'Unknown error occurred';
      
      if (error.name === 'AbortError' || elapsedTime >= 5000) {
        // Timeout - likely backend not running or very slow network
        errorType = 'TIMEOUT';
        message = 'Connection timeout - backend may not be running or network is very slow';
      } else if (error.code === 'ECONNREFUSED') {
        // Connection refused - backend not running
        errorType = 'NOT_RUNNING';
        message = 'Backend is not running. Please start the backend server.';
      } else if (error.code === 'ENOTFOUND' || error.code === 'ENETUNREACH') {
        // Network unreachable - possible VPN issue
        errorType = 'VPN_REQUIRED';
        message = 'Cannot reach backend. Check your network connection or VPN settings.';
      } else if (error.code === 'ETIMEDOUT' || error.code === 'ESOCKETTIMEDOUT') {
        // Network timeout - slow or blocked connection
        errorType = 'NETWORK_ERROR';
        message = 'Network timeout. Check your internet connection or firewall settings.';
      } else if (error.message?.includes('fetch')) {
        // General network error
        errorType = 'NETWORK_ERROR';
        message = `Network error: ${error.message}`;
      }
      
      this.retryCount++;
      
      const status: BackendStatus = {
        isReachable: false,
        error: errorType,
        message,
        lastCheckTime: new Date()
      };
      
      this.lastStatus = status;
      this.updateStatusBar('disconnected');
      return status;
    }
  }
  
  /**
   * Set the current base URL
   */
  setBaseUrl(baseUrl: string): void {
    this.currentBaseUrl = baseUrl;
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
  private updateStatusBar(status: 'connected' | 'disconnected' | 'error'): void {
    switch (status) {
      case 'connected':
        this.statusBarItem.text = '$(check) Backend Connected';
        this.statusBarItem.backgroundColor = undefined;
        this.statusBarItem.tooltip = 'Backend is connected and responding';
        break;
      case 'disconnected':
        this.statusBarItem.text = '$(x) Backend Disconnected';
        this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
        this.statusBarItem.tooltip = `Backend is not reachable. Retry count: ${this.retryCount}/${this.maxRetries}`;
        break;
      case 'error':
        this.statusBarItem.text = '$(warning) Backend Error';
        this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
        this.statusBarItem.tooltip = 'Backend returned an error response';
        break;
    }
    
    this.statusBarItem.show();
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
    let message = status.message || 'Backend connection failed';
    let detail = '';
    const actions: string[] = ['Retry'];
    
    switch (status.error) {
      case 'NOT_RUNNING':
        detail = 'Unable to reach the backend server.\n\n' +
                'Possible causes:\n' +
                '• Backend is temporarily unavailable\n' +
                '• Network or VPN connection issues\n' +
                '• Incorrect backend URL configuration';
        actions.push('Check Settings');
        break;
        
      case 'VPN_REQUIRED':
        detail = 'Cannot reach the backend server.\n\n' +
                'Possible causes:\n' +
                '• VPN connection required but not connected\n' +
                '• Network firewall blocking the connection\n' +
                '• Incorrect backend URL configuration';
        actions.push('Check Settings');
        break;
        
      case 'TIMEOUT':
        detail = 'Connection to backend timed out.\n\n' +
                'This usually means:\n' +
                '• Backend is starting up (please wait)\n' +
                '• Backend is not running\n' +
                '• Network is very slow or unstable';
        break;
        
      case 'NETWORK_ERROR':
        detail = 'Network error while connecting to backend.\n\n' +
                'Please check:\n' +
                '• Your internet connection\n' +
                '• Firewall or proxy settings\n' +
                '• Backend URL configuration';
        actions.push('Check Settings');
        break;
    }
    
    if (this.retryCount >= this.maxRetries) {
      detail += '\n\nMaximum retry attempts reached. Please resolve the issue and try again.';
    }
    
    const selection = await vscode.window.showErrorMessage(
      message,
      { modal: true, detail },
      ...actions
    );
    
    if (selection === 'Retry') {
      // Trigger a retry
      const settings = vscode.workspace.getConfiguration('computor');
      const baseUrl = settings.get<string>('backend.url') || 'http://localhost:8000';
      await this.checkBackendConnection(baseUrl);
    } else if (selection === 'Open Terminal') {
      vscode.commands.executeCommand('workbench.action.terminal.new');
    } else if (selection === 'Check Settings') {
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
