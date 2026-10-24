import { expect } from 'chai';
import { DocumentsTreeProvider } from '../../../src/ui/tree/lecturer-documents/DocumentsTreeProvider';
import { DocumentsCourseFamilyItem, DocumentsCourseItem } from '../../../src/ui/tree/lecturer-documents/DocumentsTreeItems';

describe('Documents tree course order', () => {
  it('keeps canonical API course order within a family, including cached expansion', async () => {
    let requests = 0;
    const provider = new DocumentsTreeProvider({
      getCourses: async () => {
        requests++;
        return [
          { id: 'first', title: 'Z course', path: 'first' },
          { id: 'second', title: 'A course', path: 'second' }
        ];
      },
      documentsCanWrite: async () => false,
      listDocuments: async () => []
    } as any, { classifyEntries: async () => [] } as any);
    const family = new DocumentsCourseFamilyItem(
      { id: 'family', title: 'Family', path: 'family' } as any,
      { id: 'org', title: 'Organization', path: 'org' } as any
    );
    for (let expansion = 0; expansion < 2; expansion++) {
      const children = await provider.getChildren(family);
      expect(children.map(item => (item as DocumentsCourseItem).course.id)).to.deep.equal(['first', 'second']);
    }
    expect(requests).to.equal(1);
  });
});
