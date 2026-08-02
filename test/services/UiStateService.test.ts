import { expect } from 'chai';
import { UiStateService } from '../../src/services/UiStateService';

/**
 * Reopening a workspace dropped the user somewhere else entirely — a different
 * activity-bar container, every tree collapsed, nothing selected
 * (computor-org/issues#285). This is the store that remembers it.
 */
describe('UiStateService', () => {
  /** Stands in for ExtensionContext.globalState. */
  function makeContext(initial?: any) {
    const store = new Map<string, any>();
    if (initial) {
      store.set('computor.ui.state', initial);
    }
    const writes: any[] = [];
    return {
      writes,
      store,
      context: {
        globalState: {
          get: (key: string) => store.get(key),
          update: async (key: string, value: any) => {
            writes.push(value);
            if (value === undefined) {
              store.delete(key);
            } else {
              store.set(key, value);
            }
          }
        }
      } as any
    };
  }

  function makeService(initial?: any) {
    const harness = makeContext(initial);
    // The singleton is module state; reset it between tests.
    (UiStateService as any).instance = undefined;
    return { ...harness, service: UiStateService.initialize(harness.context) };
  }

  it('reads state synchronously, so the first render is not a race', () => {
    // The old store was loaded by a fire-and-forget promise in each provider's
    // constructor, which getChildren could outrun — collapsing the very tree
    // it was meant to restore.
    const { service } = makeService({
      activeContainer: 'computor-tutor',
      expanded: { student: { 'unit-1': true } }
    });

    expect(service.getActiveContainer()).to.equal('computor-tutor');
    expect(service.isExpanded('student', 'unit-1')).to.equal(true);
  });

  it('defaults to collapsed and no container', () => {
    const { service } = makeService();
    expect(service.getActiveContainer()).to.be.undefined;
    expect(service.isExpanded('lecturer', 'anything')).to.equal(false);
  });

  it('keeps trees in separate namespaces', () => {
    const { service } = makeService();
    service.setExpanded('student', 'shared-id', true);
    expect(service.isExpanded('student', 'shared-id')).to.equal(true);
    expect(service.isExpanded('tutorContent', 'shared-id')).to.equal(false);
  });

  it('round-trips expansion and collapse', () => {
    const { service } = makeService();
    service.setExpanded('tutorContent', 'node-a', true);
    expect(service.isExpanded('tutorContent', 'node-a')).to.equal(true);
    service.setExpanded('tutorContent', 'node-a', false);
    expect(service.isExpanded('tutorContent', 'node-a')).to.equal(false);
  });

  it('round-trips selection per view', () => {
    const { service } = makeService();
    service.setSelection('computor.student.courses', 'item-7');
    service.setSelection('computor.tutor.courses', 'item-9');
    expect(service.getSelection('computor.student.courses')).to.equal('item-7');
    expect(service.getSelection('computor.tutor.courses')).to.equal('item-9');
    service.setSelection('computor.student.courses', undefined);
    expect(service.getSelection('computor.student.courses')).to.be.undefined;
  });

  it('persists what it was given', async () => {
    const { service, store } = makeService();
    service.setActiveContainer('computor-lecturer');
    service.setExpanded('lecturer', 'course-1', true);
    await service.flush();

    const saved = store.get('computor.ui.state');
    expect(saved.activeContainer).to.equal('computor-lecturer');
    expect(saved.expanded.lecturer['course-1']).to.equal(true);
  });

  it('persists a snapshot, not a live reference', async () => {
    const { service, store } = makeService();
    service.setExpanded('lecturer', 'course-1', true);
    await service.flush();
    service.setExpanded('lecturer', 'course-2', true);

    // The already-written value must not have grown a second key.
    expect(Object.keys(store.get('computor.ui.state').expanded.lecturer)).to.deep.equal(['course-1']);
  });

  it('does not write when nothing actually changed', async () => {
    const { service, writes } = makeService();
    service.setActiveContainer('computor-tutor');
    await service.flush();
    const after = writes.length;

    service.setActiveContainer('computor-tutor');
    service.setExpanded('lecturer', 'x', false);
    expect(writes.length).to.equal(after);
  });

  it('clear forgets everything', async () => {
    const { service, store } = makeService({ activeContainer: 'computor-tutor' });
    await service.clear();
    expect(service.getActiveContainer()).to.be.undefined;
    expect(store.has('computor.ui.state')).to.equal(false);
  });

  describe('migrateLegacyExpansion', () => {
    const legacy = {
      getTreeExpandedStates: async () => ({ 'lect-1': true, 'lect-2': false }),
      getStudentTreeExpandedStates: async () => ({ 'stud-1': true }),
      getTutorTreeExpandedStates: async () => ({})
    } as any;

    it('carries expansion over from ~/.computor/config.json', async () => {
      const { service } = makeService();
      await service.migrateLegacyExpansion(legacy);

      expect(service.isExpanded('lecturer', 'lect-1')).to.equal(true);
      // false in the old store meant collapsed, not remembered.
      expect(service.isExpanded('lecturer', 'lect-2')).to.equal(false);
      expect(service.isExpanded('student', 'stud-1')).to.equal(true);
    });

    it('runs once and never overwrites state we already own', async () => {
      const { service } = makeService({ expanded: { lecturer: { mine: true } } });
      await service.migrateLegacyExpansion(legacy);

      expect(service.isExpanded('lecturer', 'mine')).to.equal(true);
      expect(service.isExpanded('lecturer', 'lect-1')).to.equal(false);
    });

    it('survives a legacy store that throws', async () => {
      const { service } = makeService();
      await service.migrateLegacyExpansion({
        getTreeExpandedStates: async () => { throw new Error('unreadable'); },
        getStudentTreeExpandedStates: async () => ({ 'stud-1': true }),
        getTutorTreeExpandedStates: async () => ({})
      } as any);

      expect(service.isExpanded('student', 'stud-1')).to.equal(true);
    });
  });
});
