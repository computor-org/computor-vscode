import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

import { hasDescription, tooltipWithDescription, withDescription } from '../../src/ui/contentDescription';

/**
 * A course or unit description was only ever visible to the lecturer who typed
 * it (computor-org/issues#324). Items that have one now advertise it by
 * suffixing their context value, which is what puts the icon on the row — and
 * which every existing `viewItem == …` menu clause has to survive, or the
 * moment a lecturer writes a description the row loses all its other actions.
 */
describe('content descriptions', () => {
  describe('withDescription', () => {
    it('marks an item that has something to show', () => {
      const item = new vscode.TreeItem('Unit 1');
      item.contextValue = 'studentCourseUnit';
      withDescription(item, 'Unit 1', '## Kirchhoff\n\nRead this first.');

      expect(item.contextValue).to.equal('studentCourseUnit.hasDescription');
      expect((item as any).descriptionTitle).to.equal('Unit 1');
      expect((item as any).descriptionMarkdown).to.contain('Kirchhoff');
    });

    it('leaves an item without a description alone', () => {
      const item = new vscode.TreeItem('Unit 1');
      item.contextValue = 'studentCourseUnit';
      withDescription(item, 'Unit 1', null);
      withDescription(item, 'Unit 1', '   ');

      expect(item.contextValue).to.equal('studentCourseUnit');
      expect((item as any).descriptionMarkdown).to.equal(undefined);
    });

    it('does not treat blank text as a description', () => {
      expect(hasDescription('')).to.equal(false);
      expect(hasDescription('  \n ')).to.equal(false);
      expect(hasDescription(null)).to.equal(false);
      expect(hasDescription('text')).to.equal(true);
    });
  });

  describe('tooltipWithDescription', () => {
    it('stays a plain string when there is no description', () => {
      expect(tooltipWithDescription(['Unit: One', '3 items'])).to.equal('Unit: One\n3 items');
    });

    it('appends the description as markdown', () => {
      const tooltip = tooltipWithDescription(['Unit: One'], 'Read **this** first.');
      expect(tooltip).to.be.instanceOf(vscode.MarkdownString);
      expect((tooltip as vscode.MarkdownString).value).to.contain('Read **this** first.');
    });

    it('shortens a long description rather than filling the screen', () => {
      const long = 'word '.repeat(400);
      const tooltip = tooltipWithDescription(['Unit: One'], long) as vscode.MarkdownString;
      expect(tooltip.value.length).to.be.lessThan(long.length);
      expect(tooltip.value).to.contain('…');
    });
  });

  describe('menu when-clauses', () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, '../../package.json'), 'utf8')
    );
    const menus: Array<{ command: string; when?: string }> =
      manifest.contributes.menus['view/item/context'];

    /** Evaluate the `viewItem =~ /…/` or `viewItem == …` part of a clause. */
    function matchesViewItem(when: string, viewItem: string): boolean {
      const regexClause = when.match(/viewItem =~ \/(.+?)\/(?=\s|$|\))/);
      if (regexClause) {
        return new RegExp(regexClause[1] as string).test(viewItem);
      }
      const equality = when.match(/viewItem == ([\w.]+)/);
      return equality ? equality[1] === viewItem : false;
    }

    // tutorUnit is intentionally absent: it carries no other menu entries, so
    // there is nothing the suffix could take away.
    const suffixed = ['course', 'studentCourseRoot', 'studentCourseUnit'];

    for (const base of suffixed) {
      it(`keeps every ${base} action once a description is written`, () => {
        const forBase = menus.filter(
          (m) => m.when && m.command !== 'computor.showContentDescription' && matchesViewItem(m.when, base)
        );
        expect(forBase.length, `menu entries for ${base}`).to.be.greaterThan(0);

        for (const entry of forBase) {
          expect(
            matchesViewItem(entry.when as string, `${base}.hasDescription`),
            `${entry.command} stops matching ${base} once it has a description`
          ).to.equal(true);
        }
      });
    }

    it('is never equality-compared in code, only prefix-matched', () => {
      // The suffix reaches more than menus: any `contextValue === 'X'` in the
      // extension source silently stops matching the moment a lecturer writes
      // a description. The Help command had exactly this bug — a unit with a
      // description opened the course help page.
      const srcRoot = path.resolve(__dirname, '../../src');
      const offenders: string[] = [];
      const equality = new RegExp(
        `(?:contextValue\\s*===?\\s*|===?\\s*)['"](?:${suffixed.join('|')}|tutorUnit)['"]`
      );

      const walk = (dir: string): void => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            walk(full);
            continue;
          }
          if (!entry.name.endsWith('.ts')) {
            continue;
          }
          const lines = fs.readFileSync(full, 'utf8').split('\n');
          lines.forEach((line, index) => {
            if (line.includes('contextValue') && equality.test(line)) {
              offenders.push(`${path.relative(srcRoot, full)}:${index + 1}: ${line.trim()}`);
            }
          });
        }
      };
      walk(srcRoot);

      expect(offenders, `equality checks that break once a description exists:\n${offenders.join('\n')}`)
        .to.deep.equal([]);
    });

    it('does not put a course action on a course group or member', () => {
      const courseOnly = menus.filter(
        (m) => m.command === 'computor.lecturer.showCourseDetails' && m.when
      );
      expect(courseOnly.length).to.be.greaterThan(0);
      for (const entry of courseOnly) {
        expect(matchesViewItem(entry.when as string, 'course')).to.equal(true);
        expect(matchesViewItem(entry.when as string, 'course.group')).to.equal(false);
        expect(matchesViewItem(entry.when as string, 'course.member')).to.equal(false);
      }
    });
  });
});
