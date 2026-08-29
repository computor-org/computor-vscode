import * as assert from 'assert';

import { formatCascadePreview } from '../../src/services/CascadePreview';
import type { CascadeDeleteResult } from '../../src/types/generated/common';

function result(overrides: Partial<CascadeDeleteResult> = {}): CascadeDeleteResult {
  return {
    dry_run: true,
    entity_type: 'course',
    entity_id: 'c-1',
    deleted_counts: {},
    errors: [],
    ...overrides
  };
}

describe('CascadePreview', () => {
  it('lists student submissions first and skips zero counts', () => {
    const text = formatCascadePreview(result({
      deleted_counts: { course_members: 30, student_submissions: 12, results: 0, submission_artifacts: 15 }
    }));
    const lines = text.split('\n');
    const first = lines.findIndex(l => l.includes('Submissions from students: 12'));
    const members = lines.findIndex(l => l.includes('Course members: 30'));
    assert.ok(first > 0 && members > first, text);
    assert.ok(!text.includes('Test results'), text);
    assert.ok(text.includes('Submissions (all): 15'), text);
  });

  it('names the git repositories that go and says student repos stay', () => {
    const text = formatCascadePreview(result({
      git_repositories: ['forgejo:itpcp-2027/template', 'forgejo:itpcp-2027/reference'],
      student_repositories_kept: 25
    }), { kind: 'course' });
    assert.ok(text.includes('Git repositories that will be deleted:'), text);
    assert.ok(text.includes('forgejo:itpcp-2027/template'), text);
    assert.ok(text.includes('Student repositories are kept (25)'), text);
    assert.ok(text.endsWith('There is no undo.'), text);
  });

  it('does not mention student repositories for a family or organization', () => {
    const fam = formatCascadePreview(result({ entity_type: 'course_family' }));
    const org = formatCascadePreview(result({ entity_type: 'organization' }), { kind: 'organization' });
    assert.ok(!fam.includes('Student repositories'), fam);
    assert.ok(!org.includes('Student repositories'), org);
    assert.ok(fam.includes('Nothing else is stored under it.'), fam);
  });

  it('says so when nothing else is stored', () => {
    const text = formatCascadePreview(result({ deleted_counts: {} }));
    assert.ok(text.startsWith('Nothing else is stored under it.'), text);
    assert.ok(text.includes('Student repositories are kept (0)'), text);
  });
});
