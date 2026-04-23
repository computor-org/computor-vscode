/**
 * Returns an `execGitClone` wired to a stubbed `execAsyncWithTimeout` for
 * verifying argument / option passthrough. Written in .cjs so the
 * CommonJS module cache + mutation tricks work regardless of whether
 * Mocha loads the test file as CJS or ESM.
 */
'use strict';

const path = require('path');

function loadGitCloneHelperWithStub() {
  const execPath = require.resolve(path.resolve(__dirname, '../../src/utils/exec.ts'));
  delete require.cache[execPath];
  const actual = require(path.resolve(__dirname, '../../src/utils/exec.ts'));

  const calls = [];
  let pending = { stdout: '', stderr: '' };

  actual.execAsyncWithTimeout = async (command, options) => {
    calls.push({ command, options });
    if (pending instanceof Error) throw pending;
    return pending;
  };

  const helperPath = path.resolve(__dirname, '../../src/git/gitCloneHelpers.ts');
  delete require.cache[require.resolve(helperPath)];
  const helper = require(helperPath);

  return {
    execGitClone: helper.execGitClone,
    calls,
    setResolved(value) { pending = value; }
  };
}

module.exports = { loadGitCloneHelperWithStub };
