import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';
import {
  containerById,
  containerForView,
  isContainerAvailable,
  scopeForView
} from '../../src/ui/viewContainers';

describe('viewContainers', () => {
  it('maps each tree view to its container', () => {
    expect(containerForView('computor.tutor.filters')?.id).to.equal('computor-tutor');
    expect(containerForView('computor.tutor.courses')?.id).to.equal('computor-tutor');
    expect(containerForView('computor.lecturer.examples')?.id).to.equal('computor-lecturer');
    expect(containerForView('computor.chat.inbox')?.id).to.equal('computor-chat');
  });

  it('keeps the offline view out of the ordinary student container', () => {
    // They share the `computor.student.` prefix; a prefix match would put both
    // in the same container and restore the wrong one.
    expect(containerForView('computor.student.offline.view')?.id).to.equal('computor-student-offline');
    expect(containerForView('computor.student.courses')?.id).to.equal('computor-student');
  });

  it('gives every view its own state scope', () => {
    const views = [
      'computor.student.courses',
      'computor.student.offline.view',
      'computor.tutor.filters',
      'computor.tutor.courses',
      'computor.lecturer.courses',
      'computor.lecturer.examples',
      'computor.lecturer.documents',
      'computor.usermanager.users',
      'computor.chat.inbox'
    ];
    const scopes = views.map(scopeForView);
    expect(scopes.every(Boolean), 'every view has a scope').to.equal(true);
    expect(new Set(scopes).size, 'scopes are distinct').to.equal(views.length);
  });

  it('ignores views it does not know', () => {
    expect(containerForView('computor.testResultsPanel')).to.be.undefined;
    expect(scopeForView('nonsense')).to.be.undefined;
  });

  it('only offers a container the user has the role for', () => {
    const tutor = containerById('computor-tutor')!;
    expect(isContainerAvailable(tutor, ['tutor', 'student'])).to.equal(true);
    expect(isContainerAvailable(tutor, ['student'])).to.equal(false);
  });

  it('treats chat as always available', () => {
    // Contributed to every authenticated user, gated on no role.
    expect(isContainerAvailable(containerById('computor-chat')!, [])).to.equal(true);
  });

  // The mapping is a hand-written copy of what package.json declares; this is
  // what notices when a view is added there and not here.
  it('covers exactly the role views package.json contributes', () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(__dirname, '../../package.json'), 'utf8')
    );
    const contributed: string[] = [];
    for (const [container, views] of Object.entries<any[]>(manifest.contributes.views)) {
      if (!container.startsWith('computor-')) continue;
      for (const view of views) {
        // Panel views (test results, message input) are not activity-bar trees.
        if (view.when) contributed.push(view.id);
      }
    }

    const uncovered = contributed.filter(id => !containerForView(id));
    expect(uncovered, 'views in package.json with no container mapping').to.deep.equal([]);

    for (const id of contributed) {
      const declared = Object.entries<any[]>(manifest.contributes.views)
        .find(([, views]) => views.some(v => v.id === id))![0];
      expect(containerForView(id)!.id, id).to.equal(declared);
    }
  });
});
