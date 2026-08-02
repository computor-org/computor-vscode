import { expect } from 'chai';
import { isRestoringSelection, restoreSelection, trackTree, treeItemId } from '../../src/ui/treeRestore';

/**
 * Reopening a workspace lost the selected node (computor-org/issues#285).
 * `reveal` is the only way to select from code and it silently does nothing
 * without `getParent`, which seven of the nine providers did not implement —
 * so the tracking wrapper supplies one.
 */
describe('treeRestore', () => {
  interface Node {
    id: string;
    children?: Node[];
  }

  function makeProvider(root: Node[]) {
    const calls: Array<string | undefined> = [];
    return {
      calls,
      provider: {
        onDidChangeTreeData: undefined,
        getTreeItem: (n: Node) => n as any,
        getChildren: async (n?: Node) => {
          calls.push(n?.id);
          return n ? (n.children ?? []) : root;
        }
      } as any
    };
  }

  const tree: Node[] = [
    { id: 'course-1', children: [{ id: 'unit-a', children: [{ id: 'assignment-1' }] }] },
    { id: 'course-2' }
  ];

  describe('trackTree', () => {
    it('answers getParent for a provider that has none', async () => {
      const tracked = trackTree(makeProvider(tree).provider);
      const roots = await tracked.provider.getChildren!();
      const units = await tracked.provider.getChildren!(roots![0]);

      expect(await tracked.provider.getParent!(units![0])).to.equal(roots![0]);
      // A root element's parent is undefined, not an error.
      expect(await tracked.provider.getParent!(roots![0])).to.be.undefined;
    });

    it('lets a provider that has getParent keep answering', async () => {
      const own = { id: 'the-real-parent' };
      const inner = makeProvider(tree).provider;
      inner.getParent = () => own;
      const tracked = trackTree(inner);
      const roots = await tracked.provider.getChildren!();
      await tracked.provider.getChildren!(roots![0]);

      expect(await tracked.provider.getParent!(roots![0])).to.equal(own);
    });

    it('indexes rendered items by id', async () => {
      const tracked = trackTree(makeProvider(tree).provider);
      expect(tracked.find('course-1')).to.be.undefined;

      const roots = await tracked.provider.getChildren!();
      expect(tracked.find('course-1')).to.equal(roots![0]);
      // Not rendered yet — it is two levels down.
      expect(tracked.find('assignment-1')).to.be.undefined;

      const units = await tracked.provider.getChildren!(roots![0]);
      await tracked.provider.getChildren!(units![0]);
      expect(treeItemId(tracked.find('assignment-1'))).to.equal('assignment-1');
    });

    it('passes getChildren straight through', async () => {
      const harness = makeProvider(tree);
      const tracked = trackTree(harness.provider);
      const roots = await tracked.provider.getChildren!();

      expect((roots as Node[]).map(n => n.id)).to.deep.equal(['course-1', 'course-2']);
      expect(harness.calls).to.deep.equal([undefined]);
    });
  });

  describe('restoreSelection', () => {
    function makeView() {
      const revealed: any[] = [];
      return {
        revealed,
        view: {
          reveal: async (element: any, options: any) => {
            revealed.push({ element, options });
          }
        } as any
      };
    }

    it('selects the remembered node once it is rendered', async () => {
      const tracked = trackTree(makeProvider(tree).provider);
      const { view, revealed } = makeView();
      const disposables: any[] = [];

      restoreSelection(view, tracked, 'assignment-1', disposables);
      expect(revealed, 'not rendered yet').to.have.length(0);

      const roots = await tracked.provider.getChildren!();
      const units = await tracked.provider.getChildren!(roots![0]);
      await tracked.provider.getChildren!(units![0]);
      await new Promise(resolve => setImmediate(resolve));

      expect(revealed).to.have.length(1);
      expect(treeItemId(revealed[0].element)).to.equal('assignment-1');
    });

    it('selects without taking focus', async () => {
      const tracked = trackTree(makeProvider(tree).provider);
      const { view, revealed } = makeView();

      restoreSelection(view, tracked, 'course-1', []);
      await tracked.provider.getChildren!();
      await new Promise(resolve => setImmediate(resolve));

      expect(revealed[0].options).to.include({ select: true, focus: false });
    });

    it('only fires once', async () => {
      const tracked = trackTree(makeProvider(tree).provider);
      const { view, revealed } = makeView();

      restoreSelection(view, tracked, 'course-1', []);
      await tracked.provider.getChildren!();
      await tracked.provider.getChildren!();
      await tracked.provider.getChildren!();
      await new Promise(resolve => setImmediate(resolve));

      expect(revealed).to.have.length(1);
    });

    it('flags the restore so selection side effects can stand down', async () => {
      // The student tree loads test results on selection and the tutor tree
      // clones a repository; neither may happen just because a window opened.
      const tracked = trackTree(makeProvider(tree).provider);
      const seen: boolean[] = [];
      const view = {
        reveal: async () => { seen.push(isRestoringSelection()); }
      } as any;

      // Not asserting the flag is false first: it is module-global and stays
      // set for a short window after any reveal, which is deliberate — several
      // trees restore at once — and leaks between tests here.
      restoreSelection(view, tracked, 'course-1', []);
      await tracked.provider.getChildren!();
      await new Promise(resolve => setImmediate(resolve));

      expect(seen).to.deep.equal([true]);
    });

    it('gives up quietly when the node never appears', async () => {
      const tracked = trackTree(makeProvider(tree).provider);
      const { view, revealed } = makeView();

      restoreSelection(view, tracked, 'deleted-long-ago', []);
      await tracked.provider.getChildren!();
      await new Promise(resolve => setImmediate(resolve));

      expect(revealed).to.have.length(0);
    });
  });
});
