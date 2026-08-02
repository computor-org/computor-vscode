import * as fs from 'fs/promises';
import * as path from 'path';
import { SettingsStorage } from './SettingsStorage';
import { SettingsValidationError } from '../exceptions/errors/SettingsError';

export class JsonSettingsStorage<T> extends SettingsStorage<T> {
  protected filePath: string;
  private schema: any;
  
  constructor(filePath: string, schema?: any) {
    super();
    this.filePath = filePath;
    this.schema = schema;
  }
  
  async load(): Promise<T> {
    try {
      if (!(await this.exists())) {
        const defaultSettings = this.getDefaultSettings();
        await this.save(defaultSettings);
        return defaultSettings;
      }
      
      const data = await fs.readFile(this.filePath, 'utf8');
      const settings = JSON.parse(data);
      
      if (!this.validate(settings)) {
        throw new SettingsValidationError('Invalid settings format');
      }
      
      return settings;
    } catch (error) {
      console.error('Failed to load settings:', error);
      return this.getDefaultSettings();
    }
  }
  
  /**
   * Write the settings file atomically.
   *
   * This is a whole-file read-modify-write, and the file also holds the backend
   * URL and the rest of the authentication config. A plain writeFile truncates
   * first, so a process going away mid-write — closing the browser tab a
   * code-server workspace runs in is exactly that — could leave a truncated or
   * empty config behind. Writing a sibling and renaming makes the replacement
   * atomic on the same filesystem: readers see the old file or the new one.
   */
  async save(settings: T): Promise<void> {
    if (!this.validate(settings)) {
      throw new SettingsValidationError('Invalid settings format');
    }

    await this.ensureDirectoryExists();
    const temporary = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    try {
      await fs.writeFile(temporary, JSON.stringify(settings, null, 2));
      await fs.rename(temporary, this.filePath);
    } catch (error) {
      await fs.unlink(temporary).catch(() => undefined);
      throw error;
    }
    this.cache.clear();
  }
  
  async get<K extends keyof T>(key: K): Promise<T[K] | undefined> {
    if (this.cache.has(key as string)) {
      return this.cache.get(key as string);
    }
    
    const settings = await this.load();
    const value = settings[key];
    this.cache.set(key as string, value);
    return value;
  }
  
  async set<K extends keyof T>(key: K, value: T[K]): Promise<void> {
    const settings = await this.load();
    (settings as any)[key] = value;
    await this.save(settings);
    this.cache.set(key as string, value);
  }
  
  async delete<K extends keyof T>(key: K): Promise<void> {
    const settings = await this.load();
    delete settings[key];
    await this.save(settings);
    this.cache.delete(key as string);
  }
  
  async exists(): Promise<boolean> {
    try {
      await fs.access(this.filePath);
      return true;
    } catch {
      return false;
    }
  }
  
  async clear(): Promise<void> {
    await this.save(this.getDefaultSettings());
    this.cache.clear();
  }
  
  protected validate(settings: T): boolean {
    if (this.schema) {
      return this.validateAgainstSchema(settings, this.schema);
    }
    return true;
  }
  
  protected getDefaultSettings(): T {
    throw new Error('getDefaultSettings must be implemented by subclass');
  }
  
  protected async migrate(oldVersion: number, newVersion: number): Promise<void> {
    void oldVersion;
    void newVersion;
    throw new Error('migrate must be implemented by subclass');
  }
  
  private async ensureDirectoryExists(): Promise<void> {
    const dir = path.dirname(this.filePath);
    await fs.mkdir(dir, { recursive: true });
  }
  
  private validateAgainstSchema(settings: any, schema: any): boolean {
    // Simple validation for now - can be enhanced with JSON schema validation library
    void settings;
    void schema;
    return true;
  }
}