export interface ComputorSettings {
  version: string;
  authentication: AuthenticationSettings;
  workspace: WorkspaceSettings;
  ui: UISettings;
}

export interface AuthenticationSettings {
  baseUrl: string;
  autoLogin?: boolean;
}

export interface WorkspaceSettings {
  repositoryDirectory?: string;
  gitlabUrls: string[]; // List of GitLab instance URLs that have tokens stored securely
}

export interface UISettings {
  lecturerTree: {
    expandedStates: Record<string, boolean>; // Maps tree node ID to expanded state
  };
  studentTree?: {
    expandedStates: Record<string, boolean>; // Maps tree node ID to expanded state
  };
}

export const defaultSettings: ComputorSettings = {
  version: '1.0.0',
  authentication: {
    baseUrl: 'http://localhost:8000',
    autoLogin: true
  },
  workspace: {
    repositoryDirectory: undefined,
    gitlabUrls: []
  },
  ui: {
    lecturerTree: {
      expandedStates: {}
    }
  }
};