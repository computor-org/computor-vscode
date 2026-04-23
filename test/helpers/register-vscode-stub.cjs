/**
 * Mocha `--require` hook that makes `require('vscode')` resolve to
 * test/helpers/vscode-stub.ts. Load this before the first test file so
 * extension sources that transitively import `vscode` (e.g. GitWrapper
 * via simpleGitFactory) can be unit-tested under plain Node.
 *
 * Written in CommonJS JavaScript (.cjs) so it works regardless of
 * whether Node / Mocha / ts-node try to load it as ESM — `require` is
 * always available in a .cjs file.
 *
 * Intercept at Module.prototype.require rather than _load /
 * _resolveFilename because the latter are installed as non-configurable
 * getters by source-map-support after ts-node initialises.
 */
'use strict';

const path = require('path');
const Module = require('module');

const stubPath = path.join(__dirname, 'vscode-stub.ts');
const originalRequire = Module.prototype.require;

Module.prototype.require = function (request) {
  if (request === 'vscode') {
    return originalRequire.call(this, stubPath);
  }
  return originalRequire.apply(this, arguments);
};
