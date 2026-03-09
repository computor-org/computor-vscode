import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as yaml from 'js-yaml';
import JSZip from 'jszip';
import { ComputorApiService } from '../services/ComputorApiService';
import { ExampleTreeItem, ExampleRepositoryTreeItem, CheckedOutGroupTreeItem, CheckedOutVersionTreeItem, FileSystemTreeItem, LecturerExampleTreeProvider } from '../ui/tree/lecturer/LecturerExampleTreeProvider';
import { ExampleUploadRequest, CourseContentCreate, CourseContentList, CourseList, CodeAbilityMeta } from '../types/generated';
import { writeExampleFiles } from '../utils/exampleFileWriter';
import { ExampleDetailWebviewProvider } from '../ui/webviews/ExampleDetailWebviewProvider';
import { TestYamlEditorWebviewProvider } from '../ui/webviews/TestYamlEditorWebviewProvider';
import { MetaYamlEditorWebviewProvider } from '../ui/webviews/MetaYamlEditorWebviewProvider';
import { WorkspaceStructureManager } from '../utils/workspaceStructure';
import { writeCheckoutMetadata, readCheckoutMetadata, getWorkingPath, getVersionPath, snapshotWorkingToVersion } from '../utils/checkedOutExampleManager';
import type { CheckoutMetadata } from '../utils/checkedOutExampleManager';
import { ComputorTestingInstaller } from '../services/ComputorTestingInstaller';
import { shouldExcludeExampleEntry } from '../utils/exampleExcludePatterns';

/**
 * Simplified example commands for the lecturer view
 */
export class LecturerExampleCommands {
  private exampleDetailProvider: ExampleDetailWebviewProvider;
  private testYamlEditorProvider: TestYamlEditorWebviewProvider;
  private metaYamlEditorProvider: MetaYamlEditorWebviewProvider;

  constructor(
    private context: vscode.ExtensionContext,
    private apiService: ComputorApiService,
    private treeProvider: LecturerExampleTreeProvider
  ) {
    this.exampleDetailProvider = new ExampleDetailWebviewProvider(context, apiService, treeProvider);
    this.testYamlEditorProvider = new TestYamlEditorWebviewProvider(context);
    this.metaYamlEditorProvider = new MetaYamlEditorWebviewProvider(context);
    this.registerCommands();
  }
  private registerCommands(): void {
    // Search examples - already registered in extension.ts but we'll override with better implementation
    this.context.subscriptions.push(
      vscode.commands.registerCommand('computor.lecturer.searchExamples', async () => {
        // Get current search query to prefill the input
        const currentQuery = this.treeProvider.getSearchQuery();
        
        const query = await vscode.window.showInputBox({
          prompt: 'Search examples by title, identifier, or tags',
          placeHolder: 'Enter search query',
          value: currentQuery  // Prefill with current search
        });
        
        if (query !== undefined) {
          this.treeProvider.setSearchQuery(query);
          if (query) {
            vscode.window.showInformationMessage(`Searching for: ${query}`);
          } else {
            vscode.window.showInformationMessage('Search cleared');
          }
        }
      })
    );

    // Clear search
    this.context.subscriptions.push(
      vscode.commands.registerCommand('computor.lecturer.clearExampleSearch', () => {
        this.treeProvider.clearSearch();
        vscode.window.showInformationMessage('Search cleared');
      })
    );

    // Also register clearSearch for the tree item click
    this.context.subscriptions.push(
      vscode.commands.registerCommand('computor.lecturer.clearSearch', () => {
        this.treeProvider.clearSearch();
        vscode.window.showInformationMessage('Search cleared');
      })
    );

    // Filter by category
    this.context.subscriptions.push(
      vscode.commands.registerCommand('computor.lecturer.filterExamplesByCategory', async () => {
        const currentCategory = this.treeProvider.getSelectedCategory();
        const category = await vscode.window.showInputBox({
          prompt: 'Enter category to filter by (leave empty to clear)',
          placeHolder: 'e.g., Introduction, Advanced',
          value: currentCategory || ''
        });
        
        if (category !== undefined) {
          this.treeProvider.setCategory(category || undefined);
          if (category) {
            vscode.window.showInformationMessage(`Filtering by category: ${category}`);
          } else {
            vscode.window.showInformationMessage('Category filter cleared');
          }
        }
      })
    );

    // Filter by tags
    this.context.subscriptions.push(
      vscode.commands.registerCommand('computor.lecturer.filterExamplesByTags', async () => {
        const currentTags = this.treeProvider.getSelectedTags();
        const tagsInput = await vscode.window.showInputBox({
          prompt: 'Enter tags to filter by (comma-separated, leave empty to clear)',
          placeHolder: 'e.g., beginner, loops, functions',
          value: currentTags.join(', ')
        });
        
        if (tagsInput !== undefined) {
          const tags = tagsInput ? tagsInput.split(',').map(t => t.trim()).filter(t => t) : [];
          this.treeProvider.setTags(tags);
          if (tags.length > 0) {
            vscode.window.showInformationMessage(`Filtering by tags: ${tags.join(', ')}`);
          } else {
            vscode.window.showInformationMessage('Tag filter cleared');
          }
        }
      })
    );

    // Clear category filter
    this.context.subscriptions.push(
      vscode.commands.registerCommand('computor.lecturer.clearCategoryFilter', () => {
        this.treeProvider.clearCategoryFilter();
        vscode.window.showInformationMessage('Category filter cleared');
      })
    );

    // Clear tags filter
    this.context.subscriptions.push(
      vscode.commands.registerCommand('computor.lecturer.clearTagsFilter', () => {
        this.treeProvider.clearTagsFilter();
        vscode.window.showInformationMessage('Tags filter cleared');
      })
    );

    // Checkout example (latest version)
    this.context.subscriptions.push(
      vscode.commands.registerCommand('computor.lecturer.checkoutExample', async (item: ExampleTreeItem) => {
        await this.checkoutExample(item);
      })
    );

    // Checkout specific version
    this.context.subscriptions.push(
      vscode.commands.registerCommand('computor.lecturer.checkoutExampleVersion', async (item: ExampleTreeItem) => {
        await this.checkoutExample(item, true);
      })
    );

    // Checkout all filtered examples from repository
    this.context.subscriptions.push(
      vscode.commands.registerCommand('computor.lecturer.checkoutAllFilteredExamples', async (item: ExampleRepositoryTreeItem) => {
        await this.checkoutAllFilteredExamples(item);
      })
    );

    // Upload working copy
    this.context.subscriptions.push(
      vscode.commands.registerCommand('computor.lecturer.uploadExample', async (item: ExampleTreeItem | CheckedOutVersionTreeItem) => {
        if (item instanceof CheckedOutVersionTreeItem) {
          await this.uploadCheckedOutVersion(item);
        } else {
          await this.uploadExample(item);
        }
      })
    );

    // Bump version on working copy
    this.context.subscriptions.push(
      vscode.commands.registerCommand('computor.lecturer.bumpExampleVersion', async (item: CheckedOutVersionTreeItem) => {
        await this.bumpCheckedOutVersion(item);
      })
    );

    // Reveal checked-out version in explorer
    this.context.subscriptions.push(
      vscode.commands.registerCommand('computor.lecturer.revealCheckedOutInExplorer', async (item: CheckedOutVersionTreeItem | CheckedOutGroupTreeItem) => {
        const p = item instanceof CheckedOutVersionTreeItem ? item.version.fullPath : item.group.fullPath;
        await vscode.commands.executeCommand('revealInExplorer', vscode.Uri.file(p));
      })
    );

    // Delete entire checked-out example group
    this.context.subscriptions.push(
      vscode.commands.registerCommand('computor.lecturer.deleteCheckedOutExample', async (item: CheckedOutGroupTreeItem) => {
        await this.deleteCheckedOutGroup(item);
      })
    );

    // Delete single checked-out version
    this.context.subscriptions.push(
      vscode.commands.registerCommand('computor.lecturer.deleteCheckedOutVersion', async (item: CheckedOutVersionTreeItem) => {
        await this.deleteCheckedOutVersion(item);
      })
    );

    // Restore version to working copy
    this.context.subscriptions.push(
      vscode.commands.registerCommand('computor.lecturer.restoreVersionToWorking', async (item: CheckedOutVersionTreeItem) => {
        await this.restoreVersionToWorking(item);
      })
    );

    // Compare version with working copy
    this.context.subscriptions.push(
      vscode.commands.registerCommand('computor.lecturer.compareWithWorking', async (item: CheckedOutVersionTreeItem) => {
        await this.compareWithWorking(item);
      })
    );

    // Compare a single version file with its working counterpart
    this.context.subscriptions.push(
      vscode.commands.registerCommand('computor.lecturer.compareFileWithWorking', async (item: FileSystemTreeItem) => {
        await this.compareFileWithWorking(item);
      })
    );

    // File management commands
    this.context.subscriptions.push(
      vscode.commands.registerCommand('computor.lecturer.newFile', async (item: FileSystemTreeItem | CheckedOutVersionTreeItem) => {
        await this.createFileOrFolder(item, false);
      })
    );
    this.context.subscriptions.push(
      vscode.commands.registerCommand('computor.lecturer.newFolder', async (item: FileSystemTreeItem | CheckedOutVersionTreeItem) => {
        await this.createFileOrFolder(item, true);
      })
    );
    this.context.subscriptions.push(
      vscode.commands.registerCommand('computor.lecturer.renameItem', async (item: FileSystemTreeItem) => {
        await this.renameFileSystemItem(item);
      })
    );
    this.context.subscriptions.push(
      vscode.commands.registerCommand('computor.lecturer.deleteItem', async (item: FileSystemTreeItem) => {
        await this.deleteFileSystemItem(item);
      })
    );

    // Create new example
    this.context.subscriptions.push(
      vscode.commands.registerCommand('computor.lecturer.createNewExample', async () => {
        await this.createNewExample();
      })
    );

    // Upload new example
    this.context.subscriptions.push(
      vscode.commands.registerCommand('computor.lecturer.uploadNewExample', async () => {
        await this.uploadNewExample();
      })
    );

    // Checkout multiple examples
    this.context.subscriptions.push(
      vscode.commands.registerCommand('computor.lecturer.checkoutMultipleExamples', async () => {
        vscode.window.showInformationMessage('Checkout multiple examples - not yet implemented');
      })
    );

    // Upload examples from ZIP
    this.context.subscriptions.push(
      vscode.commands.registerCommand('computor.lecturer.uploadExamplesFromZip', async (item?: ExampleRepositoryTreeItem) => {
        await this.uploadExamplesFromZip(item);
      })
    );

    // create content from example
    this.context.subscriptions.push(
      vscode.commands.registerCommand('computor.lecturer.createCourseContentFromExample', async (item: ExampleTreeItem) => {
        await this.createCourseContentFromExample(item);
      })
    );

    // Refresh examples tree (clear caches first)
    this.context.subscriptions.push(
      vscode.commands.registerCommand('computor.lecturer.refreshExamples', async () => {
        try {
          this.apiService.clearExamplesCache();
        } catch {}
        this.treeProvider.refresh();
      })
    );

    // Reveal downloaded example in explorer
    this.context.subscriptions.push(
      vscode.commands.registerCommand('computor.lecturer.revealExampleInExplorer', async (item: ExampleTreeItem) => {
        await this.revealExampleInExplorer(item);
      })
    );

    // Show example details in webview side panel
    this.context.subscriptions.push(
      vscode.commands.registerCommand('computor.lecturer.showExampleDetails', async (item: ExampleTreeItem) => {
        await this.showExampleDetails(item);
      })
    );

    // Open test.yaml editor
    this.context.subscriptions.push(
      vscode.commands.registerCommand('computor.lecturer.editTestYaml', async (item: FileSystemTreeItem | CheckedOutVersionTreeItem) => {
        await this.editTestYaml(item);
      })
    );

    // Add test.yaml to working example
    this.context.subscriptions.push(
      vscode.commands.registerCommand('computor.lecturer.addTests', async (item: CheckedOutVersionTreeItem) => {
        await this.addTests(item);
      })
    );

    // Open meta.yaml editor (from meta.yaml file or working example root)
    this.context.subscriptions.push(
      vscode.commands.registerCommand('computor.lecturer.editMetaYaml', async (item: FileSystemTreeItem | CheckedOutVersionTreeItem) => {
        await this.editMetaYaml(item);
      })
    );

    // Create new readme in content directory
    this.context.subscriptions.push(
      vscode.commands.registerCommand('computor.lecturer.newReadme', async (item: FileSystemTreeItem) => {
        await this.createNewReadme(item);
      })
    );

    // Install computor-testing tools
    this.context.subscriptions.push(
      vscode.commands.registerCommand('computor.lecturer.installTestingTools', async () => {
        const installer = ComputorTestingInstaller.getInstance();
        await installer.install();
      })
    );

    // Update computor-testing tools
    this.context.subscriptions.push(
      vscode.commands.registerCommand('computor.lecturer.updateTestingTools', async () => {
        const installer = ComputorTestingInstaller.getInstance();
        await installer.update();
      })
    );

    // Uninstall computor-testing tools
    this.context.subscriptions.push(
      vscode.commands.registerCommand('computor.lecturer.uninstallTestingTools', async () => {
        const installer = ComputorTestingInstaller.getInstance();
        await installer.uninstall();
      })
    );

    // Run tests on checked-out example
    this.context.subscriptions.push(
      vscode.commands.registerCommand('computor.lecturer.runExampleTests', async (item: CheckedOutVersionTreeItem) => {
        await this.runExampleTests(item);
      })
    );
  }

  private async checkoutExample(item: ExampleTreeItem, pickVersion: boolean = false): Promise<void> {
    if (!item?.example) {
      vscode.window.showErrorMessage('Invalid example item');
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
          vscode.window.showErrorMessage('No versions available for this example');
          return;
        }
        const sorted = versions.slice().sort((a, b) => b.version_number - a.version_number);
        const picked = await vscode.window.showQuickPick(
          sorted.map(v => ({
            label: v.version_tag,
            description: `#${v.version_number}${v.created_at ? ' — ' + new Date(v.created_at).toLocaleDateString() : ''}`,
            versionId: v.id,
            versionTag: v.version_tag,
            versionNumber: v.version_number
          })),
          { placeHolder: 'Select a version to checkout' }
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
        vscode.window.showErrorMessage('Failed to download example');
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
          const overwrite = await vscode.window.showWarningMessage(
            `'${versionLabel}' already exists. Overwrite?`, 'Yes', 'No'
          );
          if (overwrite !== 'Yes') { return; }
          fs.rmSync(versionDir, { recursive: true, force: true });
        }

        fs.mkdirSync(versionDir, { recursive: true });
        writeExampleFiles(exampleData.files, versionDir);
        writeCheckoutMetadata(versionDir, metadata);

        this.treeProvider.refresh();
        vscode.window.showInformationMessage(
          `Checked out '${item.example.title}' [${resolvedTag}] to ${versionLabel}`
        );
      } else {
        // Latest: create working copy in examples/ and version snapshot in example_versions/
        const workingDir = getWorkingPath(examplesPath, item.example.directory);
        const versionDir = getVersionPath(versionsPath, item.example.directory, resolvedTag);

        if (fs.existsSync(workingDir)) {
          const overwrite = await vscode.window.showWarningMessage(
            `Working copy of '${item.example.directory}' already exists. Overwrite?`, 'Yes', 'No'
          );
          if (overwrite !== 'Yes') { return; }
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
        vscode.window.showInformationMessage(
          `Checked out '${item.example.title}' [${resolvedTag}]`
        );
      }
    } catch (error) {
      console.error('Failed to checkout example:', error);
      vscode.window.showErrorMessage(`Failed to checkout example: ${error}`);
    }
  }

  private async checkoutAllFilteredExamples(item: ExampleRepositoryTreeItem): Promise<void> {
    if (!item?.repository) {
      vscode.window.showErrorMessage('Invalid repository item');
      return;
    }

    const examplesPath = this.getExamplesDir();
    if (!examplesPath) { return; }
    const versionsPath = this.getVersionsDir();
    if (!versionsPath) { return; }

    try {
      const filteredExamples = await this.treeProvider.getFilteredExamplesForRepository(item.repository);
      if (filteredExamples.length === 0) {
        vscode.window.showInformationMessage('No examples match the current filters');
        return;
      }

      const activeFilters: string[] = [];
      const searchQuery = this.treeProvider.getSearchQuery();
      const selectedCategory = this.treeProvider.getSelectedCategory();
      const selectedTags = this.treeProvider.getSelectedTags();
      if (searchQuery) activeFilters.push(`search: "${searchQuery}"`);
      if (selectedCategory) activeFilters.push(`category: ${selectedCategory}`);
      if (selectedTags.length > 0) activeFilters.push(`tags: ${selectedTags.join(', ')}`);
      const filterInfo = activeFilters.length > 0 ? ` with filters: ${activeFilters.join(', ')}` : '';

      const confirm = await vscode.window.showInformationMessage(
        `Checkout ${filteredExamples.length} example(s)${filterInfo} to examples/?`, 'Yes', 'No'
      );
      if (confirm !== 'Yes') { return; }

      await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'Checking out examples',
        cancellable: false
      }, async (progress) => {
        let successCount = 0;
        const errors: string[] = [];

        for (let i = 0; i < filteredExamples.length; i++) {
          const exampleItem = filteredExamples[i];
          if (!exampleItem?.example) continue;

          progress.report({
            increment: (100 / filteredExamples.length),
            message: `(${i + 1}/${filteredExamples.length}) ${exampleItem.example.title}`
          });

          try {
            const workingDir = getWorkingPath(examplesPath, exampleItem.example.directory);

            if (fs.existsSync(workingDir)) {
              errors.push(`${exampleItem.example.title}: already exists`);
              continue;
            }

            const exampleData = await this.apiService.downloadExample(exampleItem.example.id, false);
            if (!exampleData) {
              errors.push(`${exampleItem.example.title}: Failed to download`);
              continue;
            }

            fs.mkdirSync(workingDir, { recursive: true });
            writeExampleFiles(exampleData.files, workingDir);

            const metadata: CheckoutMetadata = {
              exampleId: exampleItem.example.id,
              repositoryId: exampleItem.repository.id,
              directory: exampleItem.example.directory,
              versionId: exampleData.version_id || '',
              versionTag: exampleData.version_tag,
              versionNumber: 0,
              checkedOutAt: new Date().toISOString()
            };
            writeCheckoutMetadata(workingDir, metadata);

            // Also create version snapshot in example_versions/
            const versionDir = getVersionPath(versionsPath, exampleItem.example.directory, exampleData.version_tag);
            if (fs.existsSync(versionDir)) {
              fs.rmSync(versionDir, { recursive: true, force: true });
            }
            fs.mkdirSync(path.dirname(versionDir), { recursive: true });
            fs.cpSync(workingDir, versionDir, { recursive: true });

            successCount++;
          } catch (error) {
            errors.push(`${exampleItem.example.title}: ${error}`);
          }
        }

        this.treeProvider.refresh();

        if (successCount === filteredExamples.length) {
          vscode.window.showInformationMessage(`Checked out ${successCount} example(s)`);
        } else if (successCount > 0) {
          const errorMessage = errors.length > 3 ? errors.slice(0, 3).join('; ') + '...' : errors.join('; ');
          vscode.window.showWarningMessage(`Checked out ${successCount} of ${filteredExamples.length}. Errors: ${errorMessage}`);
        } else {
          vscode.window.showErrorMessage(`Failed to checkout examples. ${errors[0]}`);
        }
      });
    } catch (error) {
      console.error('Failed to checkout filtered examples:', error);
      vscode.window.showErrorMessage(`Failed to checkout examples: ${error}`);
    }
  }

  private getExamplesDir(): string | undefined {
    try {
      const wsManager = WorkspaceStructureManager.getInstance();
      const examplesPath = wsManager.getExamplesPath();
      fs.mkdirSync(examplesPath, { recursive: true });
      return examplesPath;
    } catch {
      vscode.window.showErrorMessage('No workspace folder open');
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
      vscode.window.showErrorMessage('No workspace folder open');
      return undefined;
    }
  }

  private async uploadExample(item: ExampleTreeItem): Promise<void> {
    if (!item?.example) {
      vscode.window.showErrorMessage('Invalid example item');
      return;
    }

    const examplesPath = this.getExamplesDir();
    if (!examplesPath) { return; }

    const workingDir = getWorkingPath(examplesPath, item.example.directory);
    if (!fs.existsSync(workingDir)) {
      vscode.window.showErrorMessage(`No working copy found. Check out the example first.`);
      return;
    }

    const metadata = readCheckoutMetadata(workingDir);
    await this.uploadFromDirectory(
      workingDir, metadata?.directory || item.example.directory,
      item.repository.id, item.example.title, metadata?.exampleId || item.example.id
    );
  }

  private async uploadCheckedOutVersion(item: CheckedOutVersionTreeItem): Promise<void> {
    if (!item?.version) {
      vscode.window.showErrorMessage('Invalid checked-out version');
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
      vscode.window.showErrorMessage(`Directory not found: ${dirPath}`);
      return;
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
        { label: `Use current: ${localVersion}`, description: 'First upload', version: localVersion },
        { label: `Patch: ${patchBump}`, description: `From ${baseVersion}`, version: patchBump },
        { label: `Minor: ${minorBump}`, description: `From ${baseVersion}`, version: minorBump },
        { label: `Major: ${majorBump}`, description: `From ${baseVersion}`, version: majorBump },
        { label: 'Custom version...', description: '', version: '' }
      ], { placeHolder: `Select version for first upload of "${title}"` });
    } else {
      const remoteLabel = `Latest remote: ${latestRemoteVersion}`;
      picked = await vscode.window.showQuickPick([
        { label: `Patch: ${patchBump}`, description: remoteLabel, version: patchBump },
        { label: `Minor: ${minorBump}`, description: remoteLabel, version: minorBump },
        { label: `Major: ${majorBump}`, description: remoteLabel, version: majorBump },
        { label: 'Custom version...', description: remoteLabel, version: '' }
      ], { placeHolder: `Select version for "${title}" upload` });
    }

    if (!picked) { return; }

    let uploadVersion = picked.version;
    if (!uploadVersion) {
      const custom = await vscode.window.showInputBox({
        prompt: 'Enter version tag',
        placeHolder: 'e.g., 1.2.3',
        value: patchBump
      });
      if (!custom) { return; }
      uploadVersion = normalizeSemVer(custom);
    }

    const confirm = await vscode.window.showInformationMessage(
      `Upload "${title}" as version ${uploadVersion}?`, 'Upload', 'Cancel'
    );
    if (confirm !== 'Upload') { return; }

    // Update meta.yaml with the chosen version before uploading
    try {
      updateMetaYamlVersion(dirPath, uploadVersion);
    } catch (e) {
      vscode.window.showErrorMessage(`Failed to update meta.yaml version: ${e}`);
      return;
    }

    try {
      await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: `Uploading: ${title} [${uploadVersion}]`,
        cancellable: false
      }, async (progress) => {
        progress.report({ increment: 10, message: 'Packaging as zip...' });

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
        progress.report({ increment: 30, message: 'Uploading...' });

        const zipName = `${directory}.zip`;
        const uploadRequest: ExampleUploadRequest = {
          repository_id: repositoryId,
          directory,
          files: { [zipName]: base64Zip }
        };

        const result = await this.apiService.uploadExample(uploadRequest);
        if (!result) {
          throw new Error('Upload failed - no response from server');
        }

        progress.report({ increment: 20, message: 'Downloading version snapshot...' });

        // Download the newly created version from the API to create a clean snapshot
        const examplesPath = this.getExamplesDir();
        const versionsPath = this.getVersionsDir();
        if (examplesPath && versionsPath) {
          try {
            // Find the version we just uploaded
            const updatedVersions = await this.apiService.getExampleVersions(exampleId);
            const uploadedVersion = updatedVersions.find(v => normalizeSemVer(v.version_tag) === uploadVersion);

            if (uploadedVersion) {
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
              versionTag: uploadVersion,
              checkedOutAt: new Date().toISOString()
            });
          }
        }

        progress.report({ increment: 20, message: 'Complete!' });
        vscode.window.showInformationMessage(`Successfully uploaded: ${title} [${uploadVersion}]`);
        this.treeProvider.refresh();
      });
    } catch (error) {
      console.error('Failed to upload example:', error);
      vscode.window.showErrorMessage(`Failed to upload: ${error}`);
    }
  }

  private async createNewExample(): Promise<void> {
    const examplesPath = this.getExamplesDir();
    if (!examplesPath) { return; }

    const title = await vscode.window.showInputBox({
      prompt: 'Example Title',
      placeHolder: 'Enter a title for the new example'
    });
    if (!title) { return; }

    const identifier = await vscode.window.showInputBox({
      prompt: 'Example Identifier (ltree: letters, digits, dots, underscores)',
      placeHolder: 'e.g., hello.world.basic',
      value: title.toLowerCase().replace(/\s+/g, '.'),
      validateInput: (value) => {
        if (!/^[a-zA-Z0-9._]+$/.test(value)) {
          return 'Only letters, digits, dots, and underscores allowed (ltree format)';
        }
        return undefined;
      }
    });
    if (!identifier) { return; }

    try {
      const existingExamples = await this.apiService.getExamples();
      if (existingExamples.some(e => e.identifier === identifier)) {
        vscode.window.showErrorMessage(`Example identifier "${identifier}" is already in use.`);
        return;
      }
    } catch {
      const proceed = await vscode.window.showWarningMessage(
        'Could not verify identifier uniqueness. Continue anyway?',
        'Continue', 'Cancel'
      );
      if (proceed !== 'Continue') { return; }
    }

    const directory = identifier;

    // Select target repository for future uploads
    let repositoryId = '';
    try {
      const repositories = await this.apiService.getExampleRepositories();
      if (repositories.length > 0) {
        const picked = await vscode.window.showQuickPick(
          repositories.map(r => ({ label: r.name, description: r.description || undefined, id: r.id })),
          { placeHolder: 'Select target repository for this example' }
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
      languages = [{ code: 'en', name: 'English' }, { code: 'de', name: 'German' }];
    }

    const hasEnglish = languages.some(l => l.code === 'en');
    const sortedLanguages = hasEnglish
      ? [languages.find(l => l.code === 'en')!, ...languages.filter(l => l.code !== 'en')]
      : languages;

    const pickedLang = await vscode.window.showQuickPick(
      sortedLanguages.map(l => ({ label: l.name, description: l.code, langCode: l.code })),
      { placeHolder: 'Select language for this example' }
    );
    if (!pickedLang) { return; }

    const workingDir = getWorkingPath(examplesPath, directory);
    if (fs.existsSync(workingDir)) {
      vscode.window.showErrorMessage(`Local example "${directory}" already exists.`);
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
        keywords: [],
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

      vscode.window.showInformationMessage(`Created new example "${title}" in Local Examples`);
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to create example: ${error}`);
    }
  }

  /**
   * Upload a new example from meta.yaml
   */
  private async uploadNewExample(): Promise<void> {
    // Find meta.yaml files in workspace
    const metaFiles = await vscode.workspace.findFiles('**/meta.yaml', '**/node_modules/**');
    
    if (metaFiles.length === 0) {
      vscode.window.showErrorMessage('No meta.yaml files found in workspace');
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
        placeHolder: 'Select meta.yaml file to upload'
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
    
    vscode.window.showInformationMessage(`Uploading example from ${metaFile.fsPath} - not yet fully implemented`);
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
          vscode.window.showErrorMessage('No example repositories available');
          return;
        }
        
        const selected = await vscode.window.showQuickPick(
          repositories.map(r => ({
            label: r.name,
            description: r.description || undefined,
            id: r.id
          })),
          { placeHolder: 'Select repository to upload examples to' }
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
          'ZIP Archives': ['zip']
        },
        title: 'Select ZIP file containing examples'
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
        title: `Processing ${zipFileName}`,
        cancellable: false
      }, async (progress) => {
        progress.report({ increment: 0, message: 'Loading ZIP file...' });

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
          throw new Error('No meta.yaml files found in the ZIP archive');
        }

        progress.report({ increment: 20, message: `Found ${metaYamlPaths.length} example(s)...` });

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
          throw new Error('No valid examples found in ZIP file');
        }

        // Show selection dialog with all items preselected
        const quickPickItems = examples.map(ex => ({
          label: ex.title,
          description: ex.identifier,
          detail: `will upload as ${ex.zipName}${ex.dependencies.length ? ` • deps: ${ex.dependencies.join(', ')}` : ''}`,
          example: ex,
          picked: true  // Preselect all items
        }));

        const selectedItems = await vscode.window.showQuickPick(
          quickPickItems,
          {
            canPickMany: true,
            placeHolder: `Select examples to upload to ${repositoryName}`,
            title: 'Select Examples to Upload'
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
          vscode.window.showWarningMessage(`Some selected examples reference dependencies not in selection: ${missingSummary.slice(0,3).join('; ')}${missingSummary.length>3?' ...':''}`);
        }

        progress.report({ increment: 40, message: `Uploading ${selectedItems.length} example(s) with dependency order...` });

        // Upload selected examples
        let successCount = 0;
        const errors: string[] = [];

        for (let i = 0; i < uploadOrder.length; i++) {
          const example = uploadOrder[i];
          
          progress.report({ 
            increment: 40 + (40 * i / uploadOrder.length), 
            message: `Uploading ${example.title}...` 
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

        progress.report({ increment: 100, message: 'Complete!' });

        // Show results
        if (successCount === selectedItems.length) {
          vscode.window.showInformationMessage(
            `Successfully uploaded ${successCount} example(s) to ${repositoryName}`
          );
        } else if (successCount > 0) {
          vscode.window.showWarningMessage(
            `Uploaded ${successCount} of ${selectedItems.length} examples. Errors: ${errors.join('; ')}`
          );
        } else {
          vscode.window.showErrorMessage(
            `Failed to upload examples. Errors: ${errors.join('; ')}`
          );
        }

        // Refresh the tree to show new examples
        if (successCount > 0) {
          // Add a small delay to ensure the backend has processed the uploads
          await new Promise(resolve => setTimeout(resolve, 1000));
          
          // Refresh the tree
          this.treeProvider.refresh();
          
          console.log(`Refreshed tree after uploading ${successCount} examples`);
        }
      });

    } catch (error) {
      console.error('Failed to upload examples from ZIP:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      vscode.window.showErrorMessage(`Failed to upload examples: ${errorMessage}`);
    }
  }

  /**
   * Create a course content (assignment) from an example
   */
  private async createCourseContentFromExample(item: ExampleTreeItem): Promise<void> {
    if (!item || !item.example) {
      vscode.window.showErrorMessage('Invalid example item');
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
        vscode.window.showErrorMessage('No courses available');
        return;
      }

      // Step 2: Let user select a course
      const courseSelection = await vscode.window.showQuickPick(
        allCourses.map(item => ({
          label: item.course.title || item.course.path,
          description: `${item.orgTitle} / ${item.familyTitle}`,
          detail: `Path: ${item.course.path}`,
          id: item.course.id
        })),
        {
          placeHolder: 'Select a course to add this example to',
          title: 'Select Course'
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
              kindTitle: fullType.course_content_kind.title || 'Assignment'
            });
          }
        } catch (error) {
          console.warn(`Failed to fetch content type details: ${error}`);
        }
      }

      if (submittableTypes.length === 0) {
        vscode.window.showErrorMessage('No submittable content types available in this course. Please create an assignment-type content type first.');
        return;
      }

      // Step 4: Let user select content type
      const contentTypeSelection = await vscode.window.showQuickPick(
        submittableTypes.map(st => ({
          label: st.type.title || st.type.slug,
          description: st.kindTitle,
          detail: `Color: ${st.type.color}`,
          id: st.type.id
        })),
        {
          placeHolder: 'Select content type for this assignment',
          title: 'Select Content Type'
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
                kindTitle: fullType.course_content_kind.title || 'Unit'
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
          { label: '📁 Course Root', description: 'Place at the root level of the course', path: undefined },
          ...units.map(unit => ({
            label: unit.content.title || unit.content.path,
            description: `${unit.kindTitle} - ${unit.content.path}`,
            path: unit.content.path
          }))
        ];

        const placementSelection = await vscode.window.showQuickPick(
          placementOptions,
          {
            placeHolder: 'Select where to place this assignment',
            title: 'Select Parent Location'
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
        vscode.window.showErrorMessage(`A content item with path '${path}' already exists.`);
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
        max_submissions: 10, // Default values
        max_test_runs: 100
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
            vscode.window.showInformationMessage(
              `Successfully created assignment "${item.example.title}" with version ${latestVersion.version_tag} in course "${courseSelection.label}"`
            );
          } catch (assignError) {
            // Content was created but example assignment failed
            vscode.window.showWarningMessage(
              `Assignment "${item.example.title}" was created but example assignment failed: ${assignError}. You can assign it manually later.`
            );
          }
        } else {
          // Content created but no versions available
          vscode.window.showWarningMessage(
            `Assignment "${item.example.title}" was created but no example versions were found. Please assign a version manually.`
          );
        }
      } else {
        vscode.window.showInformationMessage(
          `Successfully created assignment "${item.example.title}" in course "${courseSelection.label}"`
        );
      }

      // Refresh the lecturer tree if it's visible
      vscode.commands.executeCommand('computor.lecturer.refresh');
      
    } catch (error) {
      console.error('Failed to create content from example:', error);
      vscode.window.showErrorMessage(`Failed to create assignment: ${error}`);
    }
  }

  private async revealExampleInExplorer(item: ExampleTreeItem): Promise<void> {
    if (!item?.example) { return; }
    const examplesPath = this.getExamplesDir();
    if (!examplesPath) { return; }
    const workingPath = getWorkingPath(examplesPath, item.example.directory);
    if (!fs.existsSync(workingPath)) {
      vscode.window.showErrorMessage('Example is not checked out');
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
      vscode.window.showErrorMessage('No version field found in meta.yaml');
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
    ], { placeHolder: 'Select version bump type' });

    if (!picked) { return; }

    updateMetaYamlVersion(item.version.fullPath, picked.newVersion);
    vscode.window.showInformationMessage(`Version bumped: ${normalized} -> ${picked.newVersion}`);
    this.treeProvider.refresh();
  }

  private async deleteCheckedOutGroup(item: CheckedOutGroupTreeItem): Promise<void> {
    if (!item?.group) { return; }

    const confirm = await vscode.window.showWarningMessage(
      `Delete all local data of "${item.group.directory}"? This removes the working copy and all version snapshots.`,
      'Delete', 'Cancel'
    );
    if (confirm !== 'Delete') { return; }

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
      vscode.window.showInformationMessage(`Deleted: ${item.group.directory}`);
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to delete: ${error}`);
    }
  }

  private async deleteCheckedOutVersion(item: CheckedOutVersionTreeItem): Promise<void> {
    if (!item?.version) { return; }

    const label = item.version.isWorking ? 'working copy' : `version ${item.version.versionTag}`;
    const confirm = await vscode.window.showWarningMessage(
      `Delete ${label} of "${item.groupDirectory}"?`,
      'Delete', 'Cancel'
    );
    if (confirm !== 'Delete') { return; }

    try {
      fs.rmSync(item.version.fullPath, { recursive: true, force: true });
      this.treeProvider.refresh();
      vscode.window.showInformationMessage(`Deleted ${label}`);
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to delete: ${error}`);
    }
  }

  private async restoreVersionToWorking(item: CheckedOutVersionTreeItem): Promise<void> {
    if (!item?.version || item.version.isWorking) { return; }

    const examplesPath = this.getExamplesDir();
    if (!examplesPath) { return; }

    const workingDir = getWorkingPath(examplesPath, item.groupDirectory);

    const confirm = await vscode.window.showWarningMessage(
      `Restore version ${item.version.versionTag} to working copy of "${item.groupDirectory}"? Any unsaved changes in the working directory will be lost.`,
      'Restore', 'Cancel'
    );
    if (confirm !== 'Restore') { return; }

    try {
      if (fs.existsSync(workingDir)) {
        fs.rmSync(workingDir, { recursive: true, force: true });
      }
      fs.cpSync(item.version.fullPath, workingDir, { recursive: true });

      this.treeProvider.refresh();
      vscode.window.showInformationMessage(`Restored ${item.version.versionTag} to working copy`);
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to restore: ${error}`);
    }
  }

  private async compareWithWorking(item: CheckedOutVersionTreeItem): Promise<void> {
    if (!item?.version || item.version.isWorking) { return; }

    const examplesPath = this.getExamplesDir();
    if (!examplesPath) { return; }

    const workingDir = getWorkingPath(examplesPath, item.groupDirectory);
    if (!fs.existsSync(workingDir)) {
      vscode.window.showWarningMessage('No working copy found to compare against.');
      return;
    }

    const versionDir = item.version.fullPath;
    const files = this.collectFiles(versionDir, versionDir);

    if (files.length === 0) {
      vscode.window.showInformationMessage('No files found in version snapshot.');
      return;
    }

    const picks = files.map(relativePath => {
      const workingFile = path.join(workingDir, relativePath);
      const exists = fs.existsSync(workingFile);
      return {
        label: relativePath,
        description: exists ? '' : '(not in working copy)',
        relativePath
      };
    });

    const selected = await vscode.window.showQuickPick(picks, {
      placeHolder: 'Select a file to compare with working copy',
      title: `Compare ${item.version.versionTag} with working`
    });

    if (!selected) { return; }

    const versionFile = vscode.Uri.file(path.join(versionDir, selected.relativePath));
    const workingFile = vscode.Uri.file(path.join(workingDir, selected.relativePath));

    if (!fs.existsSync(workingFile.fsPath)) {
      vscode.window.showWarningMessage(`File "${selected.relativePath}" does not exist in working copy.`);
      return;
    }

    await vscode.commands.executeCommand('vscode.diff',
      versionFile, workingFile,
      `${selected.relativePath} (${item.version.versionTag} ↔ working)`
    );
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
      vscode.window.showWarningMessage('No working copy found to compare against.');
      return;
    }

    const workingFilePath = path.join(workingDir, relativeFile);
    const versionUri = vscode.Uri.file(item.filePath);

    if (!fs.existsSync(workingFilePath)) {
      const action = await vscode.window.showWarningMessage(
        `"${relativeFile}" does not exist in the working copy.`,
        'Open Version File'
      );
      if (action === 'Open Version File') {
        await vscode.commands.executeCommand('vscode.open', versionUri);
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
      prompt: isFolder ? 'Enter folder name' : 'Enter file name',
      placeHolder: isFolder ? 'new-folder' : 'new-file.txt'
    });
    if (!name) { return; }

    const targetPath = path.join(targetDir, name);
    if (fs.existsSync(targetPath)) {
      vscode.window.showErrorMessage(`"${name}" already exists.`);
      return;
    }

    try {
      if (isFolder) {
        fs.mkdirSync(targetPath, { recursive: true });
      } else {
        fs.mkdirSync(path.dirname(targetPath), { recursive: true });
        fs.writeFileSync(targetPath, '', 'utf8');
        const doc = await vscode.workspace.openTextDocument(targetPath);
        await vscode.window.showTextDocument(doc);
      }
      this.treeProvider.refresh();
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to create: ${error}`);
    }
  }

  private async renameFileSystemItem(item: FileSystemTreeItem): Promise<void> {
    if (!item) { return; }

    const oldName = path.basename(item.filePath);
    const newName = await vscode.window.showInputBox({
      prompt: `Rename "${oldName}"`,
      value: oldName
    });
    if (!newName || newName === oldName) { return; }

    const newPath = path.join(path.dirname(item.filePath), newName);
    if (fs.existsSync(newPath)) {
      vscode.window.showErrorMessage(`"${newName}" already exists.`);
      return;
    }

    try {
      fs.renameSync(item.filePath, newPath);
      this.treeProvider.refresh();
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to rename: ${error}`);
    }
  }

  private async deleteFileSystemItem(item: FileSystemTreeItem): Promise<void> {
    if (!item) { return; }

    const name = path.basename(item.filePath);
    const label = item.isDirectory ? `folder "${name}" and all its contents` : `file "${name}"`;
    const confirm = await vscode.window.showWarningMessage(
      `Delete ${label}?`, 'Delete', 'Cancel'
    );
    if (confirm !== 'Delete') { return; }

    try {
      fs.rmSync(item.filePath, { recursive: true, force: true });
      this.treeProvider.refresh();
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to delete: ${error}`);
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
      vscode.window.showErrorMessage('Invalid example item');
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

    await this.exampleDetailProvider.show(`Example: ${item.example.title}`, {
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
        vscode.window.showErrorMessage('Test configuration can only be edited on working copies');
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
        vscode.window.showErrorMessage('Invalid file item');
        return;
      }
      testYamlPath = item.filePath;
      exampleDir = path.dirname(testYamlPath);
    } else {
      vscode.window.showErrorMessage('Invalid item');
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
      `Test Editor: ${exampleTitle || path.basename(exampleDir)}`,
      {
        filePath: testYamlPath,
        exampleDir,
        exampleTitle
      }
    );
  }

  private async addTests(item: CheckedOutVersionTreeItem): Promise<void> {
    if (!item?.version?.isWorking) {
      vscode.window.showErrorMessage('Tests can only be added to working copies');
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
      `Test Editor: ${exampleTitle || path.basename(workingDir)}`,
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
        vscode.window.showErrorMessage('Meta configuration can only be edited on working copies');
        return;
      }
      exampleDir = item.version.fullPath;
      metaYamlPath = path.join(exampleDir, 'meta.yaml');
    } else if (item instanceof FileSystemTreeItem) {
      metaYamlPath = item.filePath;
      exampleDir = path.dirname(metaYamlPath);
    } else {
      vscode.window.showErrorMessage('Invalid item');
      return;
    }

    if (!fs.existsSync(metaYamlPath)) {
      vscode.window.showErrorMessage('meta.yaml not found');
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
      languages = [{ code: 'en', name: 'English' }, { code: 'de', name: 'German' }];
    }

    await this.metaYamlEditorProvider.show(
      `Meta Editor: ${exampleTitle || path.basename(exampleDir)}`,
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
      vscode.window.showErrorMessage('Invalid content directory');
      return;
    }

    let languages: { code: string; name: string }[];
    try {
      languages = await this.apiService.getLanguages();
    } catch {
      languages = [{ code: 'en', name: 'English' }, { code: 'de', name: 'German' }];
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
      vscode.window.showInformationMessage('Readmes for all available languages already exist');
      return;
    }

    // Default to 'en' if available
    const hasEnglish = availableLanguages.some(l => l.code === 'en');
    const sortedLanguages = hasEnglish
      ? [availableLanguages.find(l => l.code === 'en')!, ...availableLanguages.filter(l => l.code !== 'en')]
      : availableLanguages;

    const picked = await vscode.window.showQuickPick(
      sortedLanguages.map(l => ({ label: l.name, description: l.code, langCode: l.code })),
      { placeHolder: 'Select language for the readme' }
    );

    if (!picked) { return; }

    const filename = `index_${picked.langCode}.md`;
    const filePath = path.join(item.filePath, filename);

    fs.writeFileSync(filePath, `# \n`, 'utf8');
    this.treeProvider.refresh();

    const doc = await vscode.workspace.openTextDocument(filePath);
    await vscode.window.showTextDocument(doc);
  }

  private async runExampleTests(item: CheckedOutVersionTreeItem): Promise<void> {
    if (!item?.version?.fullPath) {
      vscode.window.showErrorMessage('Invalid example item');
      return;
    }

    if (!fs.existsSync(item.version.fullPath)) {
      vscode.window.showErrorMessage('Example directory not found.');
      return;
    }

    const installer = ComputorTestingInstaller.getInstance();
    await installer.runTests(item.version.fullPath);
  }
}
