import * as vscode from 'vscode';
import * as os from 'os';
import * as path from 'path';
import { JsonSettingsStorage } from './JsonSettingsStorage';
import { VscodeSecureStorage } from './VscodeSecureStorage';
import { ComputorSettings, defaultSettings } from '../types/SettingsTypes';

export class ComputorJsonSettingsStorage extends JsonSettingsStorage<ComputorSettings> {
  protected getDefaultSettings(): ComputorSettings {
    return defaultSettings;
  }
  
  protected async migrate(oldVersion: number, newVersion: number): Promise<void> {
    // Implement migration logic here when needed
    // Parameters will be used when migration is implemented
    void oldVersion;
    void newVersion;
  }
}

export class ComputorSettingsManager {
  private settingsStorage: ComputorJsonSettingsStorage;
  private secureStorage: VscodeSecureStorage;
  
  constructor(context: vscode.ExtensionContext) {
    const settingsPath = path.join(os.homedir(), '.computor', 'config.json');
    this.settingsStorage = new ComputorJsonSettingsStorage(settingsPath);
    this.secureStorage = new VscodeSecureStorage(context.secrets);
  }
  
  async getSettings(): Promise<ComputorSettings> {
    return await this.settingsStorage.load();
  }
  
  async saveSettings(settings: ComputorSettings): Promise<void> {
    await this.settingsStorage.save(settings);
  }
  
  async getBaseUrl(): Promise<string> {
    const settings = await this.settingsStorage.load();
    return settings.authentication.baseUrl;
  }
  
  async setBaseUrl(url: string): Promise<void> {
    const settings = await this.settingsStorage.load();
    settings.authentication.baseUrl = url;
    await this.settingsStorage.save(settings);
  }
  
  async storeSecureToken(key: string, token: string): Promise<void> {
    await this.secureStorage.store(key, token);
  }
  
  async retrieveSecureToken(key: string): Promise<string | undefined> {
    return await this.secureStorage.retrieve(key);
  }
  
  async deleteSecureToken(key: string): Promise<void> {
    await this.secureStorage.delete(key);
  }
  
  async getWorkspaceDirectory(): Promise<string | undefined> {
    const settings = await this.settingsStorage.load();
    return settings.workspace?.repositoryDirectory;
  }
  
  async setWorkspaceDirectory(directory: string): Promise<void> {
    const settings = await this.settingsStorage.load();
    if (!settings.workspace) {
      settings.workspace = { repositoryDirectory: directory, gitlabTokens: {} };
    } else {
      settings.workspace.repositoryDirectory = directory;
    }
    await this.settingsStorage.save(settings);
  }
  
  async getGitLabToken(instanceUrl: string): Promise<string | undefined> {
    const settings = await this.settingsStorage.load();
    return settings.workspace?.gitlabTokens?.[instanceUrl];
  }
  
  async setGitLabToken(instanceUrl: string, token: string): Promise<void> {
    const settings = await this.settingsStorage.load();
    if (!settings.workspace) {
      settings.workspace = { repositoryDirectory: undefined, gitlabTokens: {} };
    }
    if (!settings.workspace.gitlabTokens) {
      settings.workspace.gitlabTokens = {};
    }
    settings.workspace.gitlabTokens[instanceUrl] = token;
    await this.settingsStorage.save(settings);
  }

  async getTreeExpandedStates(): Promise<Record<string, boolean>> {
    const settings = await this.settingsStorage.load();
    return settings.ui?.lecturerTree?.expandedStates || {};
  }

  async setTreeExpandedStates(states: Record<string, boolean>): Promise<void> {
    const settings = await this.settingsStorage.load();
    if (!settings.ui) {
      settings.ui = { lecturerTree: { expandedStates: {} } };
    }
    if (!settings.ui.lecturerTree) {
      settings.ui.lecturerTree = { expandedStates: {} };
    }
    settings.ui.lecturerTree.expandedStates = states;
    await this.settingsStorage.save(settings);
  }

  async setNodeExpandedState(nodeId: string, expanded: boolean): Promise<void> {
    const settings = await this.settingsStorage.load();
    if (!settings.ui) {
      settings.ui = { lecturerTree: { expandedStates: {} } };
    }
    if (!settings.ui.lecturerTree) {
      settings.ui.lecturerTree = { expandedStates: {} };
    }
    if (expanded) {
      settings.ui.lecturerTree.expandedStates[nodeId] = true;
    } else {
      delete settings.ui.lecturerTree.expandedStates[nodeId];
    }
    await this.settingsStorage.save(settings);
  }

  // Student tree expanded states
  async getStudentTreeExpandedStates(): Promise<Record<string, boolean>> {
    const settings = await this.settingsStorage.load();
    return settings.ui?.studentTree?.expandedStates || {};
  }

  async setStudentNodeExpandedState(nodeId: string, expanded: boolean): Promise<void> {
    const settings = await this.settingsStorage.load();
    if (!settings.ui) {
      settings.ui = { 
        lecturerTree: { expandedStates: {} },
        studentTree: { expandedStates: {} } 
      };
    }
    if (!settings.ui.studentTree) {
      settings.ui.studentTree = { expandedStates: {} };
    }
    if (!settings.ui.studentTree.expandedStates) {
      settings.ui.studentTree.expandedStates = {};
    }
    if (expanded) {
      settings.ui.studentTree.expandedStates[nodeId] = true;
    } else {
      delete settings.ui.studentTree.expandedStates[nodeId];
    }
    await this.settingsStorage.save(settings);
  }
  
  async clearSettings(): Promise<void> {
    await this.settingsStorage.clear();
  }
  
  async settingsExist(): Promise<boolean> {
    return await this.settingsStorage.exists();
  }
}