/**
 * Mocha `--require` hook that makes `require('vscode')` resolve to
 * test/helpers/vscode-stub.ts. Load this before the first test file so
 * extension sources that transitively import `vscode` (e.g. GitWrapper
 * via simpleGitFactory) can be unit-tested under plain Node.
 *
 * Wraps `Module._load` instead of `_resolveFilename` because some
 * toolchains (e.g. ts-node's @cspotcode/source-map-support) define
 * `_resolveFilename` as a getter-only property.
 */
import * as path from 'path';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ModuleImpl: any = require('module');

const stubPath = path.join(__dirname, 'vscode-stub.ts');
const originalRequire = ModuleImpl.prototype.require;

// Intercept at Module.prototype.require rather than _load / _resolveFilename
// because the latter are installed as non-configurable getters by
// source-map-support after ts-node initialises.
ModuleImpl.prototype.require = function (request: string) {
  if (request === 'vscode') {
    return originalRequire.call(this, stubPath);
  }
  // eslint-disable-next-line prefer-rest-params
  return originalRequire.apply(this, arguments as any);
};
