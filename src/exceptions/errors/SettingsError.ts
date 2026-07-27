export class SettingsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SettingsError';
  }
}

export class SettingsValidationError extends SettingsError {
  constructor(message: string) {
    super(message);
    this.name = 'SettingsValidationError';
  }
}

export class SettingsNotFoundError extends SettingsError {
  constructor(message: string) {
    super(message);
    this.name = 'SettingsNotFoundError';
  }
}