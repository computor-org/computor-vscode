import { runTests } from '@vscode/test-electron';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const workspace = await mkdtemp(join(tmpdir(), 'computor-public-host-'));
await writeFile(join(workspace, '.computor-public.json'), '{"format":1}\n');
await writeFile(join(workspace, 'synthetic.py'), 'print(2 + 2)\n');
try {
  await runTests({ version: process.env.VSCODE_TEST_VERSION || 'stable',
    extensionDevelopmentPath: resolve('.'),
    extensionTestsPath: resolve('test/extension-host/public-learning.cjs'),
    launchArgs: [workspace, '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes'],
  });
} finally {
  await rm(workspace, { recursive: true, force: true });
}
