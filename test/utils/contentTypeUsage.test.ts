import { expect } from 'chai';

import {
  findContentsUsingType,
  formatContentTypeInUseDetail
} from '../../src/utils/contentTypeUsage';
import type { CourseContentList } from '../../src/types/generated/courses';

/**
 * Deleting a content type that course content still points at fails: the FK is
 * NOT NULL with ondelete=RESTRICT. The lecturer in computor-org/issues#387 got
 * the raw Postgres text back ("null value in column course_content_type_id …")
 * and no hint that the type was simply still in use.
 *
 * The tree already holds the course's contents, so it can name the ones in the
 * way before any request goes out. These pin what it says.
 */

const content = (
  id: string,
  typeId: string,
  title: string | null,
  path: string
): CourseContentList => ({
  id,
  title,
  path,
  course_id: 'course-1',
  course_content_type_id: typeId,
  course_content_kind_id: 'unit',
  position: 1
});

describe('findContentsUsingType', () => {
  const contents = [
    content('1', 'type-unit', 'Week 1', 'week_1'),
    content('2', 'type-assignment', 'Task A', 'week_1.task_a'),
    content('3', 'type-unit', 'Week 2', 'week_2')
  ];

  it('returns only the contents on the given type', () => {
    const blocking = findContentsUsingType(contents, 'type-unit');
    expect(blocking.map(c => c.id)).to.deep.equal(['1', '3']);
  });

  it('returns nothing for an unused type', () => {
    expect(findContentsUsingType(contents, 'type-unused')).to.deep.equal([]);
  });

  it('handles an empty course', () => {
    expect(findContentsUsingType([], 'type-unit')).to.deep.equal([]);
  });
});

describe('formatContentTypeInUseDetail', () => {
  it('uses the singular when exactly one content blocks', () => {
    const detail = formatContentTypeInUseDetail('Unit 1', [
      content('1', 'type-unit', 'Week 1', 'week_1')
    ]);

    expect(detail).to.contain('"Unit 1" cannot be deleted because 1 course content still uses it');
    expect(detail).to.contain('• Week 1');
  });

  it('names every blocking content up to the sample size', () => {
    const blocking = [1, 2, 3].map(i =>
      content(String(i), 'type-unit', `Week ${i}`, `week_${i}`)
    );

    const detail = formatContentTypeInUseDetail('Unit 1', blocking);

    expect(detail).to.contain('3 course contents still use it');
    expect(detail).to.contain('• Week 1');
    expect(detail).to.contain('• Week 3');
    expect(detail).to.not.contain('more');
  });

  it('collapses the tail once past the sample size', () => {
    const blocking = [1, 2, 3, 4, 5, 6, 7].map(i =>
      content(String(i), 'type-unit', `Week ${i}`, `week_${i}`)
    );

    const detail = formatContentTypeInUseDetail('Unit 1', blocking);

    expect(detail).to.contain('7 course contents still use it');
    expect(detail).to.contain('• Week 5');
    expect(detail).to.not.contain('• Week 6');
    expect(detail).to.contain('…and 2 more');
  });

  it('falls back to the path when a content has no title', () => {
    const detail = formatContentTypeInUseDetail('Unit 1', [
      content('1', 'type-unit', null, 'week_1')
    ]);

    expect(detail).to.contain('• week_1');
  });

  it('says what to do about it', () => {
    const detail = formatContentTypeInUseDetail('Unit 1', [
      content('1', 'type-unit', 'Week 1', 'week_1')
    ]);

    expect(detail).to.contain('another content type of the same kind');
  });
});
