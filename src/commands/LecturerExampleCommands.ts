import * as vscode from 'vscode';
import { openFile, showOptions } from '../ui/editorLayout';
import * as path from 'path';
import * as fs from 'fs';
import * as yaml from 'js-yaml';
import JSZip from 'jszip';
import { ComputorApiService } from '../services/ComputorApiService';
import { ExampleTreeItem, ExampleRepositoryTreeItem, CheckedOutGroupTreeItem, CheckedOutVersionTreeItem, FileSystemTreeItem, RepositoryFilterToggleItem, LecturerExampleTreeProvider } from '../ui/tree/lecturer/LecturerExampleTreeProvider';
import type { MergedExample } from '../ui/tree/lecturer/LecturerExampleTreeProvider';
import { ExampleUploadRequest, ExampleRepositoryCreate, CourseContentCreate, CourseContentList, CourseList, CodeAbilityMeta } from '../types/generated';
import { writeExampleFiles } from '../utils/exampleFileWriter';
import { ExampleDetailWebviewProvider } from '../ui/webviews/ExampleDetailWebviewProvider';
import { TestYamlEditorWebviewProvider } from '../ui/webviews/TestYamlEditorWebviewProvider';
import { MetaYamlEditorWebviewProvider } from '../ui/webviews/MetaYamlEditorWebviewProvider';
import { WorkspaceStructureManager } from '../utils/workspaceStructure';
import { writeCheckoutMetadata, readCheckoutMetadata, getWorkingPath, getVersionPath, snapshotWorkingToVersion, isWorkingCopyDirty } from '../utils/checkedOutExampleManager';
import type { CheckoutMetadata, CheckedOutExampleGroup } from '../utils/checkedOutExampleManager';
import { ComputorTestingInstaller } from '../services/ComputorTestingInstaller';
import { shouldExcludeExampleEntry } from '../utils/exampleExcludePatterns';
import { computeExampleDiff } from '../utils/exampleDiffHelper';
import { planReplacements, applyReplacements, totalHits } from '../utils/exampleTextReplace';
import type { ReplaceOptions, ReplaceTarget } from '../utils/exampleTextReplace';
import { UploadAllExamplesWebviewProvider } from '../ui/webviews/UploadAllExamplesWebviewProvider';
import { commandRegistrar } from './commandHelpers';
import { notify } from '../utils/notify';
import { say, uiLanguage, uiLocale } from '../utils/uiLanguage';
import { localizedKindTitle } from '../utils/contentLanguage';

/**
 * Simplified example commands for the lecturer view
 */
export class LecturerExampleCommands {
  private exampleDetailProvider: ExampleDetailWebviewProvider;
  private testYamlEditorProvider: TestYamlEditorWebviewProvider;
  private metaYamlEditorProvider: MetaYamlEditorWebviewProvider;
  private uploadAllProvider: UploadAllExamplesWebviewProvider;

  constructor(
    private context: vscode.ExtensionContext,
    private apiService: ComputorApiService,
    private treeProvider: LecturerExampleTreeProvider
  ) {
    this.exampleDetailProvider = new ExampleDetailWebviewProvider(context, apiService, treeProvider);
    this.testYamlEditorProvider = new TestYamlEditorWebviewProvider(context);
    this.metaYamlEditorProvider = new MetaYamlEditorWebviewProvider(context);
    this.uploadAllProvider = new UploadAllExamplesWebviewProvider(context, apiService, treeProvider);
    this.registerCommands();
  }
  private registerCommands(): void {
    const register = commandRegistrar(this.context);
    // Search examples - already registered in extension.ts but we'll override with better implementation
    register('computor.lecturer.searchExamples', async () => {
      // Get current search query to prefill the input
      const currentQuery = this.treeProvider.getSearchQuery();
      
      const query = await vscode.window.showInputBox({
        prompt: say('Search examples by title, identifier, or tags', 'Beispiele nach Titel, Kennung oder Schlagwörtern durchsuchen'),
        placeHolder: say('Enter search query', 'Suchbegriff eingeben'),
        value: currentQuery  // Prefill with current search
      });
      
      if (query !== undefined) {
        this.treeProvider.setSearchQuery(query);
        if (query) {
          notify.info(say(`Searching for: ${query}`, `Suche nach: ${query}`));
        } else {
          notify.info(say('Search cleared', 'Suche zurückgesetzt.'));
        }
      }
    });

    // Clear search
    register('computor.lecturer.clearExampleSearch', () => {
      this.treeProvider.clearSearch();
      notify.info(say('Search cleared', 'Suche zurückgesetzt.'));
    });

    // Also register clearSearch for the tree item click
    register('computor.lecturer.clearSearch', () => {
      this.treeProvider.clearSearch();
      notify.info(say('Search cleared', 'Suche zurückgesetzt.'));
    });

    // Filter by category. Picked from the categories the examples carry rather
    // than typed: a category is matched whole, so a typo used to empty the tree
    // with nothing to explain it (computor-org/issues#358).
    register('computor.lecturer.filterExamplesByCategory', async () => {
      const current = this.treeProvider.getSelectedCategory();
      const { categories } = await this.treeProvider.getFilterVocabulary();

      if (categories.length === 0) {
        notify.info(
          say('None of your examples has a category yet. Add `category: ...` to an example\'s meta.yaml and upload it.', 'Noch keines deiner Beispiele hat eine Kategorie. Trage `category: ...` in die meta.yaml eines Beispiels ein und lade es hoch.')
        );
        return;
      }

      const clearItem = { label: say('Show all categories', 'Alle Kategorien anzeigen'), category: undefined as string | undefined };
      const picked = await vscode.window.showQuickPick(
        [
          ...(current ? [clearItem] : []),
          ...categories.map(category => ({
            label: category,
            description: category === current ? say('current filter', 'aktueller Filter') : undefined,
            category: category as string | undefined
          }))
        ],
        { title: say('Filter Examples by Category', 'Beispiele nach Kategorie filtern'), placeHolder: say('Category', 'Kategorie'), ignoreFocusOut: true }
      );
      if (!picked) { return; }

      this.treeProvider.setCategory(picked.category);
      notify.info(picked.category ? say(`Filtering by category: ${picked.category}`, `Gefiltert nach Kategorie: ${picked.category}`) : say('Category filter cleared', 'Kategoriefilter zurückgesetzt.'));
    });

    // Filter by tags — multi-select over the tags in use.
    register('computor.lecturer.filterExamplesByTags', async () => {
      const current = this.treeProvider.getSelectedTags();
      const { tags } = await this.treeProvider.getFilterVocabulary();

      if (tags.length === 0) {
        notify.info(
          say('None of your examples has tags yet. List them under `keywords:` in an example\'s meta.yaml and upload it.', 'Noch keines deiner Beispiele hat Schlagwörter. Trage sie unter `keywords:` in die meta.yaml eines Beispiels ein und lade es hoch.')
        );
        return;
      }

      const selected = new Set(current.map(tag => tag.toLowerCase()));
      const picked = await vscode.window.showQuickPick(
        tags.map(tag => ({ label: tag, picked: selected.has(tag.toLowerCase()) })),
        {
          title: say('Filter Examples by Tags', 'Beispiele nach Schlagwörtern filtern'),
          placeHolder: say('An example must carry every tag you pick', 'Ein Beispiel muss alle gewählten Schlagwörter tragen'),
          canPickMany: true,
          ignoreFocusOut: true
        }
      );
      if (!picked) { return; }

      const chosen = picked.map(item => item.label);
      this.treeProvider.setTags(chosen);
      notify.info(chosen.length > 0 ? say(`Filtering by tags: ${chosen.join(', ')}`, `Gefiltert nach Schlagwörtern: ${chosen.join(', ')}`) : say('Tag filter cleared', 'Schlagwortfilter zurückgesetzt.'));
    });

    // Clear category filter
    register('computor.lecturer.clearCategoryFilter', () => {
      this.treeProvider.clearCategoryFilter();
      notify.info(say('Category filter cleared', 'Kategoriefilter zurückgesetzt.'));
    });

    // Clear tags filter
    register('computor.lecturer.clearTagsFilter', () => {
      this.treeProvider.clearTagsFilter();
      notify.info(say('Tags filter cleared', 'Schlagwortfilter zurückgesetzt.'));
    });

    // Toggle a repository in the repository filter
    register('computor.lecturer.toggleRepositoryFilter', (item: RepositoryFilterToggleItem) => {
      if (!item?.repository?.id) { return; }
      this.treeProvider.toggleRepositoryFilter(item.repository.id);
    });

    // Clear repository filter
    register('computor.lecturer.clearRepositoriesFilter', () => {
      this.treeProvider.clearRepositoriesFilter();
      notify.info(say('Repositories filter cleared', 'Repository-Filter zurückgesetzt.'));
    });

    // Checkout example (latest version)
    register('computor.lecturer.checkoutExample', async (item: ExampleTreeItem) => {
      await this.checkoutExample(item);
    });

    // Checkout specific version
    register('computor.lecturer.checkoutExampleVersion', async (item: ExampleTreeItem) => {
      await this.checkoutExample(item, true);
    });

    // Checkout all filtered examples from repository
    register('computor.lecturer.checkoutAllFilteredExamples', async () => {
      await this.checkoutAllFilteredExamples();
    });

    register('computor.lecturer.cleanupFilteredExamples', async () => {
      await this.cleanupFilteredExamples(false);
    });

    register('computor.lecturer.cleanupAllFilteredExamples', async () => {
      await this.cleanupFilteredExamples(true);
    });

    register('computor.lecturer.replaceInFilteredExamples', async () => {
      await this.replaceInFilteredExamples();
    });

    // Checkout the example version bound to a course assignment
    register('computor.lecturer.checkoutAssignmentExample', async (item: any) => {
      await this.checkoutAssignmentExample(item);
    });

    // Upload working copy
    register('computor.lecturer.uploadExample', async (item: ExampleTreeItem | CheckedOutVersionTreeItem) => {
      if (item instanceof CheckedOutVersionTreeItem) {
        await this.uploadCheckedOutVersion(item);
      } else {
        await this.uploadExample(item);
      }
    });

    // Bump version on working copy
    register('computor.lecturer.bumpExampleVersion', async (item: CheckedOutVersionTreeItem) => {
      await this.bumpCheckedOutVersion(item);
    });

    // Reveal checked-out version in explorer
    register('computor.lecturer.revealCheckedOutInExplorer', async (item: CheckedOutVersionTreeItem | CheckedOutGroupTreeItem | ExampleTreeItem) => {
      let target: string | undefined;
      if (item instanceof CheckedOutVersionTreeItem) {
        target = item.version.fullPath;
      } else if (item instanceof CheckedOutGroupTreeItem) {
        target = item.group.fullPath;
      } else if (item instanceof ExampleTreeItem) {
        target = item.merged.local?.fullPath;
      }
      if (!target) {
        notify.warning(say('No local copy to reveal.', 'Es gibt keine lokale Kopie zum Anzeigen.'));
        return;
      }
      await vscode.commands.executeCommand('revealInExplorer', vscode.Uri.file(target));
    });

    // Delete entire checked-out example group
    register('computor.lecturer.deleteCheckedOutExample', async (item: CheckedOutGroupTreeItem | ExampleTreeItem) => {
      const group = item instanceof ExampleTreeItem ? item.merged.local : item?.group;
      if (!group) {
        notify.warning(say('No local copy to delete.', 'Es gibt keine lokale Kopie zum Löschen.'));
        return;
      }
      await this.deleteCheckedOutGroup({ group } as CheckedOutGroupTreeItem);
    });

    // Delete single checked-out version
    register('computor.lecturer.deleteCheckedOutVersion', async (item: CheckedOutVersionTreeItem) => {
      await this.deleteCheckedOutVersion(item);
    });

    // Restore version to working copy
    register('computor.lecturer.restoreVersionToWorking', async (item: CheckedOutVersionTreeItem) => {
      await this.restoreVersionToWorking(item);
    });

    // Compare version with working copy
    register('computor.lecturer.compareWithWorking', async (item: CheckedOutVersionTreeItem) => {
      await this.compareWithWorking(item);
    });

    // Open the multi-file diff editor for changes between a version snapshot
    // and the working copy.
    register('computor.lecturer.openDiffWithWorking', async (item: CheckedOutVersionTreeItem | CheckedOutGroupTreeItem | ExampleTreeItem) => {
      await this.openDiffWithWorking(item);
    });

    // Compare a single version file with its working counterpart
    register('computor.lecturer.compareFileWithWorking', async (item: FileSystemTreeItem) => {
      await this.compareFileWithWorking(item);
    });

    // File management commands
    register('computor.lecturer.newFile', async (item: FileSystemTreeItem | CheckedOutVersionTreeItem) => {
      await this.createFileOrFolder(item, false);
    });
    register('computor.lecturer.newFolder', async (item: FileSystemTreeItem | CheckedOutVersionTreeItem) => {
      await this.createFileOrFolder(item, true);
    });
    register('computor.lecturer.renameItem', async (item: FileSystemTreeItem) => {
      await this.renameFileSystemItem(item);
    });
    register('computor.lecturer.deleteItem', async (item: FileSystemTreeItem) => {
      await this.deleteFileSystemItem(item);
    });

    // Create a new example repository
    register('computor.lecturer.createExampleRepository', async () => {
      await this.createExampleRepository();
    });

    // Create new example
    register('computor.lecturer.createNewExample', async () => {
      await this.createNewExample();
    });

    // Upload new example
    register('computor.lecturer.uploadNewExample', async () => {
      await this.uploadNewExample();
    });

    // Checkout multiple examples
    register('computor.lecturer.checkoutMultipleExamples', async () => {
      notify.info(say('Checkout multiple examples - not yet implemented', 'Mehrere Beispiele auschecken ist noch nicht umgesetzt.'));
    });

    // Upload examples from ZIP
    register('computor.lecturer.uploadExamplesFromZip', async (item?: ExampleRepositoryTreeItem) => {
      await this.uploadExamplesFromZip(item);
    });

    // create content from example
    register('computor.lecturer.createCourseContentFromExample', async (item: ExampleTreeItem) => {
      await this.createCourseContentFromExample(item);
    });

    // Refresh examples tree (clear caches first)
    register('computor.lecturer.refreshExamples', async () => {
      try {
        this.apiService.clearExamplesCache();
      } catch {}
      this.treeProvider.refresh();
    });

    // Reveal downloaded example in explorer
    register('computor.lecturer.revealExampleInExplorer', async (item: ExampleTreeItem) => {
      await this.revealExampleInExplorer(item);
    });

    // Show example details in webview side panel
    register('computor.lecturer.showExampleDetails', async (item: ExampleTreeItem) => {
      await this.showExampleDetails(item);
    });

    // Open test.yaml editor
    register('computor.lecturer.editTestYaml', async (item: FileSystemTreeItem | CheckedOutVersionTreeItem) => {
      await this.editTestYaml(item);
    });

    // Add test.yaml to working example
    register('computor.lecturer.addTests', async (item: CheckedOutVersionTreeItem) => {
      await this.addTests(item);
    });

    // Open meta.yaml editor (from meta.yaml file or working example root)
    register('computor.lecturer.editMetaYaml', async (item: FileSystemTreeItem | CheckedOutVersionTreeItem) => {
      await this.editMetaYaml(item);
    });

    // Create new readme in content directory
    register('computor.lecturer.newReadme', async (item: FileSystemTreeItem) => {
      await this.createNewReadme(item);
    });

    // Import examples from directory
    register('computor.lecturer.importExamples', async () => {
      await this.importExamples();
    });

    // Upload all examples
    register('computor.lecturer.uploadAllExamples', async () => {
      await this.uploadAllProvider.show(say('Upload All Examples', 'Alle Beispiele hochladen'));
    });

    // Install computor-testing tools
    register('computor.lecturer.installTestingTools', async () => {
      const installer = ComputorTestingInstaller.getInstance();
      await installer.install();
    });

    // Update computor-testing tools
    register('computor.lecturer.updateTestingTools', async () => {
      const installer = ComputorTestingInstaller.getInstance();
      await installer.update();
    });

    // Uninstall computor-testing tools
    register('computor.lecturer.uninstallTestingTools', async () => {
      const installer = ComputorTestingInstaller.getInstance();
      await installer.uninstall();
    });

    // Run tests on checked-out example
    register('computor.lecturer.runExampleTests', async (item: CheckedOutVersionTreeItem) => {
      await this.runExampleTests(item);
    });
  }

  private async checkoutExample(item: ExampleTreeItem, pickVersion: boolean = false): Promise<void> {
    if (!item?.example) {
      notify.error(say('Invalid example item', 'Ungültiges Beispiel.'));
      return;
    }

    const examplesPath = this.getExamplesDir();
    if (!examplesPath) { return; }
    const versionsPath = this.getVersionsDir();
    if (!versionsPath) { return; }

    try {
      let versionId: string | undefined;
      let versionTag: string | undefined;
      let versionNumber: number | undefined;

      if (pickVersion) {
        const versions = await this.apiService.getExampleVersions(item.example.id);
        if (versions.length === 0) {
          notify.error(say('No versions available for this example', 'Für dieses Beispiel gibt es keine Versionen.'));
          return;
        }
        const sorted = versions.slice().sort((a, b) => b.version_number - a.version_number);
        const picked = await vscode.window.showQuickPick(
          sorted.map(v => ({
            label: v.version_tag,
            description: `#${v.version_number}${v.created_at ? ' — ' + new Date(v.created_at).toLocaleDateString(uiLocale()) : ''}`,
            versionId: v.id,
            versionTag: v.version_tag,
            versionNumber: v.version_number
          })),
          { placeHolder: say('Select a version to checkout', 'Version zum Auschecken auswählen') }
        );
        if (!picked) { return; }
        versionId = picked.versionId;
        versionTag = picked.versionTag;
        versionNumber = picked.versionNumber;
      }

      const exampleData = versionId
        ? await this.apiService.downloadExampleVersion(versionId)
        : await this.apiService.downloadExample(item.example.id, false);

      if (!exampleData) {
        notify.error(say('Failed to download example', 'Das Beispiel konnte nicht heruntergeladen werden.'));
        return;
      }

      const resolvedTag = versionTag || exampleData.version_tag;

      const metadata: CheckoutMetadata = {
        exampleId: item.example.id,
        repositoryId: item.repository.id,
        directory: item.example.directory,
        versionId: versionId || exampleData.version_id || '',
        versionTag: resolvedTag,
        versionNumber: versionNumber ?? 0,
        checkedOutAt: new Date().toISOString()
      };

      if (pickVersion) {
        // Specific version: only create version snapshot in example_versions/
        const versionDir = getVersionPath(versionsPath, item.example.directory, resolvedTag);
        const versionLabel = `example_versions/${item.example.directory}/${resolvedTag}`;

        if (fs.existsSync(versionDir)) {
          const overwrite = await notify.warning(
            say(`'${versionLabel}' already exists. Overwrite?`, `„${versionLabel}“ existiert bereits. Überschreiben?`), say('Yes', 'Ja'), say('No', 'Nein')
          );
          if (overwrite !== say('Yes', 'Ja')) { return; }
          fs.rmSync(versionDir, { recursive: true, force: true });
        }

        fs.mkdirSync(versionDir, { recursive: true });
        writeExampleFiles(exampleData.files, versionDir);
        writeCheckoutMetadata(versionDir, metadata);

        this.treeProvider.refresh();
        notify.info(
          say(`Checked out '${item.example.title}' [${resolvedTag}] to ${versionLabel}`, `„${item.example.title}“ [${resolvedTag}] nach ${versionLabel} ausgecheckt.`)
        );
      } else {
        // Latest: create working copy in examples/ and version snapshot in example_versions/
        const workingDir = getWorkingPath(examplesPath, item.example.directory);
        const versionDir = getVersionPath(versionsPath, item.example.directory, resolvedTag);

        if (fs.existsSync(workingDir)) {
          const overwrite = await notify.warning(
            say(`Working copy of '${item.example.directory}' already exists. Overwrite?`, `Die Arbeitskopie von „${item.example.directory}“ existiert bereits. Überschreiben?`), say('Yes', 'Ja'), say('No', 'Nein')
          );
          if (overwrite !== say('Yes', 'Ja')) { return; }
          fs.rmSync(workingDir, { recursive: true, force: true });
        }

        // Create working directory (flat: examples/<identifier>/files)
        fs.mkdirSync(workingDir, { recursive: true });
        writeExampleFiles(exampleData.files, workingDir);
        writeCheckoutMetadata(workingDir, metadata);

        // Create version snapshot in example_versions/
        if (fs.existsSync(versionDir)) {
          fs.rmSync(versionDir, { recursive: true, force: true });
        }
        fs.mkdirSync(versionDir, { recursive: true });
        fs.cpSync(workingDir, versionDir, { recursive: true });

        this.treeProvider.refresh();
        notify.info(
          say(`Checked out '${item.example.title}' [${resolvedTag}]`, `„${item.example.title}“ [${resolvedTag}] ausgecheckt.`)
        );
      }
    } catch (error) {
      console.error('Failed to checkout example:', error);
      notify.error(say(`Failed to checkout example: ${error}`, `Das Beispiel konnte nicht ausgecheckt werden: ${error}`));
    }
  }

  private async checkoutAssignmentExample(item: any): Promise<void> {
    if (!item?.exampleVersionInfo?.id || !item?.exampleInfo) {
      notify.warning(say('No example version assigned to this content.', 'Diesem Inhalt ist keine Beispielversion zugewiesen.'));
      return;
    }

    try {
      const dirs = WorkspaceStructureManager.getInstance().getDirectories();
      const exampleData = await this.apiService.downloadExampleVersion(item.exampleVersionInfo.id);
      if (!exampleData) {
        notify.error(say('Failed to download example version.', 'Die Beispielversion konnte nicht heruntergeladen werden.'));
        return;
      }

      // The lecturer assignment tree carries a synthetic `exampleInfo` stub
      // (identifier + title only). Trust the download response for the real
      // example id / directory / identifier so the local checkout merges
      // back into the same row in the examples tree.
      const exampleId = exampleData.example_id;
      const directory = exampleData.directory;
      const identifier = exampleData.identifier;
      const versionTag = item.exampleVersionInfo.version_tag || exampleData.version_tag;

      const metadata: CheckoutMetadata = {
        exampleId,
        repositoryId: item.exampleInfo.example_repository_id || '',
        directory,
        versionId: item.exampleVersionInfo.id,
        versionTag,
        versionNumber: item.exampleVersionInfo.version_number ?? 0,
        checkedOutAt: new Date().toISOString()
      };

      const workingDir = getWorkingPath(dirs.examples, directory);
      const versionDir = getVersionPath(dirs.exampleVersions, directory, versionTag);

      if (fs.existsSync(workingDir)) {
        const overwrite = await notify.warning(
          say(`Working copy of '${directory}' already exists. Overwrite?`, `Die Arbeitskopie von „${directory}“ existiert bereits. Überschreiben?`), say('Yes', 'Ja'), say('No', 'Nein')
        );
        if (overwrite !== say('Yes', 'Ja')) { return; }
        fs.rmSync(workingDir, { recursive: true, force: true });
      }

      fs.mkdirSync(workingDir, { recursive: true });
      writeExampleFiles(exampleData.files, workingDir);
      writeCheckoutMetadata(workingDir, metadata);

      if (fs.existsSync(versionDir)) {
        fs.rmSync(versionDir, { recursive: true, force: true });
      }
      fs.mkdirSync(versionDir, { recursive: true });
      fs.cpSync(workingDir, versionDir, { recursive: true });

      this.treeProvider.refresh();
      notify.info(
        say(`Checked out '${item.exampleInfo.title || directory}' [${versionTag}]`, `„${item.exampleInfo.title || directory}“ [${versionTag}] ausgecheckt.`)
      );

      // Reveal the (now merged) example row in the examples tree so the
      // user can immediately see + interact with the local copy.
      void this.treeProvider.revealExample({ identifier });
    } catch (error) {
      console.error('Failed to checkout assignment example:', error);
      notify.error(say(`Failed to checkout: ${error}`, `Auschecken fehlgeschlagen: ${error}`));
    }
  }

  /**
   * Which of the filtered examples a bulk re-checkout should overwrite
   * (computor-org/issues#339).
   *
   * An absent or provably-clean working copy is fair game; one with edits in
   * it is not, and is named in the summary instead. Local-only rows are not
   * candidates at all -- there is no server side to download from.
   *
   * Static and free of `fs`/`vscode` so the rule that protects a lecturer's
   * unsaved work can be tested directly.
   */
  static selectForCheckout(
    merged: MergedExample[],
    isDirty: (group: CheckedOutExampleGroup) => boolean = isWorkingCopyDirty
  ): { selected: MergedExample[]; skipped: string[] } {
    const selected: MergedExample[] = [];
    const skipped: string[] = [];

    for (const example of merged) {
      if (!example.remote) { continue; }
      if (example.local && isDirty(example.local)) {
        skipped.push(example.identifier);
      } else {
        selected.push(example);
      }
    }

    return { selected, skipped };
  }

  /**
   * Which of the filtered examples a cleanup sweep should delete
   * (computor-org/issues#340).
   *
   * `includeVersions` widens the candidates as well as the deletion: a
   * snapshot-only example has nothing for the working-copy sweep to do, but is
   * exactly what the full sweep exists to clear away. Changed work is
   * protected at both depths.
   */
  static selectForCleanup(
    merged: MergedExample[],
    includeVersions: boolean,
    isDirty: (group: CheckedOutExampleGroup) => boolean = isWorkingCopyDirty
  ): { selected: MergedExample[]; skipped: string[] } {
    const selected: MergedExample[] = [];
    const skipped: string[] = [];

    for (const example of merged) {
      const hasSomethingToDelete = includeVersions
        ? Boolean(example.local)
        : Boolean(example.local?.workingVersion);
      if (!hasSomethingToDelete) { continue; }

      if (isDirty(example.local!)) {
        skipped.push(example.identifier);
      } else {
        selected.push(example);
      }
    }

    return { selected, skipped };
  }

  /**
   * What the bulk actions are scoped to, in one line and in the same words for
   * all three, so "according to the filter settings" is never left to guesswork
   * in the confirmation dialog.
   */
  private describeScope(): string {
    const filters = this.treeProvider.describeActiveFilters();
    return filters.length > 0
      ? say(`Filters: ${filters.join(', ')}`, `Filter: ${filters.join(', ')}`)
      : say('No filters set - this covers every example.', 'Kein Filter gesetzt, das betrifft also alle Beispiele.');
  }

  /**
   * The house form for a bulk result: how much of the batch landed, the first
   * few errors, and skips reported apart from failures so "skipped" never
   * reads as "broken".
   */
  private reportBulkOutcome(
    doneLabel: string,
    failingLabel: string,
    successCount: number,
    attempted: number,
    errors: string[],
    skipped: string[],
    skipReason: string
  ): void {
    const skippedNote = skipped.length > 0
      ? say(` ${skipped.length} skipped - ${skipReason}.`, ` ${skipped.length} übersprungen, weil ${skipReason}.`)
      : '';

    if (errors.length === 0) {
      notify.info(say(`${doneLabel} ${successCount} example(s).${skippedNote}`, `${doneLabel}: ${successCount} Beispiel(e).${skippedNote}`));
      return;
    }

    const shown = errors.length > 3 ? errors.slice(0, 3).join('; ') + '...' : errors.join('; ');
    if (successCount > 0) {
      notify.warning(say(`${doneLabel} ${successCount} of ${attempted}.${skippedNote} Errors: ${shown}`, `${doneLabel}: ${successCount} von ${attempted}.${skippedNote} Fehler: ${shown}`));
    } else {
      notify.error(say(`Failed to ${failingLabel} any example.${skippedNote} ${shown}`, `Kein Beispiel konnte ${failingLabel} werden.${skippedNote} ${shown}`));
    }
  }

  /**
   * Checks out the latest version of every example matching the current
   * filters (computor-org/issues#339).
   *
   * An existing local directory is not an error here - that was the complaint
   * in the issue. A clean working copy is simply replaced, because it is
   * provably identical to the snapshot it came from and nothing is lost. A
   * working copy with edits in it is the one thing a bulk re-checkout must not
   * touch, so it is skipped and named in the summary.
   */
  private async checkoutAllFilteredExamples(): Promise<void> {
    const examplesPath = this.getExamplesDir();
    if (!examplesPath) { return; }
    const versionsPath = this.getVersionsDir();
    if (!versionsPath) { return; }

    const merged = await this.treeProvider.getFilteredMergedExamples();
    if (!merged.some(m => m.remote)) {
      notify.info(say('No examples match the current filters.', 'Kein Beispiel passt zu den aktuellen Filtern.'));
      return;
    }

    const { selected: toCheckout, skipped } = LecturerExampleCommands.selectForCheckout(merged);

    if (toCheckout.length === 0) {
      notify.info(
        say(`Nothing checked out: all ${skipped.length} matching example(s) have local changes.`, `Nichts ausgecheckt: Alle ${skipped.length} passenden Beispiele haben lokale Änderungen.`)
      );
      return;
    }

    const detail = [
      this.describeScope(),
      '',
      say(`${toCheckout.length} example(s) will be checked out at their latest version, replacing any unmodified local copy.`, `${toCheckout.length} Beispiel(e) werden in der neuesten Version ausgecheckt; unveränderte lokale Kopien werden dabei ersetzt.`),
      skipped.length > 0
        ? say(`${skipped.length} will be left alone because they have local changes.`, `${skipped.length} bleiben unberührt, weil sie lokale Änderungen haben.`)
        : ''
    ].filter(Boolean).join('\n');

    const confirmed = await notify.confirm(
      say(`Checkout the latest version of ${toCheckout.length} example(s)?`, `Neueste Version von ${toCheckout.length} Beispiel(en) auschecken?`),
      say('Checkout', 'Auschecken'),
      detail
    );
    if (!confirmed) { return; }

    await notify.progress(say('Checking out examples', 'Beispiele werden ausgecheckt'), async (progress) => {
      let successCount = 0;
      const errors: string[] = [];

      for (let i = 0; i < toCheckout.length; i++) {
        const example = toCheckout[i]!;
        const remote = example.remote!;

        progress.report({
          increment: 100 / toCheckout.length,
          message: `(${i + 1}/${toCheckout.length}) ${remote.title}`
        });

        try {
          const exampleData = await this.apiService.downloadExample(remote.id, false);
          if (!exampleData) {
            errors.push(say(`${remote.title}: failed to download`, `${remote.title}: Herunterladen fehlgeschlagen`));
            continue;
          }

          const workingDir = getWorkingPath(examplesPath, remote.directory);
          if (fs.existsSync(workingDir)) {
            fs.rmSync(workingDir, { recursive: true, force: true });
          }
          fs.mkdirSync(workingDir, { recursive: true });
          writeExampleFiles(exampleData.files, workingDir);

          const metadata: CheckoutMetadata = {
            exampleId: remote.id,
            repositoryId: example.repositoryId ?? '',
            directory: remote.directory,
            versionId: exampleData.version_id || '',
            versionTag: exampleData.version_tag,
            versionNumber: 0,
            checkedOutAt: new Date().toISOString()
          };
          writeCheckoutMetadata(workingDir, metadata);

          // The snapshot is what the tree diffs the working copy against, so it
          // has to be refreshed alongside it or every example would come back
          // looking modified.
          snapshotWorkingToVersion(examplesPath, versionsPath, remote.directory, exampleData.version_tag);

          successCount++;
        } catch (error) {
          errors.push(`${remote.title}: ${error}`);
        }
      }

      this.treeProvider.refresh();
      this.reportBulkOutcome(
        say('Checked out', 'Ausgecheckt'), say('check out', 'ausgecheckt'),
        successCount, toCheckout.length, errors,
        skipped, say('they have local changes', 'sie lokale Änderungen haben')
      );
    });
  }

  /**
   * Removes local example data for the examples matching the current filters
   * (computor-org/issues#340).
   *
   * Two depths, because they answer different needs. The working-copy sweep
   * clears the editing area while keeping the snapshots, so a later checkout
   * still has something to diff against. The full sweep also drops
   * example_versions/, which is the only way an example leaves the tree
   * altogether -- a snapshot on its own is enough to keep a row alive.
   *
   * Neither touches an example showing as changed. That is the one guarantee
   * the issue asks for, and it holds at both depths.
   */
  private async cleanupFilteredExamples(includeVersions: boolean): Promise<void> {
    const examplesPath = this.getExamplesDir();
    if (!examplesPath) { return; }
    const versionsPath = includeVersions ? this.getVersionsDir() : undefined;
    if (includeVersions && !versionsPath) { return; }

    const merged = await this.treeProvider.getFilteredMergedExamples();
    const { selected: toDelete, skipped } =
      LecturerExampleCommands.selectForCleanup(merged, includeVersions);

    if (toDelete.length === 0) {
      notify.info(skipped.length > 0
        ? say(`Nothing to clean up: all ${skipped.length} matching example(s) have local changes.`, `Nichts aufzuräumen: Alle ${skipped.length} passenden Beispiele haben lokale Änderungen.`)
        : say('No checked-out examples match the current filters.', 'Kein ausgechecktes Beispiel passt zu den aktuellen Filtern.'));
      return;
    }

    const detail = [
      this.describeScope(),
      '',
      includeVersions
        ? say(`${toDelete.length} example(s) will lose their working copy in examples/ and every`, `${toDelete.length} Beispiel(e) verlieren ihre Arbeitskopie in examples/ und alle`)
        : say(`${toDelete.length} example(s) will have their working copy removed from examples/.`, `Bei ${toDelete.length} Beispiel(en) wird die Arbeitskopie aus examples/ entfernt.`),
      includeVersions
        ? say('version snapshot in example_versions/, and will disappear from the tree until', 'Versionsstände in example_versions/ und verschwinden aus dem Baum, bis sie')
        : say('Version snapshots under example_versions/ are kept, so an example that has any', 'Versionsstände unter example_versions/ bleiben erhalten, ein Beispiel mit solchen Ständen'),
      includeVersions
        ? say('checked out again.', 'erneut ausgecheckt werden.')
        : say('still shows in the tree with its versions under it.', 'erscheint also weiter im Baum, mit seinen Versionen darunter.'),
      skipped.length > 0
        ? say(`${skipped.length} will be kept because they have local changes.`, `${skipped.length} bleiben erhalten, weil sie lokale Änderungen haben.`)
        : ''
    ].filter(Boolean).join('\n');

    const confirmed = await notify.confirm(
      includeVersions
        ? say(`Delete all local data of ${toDelete.length} example(s)?`, `Alle lokalen Daten von ${toDelete.length} Beispiel(en) löschen?`)
        : say(`Delete the local working copy of ${toDelete.length} example(s)?`, `Lokale Arbeitskopie von ${toDelete.length} Beispiel(en) löschen?`),
      say('Delete', 'Löschen'),
      detail
    );
    if (!confirmed) { return; }

    let successCount = 0;
    const errors: string[] = [];
    for (const example of toDelete) {
      const group = example.local!;
      try {
        const workingDir = group.workingVersion?.fullPath ?? getWorkingPath(examplesPath, group.directory);
        fs.rmSync(workingDir, { recursive: true, force: true });
        if (versionsPath) {
          fs.rmSync(path.join(versionsPath, group.directory), { recursive: true, force: true });
        }
        successCount++;
      } catch (error) {
        errors.push(`${example.identifier}: ${error}`);
      }
    }

    this.treeProvider.refresh();
    this.reportBulkOutcome(
      say('Cleaned up', 'Aufgeräumt'), say('clean up', 'aufgeräumt'),
      successCount, toDelete.length, errors,
      skipped, say('they have local changes', 'sie lokale Änderungen haben')
    );
  }

  /**
   * Search and replace across every checked-out example matching the current
   * filters - VS Code's Replace All, widened from one folder to a filtered set
   * of examples (computor-org/issues#341).
   *
   * Only working copies under examples/ are rewritten, never the snapshots
   * under example_versions/. That is what makes the edited examples light up
   * as changed in the tree and arrive pre-ticked in Upload All Examples, which
   * is where the version bump is chosen. Nothing is bumped here.
   */
  private async replaceInFilteredExamples(): Promise<void> {
    const merged = await this.treeProvider.getFilteredMergedExamples();
    const targets: ReplaceTarget[] = merged
      .filter(m => m.local?.workingVersion)
      .map(m => ({ directory: m.identifier, dirPath: m.local!.workingVersion!.fullPath }));

    if (targets.length === 0) {
      notify.info(say('No checked-out examples match the current filters. Run "Checkout Latest (Filtered)" first.', 'Kein ausgechecktes Beispiel passt zu den aktuellen Filtern. Führe zuerst „Neueste Versionen auschecken (gefiltert)“ aus.'));
      return;
    }

    const options = await this.promptForReplacement(targets.length);
    if (!options) { return; }

    const plans = await notify.progress(
      say('Searching examples', 'Beispiele werden durchsucht'),
      async () => planReplacements(targets, options)
    );

    const { files, replacements } = totalHits(plans);
    if (replacements === 0) {
      notify.info(say(`No matches for "${options.find}" in ${targets.length} example(s).`, `Keine Treffer für „${options.find}“ in ${targets.length} Beispiel(en).`));
      return;
    }

    const preview = plans.slice(0, 10)
      .map(plan => say(`  ${plan.directory}: ${plan.total} in ${plan.files.length} file(s)`, `  ${plan.directory}: ${plan.total} in ${plan.files.length} Datei(en)`));
    if (plans.length > 10) {
      preview.push(say(`  ...and ${plans.length - 10} more`, `  … und ${plans.length - 10} weitere`));
    }

    const detail = [
      this.describeScope(),
      '',
      ...preview,
      '',
      say('Only working copies under examples/ are rewritten. Version snapshots are left alone,', 'Nur Arbeitskopien unter examples/ werden geändert. Versionsstände bleiben unberührt,'),
      say('and no version is bumped - choose that in Upload All Examples.', 'und keine Version wird erhöht; das wählst du unter „Alle Beispiele hochladen“.')
    ].join('\n');

    const confirmed = await notify.confirm(
      say(`Replace ${replacements} occurrence(s) across ${files} file(s) in ${plans.length} example(s)?`, `${replacements} Vorkommen in ${files} Datei(en) von ${plans.length} Beispiel(en) ersetzen?`),
      say('Replace', 'Ersetzen'),
      detail
    );
    if (!confirmed) { return; }

    const summary = await notify.progress(
      say('Replacing in examples', 'In Beispielen wird ersetzt'),
      async () => applyReplacements(plans, options)
    );
    this.treeProvider.refresh();

    if (summary.errors.length === 0) {
      notify.info(
        say(`Replaced ${summary.replacements} occurrence(s) in ${summary.files} file(s) across ${summary.examples} example(s).`, `${summary.replacements} Vorkommen in ${summary.files} Datei(en) von ${summary.examples} Beispiel(en) ersetzt.`)
      );
      return;
    }

    const shown = summary.errors.length > 3
      ? summary.errors.slice(0, 3).join('; ') + '...'
      : summary.errors.join('; ');
    if (summary.replacements > 0) {
      notify.warning(
        say(`Replaced ${summary.replacements} occurrence(s) in ${summary.files} file(s). Errors: ${shown}`, `${summary.replacements} Vorkommen in ${summary.files} Datei(en) ersetzt. Fehler: ${shown}`)
      );
    } else {
      notify.error(say(`Failed to replace anything. ${shown}`, `Es konnte nichts ersetzt werden. ${shown}`));
    }
  }

  private async promptForReplacement(exampleCount: number): Promise<ReplaceOptions | undefined> {
    const state = { regex: false, matchCase: false };

    const find = await this.showToggleInput({
      label: say('Find', 'Suchen'),
      prompt: say(`Text to find across ${exampleCount} checked-out example(s)`, `Text, der in ${exampleCount} ausgecheckten Beispiel(en) gesucht wird`),
      state,
      validate: (value) => {
        if (!value) { return say('Enter the text to find.', 'Gib den Suchtext ein.'); }
        if (!state.regex) { return undefined; }
        try {
          new RegExp(value);
          return undefined;
        } catch (error) {
          return say(`Invalid regular expression: ${error instanceof Error ? error.message : String(error)}`, `Ungültiger regulärer Ausdruck: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    });
    if (find === undefined) { return undefined; }

    const replace = await this.showToggleInput({
      label: say('Replace with', 'Ersetzen durch'),
      prompt: state.regex
        ? say('Replacement text - $1, $2 refer to capture groups. Empty deletes the matches.', 'Ersetzungstext; $1, $2 verweisen auf Gruppen. Leer löscht die Treffer.')
        : say('Replacement text. Empty deletes the matches.', 'Ersetzungstext. Leer löscht die Treffer.'),
      state,
      allowEmpty: true
    });
    if (replace === undefined) { return undefined; }

    return { find, replace, regex: state.regex, matchCase: state.matchCase };
  }

  /**
   * An input box carrying VS Code's two find toggles.
   *
   * Quick-input buttons have no on/off styling of their own, so the current
   * state is spelled out in the title as well - otherwise a lecturer cannot
   * tell whether they are about to run a regex across every example.
   */
  private showToggleInput(config: {
    label: string;
    prompt: string;
    state: { regex: boolean; matchCase: boolean };
    allowEmpty?: boolean;
    validate?: (value: string) => string | undefined;
  }): Promise<string | undefined> {
    return new Promise((resolve) => {
      const input = vscode.window.createInputBox();
      const caseButton: vscode.QuickInputButton = {
        iconPath: new vscode.ThemeIcon('case-sensitive'),
        tooltip: say('Toggle Match Case', 'Groß-/Kleinschreibung beachten ein/aus')
      };
      const regexButton: vscode.QuickInputButton = {
        iconPath: new vscode.ThemeIcon('regex'),
        tooltip: say('Toggle Use Regular Expression', 'Regulären Ausdruck verwenden ein/aus')
      };

      input.buttons = [caseButton, regexButton];
      input.prompt = config.prompt;
      input.placeholder = config.label;
      input.ignoreFocusOut = true;

      const applyTitle = () => {
        input.title = say(`${config.label} - regex: ${config.state.regex ? 'on' : 'off'}, match case: ${config.state.matchCase ? 'on' : 'off'}`, `${config.label} – regulärer Ausdruck: ${config.state.regex ? 'ein' : 'aus'}, Groß-/Kleinschreibung: ${config.state.matchCase ? 'ein' : 'aus'}`);
      };
      const revalidate = () => {
        input.validationMessage = config.validate ? config.validate(input.value) : undefined;
      };

      let settled = false;
      const finish = (value: string | undefined) => {
        if (settled) { return; }
        settled = true;
        resolve(value);
        input.hide();
      };

      input.onDidTriggerButton((button) => {
        if (button === regexButton) { config.state.regex = !config.state.regex; }
        if (button === caseButton) { config.state.matchCase = !config.state.matchCase; }
        applyTitle();
        revalidate();
      });
      input.onDidChangeValue(revalidate);
      input.onDidAccept(() => {
        const value = input.value;
        if (!value && !config.allowEmpty) {
          input.validationMessage = say(`Enter the text to ${config.label.toLowerCase()}.`, `Gib den Text für „${config.label}“ ein.`);
          return;
        }
        const problem = config.validate ? config.validate(value) : undefined;
        if (problem) {
          input.validationMessage = problem;
          return;
        }
        finish(value);
      });
      input.onDidHide(() => {
        finish(undefined);
        input.dispose();
      });

      applyTitle();
      input.show();
    });
  }

  private getExamplesDir(): string | undefined {
    try {
      const wsManager = WorkspaceStructureManager.getInstance();
      const examplesPath = wsManager.getExamplesPath();
      fs.mkdirSync(examplesPath, { recursive: true });
      return examplesPath;
    } catch {
      notify.error(say('No workspace folder open', 'Es ist kein Arbeitsbereichsordner geöffnet.'));
      return undefined;
    }
  }

  private getVersionsDir(): string | undefined {
    try {
      const wsManager = WorkspaceStructureManager.getInstance();
      const versionsPath = wsManager.getExampleVersionsPath();
      fs.mkdirSync(versionsPath, { recursive: true });
      return versionsPath;
    } catch {
      notify.error(say('No workspace folder open', 'Es ist kein Arbeitsbereichsordner geöffnet.'));
      return undefined;
    }
  }

  // Callers are the examples tree (`ExampleTreeItem`) and the example-details
  // webview, which posts a plain `{ example, repository }` payload instead of a
  // tree item. A local-only row — "Create New Example" that was never pushed —
  // has no remote at all, so the checked-out working copy is the only source of
  // directory / repository / example id.
  private async uploadExample(item: ExampleTreeItem): Promise<void> {
    const local = item?.merged?.local;
    const remote = item?.merged ? item.merged.remote : item?.example;

    const examplesPath = this.getExamplesDir();
    if (!examplesPath) { return; }

    const directory = local?.directory || remote?.directory;
    if (!directory) {
      notify.error(say('Invalid example item', 'Ungültiges Beispiel.'));
      return;
    }

    const workingDir = local?.workingVersion?.fullPath || getWorkingPath(examplesPath, directory);
    if (!fs.existsSync(workingDir)) {
      notify.error(say(`No working copy found. Check out the example first.`, `Keine Arbeitskopie gefunden. Checke das Beispiel zuerst aus.`));
      return;
    }

    const metadata = readCheckoutMetadata(workingDir);
    await this.uploadFromDirectory(
      workingDir, metadata?.directory || directory,
      item.repository?.id || metadata?.repositoryId || '',
      remote?.title || directory,
      metadata?.exampleId || remote?.id || ''
    );
  }

  private async uploadCheckedOutVersion(item: CheckedOutVersionTreeItem): Promise<void> {
    if (!item?.version) {
      notify.error(say('Invalid checked-out version', 'Ungültige ausgecheckte Version.'));
      return;
    }

    const v = item.version;
    await this.uploadFromDirectory(
      v.fullPath, v.metadata.directory, v.metadata.repositoryId,
      item.groupDirectory, v.metadata.exampleId
    );
  }

  private async uploadFromDirectory(
    dirPath: string, directory: string, repositoryId: string, title: string, exampleId: string
  ): Promise<void> {
    if (!fs.existsSync(dirPath)) {
      notify.error(say(`Directory not found: ${dirPath}`, `Verzeichnis nicht gefunden: ${dirPath}`));
      return;
    }

    // If repositoryId is missing, prompt the user to select one
    if (!repositoryId) {
      const repos = await this.apiService.getExampleRepositories();
      if (!repos || repos.length === 0) {
        notify.error(say('No example repositories found. Please create one first.', 'Keine Beispiel-Repositorys gefunden. Lege zuerst eines an.'));
        return;
      }

      if (repos.length === 1) {
        repositoryId = repos[0]!.id;
      } else {
        const picked = await vscode.window.showQuickPick(
          repos.map(r => ({ label: r.name, description: r.source_url, id: r.id })),
          { placeHolder: say('Select a repository for this example', 'Repository für dieses Beispiel auswählen') }
        );
        if (!picked) { return; }
        repositoryId = picked.id;
      }
    }

    const { readMetaYamlVersion, updateMetaYamlVersion } = await import('../utils/metaYamlHelpers');
    const { bumpVersion, normalizeSemVer } = await import('../utils/versionHelpers');

    // Fetch latest remote version for bump proposals
    let latestRemoteVersion: string | undefined;
    const isFirstUpload = !exampleId;
    if (!isFirstUpload) {
      try {
        const versions = await this.apiService.getExampleVersions(exampleId);
        if (versions.length > 0) {
          const latest = versions.reduce((a, b) => b.version_number > a.version_number ? b : a);
          latestRemoteVersion = normalizeSemVer(latest.version_tag);
        }
      } catch {
        // If we can't fetch versions, continue without remote version info
      }
    }

    const localVersion = normalizeSemVer(readMetaYamlVersion(dirPath) || '0.1.0');
    const baseVersion = latestRemoteVersion || localVersion;

    const patchBump = bumpVersion(baseVersion, 'patch');
    const minorBump = bumpVersion(baseVersion, 'minor');
    const majorBump = bumpVersion(baseVersion, 'major');

    let picked;
    if (isFirstUpload || !latestRemoteVersion) {
      picked = await vscode.window.showQuickPick([
        { label: say(`Use current: ${localVersion}`, `Aktuelle verwenden: ${localVersion}`), description: say('First upload', 'Erstes Hochladen'), version: localVersion },
        { label: `Patch: ${patchBump}`, description: say(`From ${baseVersion}`, `Von ${baseVersion}`), version: patchBump },
        { label: `Minor: ${minorBump}`, description: say(`From ${baseVersion}`, `Von ${baseVersion}`), version: minorBump },
        { label: `Major: ${majorBump}`, description: say(`From ${baseVersion}`, `Von ${baseVersion}`), version: majorBump },
        { label: say('Custom version...', 'Eigene Version …'), description: '', version: '' }
      ], { placeHolder: say(`Select version for first upload of "${title}"`, `Version für das erste Hochladen von „${title}“ auswählen`) });
    } else {
      const remoteLabel = say(`Latest remote: ${latestRemoteVersion}`, `Neueste auf dem Server: ${latestRemoteVersion}`);
      picked = await vscode.window.showQuickPick([
        { label: `Patch: ${patchBump}`, description: remoteLabel, version: patchBump },
        { label: `Minor: ${minorBump}`, description: remoteLabel, version: minorBump },
        { label: `Major: ${majorBump}`, description: remoteLabel, version: majorBump },
        { label: say('Custom version...', 'Eigene Version …'), description: remoteLabel, version: '' }
      ], { placeHolder: say(`Select version for "${title}" upload`, `Version für das Hochladen von „${title}“ auswählen`) });
    }

    if (!picked) { return; }

    let uploadVersion = picked.version;
    if (!uploadVersion) {
      const custom = await vscode.window.showInputBox({
        prompt: say('Enter version tag', 'Versionskennung eingeben'),
        placeHolder: 'e.g., 1.2.3',
        value: patchBump
      });
      if (!custom) { return; }
      uploadVersion = normalizeSemVer(custom);
    }

    const confirm = await notify.info(
      say(`Upload "${title}" as version ${uploadVersion}?`, `„${title}“ als Version ${uploadVersion} hochladen?`), say('Upload', 'Hochladen'), say('Cancel', 'Abbrechen')
    );
    if (confirm !== say('Upload', 'Hochladen')) { return; }

    // Update meta.yaml with the chosen version before uploading
    try {
      updateMetaYamlVersion(dirPath, uploadVersion);
    } catch (e) {
      notify.error(say(`Failed to update meta.yaml version: ${e}`, `Die Version in meta.yaml konnte nicht aktualisiert werden: ${e}`));
      return;
    }

    try {
      await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: say(`Uploading: ${title} [${uploadVersion}]`, `Wird hochgeladen: ${title} [${uploadVersion}]`),
        cancellable: false
      }, async (progress) => {
        progress.report({ increment: 10, message: say('Packaging as zip...', 'Wird als ZIP gepackt …') });

        const zipper = new JSZip();
        const addToZip = (currentDir: string, basePath: string) => {
          const entries = fs.readdirSync(currentDir);
          for (const entry of entries) {
            if (shouldExcludeExampleEntry(entry)) continue;
            const fullPath = path.join(currentDir, entry);
            const stat = fs.statSync(fullPath);
            const relativePath = path.relative(basePath, fullPath).replace(/\\/g, '/');
            if (stat.isFile()) {
              zipper.file(relativePath, fs.readFileSync(fullPath));
            } else if (stat.isDirectory()) {
              addToZip(fullPath, basePath);
            }
          }
        };
        addToZip(dirPath, dirPath);

        const base64Zip = await zipper.generateAsync({ type: 'base64', compression: 'DEFLATE' });
        progress.report({ increment: 30, message: say('Uploading...', 'Wird hochgeladen …') });

        const zipName = `${directory}.zip`;
        const uploadRequest: ExampleUploadRequest = {
          repository_id: repositoryId,
          directory,
          files: { [zipName]: base64Zip }
        };

        const result = await this.apiService.uploadExample(uploadRequest);
        if (!result) {
          throw new Error(say('Upload failed - no response from server', 'Hochladen fehlgeschlagen: keine Antwort vom Server'));
        }

        const returnedExampleId = (result as any).example_id || exampleId;

        progress.report({ increment: 20, message: say('Downloading version snapshot...', 'Versionsstand wird heruntergeladen …') });

        // Download the newly created version from the API to create a clean snapshot
        const examplesPath = this.getExamplesDir();
        const versionsPath = this.getVersionsDir();
        let uploadedVersionId = '';
        let uploadedVersionNumber = 0;

        if (examplesPath && versionsPath) {
          try {
            // Find the version we just uploaded
            const updatedVersions = await this.apiService.getExampleVersions(returnedExampleId);
            const uploadedVersion = updatedVersions.find(v => normalizeSemVer(v.version_tag) === uploadVersion);

            if (uploadedVersion) {
              uploadedVersionId = uploadedVersion.id;
              uploadedVersionNumber = uploadedVersion.version_number;

              const downloadedData = await this.apiService.downloadExampleVersion(uploadedVersion.id);
              if (downloadedData) {
                const versionDir = getVersionPath(versionsPath, directory, uploadVersion);
                if (fs.existsSync(versionDir)) {
                  fs.rmSync(versionDir, { recursive: true, force: true });
                }
                fs.mkdirSync(versionDir, { recursive: true });
                writeExampleFiles(downloadedData.files, versionDir);

                const existingMeta = readCheckoutMetadata(dirPath);
                if (existingMeta) {
                  writeCheckoutMetadata(versionDir, {
                    ...existingMeta,
                    exampleId: returnedExampleId,
                    repositoryId,
                    versionTag: uploadVersion,
                    versionId: uploadedVersion.id,
                    versionNumber: uploadedVersion.version_number,
                    checkedOutAt: new Date().toISOString()
                  });
                }
              }
            } else {
              // Fallback: snapshot from local files
              const snapshotDir = snapshotWorkingToVersion(examplesPath, versionsPath, directory, uploadVersion);
              const existingMeta = readCheckoutMetadata(dirPath);
              if (existingMeta) {
                writeCheckoutMetadata(snapshotDir, {
                  ...existingMeta,
                  exampleId: returnedExampleId,
                  repositoryId,
                  versionTag: uploadVersion,
                  checkedOutAt: new Date().toISOString()
                });
              }
            }
          } catch (snapError) {
            console.warn('Failed to create version snapshot:', snapError);
          }

          // Update working copy metadata to reflect uploaded version
          const existingMeta = readCheckoutMetadata(dirPath);
          if (existingMeta) {
            writeCheckoutMetadata(dirPath, {
              ...existingMeta,
              exampleId: returnedExampleId,
              repositoryId,
              versionTag: uploadVersion,
              versionId: uploadedVersionId || existingMeta.versionId,
              versionNumber: uploadedVersionNumber || existingMeta.versionNumber,
              checkedOutAt: new Date().toISOString()
            });
          }
        }

        progress.report({ increment: 20, message: say('Complete!', 'Fertig.') });
        notify.info(say(`Successfully uploaded: ${title} [${uploadVersion}]`, `Hochgeladen: ${title} [${uploadVersion}]`));
        this.treeProvider.refresh();
        vscode.commands.executeCommand('computor.lecturer.refresh');
      });
    } catch (error) {
      console.error('Failed to upload example:', error);
      notify.error(say(`Failed to upload: ${error}`, `Hochladen fehlgeschlagen: ${error}`));
    }
  }

  private async createExampleRepository(): Promise<void> {
    const name = await vscode.window.showInputBox({
      prompt: say('Example Repository name', 'Name des Beispiel-Repositorys'),
      placeHolder: say('e.g., Default Examples', 'z. B. Standardbeispiele'),
      validateInput: (value) => (value && value.trim() ? undefined : say('A name is required', 'Ein Name ist erforderlich.'))
    });
    if (!name) { return; }

    const sourceTypePick = await vscode.window.showQuickPick(
      [
        { label: say('MinIO (uploadable)', 'MinIO (Hochladen möglich)'), value: 'minio' },
        { label: say('S3 (uploadable)', 'S3 (Hochladen möglich)'), value: 's3' },
        { label: say('Git (read-only — synced via push)', 'Git (nur lesen, Abgleich per Push)'), value: 'git' }
      ],
      { placeHolder: say('Select the repository source type', 'Quelltyp des Repositorys auswählen') }
    );
    if (!sourceTypePick) { return; }
    const sourceType = sourceTypePick.value;

    const isObjectStore = sourceType === 'minio' || sourceType === 's3';
    const sourceUrl = await vscode.window.showInputBox({
      prompt: isObjectStore ? say('Bucket (source URL)', 'Bucket (Quell-URL)') : 'Git URL',
      placeHolder: isObjectStore ? say('e.g., computor-storage', 'z. B. computor-storage') : say('e.g., https://git.example.com/org/examples.git', 'z. B. https://git.example.com/org/examples.git'),
      value: isObjectStore ? 'computor-storage' : '',
      // First path segment is the bucket for minio/s3; must be unique across repositories.
      validateInput: (value) => (value && value.trim() ? undefined : say('A source URL is required', 'Eine Quell-URL ist erforderlich.'))
    });
    if (!sourceUrl) { return; }

    const description = await vscode.window.showInputBox({
      prompt: say('Description (optional)', 'Beschreibung (optional)'),
      placeHolder: say('What does this repository contain?', 'Was enthält dieses Repository?')
    });
    if (description === undefined) { return; }

    const payload: ExampleRepositoryCreate = {
      name: name.trim(),
      source_type: sourceType,
      source_url: sourceUrl.trim(),
      description: description.trim() || null
    };

    try {
      const repo = await this.apiService.createExampleRepository(payload);
      notify.info(say(`Example repository "${repo.name}" created.`, `Das Beispiel-Repository „${repo.name}“ wurde angelegt.`));
      try { this.apiService.clearExamplesCache(); } catch {}
      this.treeProvider.refresh();
    } catch (error: any) {
      notify.error(say(`Failed to create example repository: ${error?.message || error}`, `Das Beispiel-Repository konnte nicht angelegt werden: ${error?.message || error}`));
    }
  }

  private async createNewExample(): Promise<void> {
    const examplesPath = this.getExamplesDir();
    if (!examplesPath) { return; }

    const title = await vscode.window.showInputBox({
      prompt: say('Example Title', 'Titel des Beispiels'),
      placeHolder: say('Enter a title for the new example', 'Titel für das neue Beispiel eingeben')
    });
    if (!title) { return; }

    const identifier = await vscode.window.showInputBox({
      prompt: say('Example Identifier (ltree: letters, digits, dots, underscores)', 'Kennung des Beispiels (ltree: Buchstaben, Ziffern, Punkte, Unterstriche)'),
      placeHolder: say('e.g., hello.world.basic', 'z. B. hello.world.basic'),
      value: title.toLowerCase().replace(/\s+/g, '.'),
      validateInput: (value) => {
        if (!/^[a-zA-Z0-9._]+$/.test(value)) {
          return say('Only letters, digits, dots, and underscores allowed (ltree format)', 'Erlaubt sind nur Buchstaben, Ziffern, Punkte und Unterstriche (ltree-Format).');
        }
        return undefined;
      }
    });
    if (!identifier) { return; }

    try {
      const existingExamples = await this.apiService.getExamples();
      if (existingExamples.some(e => e.identifier === identifier)) {
        notify.error(say(`Example identifier "${identifier}" is already in use.`, `Die Kennung „${identifier}“ ist bereits vergeben.`));
        return;
      }
    } catch {
      const proceed = await notify.warning(
        say('Could not verify identifier uniqueness. Continue anyway?', 'Es ließ sich nicht prüfen, ob die Kennung eindeutig ist. Trotzdem fortfahren?'),
        say('Continue', 'Fortfahren'), say('Cancel', 'Abbrechen')
      );
      if (proceed !== say('Continue', 'Fortfahren')) { return; }
    }

    const directory = identifier;

    // Select target repository for future uploads
    let repositoryId = '';
    try {
      const repositories = await this.apiService.getExampleRepositories();
      if (repositories.length > 0) {
        const picked = await vscode.window.showQuickPick(
          repositories.map(r => ({ label: r.name, description: r.description || undefined, id: r.id })),
          { placeHolder: say('Select target repository for this example', 'Ziel-Repository für dieses Beispiel auswählen') }
        );
        if (!picked) { return; }
        repositoryId = picked.id;
      }
    } catch {
      // Continue without repository — user can pick one on upload
    }

    // Select language
    let languages: { code: string; name: string }[];
    try {
      languages = await this.apiService.getLanguages();
    } catch {
      languages = [{ code: 'en', name: say('English', 'Englisch') }, { code: 'de', name: say('German', 'Deutsch') }];
    }

    const hasEnglish = languages.some(l => l.code === 'en');
    const sortedLanguages = hasEnglish
      ? [languages.find(l => l.code === 'en')!, ...languages.filter(l => l.code !== 'en')]
      : languages;

    const pickedLang = await vscode.window.showQuickPick(
      sortedLanguages.map(l => ({ label: l.name, description: l.code, langCode: l.code })),
      { placeHolder: say('Select language for this example', 'Sprache für dieses Beispiel auswählen') }
    );
    if (!pickedLang) { return; }

    const workingDir = getWorkingPath(examplesPath, directory);
    if (fs.existsSync(workingDir)) {
      notify.error(say(`Local example "${directory}" already exists.`, `Das lokale Beispiel „${directory}“ existiert bereits.`));
      return;
    }

    try {
      fs.mkdirSync(workingDir, { recursive: true });

      const meta: CodeAbilityMeta = {
        slug: identifier,
        version: '0.1.0',
        title,
        description: 'Example description here',
        language: pickedLang.langCode,
        license: 'MIT',
        authors: [],
        maintainers: [],
        links: [],
        supportingMaterial: [],
        // Both drive the Examples filters: keywords become the example's tags,
        // category groups it (computor-org/issues#358).
        keywords: [],
        category: '',
        properties: {
          studentSubmissionFiles: [],
          additionalFiles: [],
          testFiles: [],
          studentTemplates: []
        }
      };
      const metaContent = yaml.dump(meta, { indent: 2, lineWidth: 120, noRefs: true, sortKeys: false, quotingType: "'", forceQuotes: false });
      fs.writeFileSync(path.join(workingDir, 'meta.yaml'), metaContent);

      fs.mkdirSync(path.join(workingDir, 'content'), { recursive: true });
      fs.mkdirSync(path.join(workingDir, 'content', 'mediaFiles'), { recursive: true });
      fs.writeFileSync(path.join(workingDir, 'content', `index_${pickedLang.langCode}.md`), `# ${title}\n`, 'utf8');

      const metadata: CheckoutMetadata = {
        exampleId: '',
        repositoryId,
        directory,
        versionId: '',
        versionTag: '0.1.0',
        versionNumber: 0,
        checkedOutAt: new Date().toISOString()
      };
      writeCheckoutMetadata(workingDir, metadata);

      this.treeProvider.refreshAndExpand(directory);

      notify.info(say(`Created new example "${title}" — checked out locally.`, `Das neue Beispiel „${title}“ wurde angelegt und lokal ausgecheckt.`));
    } catch (error) {
      notify.error(say(`Failed to create example: ${error}`, `Das Beispiel konnte nicht angelegt werden: ${error}`));
    }
  }

  /**
   * Upload a new example from meta.yaml
   */
  private async uploadNewExample(): Promise<void> {
    // Find meta.yaml files in workspace
    const metaFiles = await vscode.workspace.findFiles('**/meta.yaml', '**/node_modules/**');
    
    if (metaFiles.length === 0) {
      notify.error(say('No meta.yaml files found in workspace', 'Im Arbeitsbereich gibt es keine meta.yaml-Dateien.'));
      return;
    }

    let metaFile: vscode.Uri | undefined;
    
    if (metaFiles.length === 1) {
      metaFile = metaFiles[0];
    } else {
      // Let user choose
      const items = metaFiles.map(file => ({
        label: path.basename(path.dirname(file.fsPath)),
        description: file.fsPath,
        uri: file
      }));

      const selected = await vscode.window.showQuickPick(items, {
        placeHolder: say('Select meta.yaml file to upload', 'meta.yaml zum Hochladen auswählen')
      });

      if (!selected) {
        return;
      }

      if (!selected) {
        return;
      }
      metaFile = selected.uri;
    }

    if (!metaFile) {
      return;
    }
    
    notify.info(say(`Uploading example from ${metaFile.fsPath} - not yet fully implemented`, `Hochladen eines Beispiels aus ${metaFile.fsPath} ist noch nicht vollständig umgesetzt.`));
  }

  /**
   * Upload examples from a ZIP file to a repository
   */
  private async uploadExamplesFromZip(item?: ExampleRepositoryTreeItem): Promise<void> {
    try {
      // Get repository - either from selected item or ask user
      let repositoryId: string;
      let repositoryName: string;
      
      if (item && item.repository) {
        repositoryId = item.repository.id;
        repositoryName = item.repository.name;
      } else {
        // Ask user to select a repository
        const repositories = await this.apiService.getExampleRepositories();
        if (repositories.length === 0) {
          notify.error(say('No example repositories available', 'Keine Beispiel-Repositorys verfügbar.'));
          return;
        }
        
        const selected = await vscode.window.showQuickPick(
          repositories.map(r => ({
            label: r.name,
            description: r.description || undefined,
            id: r.id
          })),
          { placeHolder: say('Select repository to upload examples to', 'Repository zum Hochladen der Beispiele auswählen') }
        );
        
        if (!selected) {
          return;
        }
        
        repositoryId = selected.id;
        repositoryName = selected.label;
      }

      // Show file picker for ZIP file
      const zipFileUri = await vscode.window.showOpenDialog({
        canSelectFiles: true,
        canSelectFolders: false,
        canSelectMany: false,
        filters: {
          [say('ZIP Archives', 'ZIP-Archive')]: ['zip']
        },
        title: say('Select ZIP file containing examples', 'ZIP-Datei mit Beispielen auswählen')
      });

      if (!zipFileUri || zipFileUri.length === 0) {
        return;
      }

      const firstFile = zipFileUri[0];
      if (!firstFile) {
        return;
      }
      const zipFilePath = firstFile.fsPath;
      const zipFileName = path.basename(zipFilePath);

      // Read the ZIP file
      const zipContent = await fs.promises.readFile(zipFilePath);
      const zip = new JSZip();

      await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: say(`Processing ${zipFileName}`, `${zipFileName} wird verarbeitet`),
        cancellable: false
      }, async (progress) => {
        progress.report({ increment: 0, message: say('Loading ZIP file...', 'ZIP-Datei wird geladen …') });

        // Load the ZIP content
        const loadedZip = await zip.loadAsync(zipContent);

        // Find all directories that contain meta.yaml files
        const allPaths = Object.keys(loadedZip.files).filter(path => 
          !path.startsWith('__MACOSX/') && 
          !path.includes('/.') && // Exclude hidden files/directories
          !path.endsWith('.meta.yaml') // Exclude .meta.yaml (local version tracking)
        );
        
        const metaYamlPaths = allPaths.filter(path => path.endsWith('meta.yaml'));
        
        if (metaYamlPaths.length === 0) {
          throw new Error(say('No meta.yaml files found in the ZIP archive', 'Das ZIP-Archiv enthält keine meta.yaml-Dateien.'));
        }

        progress.report({ increment: 20, message: say(`Found ${metaYamlPaths.length} example(s)...`, `${metaYamlPaths.length} Beispiel(e) gefunden …`) });

        // Process each example (we will re-zip each directory individually)
        const examples: Array<{
          directory: string;
          title: string;
          identifier: string;
          slug: string;
          dependencies: string[];
          zipBase64: string;
          zipName: string;
        }> = [];

        for (const metaPath of metaYamlPaths) {
          const directoryPath = metaPath.replace('/meta.yaml', '');
          const directoryName = directoryPath.includes('/') ? 
            directoryPath.split('/').pop()! : directoryPath;

          // Read meta.yaml content
          const metaFile = loadedZip.files[metaPath];
          if (!metaFile) {
            console.warn(`Skipping ${directoryPath}: meta.yaml file not found in ZIP`);
            continue;
          }
          const metaContent = await metaFile.async('string');
          const metaData = yaml.load(metaContent) as any;

          if (!metaData) {
            console.warn(`Skipping ${directoryPath}: Failed to parse meta.yaml`);
            continue;
          }

          // Create a new zip for this example's directory
          const exampleZip = new JSZip();
          const directoryPrefix = directoryPath === directoryName ? `${directoryName}/` : `${directoryPath}/`;

          for (const [filePath, zipEntry] of Object.entries(loadedZip.files)) {
            const entry = zipEntry as JSZip.JSZipObject;
            if (!entry.dir && filePath.startsWith(directoryPrefix) &&
                !filePath.startsWith('__MACOSX/') && !filePath.includes('/.') &&
                !filePath.endsWith('.meta.yaml')) {
              const relativePath = filePath.substring(directoryPrefix.length);
              try {
                const content = await entry.async('uint8array');
                exampleZip.file(relativePath, content);
              } catch (err) {
                console.warn(`Failed to add ${filePath} to zip:`, err);
              }
            }
          }

          const base64Zip = await exampleZip.generateAsync({ type: 'base64', compression: 'DEFLATE' });
          const zipName = `${directoryName}.zip`;

          // Determine slug/identifier and dependencies
          const slug = (metaData?.slug || metaData?.identifier || directoryName).toString();
          let deps: string[] = [];
          const td = metaData?.testDependencies ?? metaData?.properties?.testDependencies;
          if (Array.isArray(td)) {
            deps = td.map((d: any) => {
              if (typeof d === 'string') return d.toString();
              if (d && typeof d === 'object') {
                return (d.slug || d.identifier || '').toString();
              }
              return '';
            }).filter(Boolean);
          }

          examples.push({
            directory: directoryName,
            title: metaData?.title || directoryName,
            identifier: metaData?.identifier || metaData?.slug || directoryName,
            slug,
            dependencies: deps,
            zipBase64: base64Zip,
            zipName
          });
        }

        if (examples.length === 0) {
          throw new Error(say('No valid examples found in ZIP file', 'Die ZIP-Datei enthält keine gültigen Beispiele.'));
        }

        // Show selection dialog with all items preselected
        const quickPickItems = examples.map(ex => ({
          label: ex.title,
          description: ex.identifier,
          detail: say(`will upload as ${ex.zipName}${ex.dependencies.length ? ` • deps: ${ex.dependencies.join(', ')}` : ''}`, `wird hochgeladen als ${ex.zipName}${ex.dependencies.length ? ` • Abhängigkeiten: ${ex.dependencies.join(', ')}` : ''}`),
          example: ex,
          picked: true  // Preselect all items
        }));

        const selectedItems = await vscode.window.showQuickPick(
          quickPickItems,
          {
            canPickMany: true,
            placeHolder: say(`Select examples to upload to ${repositoryName}`, `Beispiele zum Hochladen nach ${repositoryName} auswählen`),
            title: say('Select Examples to Upload', 'Beispiele zum Hochladen auswählen')
          }
        );

        if (!selectedItems || selectedItems.length === 0) {
          return;
        }

        // Compute dependency-aware order among selected examples
        const selectedExamples = selectedItems.map(si => si.example);
        const slugToExample = new Map<string, any>();
        for (const ex of selectedExamples) slugToExample.set(ex.slug, ex);

        // Kahn's algorithm: edges dep -> ex (only for deps present in selection)
        const indegree = new Map<string, number>();
        const adj = new Map<string, Set<string>>();
        const keyOf = (ex: any) => ex.slug;

        for (const ex of selectedExamples) {
          indegree.set(keyOf(ex), 0);
          adj.set(keyOf(ex), new Set());
        }
        for (const ex of selectedExamples) {
          for (const dep of ex.dependencies) {
            if (!slugToExample.has(dep)) continue; // Only order within selected set
            adj.get(dep)!.add(ex.slug);
            indegree.set(ex.slug, (indegree.get(ex.slug) || 0) + 1);
          }
        }

        // Initialize queue with stable order using the original selected order
        const queue: string[] = [];
        for (const ex of selectedExamples) {
          if ((indegree.get(ex.slug) || 0) === 0) queue.push(ex.slug);
        }

        const orderedSlugs: string[] = [];
        while (queue.length) {
          const u = queue.shift()!;
          orderedSlugs.push(u);
          for (const v of (adj.get(u) || [])) {
            indegree.set(v, (indegree.get(v) || 0) - 1);
            if ((indegree.get(v) || 0) === 0) queue.push(v);
          }
        }

        let uploadOrder = orderedSlugs.map(s => slugToExample.get(s)!).filter(Boolean);
        if (uploadOrder.length !== selectedExamples.length) {
          // Cycle or missing accounted nodes; append any remaining in original selection order
          const seen = new Set(uploadOrder.map(e => e.slug));
          for (const ex of selectedExamples) if (!seen.has(ex.slug)) uploadOrder.push(ex);
        }

        // Warn about missing dependencies not included in selection
        const missingSummary: string[] = [];
        const selectedSlugSet = new Set(selectedExamples.map(e => e.slug));
        for (const ex of selectedExamples) {
          const missing = ex.dependencies.filter(d => !selectedSlugSet.has(d));
          if (missing.length) missingSummary.push(`${ex.slug}: ${missing.join(', ')}`);
        }
        if (missingSummary.length) {
          notify.warning(say(`Some selected examples reference dependencies not in selection: ${missingSummary.slice(0,3).join('; ')}${missingSummary.length>3?' ...':''}`, `Einige ausgewählte Beispiele verweisen auf Abhängigkeiten außerhalb der Auswahl: ${missingSummary.slice(0,3).join('; ')}${missingSummary.length>3?' …':''}`));
        }

        progress.report({ increment: 40, message: say(`Uploading ${selectedItems.length} example(s) with dependency order...`, `${selectedItems.length} Beispiel(e) werden in der Reihenfolge ihrer Abhängigkeiten hochgeladen …`) });

        // Upload selected examples
        let successCount = 0;
        const errors: string[] = [];

        for (let i = 0; i < uploadOrder.length; i++) {
          const example = uploadOrder[i];
          
          progress.report({ 
            increment: 40 + (40 * i / uploadOrder.length), 
            message: say(`Uploading ${example.title}...`, `${example.title} wird hochgeladen …`) 
          });

          try {
            const uploadRequest: ExampleUploadRequest = {
              repository_id: repositoryId,
              directory: example.directory,
              files: { [example.zipName]: example.zipBase64 }
            };

            await this.apiService.uploadExample(uploadRequest);
            successCount++;
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            errors.push(`${example.title}: ${errorMsg}`);
            console.error(`Failed to upload ${example.title}:`, error);
          }
        }

        progress.report({ increment: 100, message: say('Complete!', 'Fertig.') });

        // Show results
        if (successCount === selectedItems.length) {
          notify.info(
            say(`Successfully uploaded ${successCount} example(s) to ${repositoryName}`, `${successCount} Beispiel(e) nach ${repositoryName} hochgeladen.`)
          );
        } else if (successCount > 0) {
          notify.warning(
            say(`Uploaded ${successCount} of ${selectedItems.length} examples. Errors: ${errors.join('; ')}`, `${successCount} von ${selectedItems.length} Beispielen hochgeladen. Fehler: ${errors.join('; ')}`)
          );
        } else {
          notify.error(
            say(`Failed to upload examples. Errors: ${errors.join('; ')}`, `Die Beispiele konnten nicht hochgeladen werden. Fehler: ${errors.join('; ')}`)
          );
        }

        // Refresh the tree to show new examples
        if (successCount > 0) {
          // Add a small delay to ensure the backend has processed the uploads
          await new Promise(resolve => setTimeout(resolve, 1000));
          
          this.treeProvider.refresh();
          vscode.commands.executeCommand('computor.lecturer.refresh');
        }
      });

    } catch (error) {
      console.error('Failed to upload examples from ZIP:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      notify.error(say(`Failed to upload examples: ${errorMessage}`, `Die Beispiele konnten nicht hochgeladen werden: ${errorMessage}`));
    }
  }

  /**
   * Create a course content (assignment) from an example
   */
  private async createCourseContentFromExample(item: ExampleTreeItem): Promise<void> {
    if (!item || !item.example) {
      notify.error(say('Invalid example item', 'Ungültiges Beispiel.'));
      return;
    }

    try {
      // Step 1: Get organizations, then course families and their courses
      const organizations = await this.apiService.getOrganizations();
      const allCourses: Array<{course: CourseList, familyTitle: string, orgTitle: string}> = [];
      
      for (const org of organizations) {
        const courseFamilies = await this.apiService.getCourseFamilies(org.id);
        for (const family of courseFamilies) {
          const courses = await this.apiService.getCourses(family.id);
          for (const course of courses) {
            allCourses.push({
              course,
              familyTitle: family.title || family.path,
              orgTitle: org.title || org.path
            });
          }
        }
      }
      
      if (allCourses.length === 0) {
        notify.error(say('No courses available', 'Keine Kurse verfügbar.'));
        return;
      }

      // Step 2: Let user select a course
      const courseSelection = await vscode.window.showQuickPick(
        allCourses.map(item => ({
          label: item.course.title || item.course.path,
          description: `${item.orgTitle} / ${item.familyTitle}`,
          detail: say(`Path: ${item.course.path}`, `Pfad: ${item.course.path}`),
          id: item.course.id
        })),
        {
          placeHolder: say('Select a course to add this example to', 'Kurs auswählen, dem dieses Beispiel hinzugefügt wird'),
          title: say('Select Course', 'Kurs auswählen')
        }
      );

      if (!courseSelection) {
        return;
      }

      // Step 3: Get content types for the selected course and filter for submittable ones
      const contentTypes = await this.apiService.getCourseContentTypes(courseSelection.id);
      
      // Fetch full details to check which are submittable
      const submittableTypes = [];
      for (const type of contentTypes) {
        try {
          const fullType = await this.apiService.getCourseContentType(type.id);
          if (fullType?.course_content_kind?.submittable) {
            submittableTypes.push({
              type: type,
              kindTitle: localizedKindTitle(fullType.course_content_kind_id, fullType.course_content_kind.title, uiLanguage()) || 'Assignment'
            });
          }
        } catch (error) {
          console.warn(`Failed to fetch content type details: ${error}`);
        }
      }

      if (submittableTypes.length === 0) {
        notify.error(say('No submittable content types available in this course. Please create an assignment-type content type first.', 'In diesem Kurs gibt es keinen Inhaltstyp mit Abgabe. Lege zuerst einen Inhaltstyp der Art Aufgabe an.'));
        return;
      }

      // Step 4: Let user select content type
      const contentTypeSelection = await vscode.window.showQuickPick(
        submittableTypes.map(st => ({
          label: st.type.title || st.type.slug,
          description: st.kindTitle,
          detail: say(`Color: ${st.type.color}`, `Farbe: ${st.type.color}`),
          id: st.type.id
        })),
        {
          placeHolder: say('Select content type for this assignment', 'Inhaltstyp für diese Aufgabe auswählen'),
          title: say('Select Content Type', 'Inhaltstyp auswählen')
        }
      );

      if (!contentTypeSelection) {
        return;
      }

      // Step 5: Get course contents to allow selection of parent unit (optional)
      const courseContents = await this.apiService.getCourseContents(courseSelection.id);
      
      // Filter for units (non-submittable content types that can have children)
      const units = [];
      for (const content of courseContents) {
        const contentType = contentTypes.find(t => t.id === content.course_content_type_id);
        if (contentType) {
          try {
            const fullType = await this.apiService.getCourseContentType(contentType.id);
            if (fullType?.course_content_kind && 
                !fullType.course_content_kind.submittable && 
                fullType.course_content_kind.has_descendants) {
              units.push({
                content: content,
                kindTitle: localizedKindTitle(fullType.course_content_kind_id, fullType.course_content_kind.title, uiLanguage()) || 'Unit'
              });
            }
          } catch (error) {
            console.warn(`Failed to fetch content type details: ${error}`);
          }
        }
      }

      // Step 6: Ask where to place the content (root or under a unit)
      let parentPath: string | undefined;
      
      if (units.length > 0) {
        const placementOptions = [
          { label: say('📁 Course Root', '📁 Oberste Ebene des Kurses'), description: say('Place at the root level of the course', 'Auf der obersten Ebene des Kurses einordnen'), path: undefined },
          ...units.map(unit => ({
            label: unit.content.title || unit.content.path,
            description: `${unit.kindTitle} - ${unit.content.path}`,
            path: unit.content.path
          }))
        ];

        const placementSelection = await vscode.window.showQuickPick(
          placementOptions,
          {
            placeHolder: say('Select where to place this assignment', 'Auswählen, wo diese Aufgabe eingeordnet wird'),
            title: say('Select Parent Location', 'Übergeordneten Ort auswählen')
          }
        );

        if (!placementSelection) {
          return;
        }
        
        parentPath = placementSelection.path;
      }

      // Step 7: Generate slug from example identifier
      const slug = item.example.identifier.replace(/\./g, '_').toLowerCase();
      
      // Step 8: Create the course content
      const position = await this.getNextPosition(courseSelection.id, parentPath, courseContents);
      const pathSegment = slug;
      const path = parentPath ? `${parentPath}.${pathSegment}` : pathSegment;
      
      // Check if path already exists
      if (courseContents.some(c => c.path === path)) {
        notify.error(say(`A content item with path '${path}' already exists.`, `Ein Inhalt mit dem Pfad „${path}“ existiert bereits.`));
        return;
      }

      const contentData: CourseContentCreate = {
        title: item.example.title,
        description: `Assignment based on example: ${item.example.identifier}`,
        path: path,
        position: position,
        course_id: courseSelection.id,
        course_content_type_id: contentTypeSelection.id,
        // Note: example_id removed - will be assigned after creation
        // No max_submissions / max_test_runs: an assignment is unlimited
        // unless a lecturer sets a limit. These used to be stamped with 10/100,
        // which silently capped every assignment created from an example.
      };

      // Step 1: Create the course content
      const createdContent = await this.apiService.createCourseContent(courseSelection.id, contentData);
      
      // Step 2: Assign the example version to the newly created content
      if (createdContent && createdContent.id) {
        // Get the full example with versions since item.example is ExampleList
        const fullExample = await this.apiService.getExample(item.example.id);
        
        // If we have versions, assign the latest one
        if (fullExample && fullExample.versions && fullExample.versions.length > 0) {
          const latestVersion = fullExample.versions.reduce((latest, current) => 
            current.version_number > latest.version_number ? current : latest
          );

          try {
            await this.apiService.lecturerAssignExample(
              createdContent.id,
              {
                example_identifier: fullExample.identifier,
                version_tag: latestVersion.version_tag
              }
            );
            // Trigger assignments sync for this single content
            try {
              await this.apiService.generateAssignments(courseSelection.id, {
                course_content_ids: [createdContent.id],
                overwrite_strategy: 'skip_if_exists',
                commit_message: `Initialize assignment from example ${fullExample.identifier || fullExample.title}`
              });
            } catch (e) {
              console.warn('Failed to trigger assignments generation after creating content:', e);
            }
            notify.info(
              say(`Successfully created assignment "${item.example.title}" with version ${latestVersion.version_tag} in course "${courseSelection.label}"`, `Die Aufgabe „${item.example.title}“ wurde mit Version ${latestVersion.version_tag} im Kurs „${courseSelection.label}“ angelegt.`)
            );
          } catch (assignError) {
            // Content was created but example assignment failed
            notify.warning(
              say(`Assignment "${item.example.title}" was created but example assignment failed: ${assignError}. You can assign it manually later.`, `Die Aufgabe „${item.example.title}“ wurde angelegt, aber das Beispiel konnte nicht zugewiesen werden: ${assignError}. Du kannst es später von Hand zuweisen.`)
            );
          }
        } else {
          // Content created but no versions available
          notify.warning(
            say(`Assignment "${item.example.title}" was created but no example versions were found. Please assign a version manually.`, `Die Aufgabe „${item.example.title}“ wurde angelegt, aber es wurden keine Beispielversionen gefunden. Weise eine Version von Hand zu.`)
          );
        }
      } else {
        notify.info(
          say(`Successfully created assignment "${item.example.title}" in course "${courseSelection.label}"`, `Die Aufgabe „${item.example.title}“ wurde im Kurs „${courseSelection.label}“ angelegt.`)
        );
      }

      // Refresh the lecturer tree if it's visible
      vscode.commands.executeCommand('computor.lecturer.refresh');
      
    } catch (error) {
      console.error('Failed to create content from example:', error);
      notify.error(say(`Failed to create assignment: ${error}`, `Die Aufgabe konnte nicht angelegt werden: ${error}`));
    }
  }

  private async revealExampleInExplorer(item: ExampleTreeItem): Promise<void> {
    if (!item?.example) { return; }
    const examplesPath = this.getExamplesDir();
    if (!examplesPath) { return; }
    const workingPath = getWorkingPath(examplesPath, item.example.directory);
    if (!fs.existsSync(workingPath)) {
      notify.error(say('Example is not checked out', 'Das Beispiel ist nicht ausgecheckt.'));
      return;
    }
    await vscode.commands.executeCommand('revealInExplorer', vscode.Uri.file(workingPath));
  }

  private async bumpCheckedOutVersion(item: CheckedOutVersionTreeItem): Promise<void> {
    if (!item?.version) { return; }

    const { readMetaYamlVersion, updateMetaYamlVersion } = await import('../utils/metaYamlHelpers');
    const { bumpVersion, normalizeSemVer } = await import('../utils/versionHelpers');

    const currentVersion = readMetaYamlVersion(item.version.fullPath);
    if (!currentVersion) {
      notify.error(say('No version field found in meta.yaml', 'In meta.yaml gibt es kein Feld „version“.'));
      return;
    }

    const normalized = normalizeSemVer(currentVersion);
    const patchBump = bumpVersion(currentVersion, 'patch');
    const minorBump = bumpVersion(currentVersion, 'minor');
    const majorBump = bumpVersion(currentVersion, 'major');

    const picked = await vscode.window.showQuickPick([
      { label: `Patch: ${normalized} -> ${patchBump}`, part: 'patch' as const, newVersion: patchBump },
      { label: `Minor: ${normalized} -> ${minorBump}`, part: 'minor' as const, newVersion: minorBump },
      { label: `Major: ${normalized} -> ${majorBump}`, part: 'major' as const, newVersion: majorBump }
    ], { placeHolder: say('Select version bump type', 'Art der Versionserhöhung auswählen') });

    if (!picked) { return; }

    updateMetaYamlVersion(item.version.fullPath, picked.newVersion);
    notify.info(say(`Version bumped: ${normalized} -> ${picked.newVersion}`, `Version erhöht: ${normalized} -> ${picked.newVersion}`));
    this.treeProvider.refresh();
  }

  private async deleteCheckedOutGroup(item: CheckedOutGroupTreeItem): Promise<void> {
    if (!item?.group) { return; }

    const confirm = await notify.warning(
      say(`Delete all local data of "${item.group.directory}"? This removes the working copy and all version snapshots.`, `Alle lokalen Daten von „${item.group.directory}“ löschen? Das entfernt die Arbeitskopie und alle Versionsstände.`),
      say('Delete', 'Löschen'), say('Cancel', 'Abbrechen')
    );
    if (confirm !== say('Delete', 'Löschen')) { return; }

    try {
      // Delete working copy from examples/
      if (fs.existsSync(item.group.fullPath)) {
        fs.rmSync(item.group.fullPath, { recursive: true, force: true });
      }
      // Delete version snapshots from example_versions/
      const versionsPath = this.getVersionsDir();
      if (versionsPath) {
        const versionsDir = path.join(versionsPath, item.group.directory);
        if (fs.existsSync(versionsDir)) {
          fs.rmSync(versionsDir, { recursive: true, force: true });
        }
      }
      this.treeProvider.refresh();
      notify.info(say(`Deleted: ${item.group.directory}`, `Gelöscht: ${item.group.directory}`));
    } catch (error) {
      notify.error(say(`Failed to delete: ${error}`, `Löschen fehlgeschlagen: ${error}`));
    }
  }

  private async deleteCheckedOutVersion(item: CheckedOutVersionTreeItem): Promise<void> {
    if (!item?.version) { return; }

    const label = item.version.isWorking ? say('working copy', 'Arbeitskopie') : say(`version ${item.version.versionTag}`, `Version ${item.version.versionTag}`);
    const confirm = await notify.warning(
      say(`Delete ${label} of "${item.groupDirectory}"?`, `${label} von „${item.groupDirectory}“ löschen?`),
      say('Delete', 'Löschen'), say('Cancel', 'Abbrechen')
    );
    if (confirm !== say('Delete', 'Löschen')) { return; }

    try {
      fs.rmSync(item.version.fullPath, { recursive: true, force: true });
      this.treeProvider.refresh();
      notify.info(say(`Deleted ${label}`, `${label} gelöscht.`));
    } catch (error) {
      notify.error(say(`Failed to delete: ${error}`, `Löschen fehlgeschlagen: ${error}`));
    }
  }

  private async restoreVersionToWorking(item: CheckedOutVersionTreeItem): Promise<void> {
    if (!item?.version || item.version.isWorking) { return; }

    const examplesPath = this.getExamplesDir();
    if (!examplesPath) { return; }

    const workingDir = getWorkingPath(examplesPath, item.groupDirectory);

    const confirm = await notify.warning(
      say(`Restore version ${item.version.versionTag} to working copy of "${item.groupDirectory}"? Any unsaved changes in the working directory will be lost.`, `Version ${item.version.versionTag} in die Arbeitskopie von „${item.groupDirectory}“ zurückholen? Nicht gespeicherte Änderungen im Arbeitsverzeichnis gehen verloren.`),
      say('Restore', 'Wiederherstellen'), say('Cancel', 'Abbrechen')
    );
    if (confirm !== say('Restore', 'Wiederherstellen')) { return; }

    try {
      if (fs.existsSync(workingDir)) {
        fs.rmSync(workingDir, { recursive: true, force: true });
      }
      fs.cpSync(item.version.fullPath, workingDir, { recursive: true });

      this.treeProvider.refresh();
      notify.info(say(`Restored ${item.version.versionTag} to working copy`, `${item.version.versionTag} in die Arbeitskopie zurückgeholt.`));
    } catch (error) {
      notify.error(say(`Failed to restore: ${error}`, `Wiederherstellen fehlgeschlagen: ${error}`));
    }
  }

  private async compareWithWorking(item: CheckedOutVersionTreeItem): Promise<void> {
    if (!item?.version || item.version.isWorking) { return; }

    const examplesPath = this.getExamplesDir();
    if (!examplesPath) { return; }

    const workingDir = getWorkingPath(examplesPath, item.groupDirectory);
    if (!fs.existsSync(workingDir)) {
      notify.warning(say('No working copy found to compare against.', 'Keine Arbeitskopie zum Vergleichen gefunden.'));
      return;
    }

    const versionDir = item.version.fullPath;
    const versionFiles = this.collectFiles(versionDir, versionDir);

    if (versionFiles.length === 0 && !fs.existsSync(workingDir)) {
      notify.info(say('No files found in version snapshot.', 'Der Versionsstand enthält keine Dateien.'));
      return;
    }

    const diff = computeExampleDiff(versionDir, workingDir);
    const modifiedSet = new Set(diff.modified);
    const addedSet = new Set(diff.added);
    const removedSet = new Set(diff.removed);

    interface Pick extends vscode.QuickPickItem { relativePath: string; existsInWorking: boolean; existsInVersion: boolean; }

    const picks: Pick[] = [];
    for (const rel of diff.modified) {
      picks.push({ label: `$(diff-modified) ${rel}`, description: say('modified', 'geändert'), relativePath: rel, existsInVersion: true, existsInWorking: true });
    }
    for (const rel of diff.added) {
      picks.push({ label: `$(diff-added) ${rel}`, description: say('added in working', 'in der Arbeitskopie hinzugefügt'), relativePath: rel, existsInVersion: false, existsInWorking: true });
    }
    for (const rel of diff.removed) {
      picks.push({ label: `$(diff-removed) ${rel}`, description: say('removed from working', 'aus der Arbeitskopie entfernt'), relativePath: rel, existsInVersion: true, existsInWorking: false });
    }

    const unchanged = versionFiles.filter(rel =>
      !modifiedSet.has(rel) && !addedSet.has(rel) && !removedSet.has(rel)
    );
    if (unchanged.length > 0) {
      if (picks.length > 0) {
        picks.push({ label: '', kind: vscode.QuickPickItemKind.Separator, relativePath: '', existsInVersion: false, existsInWorking: false });
      }
      for (const rel of unchanged) {
        picks.push({ label: rel, description: say('unchanged', 'unverändert'), relativePath: rel, existsInVersion: true, existsInWorking: true });
      }
    }

    const changedCount = diff.modified.length + diff.added.length + diff.removed.length;
    const placeHolder = changedCount === 0
      ? say('No differences with working copy. Pick a file to inspect anyway.', 'Keine Unterschiede zur Arbeitskopie. Wähle trotzdem eine Datei zum Ansehen.')
      : say(`${changedCount} change(s) — pick a file to open the diff`, `${changedCount} Änderung(en). Wähle eine Datei, um die Unterschiede zu öffnen`);

    const selected = await vscode.window.showQuickPick(picks, {
      placeHolder,
      title: say(`Compare ${item.version.versionTag} with working`, `${item.version.versionTag} mit der Arbeitskopie vergleichen`),
      matchOnDescription: true
    });

    if (!selected || !selected.relativePath) { return; }

    const versionFile = vscode.Uri.file(path.join(versionDir, selected.relativePath));
    const workingFile = vscode.Uri.file(path.join(workingDir, selected.relativePath));

    await vscode.commands.executeCommand('vscode.diff',
      versionFile, workingFile,
      say(`${selected.relativePath} (${item.version.versionTag} ↔ working)`, `${selected.relativePath} (${item.version.versionTag} ↔ Arbeitskopie)`)
    );
  }

  private async openDiffWithWorking(item: CheckedOutVersionTreeItem | CheckedOutGroupTreeItem | ExampleTreeItem): Promise<void> {
    const examplesPath = this.getExamplesDir();
    if (!examplesPath) { return; }
    const versionsPath = this.getVersionsDir();

    let versionDir: string | undefined;
    let groupDirectory: string | undefined;
    let versionTag: string | undefined;

    if (item instanceof CheckedOutVersionTreeItem) {
      if (item.version.isWorking) {
        notify.info(say('Pick a non-working version snapshot to diff against the working copy.', 'Wähle einen Versionsstand (nicht die Arbeitskopie), um ihn mit der Arbeitskopie zu vergleichen.'));
        return;
      }
      versionDir = item.version.fullPath;
      groupDirectory = item.groupDirectory;
      versionTag = item.version.versionTag;
    } else if (item instanceof CheckedOutGroupTreeItem) {
      const picked = this.pickSnapshotForGroup(item.group, versionsPath);
      if (!picked) { return; }
      versionDir = picked.versionDir;
      groupDirectory = item.group.directory;
      versionTag = picked.versionTag;
    } else if (item instanceof ExampleTreeItem) {
      const group = item.merged.local;
      if (!group) {
        notify.warning(say('This example is not checked out locally.', 'Dieses Beispiel ist lokal nicht ausgecheckt.'));
        return;
      }
      const picked = this.pickSnapshotForGroup(group, versionsPath);
      if (!picked) { return; }
      versionDir = picked.versionDir;
      groupDirectory = group.directory;
      versionTag = picked.versionTag;
    }

    if (!versionDir || !groupDirectory || !versionTag) {
      return;
    }

    const workingDir = getWorkingPath(examplesPath, groupDirectory);
    if (!fs.existsSync(workingDir)) {
      notify.warning(say('No working copy found to compare against.', 'Keine Arbeitskopie zum Vergleichen gefunden.'));
      return;
    }

    const diff = computeExampleDiff(versionDir, workingDir);
    const total = diff.modified.length + diff.added.length + diff.removed.length;
    if (total === 0) {
      notify.info(say(`No differences between ${versionTag} and the working copy.`, `Keine Unterschiede zwischen ${versionTag} und der Arbeitskopie.`));
      return;
    }

    // Build resource triples for the multi-file diff editor:
    //   [labelUri, leftUri, rightUri]
    // where labelUri is purely for grouping/sorting in the editor list.
    const emptyUri = vscode.Uri.file(path.join(versionDir, '__non_existent__'));
    const resources: Array<[vscode.Uri, vscode.Uri, vscode.Uri]> = [];

    for (const rel of diff.modified) {
      const left = vscode.Uri.file(path.join(versionDir, rel));
      const right = vscode.Uri.file(path.join(workingDir, rel));
      resources.push([right, left, right]);
    }
    for (const rel of diff.added) {
      const right = vscode.Uri.file(path.join(workingDir, rel));
      resources.push([right, emptyUri, right]);
    }
    for (const rel of diff.removed) {
      const left = vscode.Uri.file(path.join(versionDir, rel));
      // Use the version path as the label so it shows up in the file list.
      resources.push([left, left, emptyUri]);
    }

    const title = say(`${groupDirectory}: ${versionTag} ↔ working (${total} change${total === 1 ? '' : 's'})`, `${groupDirectory}: ${versionTag} ↔ Arbeitskopie (${total} ${total === 1 ? 'Änderung' : 'Änderungen'})`);
    try {
      await vscode.commands.executeCommand('vscode.changes', title, resources);
    } catch (err) {
      console.error('Failed to open multi-file diff editor:', err);
      notify.error(say(`Failed to open diff: ${err}`, `Die Unterschiede konnten nicht geöffnet werden: ${err}`));
    }
  }

  /**
   * For a checked-out group, picks the snapshot to diff the working copy
   * against. Prefers the snapshot the working copy was originally checked
   * out from (matches the dirty-badge logic), and falls back to the most
   * recent non-working snapshot if that one is gone.
   */
  private pickSnapshotForGroup(
    group: { directory: string; workingVersion?: { metadata: { versionTag: string } }; versions: { isWorking: boolean; versionTag: string; fullPath: string }[] },
    versionsPath: string | undefined
  ): { versionDir: string; versionTag: string } | undefined {
    if (versionsPath && group.workingVersion) {
      const sourceTag = group.workingVersion.metadata.versionTag;
      const sourceDir = getVersionPath(versionsPath, group.directory, sourceTag);
      if (fs.existsSync(sourceDir)) {
        return { versionDir: sourceDir, versionTag: sourceTag };
      }
    }
    const snapshots = group.versions.filter(v => !v.isWorking);
    if (snapshots.length === 0) {
      notify.warning(say('No version snapshots available to diff against.', 'Es gibt keine Versionsstände zum Vergleichen.'));
      return undefined;
    }
    const latest = snapshots[0]!;
    return { versionDir: latest.fullPath, versionTag: latest.versionTag };
  }

  private async compareFileWithWorking(item: FileSystemTreeItem): Promise<void> {
    if (!item || item.isDirectory) { return; }

    const examplesDir = this.getExamplesDir();
    if (!examplesDir) { return; }
    const versionsDir = this.getVersionsDir();
    if (!versionsDir) { return; }

    // Version files are in example_versions/<id>/<tag>/file
    const relativeToVersions = path.relative(versionsDir, item.filePath);
    const segments = relativeToVersions.split(path.sep);
    if (segments.length < 3) { return; }

    const exampleDirectory = segments[0]!;
    const relativeFile = segments.slice(2).join(path.sep);

    const workingDir = getWorkingPath(examplesDir, exampleDirectory);
    if (!fs.existsSync(workingDir)) {
      notify.warning(say('No working copy found to compare against.', 'Keine Arbeitskopie zum Vergleichen gefunden.'));
      return;
    }

    const workingFilePath = path.join(workingDir, relativeFile);
    const versionUri = vscode.Uri.file(item.filePath);

    if (!fs.existsSync(workingFilePath)) {
      const action = await notify.warning(
        say(`"${relativeFile}" does not exist in the working copy.`, `„${relativeFile}“ gibt es in der Arbeitskopie nicht.`),
        say('Open Version File', 'Datei der Version öffnen')
      );
      if (action === say('Open Version File', 'Datei der Version öffnen')) {
        await openFile(versionUri);
      }
      return;
    }

    const workingUri = vscode.Uri.file(workingFilePath);
    const versionLabel = segments[1];
    await vscode.commands.executeCommand('vscode.diff',
      versionUri, workingUri,
      `${relativeFile} (${versionLabel} ↔ working)`
    );
  }

  private collectFiles(dir: string, baseDir: string): string[] {
    const results: string[] = [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === '.computor-example.json') { continue; }
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...this.collectFiles(fullPath, baseDir));
      } else {
        results.push(path.relative(baseDir, fullPath));
      }
    }
    return results;
  }

  private async createFileOrFolder(item: FileSystemTreeItem | CheckedOutVersionTreeItem, isFolder: boolean): Promise<void> {
    let targetDir: string;
    if (item instanceof CheckedOutVersionTreeItem) {
      targetDir = item.version.fullPath;
    } else if (item.isDirectory) {
      targetDir = item.filePath;
    } else {
      targetDir = path.dirname(item.filePath);
    }

    const name = await vscode.window.showInputBox({
      prompt: isFolder ? say('Enter folder name', 'Ordnernamen eingeben') : say('Enter file name', 'Dateinamen eingeben'),
      placeHolder: isFolder ? 'new-folder' : 'new-file.txt'
    });
    if (!name) { return; }

    const targetPath = path.join(targetDir, name);
    if (fs.existsSync(targetPath)) {
      notify.error(say(`"${name}" already exists.`, `„${name}“ existiert bereits.`));
      return;
    }

    try {
      if (isFolder) {
        fs.mkdirSync(targetPath, { recursive: true });
      } else {
        fs.mkdirSync(path.dirname(targetPath), { recursive: true });
        fs.writeFileSync(targetPath, '', 'utf8');
        // The name comes from an input box, so the extension is whatever the
        // lecturer typed — open it the way the tree does, not as text.
        await openFile(targetPath);
      }
      this.treeProvider.refresh();
    } catch (error) {
      notify.error(say(`Failed to create: ${error}`, `Anlegen fehlgeschlagen: ${error}`));
    }
  }

  private async renameFileSystemItem(item: FileSystemTreeItem): Promise<void> {
    if (!item) { return; }

    const oldName = path.basename(item.filePath);
    const newName = await vscode.window.showInputBox({
      prompt: say(`Rename "${oldName}"`, `„${oldName}“ umbenennen`),
      value: oldName
    });
    if (!newName || newName === oldName) { return; }

    const newPath = path.join(path.dirname(item.filePath), newName);
    if (fs.existsSync(newPath)) {
      notify.error(say(`"${newName}" already exists.`, `„${newName}“ existiert bereits.`));
      return;
    }

    try {
      fs.renameSync(item.filePath, newPath);
      this.treeProvider.refresh();
    } catch (error) {
      notify.error(say(`Failed to rename: ${error}`, `Umbenennen fehlgeschlagen: ${error}`));
    }
  }

  private async deleteFileSystemItem(item: FileSystemTreeItem): Promise<void> {
    if (!item) { return; }

    const name = path.basename(item.filePath);
    const label = item.isDirectory ? say(`folder "${name}" and all its contents`, `Ordner „${name}“ samt Inhalt`) : say(`file "${name}"`, `Datei „${name}“`);
    const confirm = await notify.warning(
      say(`Delete ${label}?`, `${label} löschen?`), say('Delete', 'Löschen'), say('Cancel', 'Abbrechen')
    );
    if (confirm !== say('Delete', 'Löschen')) { return; }

    try {
      fs.rmSync(item.filePath, { recursive: true, force: true });
      this.treeProvider.refresh();
    } catch (error) {
      notify.error(say(`Failed to delete: ${error}`, `Löschen fehlgeschlagen: ${error}`));
    }
  }

  private async getNextPosition(courseId: string, parentPath: string | undefined, contents: CourseContentList[]): Promise<number> {
    void courseId;
    const sameLevelContents = contents.filter(c => {
      if (!parentPath) {
        return !c.path.includes('.');
      } else {
        if (!c.path.startsWith(parentPath + '.')) { return false; }
        const relativePath = c.path.substring(parentPath.length + 1);
        return !relativePath.includes('.');
      }
    });
    const maxPosition = sameLevelContents.reduce((max, c) => Math.max(max, c.position || 0), 0);
    return maxPosition + 1;
  }

  private async showExampleDetails(item: ExampleTreeItem): Promise<void> {
    if (!item?.example) {
      notify.error(say('Invalid example item', 'Ungültiges Beispiel.'));
      return;
    }

    const examplesPath = this.getExamplesDir();
    let downloadPath: string | undefined;
    let isDownloaded = false;
    let currentVersion: string | undefined;

    if (examplesPath) {
      const workingPath = getWorkingPath(examplesPath, item.example.directory);
      if (fs.existsSync(workingPath)) {
        downloadPath = workingPath;
        isDownloaded = true;
        const metadata = readCheckoutMetadata(workingPath);
        currentVersion = metadata?.versionTag;
      }
    }

    await this.exampleDetailProvider.show(say(`Example: ${item.example.title}`, `Beispiel: ${item.example.title}`), {
      example: item.example,
      repository: item.repository,
      isDownloaded,
      downloadPath,
      currentVersion
    });
  }

  private async editTestYaml(item: FileSystemTreeItem | CheckedOutVersionTreeItem): Promise<void> {
    let testYamlPath: string;
    let exampleDir: string;

    if (item instanceof CheckedOutVersionTreeItem) {
      if (!item?.version?.isWorking) {
        notify.error(say('Test configuration can only be edited on working copies', 'Die Testkonfiguration lässt sich nur in Arbeitskopien bearbeiten.'));
        return;
      }
      exampleDir = item.version.fullPath;
      testYamlPath = path.join(exampleDir, 'test.yaml');
      if (!fs.existsSync(testYamlPath)) {
        fs.writeFileSync(testYamlPath, '');
        this.treeProvider.refresh();
      }
    } else if (item instanceof FileSystemTreeItem) {
      if (!item?.filePath) {
        notify.error(say('Invalid file item', 'Ungültige Datei.'));
        return;
      }
      testYamlPath = item.filePath;
      exampleDir = path.dirname(testYamlPath);
    } else {
      notify.error(say('Invalid item', 'Ungültiges Element.'));
      return;
    }

    const metaYamlPath = path.join(exampleDir, 'meta.yaml');
    let exampleTitle: string | undefined;

    if (fs.existsSync(metaYamlPath)) {
      try {
        const metaContent = fs.readFileSync(metaYamlPath, 'utf8');
        const metaData = yaml.load(metaContent) as Record<string, unknown>;
        exampleTitle = metaData?.title as string;
      } catch {
        // Ignore meta.yaml parse errors
      }
    }

    await this.testYamlEditorProvider.show(
      say(`Test Editor: ${exampleTitle || path.basename(exampleDir)}`, `Test-Editor: ${exampleTitle || path.basename(exampleDir)}`),
      {
        filePath: testYamlPath,
        exampleDir,
        exampleTitle
      }
    );
  }

  private async addTests(item: CheckedOutVersionTreeItem): Promise<void> {
    if (!item?.version?.isWorking) {
      notify.error(say('Tests can only be added to working copies', 'Tests lassen sich nur zu Arbeitskopien hinzufügen.'));
      return;
    }

    const workingDir = item.version.fullPath;
    const testYamlPath = path.join(workingDir, 'test.yaml');

    if (fs.existsSync(testYamlPath)) {
      await this.editTestYaml(new FileSystemTreeItem(testYamlPath, false, 'test.yaml', true));
      return;
    }

    let exampleTitle: string | undefined;
    const metaYamlPath = path.join(workingDir, 'meta.yaml');
    if (fs.existsSync(metaYamlPath)) {
      try {
        const metaContent = fs.readFileSync(metaYamlPath, 'utf8');
        const metaData = yaml.load(metaContent) as Record<string, unknown>;
        exampleTitle = metaData?.title as string;
      } catch {
        // Ignore meta.yaml parse errors
      }
    }

    fs.writeFileSync(testYamlPath, '');
    this.treeProvider.refresh();

    await this.testYamlEditorProvider.show(
      say(`Test Editor: ${exampleTitle || path.basename(workingDir)}`, `Test-Editor: ${exampleTitle || path.basename(workingDir)}`),
      {
        filePath: testYamlPath,
        exampleDir: workingDir,
        exampleTitle
      }
    );
  }

  private async editMetaYaml(item: FileSystemTreeItem | CheckedOutVersionTreeItem): Promise<void> {
    let metaYamlPath: string;
    let exampleDir: string;

    if (item instanceof CheckedOutVersionTreeItem) {
      if (!item?.version?.isWorking) {
        notify.error(say('Meta configuration can only be edited on working copies', 'Die Metadaten lassen sich nur in Arbeitskopien bearbeiten.'));
        return;
      }
      exampleDir = item.version.fullPath;
      metaYamlPath = path.join(exampleDir, 'meta.yaml');
    } else if (item instanceof FileSystemTreeItem) {
      metaYamlPath = item.filePath;
      exampleDir = path.dirname(metaYamlPath);
    } else {
      notify.error(say('Invalid item', 'Ungültiges Element.'));
      return;
    }

    if (!fs.existsSync(metaYamlPath)) {
      notify.error(say('meta.yaml not found', 'meta.yaml nicht gefunden.'));
      return;
    }

    let exampleTitle: string | undefined;
    try {
      const metaContent = fs.readFileSync(metaYamlPath, 'utf8');
      const metaData = yaml.load(metaContent) as Record<string, unknown>;
      exampleTitle = metaData?.title as string;
    } catch {
      // Ignore parse errors
    }

    let languages: { code: string; name: string }[];
    try {
      languages = await this.apiService.getLanguages();
    } catch {
      languages = [{ code: 'en', name: say('English', 'Englisch') }, { code: 'de', name: say('German', 'Deutsch') }];
    }

    await this.metaYamlEditorProvider.show(
      say(`Meta Editor: ${exampleTitle || path.basename(exampleDir)}`, `Metadaten-Editor: ${exampleTitle || path.basename(exampleDir)}`),
      {
        filePath: metaYamlPath,
        exampleDir,
        exampleTitle,
        languages
      }
    );
  }

  private async createNewReadme(item: FileSystemTreeItem): Promise<void> {
    if (!item?.filePath || !item.isDirectory) {
      notify.error(say('Invalid content directory', 'Ungültiges Verzeichnis für den Inhalt.'));
      return;
    }

    let languages: { code: string; name: string }[];
    try {
      languages = await this.apiService.getLanguages();
    } catch {
      languages = [{ code: 'en', name: say('English', 'Englisch') }, { code: 'de', name: say('German', 'Deutsch') }];
    }

    // Find existing readmes to filter them out
    const existingFiles = fs.readdirSync(item.filePath);
    const existingLangs = new Set(
      existingFiles
        .filter(f => /^index_[a-z]{2}\.md$/.test(f))
        .map(f => f.replace('index_', '').replace('.md', ''))
    );

    const availableLanguages = languages.filter(l => !existingLangs.has(l.code));
    if (availableLanguages.length === 0) {
      notify.info(say('Readmes for all available languages already exist', 'Für alle verfügbaren Sprachen gibt es bereits eine README.'));
      return;
    }

    // Default to 'en' if available
    const hasEnglish = availableLanguages.some(l => l.code === 'en');
    const sortedLanguages = hasEnglish
      ? [availableLanguages.find(l => l.code === 'en')!, ...availableLanguages.filter(l => l.code !== 'en')]
      : availableLanguages;

    const picked = await vscode.window.showQuickPick(
      sortedLanguages.map(l => ({ label: l.name, description: l.code, langCode: l.code })),
      { placeHolder: say('Select language for the readme', 'Sprache für die README auswählen') }
    );

    if (!picked) { return; }

    const filename = `index_${picked.langCode}.md`;
    const filePath = path.join(item.filePath, filename);

    fs.writeFileSync(filePath, `# \n`, 'utf8');
    this.treeProvider.refresh();

    const doc = await vscode.workspace.openTextDocument(filePath);
    await vscode.window.showTextDocument(doc, showOptions(filePath));
  }

  private async runExampleTests(item: CheckedOutVersionTreeItem): Promise<void> {
    if (!item?.version?.fullPath) {
      notify.error(say('Invalid example item', 'Ungültiges Beispiel.'));
      return;
    }

    if (!fs.existsSync(item.version.fullPath)) {
      notify.error(say('Example directory not found.', 'Das Beispielverzeichnis wurde nicht gefunden.'));
      return;
    }

    const installer = ComputorTestingInstaller.getInstance();
    await installer.runTests(item.version.fullPath);
  }

  private async importExamples(): Promise<void> {
    const uris = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      openLabel: say('Import Examples', 'Beispiele importieren')
    });
    if (!uris || uris.length === 0) { return; }

    const selectedDir = uris[0]!.fsPath;
    const exampleDirs = this.detectExampleDirectories(selectedDir);

    if (exampleDirs.length === 0) {
      notify.warning(say('No examples found. A valid example directory must contain a meta.yaml with a slug.', 'Keine Beispiele gefunden. Ein gültiges Beispielverzeichnis enthält eine meta.yaml mit einem Slug.'));
      return;
    }

    const examplesPath = this.getExamplesDir();
    if (!examplesPath) { return; }
    const versionsPath = this.getVersionsDir();
    if (!versionsPath) { return; }

    const { readMetaYaml, updateMetaYamlVersion } = await import('../utils/metaYamlHelpers');
    const { normalizeSemVer } = await import('../utils/versionHelpers');
    const { writeCheckoutMetadata, getVersionPath } = await import('../utils/checkedOutExampleManager');
    const { writeExampleFiles } = await import('../utils/exampleFileWriter');

    // Pre-select a fallback repository for examples not yet on the server
    let fallbackRepositoryId: string | undefined;

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: say('Importing Examples', 'Beispiele werden importiert'),
        cancellable: false
      },
      async (progress) => {
        let imported = 0;
        let failed = 0;

        for (const exampleDir of exampleDirs) {
          const dirName = path.basename(exampleDir);
          progress.report({ message: `${dirName} (${imported + failed + 1}/${exampleDirs.length})` });

          try {
            const meta = readMetaYaml(exampleDir);
            const slug = meta?.slug || meta?.identifier;
            if (!slug) {
              failed++;
              continue;
            }

            const localVersion = meta.version || '0.1.0';
            const directory = meta.directory || dirName;

            // Copy to working directory
            const workingDir = path.join(examplesPath, directory);
            if (fs.existsSync(workingDir)) {
              fs.rmSync(workingDir, { recursive: true, force: true });
            }
            fs.cpSync(exampleDir, workingDir, {
              recursive: true,
              filter: (source) => !shouldExcludeExampleEntry(path.basename(source))
            });

            // Normalize version tag in the working copy's meta.yaml
            const normalizedLocalVersion = normalizeSemVer(localVersion);
            if (normalizedLocalVersion !== localVersion) {
              try {
                updateMetaYamlVersion(workingDir, normalizedLocalVersion);
              } catch { /* meta.yaml might not have version field yet */ }
            }

            // Look up example on server
            const remoteExample = await this.apiService.getExampleByIdentifier(slug);

            let exampleId = '';
            let repositoryId = '';
            let versionTag = localVersion;
            let versionId = '';
            let versionNumber = 0;

            if (remoteExample) {
              exampleId = remoteExample.id;
              repositoryId = remoteExample.example_repository_id;

              // Fetch versions and find best match
              const versions = await this.apiService.getExampleVersions(remoteExample.id);
              if (versions && versions.length > 0) {
                // Try to find exact version match
                const exactMatch = versions.find(v =>
                  normalizeSemVer(v.version_tag) === normalizeSemVer(localVersion)
                );

                // Fall back to latest version
                const bestVersion = exactMatch || versions.reduce((a, b) =>
                  b.version_number > a.version_number ? b : a
                );

                versionTag = bestVersion.version_tag;
                versionId = bestVersion.id;
                versionNumber = bestVersion.version_number;

                // Download version snapshot
                try {
                  const downloadedData = await this.apiService.downloadExampleVersion(bestVersion.id);
                  if (downloadedData) {
                    const versionDir = getVersionPath(versionsPath, directory, versionTag);
                    if (fs.existsSync(versionDir)) {
                      fs.rmSync(versionDir, { recursive: true, force: true });
                    }
                    fs.mkdirSync(versionDir, { recursive: true });
                    writeExampleFiles(downloadedData.files, versionDir);

                    writeCheckoutMetadata(versionDir, {
                      exampleId,
                      repositoryId,
                      directory,
                      versionId,
                      versionTag: normalizeSemVer(versionTag),
                      versionNumber,
                      checkedOutAt: new Date().toISOString()
                    });
                  }
                } catch (snapshotError) {
                  console.warn(`Failed to download version snapshot for ${directory}:`, snapshotError);
                }
              }
            } else {
              // Example not on server yet — prompt for a target repository (once)
              if (!fallbackRepositoryId) {
                const repos = await this.apiService.getExampleRepositories();
                if (!repos || repos.length === 0) {
                  notify.error(say('No example repositories found. Please create one first.', 'Keine Beispiel-Repositorys gefunden. Lege zuerst eines an.'));
                  return;
                }

                if (repos.length === 1) {
                  fallbackRepositoryId = repos[0]!.id;
                } else {
                  const picked = await vscode.window.showQuickPick(
                    repos.map(r => ({ label: r.name, description: r.source_url, id: r.id })),
                    { placeHolder: say('Select a repository for new examples not yet on the server', 'Repository für neue Beispiele auswählen, die noch nicht auf dem Server sind') }
                  );
                  if (!picked) { return; }
                  fallbackRepositoryId = picked.id;
                }
              }
              repositoryId = fallbackRepositoryId;
            }

            // Write checkout metadata for working copy
            writeCheckoutMetadata(workingDir, {
              exampleId,
              repositoryId,
              directory,
              versionId,
              versionTag: normalizeSemVer(versionTag),
              versionNumber,
              checkedOutAt: new Date().toISOString()
            });

            imported++;
          } catch (error) {
            console.error(`Failed to import ${dirName}:`, error);
            failed++;
          }
        }

        this.treeProvider.refresh();

        if (failed > 0) {
          notify.warning(say(`Imported ${imported} example(s), ${failed} failed.`, `${imported} Beispiel(e) importiert, ${failed} fehlgeschlagen.`));
        } else {
          notify.info(say(`Imported ${imported} example(s) successfully.`, `${imported} Beispiel(e) importiert.`));
        }
      }
    );
  }

  private detectExampleDirectories(dir: string): string[] {
    // Check if this directory itself is an example
    const metaPath = path.join(dir, 'meta.yaml');
    if (fs.existsSync(metaPath)) {
      const { readMetaYaml } = require('../utils/metaYamlHelpers');
      const meta = readMetaYaml(dir);
      if (meta?.slug || meta?.identifier) {
        return [dir];
      }
    }

    // Otherwise scan subdirectories for examples
    const examples: string[] = [];
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) { continue; }
        const subDir = path.join(dir, entry.name);
        const subMeta = path.join(subDir, 'meta.yaml');
        if (fs.existsSync(subMeta)) {
          examples.push(subDir);
        }
      }
    } catch { /* ignore read errors */ }

    return examples;
  }
}
