# Developer Guide

This guide is for developers who want to contribute to or extend the Computor VS Code Extension.

## Table of Contents

- [Development Setup](#development-setup)
- [Project Structure](#project-structure)
- [Development Workflow](#development-workflow)
- [Architecture Patterns](#architecture-patterns)
- [Coding Guidelines](#coding-guidelines)
- [Testing](#testing)
- [Debugging](#debugging)
- [Contributing](#contributing)

---

## Development Setup

### Prerequisites

- Node.js (v16 or higher)
- npm (v7 or higher)
- Git
- VS Code (latest version)

### Initial Setup

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd computor-vsc-extension
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Compile TypeScript**
   ```bash
   npm run compile
   ```

4. **Run in development mode**
   - Press `F5` in VS Code to launch Extension Development Host
   - Or use the "Run Extension" configuration from the debug panel

### NPM Scripts

| Script | Description |
|--------|-------------|
| `npm run compile` | Type-check and compile with webpack |
| `npm run compile:fast` | Compile without type-checking (faster) |
| `npm run watch` | Watch mode for development |
| `npm run package` | Production build with minification |
| `npm run type-check` | Run TypeScript type checking only |
| `npm run lint` | Run ESLint on source files |
| `npm run test` | Run all Mocha unit tests |
| `npm run test:unit` | Run unit tests only |
| `npm run test:integration` | Run Jest integration tests |
| `npm run test:all` | Run both unit and integration tests |

---

## Project Structure

See [Architecture Overview](architecture.md#project-structure) for detailed structure.

### Key Directories

- **`src/`** - All source code
  - **`commands/`** - Command implementations
  - **`services/`** - Business logic
  - **`ui/`** - User interface components
  - **`http/`** - HTTP client layer
  - **`git/`** - Git integration
  - **`types/`** - TypeScript type definitions

- **`test/`** - Test files
  - **`unit/`** - Unit tests
  - **`integration/`** - Integration tests
  - **`fixtures/`** - Test data

- **`dist/`** - Compiled output (generated)

---

## Development Workflow

### 1. Development Mode

Run the extension in development mode:

```bash
npm run watch
```

Then press `F5` to launch the Extension Development Host.

### 2. Making Changes

1. Create a feature branch
   ```bash
   git checkout -b feature/my-feature
   ```

2. Make your changes

3. Type-check your code
   ```bash
   npm run type-check
   ```

4. Lint your code
   ```bash
   npm run lint
   ```

5. Write tests for new functionality

6. Run tests
   ```bash
   npm run test
   ```

### 3. Git Workflow

Following the project's coding guidelines from [CLAUDE.md](../CLAUDE.md):

- **Small commits**: Keep commits focused and atomic
- **Descriptive messages**: Write clear, concise commit messages
- **Create issues**: Use `gh` CLI to create issues for new features
- **Ask before committing**: Confirm before making commits

Example:
```bash
# Create an issue for tracking
gh issue create --title "Add feature X" --body "Description..."

# Make changes and commit
git add .
git commit -m "feat: add feature X"

# Create PR
gh pr create --title "Add feature X" --body "Closes #123"
```

---

## Architecture Patterns

### Service Pattern

Services encapsulate business logic and provide a clean API:

```typescript
export class MyService {
  private dependency: SomeDependency;

  constructor(dependency: SomeDependency) {
    this.dependency = dependency;
  }

  async performAction(): Promise<void> {
    // Business logic here
  }
}
```

### Command Pattern

Commands are VS Code command handlers:

```typescript
export class MyCommands {
  constructor(
    private context: vscode.ExtensionContext,
    private service: MyService
  ) {}

  registerCommands(): void {
    this.context.subscriptions.push(
      vscode.commands.registerCommand('computor.myCommand',
        () => this.handleMyCommand()
      )
    );
  }

  private async handleMyCommand(): Promise<void> {
    try {
      await this.service.performAction();
      vscode.window.showInformationMessage('Success!');
    } catch (error) {
      vscode.window.showErrorMessage(`Error: ${error}`);
    }
  }
}
```

### Tree Provider Pattern

Tree providers display hierarchical data:

```typescript
export class MyTreeProvider implements vscode.TreeDataProvider<MyTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<MyTreeItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private api: ComputorApiService) {}

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: MyTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: MyTreeItem): Promise<MyTreeItem[]> {
    if (!element) {
      // Root level
      const data = await this.api.getData();
      return data.map(item => new MyTreeItem(item));
    }
    // Children of element
    return element.getChildren();
  }
}
```

### Webview Provider Pattern

Webviews display rich HTML content:

```typescript
export class MyWebviewProvider extends BaseWebviewProvider {
  constructor(
    context: vscode.ExtensionContext,
    private api: ComputorApiService
  ) {
    super(context);
  }

  async open(): Promise<void> {
    const panel = this.createPanel('My View', 'myView');
    panel.webview.html = this.getHtmlContent();

    panel.webview.onDidReceiveMessage(async (message) => {
      await this.handleMessage(message);
    });
  }

  private getHtmlContent(): string {
    return `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8">
          <title>My View</title>
        </head>
        <body>
          <h1>Hello from Webview</h1>
          <script>
            const vscode = acquireVsCodeApi();
            // Handle messages
          </script>
        </body>
      </html>
    `;
  }

  private async handleMessage(message: any): Promise<void> {
    switch (message.command) {
      case 'action':
        await this.api.performAction();
        break;
    }
  }
}
```

---

## Coding Guidelines

Following [CLAUDE.md](../CLAUDE.md):

### Naming Conventions

- **camelCase**: Variables, functions, methods, parameters
  ```typescript
  const userName = 'Alice';
  function getUserData() { }
  ```

- **PascalCase**: Classes, interfaces, types, enums
  ```typescript
  class HttpClient { }
  interface UserData { }
  type RequestConfig = { };
  enum ButtonVariant { }
  ```

- **SCREAMING_SNAKE_CASE**: Constants and enum values
  ```typescript
  const MAX_RETRY_COUNT = 3;
  enum Status {
    SUCCESS = 'SUCCESS',
    FAILED = 'FAILED'
  }
  ```

- **kebab-case**: File names
  ```typescript
  // my-service.ts
  // user-profile-view.ts
  ```

### Unused Parameters

Never use underscore prefix. Instead, use `void`:

```typescript
// ✗ Wrong
function example(_unusedParam: string, usedParam: number) {
  return usedParam * 2;
}

// ✓ Correct
function example(unusedParam: string, usedParam: number) {
  void unusedParam;
  return usedParam * 2;
}
```

### Type Safety

- **Avoid `any`**: Use specific types
- **Use interfaces**: For object shapes
- **Use type guards**: For runtime type checking

```typescript
// ✗ Avoid
function process(data: any) {
  return data.value;
}

// ✓ Better
interface Data {
  value: string;
}

function process(data: Data): string {
  return data.value;
}
```

### Comments

From [CLAUDE.md](../CLAUDE.md):

- **Use speaking names**: Let code explain itself
- **Avoid redundant comments**: Don't comment what code already says
- **Comment only when needed**: Complex algorithms, workarounds, non-obvious decisions

```typescript
// ✗ Redundant
// Get the user name
const userName = user.name;

// ✓ Useful comment
// Using setTimeout to avoid race condition with VS Code API
// See issue #123
setTimeout(() => refresh(), 100);
```

### SOLID Principles

- **Single Responsibility**: Each class has one reason to change
- **Open/Closed**: Open for extension, closed for modification
- **Liskov Substitution**: Subtypes must be substitutable for base types
- **Interface Segregation**: Many specific interfaces > one general interface
- **Dependency Inversion**: Depend on abstractions, not concretions

### Error Handling

Always handle errors gracefully:

```typescript
async function performAction(): Promise<void> {
  try {
    await riskyOperation();
  } catch (error) {
    if (error instanceof HttpError) {
      vscode.window.showErrorMessage(`HTTP Error: ${error.message}`);
    } else if (error instanceof GitError) {
      vscode.window.showErrorMessage(`Git Error: ${error.message}`);
    } else {
      vscode.window.showErrorMessage(`Unexpected error: ${error}`);
    }
    // Log for debugging
    console.error('Error in performAction:', error);
  }
}
```

---

## Testing

### Unit Tests

Location: `test/unit/`

Framework: Mocha + Chai

Example:
```typescript
import { expect } from 'chai';
import { MyService } from '../../src/services/MyService';

describe('MyService', () => {
  let service: MyService;

  beforeEach(() => {
    service = new MyService();
  });

  describe('performAction', () => {
    it('should return expected result', async () => {
      const result = await service.performAction();
      expect(result).to.equal('expected');
    });

    it('should throw error on invalid input', async () => {
      await expect(service.performAction(null))
        .to.be.rejectedWith('Invalid input');
    });
  });
});
```

Run unit tests:
```bash
npm run test:unit
```

### Integration Tests

Location: `test/integration/`

Framework: Jest

Example:
```typescript
import { ComputorApiService } from '../../src/services/ComputorApiService';

describe('ComputorApiService Integration', () => {
  let api: ComputorApiService;

  beforeAll(() => {
    // Setup
    api = new ComputorApiService(mockContext);
  });

  test('should fetch courses', async () => {
    const courses = await api.getCourses();
    expect(courses).toBeInstanceOf(Array);
  });
});
```

Run integration tests:
```bash
npm run test:integration
```

### Manual Tests

Location: `test/integration/manual/`

For testing Git and GitLab functionality:

```bash
npm run test:git-basic
npm run test:gitlab
```

### Test Coverage

Aim for:
- **Unit tests**: Core business logic (services, utilities)
- **Integration tests**: API interactions, complex workflows
- **Manual tests**: Git operations, UI flows

---

## Debugging

### Debugging the Extension

1. Set breakpoints in your code
2. Press `F5` to start debugging
3. The Extension Development Host launches
4. Breakpoints hit when code executes

### Debugging Webviews

Webviews run in a separate context:

1. Open Extension Development Host
2. Open webview
3. Run command: `Developer: Open Webview Developer Tools`
4. Use Chrome DevTools to debug HTML/JS

### Debugging Tests

Add debug configuration to `.vscode/launch.json`:

```json
{
  "type": "node",
  "request": "launch",
  "name": "Mocha Tests",
  "program": "${workspaceFolder}/node_modules/mocha/bin/_mocha",
  "args": [
    "--require", "ts-node/register",
    "--timeout", "999999",
    "--colors",
    "${workspaceFolder}/test/unit/**/*.test.ts"
  ],
  "console": "integratedTerminal",
  "internalConsoleOptions": "neverOpen"
}
```

### Logging

Use VS Code output channel for logging:

```typescript
const outputChannel = vscode.window.createOutputChannel('Computor');
outputChannel.appendLine('Debug message');
outputChannel.show();
```

Or use console for development:
```typescript
console.log('Debug:', data);
console.error('Error:', error);
```

---

## Adding New Features

### Adding a New Command

1. **Define command in package.json**
   ```json
   {
     "command": "computor.myNewCommand",
     "title": "My New Command",
     "category": "Computor"
   }
   ```

2. **Implement command handler**
   ```typescript
   // src/commands/MyCommands.ts
   export class MyCommands {
     registerCommands(): void {
       this.context.subscriptions.push(
         vscode.commands.registerCommand('computor.myNewCommand',
           () => this.handleMyCommand()
         )
       );
     }

     private async handleMyCommand(): Promise<void> {
       // Implementation
     }
   }
   ```

3. **Register in extension.ts**
   ```typescript
   const myCommands = new MyCommands(context, api);
   myCommands.registerCommands();
   ```

### Adding a New Tree View

1. **Define view in package.json**
   ```json
   {
     "views": {
       "computor-student": [
         {
           "id": "computor.myTreeView",
           "name": "My Tree View"
         }
       ]
     }
   }
   ```

2. **Implement tree provider**
   ```typescript
   export class MyTreeProvider implements vscode.TreeDataProvider<MyTreeItem> {
     // Implementation
   }
   ```

3. **Register in extension.ts**
   ```typescript
   const provider = new MyTreeProvider(api);
   vscode.window.registerTreeDataProvider('computor.myTreeView', provider);
   ```

### Adding a New API Endpoint

1. **Define types in types/generated/**
   ```typescript
   // src/types/generated/my-feature.ts
   export interface MyFeatureGet {
     id: string;
     name: string;
   }
   ```

2. **Add method to ComputorApiService**
   ```typescript
   async getMyFeature(id: string): Promise<MyFeatureGet> {
     return this.get<MyFeatureGet>(`/api/my-feature/${id}`);
   }
   ```

3. **Use in commands/services**
   ```typescript
   const feature = await this.api.getMyFeature('123');
   ```

### Adding a New Webview

1. **Create webview provider**
   ```typescript
   export class MyWebviewProvider extends BaseWebviewProvider {
     async open(): Promise<void> {
       const panel = this.createPanel('My View', 'myView');
       panel.webview.html = this.getHtmlContent();
     }
   }
   ```

2. **Register command to open**
   ```typescript
   vscode.commands.registerCommand('computor.openMyView', async () => {
     const provider = new MyWebviewProvider(context, api);
     await provider.open();
   });
   ```

---

## Working with Generated Types

Types in `src/types/generated/` are generated from the backend API.

### Updating Generated Types

1. Get OpenAPI/Swagger spec from backend
2. Use code generator (e.g., openapi-typescript)
3. Place generated types in `src/types/generated/`
4. Export from `src/types/generated/index.ts`

### Using Generated Types

```typescript
import { CourseGet, CourseUpdate } from '../types/generated';

async function updateCourse(id: string, updates: Partial<CourseUpdate>): Promise<CourseGet> {
  return api.updateCourse(id, updates);
}
```

---

## Performance Considerations

### Caching

Use the built-in cache service:

```typescript
import { multiTierCache } from '../services/CacheService';

async function getData(): Promise<Data> {
  const cacheKey = 'my-data';
  const cached = multiTierCache.get<Data>(cacheKey);
  if (cached) return cached;

  const data = await api.getData();
  multiTierCache.set(cacheKey, data, 300000); // 5 min TTL
  return data;
}
```

### Request Batching

Use the request batching service for multiple similar requests:

```typescript
import { requestBatchingService } from '../services/RequestBatchingService';

async function getMultipleCourses(ids: string[]): Promise<Course[]> {
  const requests = ids.map(id =>
    requestBatchingService.addRequest('courses', { id })
  );
  return Promise.all(requests);
}
```

### Virtual Scrolling

For large lists, use virtual scrolling:

```typescript
import { virtualScrollingService } from '../services/VirtualScrollingService';

const items = virtualScrollingService.getVisibleItems(
  allItems,
  scrollPosition,
  viewportHeight
);
```

---

## Common Patterns

### Showing Progress

```typescript
await vscode.window.withProgress(
  {
    location: vscode.ProgressLocation.Notification,
    title: 'Performing action...',
    cancellable: false
  },
  async (progress) => {
    progress.report({ increment: 0 });
    await step1();
    progress.report({ increment: 50, message: 'Step 1 done' });
    await step2();
    progress.report({ increment: 100, message: 'Complete' });
  }
);
```

### User Input

```typescript
const input = await vscode.window.showInputBox({
  title: 'Enter value',
  prompt: 'Please enter a value',
  placeHolder: 'value',
  validateInput: (value) => {
    if (!value) return 'Value is required';
    return undefined;
  }
});

if (!input) return; // User cancelled
```

### Quick Pick

```typescript
const choice = await vscode.window.showQuickPick(
  [
    { label: 'Option 1', value: '1' },
    { label: 'Option 2', value: '2' }
  ],
  { title: 'Choose an option' }
);

if (!choice) return; // User cancelled
console.log(choice.value);
```

### Error Messages

```typescript
vscode.window.showErrorMessage('An error occurred', 'Retry', 'Cancel')
  .then(async (choice) => {
    if (choice === 'Retry') {
      await retryOperation();
    }
  });
```

---

## Contributing

### Before Submitting

1. **Type-check**: `npm run type-check`
2. **Lint**: `npm run lint`
3. **Test**: `npm run test`
4. **Build**: `npm run compile`

### Pull Request Process

1. Create a feature branch
2. Make your changes
3. Write/update tests
4. Update documentation
5. Commit with clear messages
6. Create pull request
7. Wait for review

### Code Review Checklist

- [ ] Code follows naming conventions
- [ ] No `any` types (unless absolutely necessary)
- [ ] Error handling implemented
- [ ] Tests written/updated
- [ ] Documentation updated
- [ ] No console.log in production code
- [ ] Type-checking passes
- [ ] Linting passes
- [ ] All tests pass

---

## Resources

- [VS Code Extension API](https://code.visualstudio.com/api)
- [TypeScript Documentation](https://www.typescriptlang.org/docs/)
- [simple-git Documentation](https://github.com/steveukx/git-js)
- [Mocha Documentation](https://mochajs.org/)
- [Chai Assertion Library](https://www.chaijs.com/)

---

## Troubleshooting Development Issues

### Extension Not Loading

- Check for TypeScript errors
- Rebuild: `npm run compile`
- Restart Extension Development Host

### Breakpoints Not Hitting

- Ensure source maps are enabled
- Check `launch.json` configuration
- Rebuild extension

### Tests Failing

- Check test dependencies are installed
- Ensure test fixtures are present
- Check for environment-specific issues

### Type Errors

- Run `npm run type-check` for detailed errors
- Check that all types are properly imported
- Verify generated types are up to date

---

## Next Steps

- Read the [Architecture Overview](architecture.md) for detailed system design
- Check the [User Guide](user-guide.md) to understand user workflows
- Explore the [API Reference](api-reference.md) for backend integration details
- Join the development team chat for questions and discussions
