import { expect } from 'chai';

import { StudentCourseContentTreeProvider } from '../../src/ui/tree/student/StudentCourseContentTreeProvider';

/**
 * Pins how an assignment row renders its two percentages (issue #354).
 *
 * The row has two positional slots — test result first, grading second — and a
 * grade without a test run keeps its place with "-%". Without that, a single
 * bare percentage was ambiguous: a graded-but-untested assignment read exactly
 * like a tested one, which is how the test percentage came to look "missing".
 *
 * The fractional case is pinned too: the row shows whatever `result.result`
 * carries, so a partially correct run is *not* rounded to 0%/100% here.
 */
describe('student tree assignment percentages', () => {
  function makeProvider(): any {
    return new StudentCourseContentTreeProvider(
      {} as any,
      { getCurrentCourseId: () => undefined } as any
    );
  }

  function leaf(id: string, content: any) {
    return {
      children: new Map(),
      isUnit: false,
      courseContent: { id, title: id, path: id, position: 1, ...content },
      submissionGroup: content.submission_group,
      contentType: { id: `type-${id}`, course_content_kind_id: 'assignment', slug: 'assignment', title: 'Assignment' },
    };
  }

  function render(rows: Record<string, any>): Map<string, any> {
    const provider = makeProvider();
    const node = {
      children: new Map(Object.entries(rows).map(([id, content]) => [id, leaf(id, content)])),
      isUnit: false,
    };
    return new Map(provider.createTreeItems(node).map((item: any) => [item.id, item]));
  }

  const tested = (value: number) => ({ result_count: 1, result: { id: 'r', status: 'finished', result: value } });
  const graded = (value: number) => ({ submission_group: { id: 'sg', grading: value, count: 1 } });

  it('shows a partial test result as its own percentage, not 0% or 100%', () => {
    const rows = render({ partial: tested(7 / 13) });
    expect(String(rows.get('partial').description)).to.contain('54%');
  });

  it('shows one percentage when only the tests have run', () => {
    const rows = render({ onlyTest: tested(0.5) });
    expect(String(rows.get('onlyTest').description).match(/%/g)).to.have.length(1);
    expect(String(rows.get('onlyTest').description)).to.contain('50%');
    expect(String(rows.get('onlyTest').description)).to.not.contain('-%');
  });

  it('holds the test slot with -% when a grade arrived without a test run', () => {
    const rows = render({ onlyGrade: graded(0.8) });
    expect(String(rows.get('onlyGrade').description)).to.contain('-% 80%');
  });

  it('shows both percentages, test first, when both exist', () => {
    const rows = render({ both: { ...tested(0.5), ...graded(1) } });
    expect(String(rows.get('both').description)).to.contain('50% 100%');
  });

  it('shows no percentage at all when nothing has happened', () => {
    const rows = render({ untouched: { result: null, submission_group: { id: 'sg', grading: null } } });
    expect(String(rows.get('untouched').description ?? '')).to.not.contain('%');
  });

  it('names the missing test run in the tooltip so -% reads', () => {
    const rows = render({ onlyGrade: graded(0.8) });
    const tooltip = String((rows.get('onlyGrade').tooltip as any)?.value ?? rows.get('onlyGrade').tooltip ?? '');
    expect(tooltip).to.contain('Result: not tested yet');
    expect(tooltip).to.contain('Grading: 80.00%');
  });
});
