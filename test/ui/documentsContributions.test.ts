import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';

/**
 * The Documents tree's reach onto the lecturer's own machine (issue #361).
 *
 * Every transfer this view had moved bytes between the backend and the
 * workspace mirror, and under code-server that mirror is the *server's* disk.
 * So a lecturer whose source material sits in Keynote on their laptop could
 * neither get a document out nor put one in. These pins cover the actions that
 * close that gap, and the viewers for the two formats that had none.
 */

const pkg = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')
);

const DOCUMENTS_VIEW = 'computor.lecturer.documents';

interface Command { command: string; title: string }
interface MenuEntry { command: string; when?: string; group?: string }

const commands: Command[] = pkg.contributes.commands;
const contextMenus: MenuEntry[] = pkg.contributes.menus['view/item/context'];

function command(id: string): Command | undefined {
  return commands.find(c => c.command === id);
}

function documentEntries(id: string): MenuEntry[] {
  return contextMenus.filter(
    entry => entry.command === id && (entry.when || '').includes(`view == ${DOCUMENTS_VIEW}`)
  );
}

describe('documents tree contributions', () => {
  describe('reaching the lecturer\'s own computer', () => {
    it('offers a download that leaves the server', () => {
      expect(command('computor.lecturer.documents.downloadToComputer')?.title)
        .to.equal('Download to My Computer...');
    });

    it('offers that download on files, folders and whole scopes', () => {
      // A folder download is the one the issue asked for by name: material is
      // organised in folders, and pulling them one file at a time is the
      // problem, not the solution.
      const when = documentEntries('computor.lecturer.documents.downloadToComputer')
        .map(e => e.when || '')
        .join(' ');
      for (const rowKind of ['file', 'dir', 'scope']) {
        expect(when).to.contain(rowKind);
      }
    });

    it('offers both a file and a folder upload from the lecturer\'s machine', () => {
      expect(command('computor.lecturer.documents.uploadFromComputer')).to.not.equal(undefined);
      expect(command('computor.lecturer.documents.uploadFolderFromComputer')).to.not.equal(undefined);
      expect(documentEntries('computor.lecturer.documents.uploadFromComputer').length)
        .to.be.greaterThan(0);
      expect(documentEntries('computor.lecturer.documents.uploadFolderFromComputer').length)
        .to.be.greaterThan(0);
    });

    it('keeps the existing workspace download untouched', () => {
      // Clicking a document still pulls it into the mirror; that behaviour is
      // deliberate and stays. The new command is an addition, not a swap.
      expect(command('computor.lecturer.documents.downloadFile')?.title).to.equal('Download');
      expect(documentEntries('computor.lecturer.documents.downloadFile').length)
        .to.be.greaterThan(0);
    });
  });

  describe('the address of a published document', () => {
    it('can be copied', () => {
      expect(command('computor.lecturer.documents.copyPublicUrl')?.title).to.equal('Copy Public URL');
    });

    it('sits with the other clipboard actions on files and folders', () => {
      const entries = documentEntries('computor.lecturer.documents.copyPublicUrl');
      expect(entries.length).to.be.greaterThan(0);
      expect(entries.every(e => (e.group || '').startsWith('9_clipboard'))).to.equal(true);
    });
  });

  describe('write actions', () => {
    const WRITE_COMMANDS = [
      'computor.lecturer.documents.uploadFile',
      'computor.lecturer.documents.newFile',
      'computor.lecturer.documents.newFolder',
      'computor.lecturer.documents.uploadAllPending',
      'computor.lecturer.documents.rename',
      'computor.lecturer.documents.delete',
      'computor.lecturer.documents.uploadFromComputer',
      'computor.lecturer.documents.uploadFolderFromComputer'
    ];

    it('every write action requires the writable stamp (#361)', () => {
      // The provider stamps `.writable` from the backend's own
      // GET /documents/permissions answer; an ungated write action is a
      // guaranteed 403 dressed up as a button.
      const entries: Array<{ command: string; when?: string }> =
        pkg.contributes.menus['view/item/context'];
      for (const command of WRITE_COMMANDS) {
        const clauses = entries.filter(e => e.command === command);
        expect(clauses.length, command).to.be.greaterThan(0);
        for (const clause of clauses) {
          expect(clause.when, command).to.contain('writable');
        }
      }
    });
  });

  describe('viewers', () => {
    const editors: Array<{ viewType: string; priority: string; selector: Array<{ filenamePattern: string }> }> =
      pkg.contributes.customEditors;

    function editor(viewType: string) {
      return editors.find(e => e.viewType === viewType);
    }

    it('renders mirror PDFs', () => {
      expect(editor('computor.pdfPreview')?.selector[0]?.filenamePattern)
        .to.equal('**/.computor-data/documents/**/*.pdf');
    });

    it('renders mirror HTML', () => {
      expect(editor('computor.htmlPreview')?.selector[0]?.filenamePattern)
        .to.equal('**/.computor-data/documents/**/*.html');
    });

    it('opens mirror documents by default and claims nothing else (#361)', () => {
      // "default" makes a click on a mirror document open the viewer directly
      // — reopening by hand on every PDF was the reported pain — while the
      // mirror-scoped selector keeps a student's own files on their normal
      // editors.
      for (const viewType of ['computor.pdfPreview', 'computor.htmlPreview']) {
        expect(editor(viewType)?.priority).to.equal('default');
        expect(editor(viewType)?.selector[0]?.filenamePattern).to.contain('.computor-data/documents/');
      }
    });
  });
});
