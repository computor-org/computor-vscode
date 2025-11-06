import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as yaml from 'js-yaml';
import JSZip from 'jszip';
import { ComputorApiService } from '../services/ComputorApiService';
import { ExampleTreeItem, ExampleRepositoryTreeItem, LecturerExampleTreeProvider } from '../ui/tree/lecturer/LecturerExampleTreeProvider';
import { ExampleUploadRequest, CourseContentCreate, CourseContentList, CourseList } from '../types/generated';
import { LecturerRepositoryManager } from '../services/LecturerRepositoryManager';

/**
 * Simplified example commands for the lecturer view
 */
export class LecturerExampleCommands {
  constructor(
    private context: vscode.ExtensionContext,
    private apiService: ComputorApiService,
    private treeProvider: LecturerExampleTreeProvider
  ) {
    this.registerCommands();
  }
  private assignmentsRootCache: { courseId: string; path: string } | null = null;

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

    // Checkout example
    this.context.subscriptions.push(
      vscode.commands.registerCommand('computor.lecturer.checkoutExample', async (item: ExampleTreeItem) => {
        await this.checkoutExample(item);
      })
    );

    // Checkout all filtered examples from repository
    this.context.subscriptions.push(
      vscode.commands.registerCommand('computor.lecturer.checkoutAllFilteredExamples', async (item: ExampleRepositoryTreeItem) => {
        await this.checkoutAllFilteredExamples(item);
      })
    );

    // Upload example
    this.context.subscriptions.push(
      vscode.commands.registerCommand('computor.lecturer.uploadExample', async (item: ExampleTreeItem) => {
        await this.uploadExample(item);
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
  }

  /**
   * Checkout an example to the workspace
   */
  private async checkoutExample(item: ExampleTreeItem): Promise<void> {
    if (!item || !item.example) {
      vscode.window.showErrorMessage('Invalid example item');
      return;
    }

    const assignmentsRoot = await this.getAssignmentsRoot();
    if (!assignmentsRoot) {
      return;
    }

    try {
      const examplePath = path.join(assignmentsRoot, item.example.directory);
      
      // Check if directory already exists
      if (fs.existsSync(examplePath)) {
        const overwrite = await vscode.window.showWarningMessage(
          `Directory '${item.example.directory}' already exists. Overwrite?`,
          'Yes', 'No'
        );
        
        if (overwrite !== 'Yes') {
          return;
        }
        
        // Remove existing directory
        fs.rmSync(examplePath, { recursive: true, force: true });
      }

      // Download the example
      const exampleData = await this.apiService.downloadExample(item.example.id, false);
      if (!exampleData) {
        vscode.window.showErrorMessage('Failed to download example');
        return;
      }

      // Create directory
      fs.mkdirSync(examplePath, { recursive: true });

      // Write all files from the download response
      for (const [filename, content] of Object.entries(exampleData.files)) {
        const filePath = path.join(examplePath, filename);
        const fileDir = path.dirname(filePath);
        
        // Create subdirectories if needed
        if (!fs.existsSync(fileDir)) {
          fs.mkdirSync(fileDir, { recursive: true });
        }
        
        // Write file content (handle binary vs text)
        try {
          const ext = path.extname(filename).toLowerCase();
          const binaryExtensions = new Set(['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.svg', '.pdf', '.zip', '.gz', '.tar', '.rar', '.7z', '.webp']);
          if (typeof content === 'string' && content.startsWith('data:') && content.includes(';base64,')) {
            const base64 = content.split(';base64,')[1] || '';
            const buffer = Buffer.from(base64, 'base64');
            fs.writeFileSync(filePath, buffer);
          } else if (binaryExtensions.has(ext)) {
            // Attempt to decode as base64 for known binary extensions
            const maybeBase64 = content as string;
            const isProbablyBase64 = /^[A-Za-z0-9+/=\r\n]+$/.test(maybeBase64) && (maybeBase64.replace(/\s+/g, '').length % 4 === 0);
            if (isProbablyBase64) {
              const buffer = Buffer.from(maybeBase64, 'base64');
              fs.writeFileSync(filePath, buffer);
            } else {
              // Fallback: write raw bytes from utf8 string (may still corrupt if misidentified)
              fs.writeFileSync(filePath, maybeBase64);
            }
          } else {
            fs.writeFileSync(filePath, content, 'utf8');
          }
        } catch (e) {
          // Fallback to text write on any errors
          fs.writeFileSync(filePath, content, 'utf8');
        }
        
        // If this is meta.yaml, also create a .meta.yaml copy as source of truth
        if (filename === 'meta.yaml') {
          const hiddenMetaPath = path.join(examplePath, '.meta.yaml');
          fs.writeFileSync(hiddenMetaPath, content, 'utf8');
        }
      }

      // Mark example as downloaded and refresh tree with version information
      this.treeProvider.markExampleAsDownloaded(item.example.id, examplePath, exampleData.version_tag);

      const relativePath = path.relative(assignmentsRoot, examplePath) || '.';
      vscode.window.showInformationMessage(`Example '${item.example.title}' checked out to assignments: ${relativePath}`);
    } catch (error) {
      console.error('Failed to checkout example:', error);
      vscode.window.showErrorMessage(`Failed to checkout example: ${error}`);
    }
  }

  /**
   * Checkout all filtered examples from a repository
   */
  private async checkoutAllFilteredExamples(item: ExampleRepositoryTreeItem): Promise<void> {
    if (!item || !item.repository) {
      vscode.window.showErrorMessage('Invalid repository item');
      return;
    }

    const assignmentsRoot = await this.getAssignmentsRoot();
    if (!assignmentsRoot) {
      return;
    }

    try {
      // Get all filtered examples for this repository
      const filteredExamples = await this.treeProvider.getFilteredExamplesForRepository(item.repository);
      
      if (filteredExamples.length === 0) {
        vscode.window.showInformationMessage('No examples match the current filters');
        return;
      }

      // Confirm with user
      const activeFilters: string[] = [];
      const searchQuery = this.treeProvider.getSearchQuery();
      const selectedCategory = this.treeProvider.getSelectedCategory();
      const selectedTags = this.treeProvider.getSelectedTags();
      
      if (searchQuery) activeFilters.push(`search: "${searchQuery}"`);
      if (selectedCategory) activeFilters.push(`category: ${selectedCategory}`);
      if (selectedTags.length > 0) activeFilters.push(`tags: ${selectedTags.join(', ')}`);
      
      const filterInfo = activeFilters.length > 0 
        ? ` with filters: ${activeFilters.join(', ')}`
        : '';
      
      const confirm = await vscode.window.showInformationMessage(
        `Checkout ${filteredExamples.length} example(s)${filterInfo}?`,
        'Yes', 'No'
      );

      if (confirm !== 'Yes') {
        return;
      }

      // Progress indicator
      await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'Checking out examples',
        cancellable: false
      }, async (progress) => {
        let successCount = 0;
        const errors: string[] = [];

        for (let i = 0; i < filteredExamples.length; i++) {
          const exampleItem = filteredExamples[i];
          if (!exampleItem || !exampleItem.example) continue;
          
          progress.report({ 
            increment: (100 / filteredExamples.length),
            message: `(${i + 1}/${filteredExamples.length}) ${exampleItem.example.title}`
          });

          try {
            const examplePath = path.join(assignmentsRoot, exampleItem.example.directory);
            
            // Skip if directory already exists
            if (fs.existsSync(examplePath)) {
              errors.push(`${exampleItem.example.title}: Directory already exists`);
              continue;
            }

            // Download the example
            const exampleData = await this.apiService.downloadExample(exampleItem.example.id, false);
            if (!exampleData) {
              errors.push(`${exampleItem.example.title}: Failed to download`);
              continue;
            }

            // Create directory
            fs.mkdirSync(examplePath, { recursive: true });

            // Write all files from the download response
            for (const [filename, content] of Object.entries(exampleData.files)) {
              const filePath = path.join(examplePath, filename);
              const fileDir = path.dirname(filePath);
              
              // Create subdirectories if needed
              if (!fs.existsSync(fileDir)) {
                fs.mkdirSync(fileDir, { recursive: true });
              }
              
              // Write file content (handle binary vs text)
              try {
                const ext = path.extname(filename).toLowerCase();
                const binaryExtensions = new Set(['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.svg', '.pdf', '.zip', '.gz', '.tar', '.rar', '.7z', '.webp']);
                if (typeof content === 'string' && content.startsWith('data:') && content.includes(';base64,')) {
                  const base64 = content.split(';base64,')[1] || '';
                  const buffer = Buffer.from(base64, 'base64');
                  fs.writeFileSync(filePath, buffer);
                } else if (binaryExtensions.has(ext)) {
                  const maybeBase64 = content as string;
                  const isProbablyBase64 = /^[A-Za-z0-9+/=\r\n]+$/.test(maybeBase64) && (maybeBase64.replace(/\s+/g, '').length % 4 === 0);
                  if (isProbablyBase64) {
                    const buffer = Buffer.from(maybeBase64, 'base64');
                    fs.writeFileSync(filePath, buffer);
                  } else {
                    fs.writeFileSync(filePath, maybeBase64);
                  }
                } else {
                  fs.writeFileSync(filePath, content, 'utf8');
                }
              } catch (e) {
                fs.writeFileSync(filePath, content, 'utf8');
              }
              
              // If this is meta.yaml, also create a .meta.yaml copy as source of truth
              if (filename === 'meta.yaml') {
                const hiddenMetaPath = path.join(examplePath, '.meta.yaml');
                fs.writeFileSync(hiddenMetaPath, content, 'utf8');
              }
            }

            // Mark example as downloaded with version information
            this.treeProvider.markExampleAsDownloaded(exampleItem.example.id, examplePath, exampleData.version_tag);

            successCount++;
          } catch (error) {
            errors.push(`${exampleItem.example.title}: ${error}`);
            console.error(`Failed to checkout example ${exampleItem.example.title}:`, error);
          }
        }

        // Show results
        if (successCount === filteredExamples.length) {
          vscode.window.showInformationMessage(
            `Successfully checked out ${successCount} example(s)`
          );
        } else if (successCount > 0) {
          const errorMessage = errors.length > 3 
            ? errors.slice(0, 3).join('; ') + '...'
            : errors.join('; ');
          vscode.window.showWarningMessage(
            `Checked out ${successCount} of ${filteredExamples.length} examples. Errors: ${errorMessage}`
          );
        } else {
          vscode.window.showErrorMessage(
            `Failed to checkout examples. ${errors[0]}`
          );
        }
      });
    } catch (error) {
      console.error('Failed to checkout filtered examples:', error);
      vscode.window.showErrorMessage(`Failed to checkout examples: ${error}`);
    }
  }

  private async getAssignmentsRoot(): Promise<string | undefined> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      vscode.window.showErrorMessage('No workspace folder open');
      return undefined;
    }

    const markerPath = path.join(workspaceFolder.uri.fsPath, '.computor');
    let courseId: string | undefined;

    try {
      const raw = await fs.promises.readFile(markerPath, 'utf8');
      const marker = JSON.parse(raw);
      if (marker && typeof marker.courseId === 'string') {
        courseId = marker.courseId;
      }
    } catch (error) {
      console.warn('[LecturerExampleCommands] Failed to read course marker:', error);
    }

    if (!courseId) {
      vscode.window.showErrorMessage('Active course not found. Please run "Computor: Login" again.');
      return undefined;
    }

    if (this.assignmentsRootCache && this.assignmentsRootCache.courseId === courseId) {
      if (fs.existsSync(this.assignmentsRootCache.path)) {
        return this.assignmentsRootCache.path;
      }
      this.assignmentsRootCache = null;
    }

    const course = await this.apiService.getCourse(courseId);
    if (!course) {
      vscode.window.showErrorMessage('Unable to fetch course information.');
      return undefined;
    }

    const repoManager = new LecturerRepositoryManager(this.context, this.apiService);
    const assignmentsRoot = repoManager.getAssignmentsRepoRoot(course);
    if (!assignmentsRoot || !fs.existsSync(assignmentsRoot)) {
      vscode.window.showErrorMessage('Assignments repository not found. Run "Computor: Sync Assignments" first.');
      return undefined;
    }

    this.assignmentsRootCache = { courseId, path: assignmentsRoot };
    return assignmentsRoot;
  }

  /**
   * Upload a downloaded example back to the repository
   */
  private async uploadExample(item: ExampleTreeItem): Promise<void> {
    if (!item || !item.isDownloaded || !item.downloadPath) {
      vscode.window.showErrorMessage('This example is not downloaded locally');
      return;
    }

    if (!fs.existsSync(item.downloadPath)) {
      vscode.window.showErrorMessage(`Example directory not found: ${item.downloadPath}`);
      return;
    }

    try {
      // Confirm with user
      const confirm = await vscode.window.showInformationMessage(
        `Upload example "${item.example.title}" from local directory?`,
        'Yes', 'No'
      );

      if (confirm !== 'Yes') {
        return;
      }

      // Show progress
      await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: `Uploading example: ${item.example.title}`,
        cancellable: false
      }, async (progress) => {
        progress.report({ increment: 10, message: 'Packaging example as zip...' });

        // Package the example directory into a zip to preserve file types
        const zipper = new JSZip();

        const addToZip = (dirPath: string, basePath: string) => {
          const entries = fs.readdirSync(dirPath);
          for (const entry of entries) {
            if (entry === 'node_modules' || entry === '.git' || entry.startsWith('.')) continue;
            const fullPath = path.join(dirPath, entry);
            const stat = fs.statSync(fullPath);
            const relativePath = path.relative(basePath, fullPath).replace(/\\/g, '/');
            if (stat.isFile()) {
              if (entry === '.meta.yaml') continue; // local tracking only
              const data = fs.readFileSync(fullPath);
              zipper.file(relativePath, data);
            } else if (stat.isDirectory()) {
              addToZip(fullPath, basePath);
            }
          }
        };

        addToZip(item.downloadPath!, item.downloadPath!);

        // Generate base64 zip content
        const base64Zip = await zipper.generateAsync({ type: 'base64', compression: 'DEFLATE' });

        progress.report({ increment: 40, message: 'Preparing upload...' });

        // Create upload request with a single zip entry
        const zipName = `${item.example.directory}.zip`;
        const uploadRequest: ExampleUploadRequest = {
          repository_id: item.repository.id,
          directory: item.example.directory,
          files: { [zipName]: base64Zip }
        };

        progress.report({ increment: 20, message: 'Uploading to server...' });

        // Upload the example
        const result = await this.apiService.uploadExample(uploadRequest);
        
        if (result) {
          progress.report({ increment: 30, message: 'Complete!' });
          vscode.window.showInformationMessage(`Successfully uploaded example: ${item.example.title}`);
          
          // Refresh the tree to show any updates
          this.treeProvider.refresh();
        } else {
          throw new Error('Upload failed - no response from server');
        }
      });
    } catch (error) {
      console.error('Failed to upload example:', error);
      vscode.window.showErrorMessage(`Failed to upload example: ${error}`);
    }
  }

  /**
   * Create a new example
   */
  private async createNewExample(): Promise<void> {
    const title = await vscode.window.showInputBox({
      prompt: 'Example Title',
      placeHolder: 'Enter a title for the new example'
    });

    if (!title) {
      return;
    }

    const identifier = await vscode.window.showInputBox({
      prompt: 'Example Identifier',
      placeHolder: 'e.g., hello.world.basic',
      value: title.toLowerCase().replace(/\s+/g, '.')
    });

    if (!identifier) {
      return;
    }

    const directory = await vscode.window.showInputBox({
      prompt: 'Directory Name',
      placeHolder: 'Directory name for the example',
      value: identifier.replace(/\./g, '-')
    });

    if (!directory) {
      return;
    }

    // Create example in workspace
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      vscode.window.showErrorMessage('No workspace folder open');
      return;
    }

    // Create example directly in workspace root
    const examplePath = path.join(workspaceFolder.uri.fsPath, directory);
    
    try {
      // Check if directory already exists
      if (fs.existsSync(examplePath)) {
        vscode.window.showErrorMessage(`Directory '${directory}' already exists in workspace`);
        return;
      }
      
      // Create directory
      fs.mkdirSync(examplePath, { recursive: true });

      // Create meta.yaml file
      const metaContent = `title: ${title}
identifier: ${identifier}
directory: ${directory}
category: ""
tags: []
description: |
  Example description here
`;

      fs.writeFileSync(path.join(examplePath, 'meta.yaml'), metaContent);

      // Create README.md
      const readmeContent = `# ${title}

## Description
Add your example description here.

## Usage
Explain how to use this example.
`;

      fs.writeFileSync(path.join(examplePath, 'README.md'), readmeContent);

      vscode.window.showInformationMessage(`Example '${title}' created at ${examplePath}`);
      
      // Open the meta.yaml file
      const doc = await vscode.workspace.openTextDocument(path.join(examplePath, 'meta.yaml'));
      await vscode.window.showTextDocument(doc);
    } catch (error) {
      console.error('Failed to create example:', error);
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
    
    // TODO: Read meta.yaml, package the example, and upload
    // IMPORTANT: When packaging, exclude .meta.yaml file (it's only for local version tracking)
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

  /**
   * Reveal a downloaded example in the VS Code explorer
   */
  private async revealExampleInExplorer(item: ExampleTreeItem): Promise<void> {
    if (!item || !item.example) {
      vscode.window.showErrorMessage('Invalid example item');
      return;
    }

    if (!item.isDownloaded || !item.downloadPath) {
      vscode.window.showErrorMessage('Example is not downloaded yet');
      return;
    }

    try {
      // Convert to URI and reveal in explorer
      const folderUri = vscode.Uri.file(item.downloadPath);
      await vscode.commands.executeCommand('revealInExplorer', folderUri);
    } catch (error) {
      console.error('Failed to reveal example in explorer:', error);
      vscode.window.showErrorMessage(`Failed to reveal in explorer: ${error}`);
    }
  }

  private async getNextPosition(courseId: string, parentPath: string | undefined, contents: CourseContentList[]): Promise<number> {
    void courseId; // Currently unused but kept for future use
    // Filter contents at the same level
    const sameLevelContents = contents.filter(c => {
      if (!parentPath) {
        // Root level - items with no dots in path
        return !c.path.includes('.');
      } else {
        // Children of parent - items that start with parent path and have exactly one more segment
        if (!c.path.startsWith(parentPath + '.')) {
          return false;
        }
        const relativePath = c.path.substring(parentPath.length + 1);
        return !relativePath.includes('.');
      }
    });
    
    // Find the highest position and add 1
    const maxPosition = sameLevelContents.reduce((max, c) => Math.max(max, c.position || 0), 0);
    return maxPosition + 1;
  }
}
