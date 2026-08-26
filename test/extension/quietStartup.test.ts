import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

import { COMPUTOR_MARKER, MARKER_ACTIVATION_EVENT, findComputorMarker } from '../../src/activation';

/**
 * Opening a window that has nothing to do with Computor must not start
 * Computor (computor-org/issues#258).
 *
 * The login half of that was always gated on the `.computor` marker. The
 * activation half was not: `onStartupFinished` loaded the extension in every
 * VS Code window on the machine, which meant icon generation, a UI-state
 * migration, three file watchers and a status bar item in windows that had
 * never heard of a course.
 *
 * These are contract tests, not behaviour tests. The behaviour lives in
 * VS Code's activation machinery, which a unit test cannot drive — so what is
 * checked here is the declaration that machinery reads, and the one piece of
 * logic underneath it that is ours.
 */
describe('quiet startup', () => {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8')
  ) as {
    engines: { vscode: string };
    activationEvents: string[];
    contributes: { commands: Array<{ command: string }> };
  };

  describe('activation events', () => {
    it('wakes on the Computor workspace marker and nothing else', () => {
      assert.deepStrictEqual(manifest.activationEvents, [MARKER_ACTIVATION_EVENT]);
    });

    it('does not activate on plain startup', () => {
      // The regression this whole issue is about. `*` is the same mistake
      // wearing a bigger hat.
      assert.ok(!manifest.activationEvents.includes('onStartupFinished'));
      assert.ok(!manifest.activationEvents.includes('*'));
    });

    it('derives the event from the marker the code looks for', () => {
      // Renaming one without the other leaves the extension permanently
      // asleep, and nothing at runtime would report it.
      assert.strictEqual(MARKER_ACTIVATION_EVENT, `workspaceContains:${COMPUTOR_MARKER}`);
    });
  });

  describe('entry points that must still reach a plain folder', () => {
    // With the startup event gone, these are only reachable because VS Code
    // generates activation for contributed commands. That generation landed in
    // 1.74, which is why the engine floor may not drop below it.
    const ENTRY_POINTS = [
      'computor.login',
      'computor.loginWithApiToken',
      'computor.loginOffline',
      'computor.settingsView',
      'computor.changeRealmUrl'
    ];

    const contributed = new Set(manifest.contributes.commands.map(command => command.command));

    for (const command of ENTRY_POINTS) {
      it(`contributes ${command}`, () => {
        assert.ok(contributed.has(command), `${command} is not in contributes.commands`);
      });
    }

    it('keeps the engine at or above the implicit-activation floor', () => {
      const [major, minor] = manifest.engines.vscode.replace(/^[^0-9]*/, '').split('.').map(Number);
      assert.ok(major !== undefined && minor !== undefined);
      assert.ok(major! > 1 || (major === 1 && minor! >= 74), `engine ${manifest.engines.vscode} predates implicit activation`);
    });
  });

  describe('findComputorMarker', () => {
    const exists = (present: string[]) => (file: string) => present.includes(file);

    it('finds nothing when no folder carries a marker', () => {
      assert.strictEqual(findComputorMarker(['/home/x/notes'], exists([])), undefined);
    });

    it('finds nothing when no folder is open at all', () => {
      assert.strictEqual(findComputorMarker([], exists(['/anything/.computor'])), undefined);
    });

    it('finds the marker in the only folder', () => {
      const marker = path.join('/home/x/workspace', COMPUTOR_MARKER);
      assert.strictEqual(findComputorMarker(['/home/x/workspace'], exists([marker])), marker);
    });

    it('finds a marker that is not in the first folder', () => {
      // `workspaceContains` fires on any folder of a multi-root workspace, so
      // looking only at folder #1 would wake the extension and then find
      // nothing to sign in to.
      const marker = path.join('/home/x/course', COMPUTOR_MARKER);
      assert.strictEqual(
        findComputorMarker(['/home/x/notes', '/home/x/course'], exists([marker])),
        marker
      );
    });

    it('prefers the first folder that has one', () => {
      const first = path.join('/home/x/a', COMPUTOR_MARKER);
      const second = path.join('/home/x/b', COMPUTOR_MARKER);
      assert.strictEqual(
        findComputorMarker(['/home/x/a', '/home/x/b'], exists([first, second])),
        first
      );
    });
  });
});
