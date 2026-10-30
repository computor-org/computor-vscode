import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { IconGenerator } from '../../src/utils/IconGenerator';
import { StudentCourseContentTreeProvider } from '../../src/ui/tree/student/StudentCourseContentTreeProvider';

/**
 * Status icons must follow a test run, a submission or a grading without a
 * manual course refresh (computor-org/issues#554). VS Code re-reads the very
 * object a change event names, so the row is only fresh if that object was
 * updated from refetched data, and its unit's icon with it.
 */
describe('student tree status refresh', () => {
  const COURSE = 'c1';
  const unitKind = { id: 'unit', has_descendants: true };
  const assignmentKind = { id: 'assignment', has_descendants: false };

  function rows(graded: boolean): any[] {
    return [
      {
        id: 'w1', path: 'w1', title: 'Week 1', position: 1, course_id: COURSE,
        course_content_type: { id: 't-unit', course_content_kind_id: 'unit', color: '#3b82f6' },
        status: graded ? 'corrected' : null,
      },
      {
        id: 'a1', path: 'w1.a1', title: 'Exercise 1', position: 1, course_id: COURSE,
        course_content_type: { id: 't-assignment', course_content_kind_id: 'assignment', color: '#22c55e' },
        result_count: graded ? 1 : 0,
        result: graded ? { id: 'r1', status: 'finished', result: 1 } : null,
        status: graded ? 'corrected' : null,
        submitted: graded,
        submission_group: { id: 'sg1', count: graded ? 1 : 0, grading: graded ? 1 : null, status: graded ? 'corrected' : null },
      },
    ];
  }

  let iconDir: string;
  before(() => {
    iconDir = fs.mkdtempSync(path.join(os.tmpdir(), 'status-icons-'));
    IconGenerator.initialize({ globalStorageUri: { fsPath: iconDir } } as any);
  });
  after(() => fs.rmSync(iconDir, { recursive: true, force: true }));

  const iconName = (item: any) => path.basename(String(item.iconPath?.fsPath ?? item.iconPath?.path ?? item.iconPath?.id));

  let served: any[];
  let handlers: any;

  function makeProvider(): any {
    served = rows(false);
    const api = {
      getStudentCourseContents: async () => served.map(r => ({ ...r })),
      clearStudentCourseContentsCache: () => undefined,
      clearStudentCourseContentCache: () => undefined,
      getCourseGitDescriptor: async () => ({ configured: false }),
    };
    const provider: any = new StudentCourseContentTreeProvider(api as any, { getCurrentCourseId: () => COURSE } as any);
    provider.contentKinds = [unitKind, assignmentKind];
    provider.setWebSocketService({
      subscribe: (...args: any[]) => { handlers = args[2]; },
      unsubscribe: () => undefined,
    } as any);

    // Render the course once, as getChildren would.
    const tree = provider.buildContentTree(served, [], [], provider.contentKinds, COURSE);
    const [unit] = provider.createTreeItems(tree);
    provider.createTreeItems(unit.node);
    return provider;
  }

  function fired(provider: any): any[] {
    const events: any[] = [];
    provider.onDidChangeTreeData((e: any) => events.push(e));
    return events;
  }

  it('updates the indexed row and its unit from refetched data', async () => {
    const provider = makeProvider();
    const item = provider.itemIndex.get('a1');
    const unit = provider.itemIndex.get('w1');
    expect(iconName(item)).to.equal('square-#22c55e.svg');
    expect(iconName(unit)).to.equal('circle-#3b82f6.svg');
    const events = fired(provider);

    served = rows(true);
    await provider.refreshContentItem('a1');

    expect(events).to.include(item);
    expect(events).to.include(unit);
    expect(String(item.description)).to.contain('100% 100%');
    expect(iconName(item)).to.equal('square-#22c55e-success-submitted-corrected-rev.svg');
    expect(iconName(unit), 'the unit carries the corrected corner too').to.equal('circle-#3b82f6-none-corrected-rev.svg');
  });

  it('refreshes the row on submission_group:updated from the user channel', async () => {
    const provider = makeProvider();
    provider.subscribeToCourseChannels([COURSE]);
    const item = provider.itemIndex.get('a1');

    served = rows(true);
    expect(handlers.onSubmissionGroupUpdated, 'the tree listens for the event').to.be.a('function');
    const event = {
      type: 'submission_group:updated', channel: 'user:u1', course_id: COURSE,
      course_content_id: 'a1', submission_group_id: 'sg1', grading: 1, timestamp: '',
    };
    handlers.onSubmissionGroupUpdated(event);
    handlers.onSubmissionGroupUpdated(event);
    await new Promise(resolve => setTimeout(resolve, 400));

    expect(provider.itemIndex.get('a1')).to.equal(item);
    expect(String(item.description)).to.contain('100% 100%');
    expect(iconName(item)).to.equal('square-#22c55e-success-submitted-corrected-rev.svg');
  });
});
