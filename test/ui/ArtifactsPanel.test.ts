import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { webviewPanels } from '../helpers/vscode-stub';
import { ArtifactsPanel } from '../../src/ui/panels/ArtifactsPanel';

/**
 * Artifacts from test results get the Figures presentation — fit to view,
 * Close and Close All — instead of the zooming image preview
 * (computor-org/issues#315). Closing must only drop the entry from the
 * panel: the file on disk is the artifact download cache, and deleting it
 * would force a re-download on the next click.
 */
describe('ArtifactsPanel', () => {
  const extensionUri: any = { fsPath: '/ext', path: '/ext', scheme: 'file' };
  let dir: string;
  let panel: ArtifactsPanel;

  const pngPath = (name: string): string => {
    const file = path.join(dir, name);
    fs.writeFileSync(file, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    return file;
  };

  const lastPanel = () => webviewPanels[webviewPanels.length - 1]!;

  const lastUpdate = () => {
    const posts = lastPanel().posted
      .filter((message: any) => message.command === 'figuresUpdate');
    return posts[posts.length - 1]!.data;
  };

  beforeEach(() => {
    webviewPanels.length = 0;
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artifacts-'));
    panel = new ArtifactsPanel(extensionUri);
  });

  afterEach(() => {
    panel.dispose();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('shows an added artifact and accumulates a strip', async () => {
    await panel.add(pngPath('student_test_0_figure_1.png'));
    await panel.add(pngPath('reference_test_0_figure_1.png'));

    const update = lastUpdate();
    expect(update.figures).to.have.length(2);
    // The one just added carries its image; the one already on screen is
    // deliberately null ("unchanged"), so nothing is resent needlessly.
    expect(update.figures[1].image).to.match(/^data:image\/png;base64,/);
    expect(update.figures[0].image).to.equal(null);
    expect(update.selected).to.equal(update.figures[1].number);
  });

  it('adding the same file twice selects it instead of duplicating it', async () => {
    const file = pngPath('a.png');
    await panel.add(file);
    await panel.add(pngPath('b.png'));
    await panel.add(file);

    const update = lastUpdate();
    expect(update.figures).to.have.length(2);
    expect(update.selected).to.equal(update.figures[0].number);
  });

  it('close drops the entry but keeps the file on disk', async () => {
    const file = pngPath('a.png');
    await panel.add(file);
    const id = lastUpdate().figures[0].number;

    lastPanel().fireMessage({ command: 'close', data: { number: id } });
    await new Promise((resolve) => setImmediate(resolve));

    expect(lastUpdate().figures).to.have.length(0);
    expect(fs.existsSync(file)).to.equal(true);
  });

  it('close all empties the panel but keeps every file', async () => {
    const first = pngPath('a.png');
    const second = pngPath('b.png');
    await panel.add(first);
    await panel.add(second);

    lastPanel().fireMessage({ command: 'closeAll' });
    await new Promise((resolve) => setImmediate(resolve));

    expect(lastUpdate().figures).to.have.length(0);
    expect(fs.existsSync(first)).to.equal(true);
    expect(fs.existsSync(second)).to.equal(true);
  });
});
