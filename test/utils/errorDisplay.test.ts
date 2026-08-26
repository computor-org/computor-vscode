import { expect } from 'chai';
import * as vscode from 'vscode';

import { errorCatalog } from '../../src/exceptions/ErrorCatalog';
import { HttpError } from '../../src/exceptions/errors/HttpError';
import { showErrorWithSeverity } from '../../src/utils/errorDisplay';

/**
 * The catalog's per-code text describes the *code*, not the failure. Whenever a
 * backend call site carries a coarse or plainly mistaken code, showing that text
 * instead of the server's own reason is worse than useless.
 *
 * That is computor-org/issues#121: a misconfigured execution backend was raised
 * as CONTENT_001, and the extension rendered it to a student as "Course Content
 * Not Found: The requested course content was not found." The real detail was
 * on the wire the whole time. `HttpError` has preferred it since 2026-06-29;
 * these tests pin that the display layer stops overriding it back.
 */
describe('showErrorWithSeverity', () => {
  const CODE = 'TEST_001';
  let shown: Array<{ level: string; message: string }>;
  let originalCatalog: any;
  let originalInitialized: any;
  let originalInfo: any;
  let originalWarning: any;
  let originalError: any;

  const seedCatalog = (severity: string) => {
    (errorCatalog as any).catalog = {
      version: 'test',
      generated_at: 'test',
      error_count: 1,
      errors: {
        [CODE]: {
          code: CODE,
          http_status: 400,
          category: 'validation',
          severity,
          title: 'Generic Title',
          message: {
            plain: 'Generic catalog text.',
            markdown: '**Generic Title**\n\nGeneric catalog text.',
            html: '<strong>Generic Title</strong>',
          },
        },
      },
    };
    (errorCatalog as any).initialized = true;
  };

  beforeEach(() => {
    shown = [];
    originalCatalog = (errorCatalog as any).catalog;
    originalInitialized = (errorCatalog as any).initialized;
    originalInfo = (vscode.window as any).showInformationMessage;
    originalWarning = (vscode.window as any).showWarningMessage;
    originalError = (vscode.window as any).showErrorMessage;
    (vscode.window as any).showInformationMessage = async (message: string) => {
      shown.push({ level: 'info', message });
      return undefined;
    };
    (vscode.window as any).showWarningMessage = async (message: string) => {
      shown.push({ level: 'warning', message });
      return undefined;
    };
    (vscode.window as any).showErrorMessage = async (message: string) => {
      shown.push({ level: 'error', message });
      return undefined;
    };
  });

  afterEach(() => {
    (errorCatalog as any).catalog = originalCatalog;
    (errorCatalog as any).initialized = originalInitialized;
    (vscode.window as any).showInformationMessage = originalInfo;
    (vscode.window as any).showWarningMessage = originalWarning;
    (vscode.window as any).showErrorMessage = originalError;
  });

  it("shows the server's own reason, not the catalog's per-code text", () => {
    seedCatalog('warning');
    const error = new HttpError('Bad Request', 400, 'Bad Request', {
      error_code: CODE,
      detail: "Assignment has no testing service: no enabled service matches the example's executionBackend slug",
    });

    showErrorWithSeverity(error);

    expect(shown).to.have.lengthOf(1);
    expect(shown[0]!.message).to.equal(
      "Generic Title: Assignment has no testing service: no enabled service matches the example's executionBackend slug"
    );
  });

  it('falls back to the catalog text when the server sent no detail', () => {
    seedCatalog('warning');
    const error = new HttpError('Bad Request', 400, 'Bad Request', { error_code: CODE });

    showErrorWithSeverity(error);

    expect(shown).to.have.lengthOf(1);
    expect(shown[0]!.message).to.equal('Generic Title: Generic catalog text.');
  });

  it('keeps taking the notification level from the catalog severity', () => {
    seedCatalog('info');
    const error = new HttpError('Bad Request', 400, 'Bad Request', {
      error_code: CODE,
      detail: 'Something specific.',
    });

    showErrorWithSeverity(error);

    expect(shown[0]!.level).to.equal('info');
  });

  it('falls back to the raw message for an error with no catalog entry', () => {
    seedCatalog('warning');
    const error = new Error('Something went wrong');

    showErrorWithSeverity(error);

    expect(shown).to.deep.equal([{ level: 'error', message: 'Something went wrong' }]);
  });
});
