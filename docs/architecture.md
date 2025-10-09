# Architecture Overview

This document describes the architecture of the Computor VS Code Extension.

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     VS Code Extension                    │
├─────────────────────────────────────────────────────────┤
│                                                           │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │   Student    │  │    Tutor     │  │  Lecturer    │  │
│  │     View     │  │     View     │  │     View     │  │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  │
│         │                  │                  │           │
│         └──────────────────┴──────────────────┘           │
│                            │                               │
│                  ┌─────────▼─────────┐                    │
│                  │  ComputorApiService│                    │
│                  └─────────┬─────────┘                    │
│                            │                               │
│         ┌──────────────────┼──────────────────┐           │
│         │                  │                  │           │
│  ┌──────▼───────┐  ┌──────▼───────┐  ┌──────▼───────┐  │
│  │     HTTP     │  │     Git      │  │   Settings   │  │
│  │   Clients    │  │  Management  │  │   Storage    │  │
│  └──────────────┘  └──────────────┘  └──────────────┘  │
└─────────────────────────────────────────────────────────┘
                            │
                   ┌────────▼────────┐
                   │ Computor Backend│
                   └─────────────────┘
```

## Project Structure

```
src/
├── authentication/          # Authentication and credential management
│   ├── ComputorCredentialManager.ts
│   ├── TokenManager.ts
│   └── VscodeCredentialStorage.ts
│
├── commands/                # VS Code command implementations
│   ├── lecturer/            # Lecturer-specific commands
│   ├── LecturerCommands.ts
│   ├── LecturerExampleCommands.ts
│   ├── LecturerFsCommands.ts
│   ├── StudentCommands.ts
│   ├── TutorCommands.ts
│   ├── UserPasswordCommands.ts
│   └── manageGitLabTokens.ts
│
├── git/                     # Git integration layer
│   ├── CTGit.ts             # Custom git operations
│   ├── GitManager.ts        # High-level git management
│   ├── GitWrapper.ts        # simple-git wrapper
│   ├── GitErrorHandler.ts
│   └── simpleGitFactory.ts
│
├── http/                    # HTTP client implementations
│   ├── cache/               # HTTP caching strategies
│   ├── errors/              # HTTP error handling
│   ├── BasicAuthHttpClient.ts
│   ├── ApiKeyHttpClient.ts
│   ├── JwtHttpClient.ts
│   └── HttpClient.ts        # Base client interface
│
├── providers/               # VS Code providers
│   ├── ExampleCodeLensProvider.ts
│   ├── MetaYamlCompletionProvider.ts
│   └── MetaYamlStatusBarProvider.ts
│
├── services/                # Business logic services
│   ├── BackendConnectionService.ts
│   ├── CacheService.ts
│   ├── ComputorApiService.ts     # Main API service
│   ├── CourseSelectionService.ts
│   ├── ErrorRecoveryService.ts
│   ├── ExtensionUpdateService.ts
│   ├── GitBranchManager.ts
│   ├── GitEnvironmentService.ts
│   ├── GitLabTokenManager.ts
│   ├── LecturerRepositoryManager.ts
│   ├── PerformanceMonitoringService.ts
│   ├── RequestBatchingService.ts
│   ├── StudentRepositoryManager.ts
│   ├── StudentWorkspaceManager.ts
│   ├── TestResultService.ts
│   ├── TutorSelectionService.ts
│   ├── VirtualScrollingService.ts
│   └── WorkspaceManager.ts
│
├── settings/                # Settings and storage
│   ├── errors/
│   ├── ComputorSettingsManager.ts
│   ├── JsonSettingsStorage.ts
│   ├── SecureStorage.ts
│   ├── SettingsStorage.ts
│   └── VscodeSecureStorage.ts
│
├── types/                   # TypeScript type definitions
│   └── generated/           # Generated types from backend
│       ├── auth.ts
│       ├── common.ts
│       ├── courses.ts
│       ├── examples.ts
│       ├── messages.ts
│       ├── organizations.ts
│       ├── roles.ts
│       ├── sso.ts
│       ├── tasks.ts
│       └── users.ts
│
├── ui/                      # User interface components
│   ├── base/                # Base UI classes
│   ├── panels/              # Webview panels
│   ├── tree/                # Tree view providers
│   │   ├── lecturer/
│   │   ├── student/
│   │   └── tutor/
│   ├── views/               # Custom views
│   ├── webviews/            # Webview providers
│   └── StatusBarService.ts
│
├── utils/                   # Utility functions
│   ├── deploymentHelpers.ts
│   ├── exec.ts
│   ├── gitUrlHelpers.ts
│   ├── IconGenerator.ts
│   ├── repositoryBackup.ts
│   ├── repositoryNaming.ts
│   └── workspaceStructure.ts
│
└── extension.ts             # Extension entry point
```

## Core Components

### Extension Entry Point

**File**: [extension.ts](../src/extension.ts)

The main extension activation flow:
1. Activates on VS Code startup (`onStartupFinished`)
2. Checks for existing authentication
3. Prompts for login if needed
4. Initializes role-based views
5. Sets up commands and providers

Key class: `UnifiedController` - manages the extension lifecycle and view initialization.

### Authentication System

**Directory**: [http/](../src/http/)

Uses bearer token authentication:
- **Bearer Token Auth**: Username/password login with JWT access and refresh tokens
- Automatic token refresh before expiration
- Secure token storage using VS Code's secret storage API

Authentication flow:
1. User provides username/password
2. Extension calls `/auth/login` endpoint with credentials
3. Backend returns access token, refresh token, and expiration
4. Access token used in `Authorization: Bearer` header
5. Token auto-refreshes via `/auth/refresh/local` endpoint

### HTTP Layer

**Directory**: [http/](../src/http/)

**Architecture**:
- Abstract `HttpClient` interface
- Implementation: `BearerTokenHttpClient` with automatic token refresh
- Built-in caching with `InMemoryCache` and `NoOpCache` strategies
- Centralized error handling through `HttpError`

**Features**:
- Request/response caching
- Automatic retry logic
- Request batching
- Performance monitoring

### ComputorApiService

**File**: [services/ComputorApiService.ts](../src/services/ComputorApiService.ts)

Central service for all backend API interactions. Provides type-safe methods for:
- Organizations and course families
- Courses and course content
- Examples and repositories
- Users and profiles
- Messages and comments
- Submissions and grading
- Test results

Uses generated types from [types/generated/](../src/types/generated/) for type safety.

### Git Integration

**Directory**: [git/](../src/git/)

**Key Components**:
- `GitManager`: High-level git operations
- `GitWrapper`: Wrapper around simple-git library
- `CTGit`: Custom git operations specific to Computor
- `GitBranchManager`: Branch creation and management
- `GitEnvironmentService`: Git environment validation

**Features**:
- Repository cloning with authentication
- GitLab token management
- Branch operations
- Commit and push operations
- Conflict detection and resolution
- Repository backup and recovery

### UI Architecture

**Directory**: [ui/](../src/ui/)

**Tree Views**:
- `LecturerTreeDataProvider`: Course management tree
- `LecturerExampleTreeProvider`: Example repository tree
- `StudentCourseContentTreeProvider`: Student course content tree
- `TutorTreeDataProvider`: Tutor grading tree
- `TestResultsTreeDataProvider`: Test results tree

**Webview Providers**:
- Course details and management
- User profile editor
- Messages and comments
- Submission details
- Tutor filters
- Test results panel

**Base Classes**:
- `BaseTreeDataProvider`: Common tree view functionality
- `BaseTreeItem`: Common tree item functionality
- `BaseWebviewProvider`: Common webview functionality

### Settings Management

**Directory**: [settings/](../src/settings/)

**ComputorSettingsManager** manages:
- Backend URL configuration
- Authentication provider selection
- Token settings (header name, prefix)
- Workspace-specific settings via `.computor` file

Settings are stored in:
- VS Code workspace settings (non-sensitive)
- VS Code secret storage (credentials)
- Workspace `.computor` file (backend URL, course ID)

### Services Layer

**Directory**: [services/](../src/services/)

**Key Services**:

- **BackendConnectionService**: Backend health checks
- **CacheService**: Multi-tier caching for API responses
- **CourseSelectionService**: Course selection state management
- **ErrorRecoveryService**: Automatic error recovery and retry
- **ExtensionUpdateService**: Extension version checking
- **GitLabTokenManager**: GitLab PAT management per origin
- **LecturerRepositoryManager**: Lecturer repository operations
- **RequestBatchingService**: Request batching and deduplication
- **StudentRepositoryManager**: Student repository lifecycle
- **TestResultService**: Test execution and result parsing
- **WorkspaceManager**: Workspace structure management

## Data Flow

### Student Assignment Workflow

```
1. Student browses courses
   └─> StudentCourseContentTreeProvider
       └─> ComputorApiService.getCourseContentsForStudent()
           └─> HTTP Client → Backend

2. Student clones assignment
   └─> StudentCommands.cloneRepository()
       └─> StudentRepositoryManager.cloneRepository()
           └─> GitManager.clone()

3. Student tests assignment
   └─> StudentCommands.testAssignment()
       └─> TestResultService.runTests()
           └─> Bash execution → Parse results

4. Student submits assignment
   └─> StudentCommands.submitAssignment()
       └─> GitManager.commit() + push()
       └─> ComputorApiService.createSubmission()
```

### Tutor Grading Workflow

```
1. Tutor filters students
   └─> TutorFilterPanel (webview)
       └─> TutorSelectionService.setFilters()

2. Tutor clones student repo
   └─> TutorCommands.cloneStudentRepository()
       └─> StudentRepositoryManager.cloneStudentRepository()
           └─> GitManager.clone() with GitLab token

3. Tutor grades submission
   └─> TutorCommands.gradeAssignment()
       └─> Webview for grade input
           └─> ComputorApiService.createGrade()
```

### Lecturer Course Management

```
1. Lecturer creates course content
   └─> LecturerCommands.createCourseContent()
       └─> ComputorApiService.createCourseContent()

2. Lecturer uploads example
   └─> LecturerExampleCommands.uploadExample()
       └─> Creates ZIP archive
           └─> ComputorApiService.uploadExample()

3. Lecturer releases content
   └─> LecturerCommands.releaseCourseContent()
       └─> ComputorApiService.deployCourseContent()
```

## Authentication Flow

```
1. Extension activates
2. Check for stored access/refresh tokens
3. If no tokens:
   a. Prompt for backend URL
   b. Prompt for username and password
   c. Call /auth/login to get tokens
   d. Store tokens in secure storage
4. Build BearerTokenHttpClient with stored tokens
5. Initialize ComputorApiService
6. Fetch user views/roles
7. Initialize appropriate UI views
8. Create .computor marker file in workspace
9. Token auto-refreshes before expiration during API calls
```

## Performance Optimizations

### Caching
- **HTTP Response Caching**: Reduces redundant API calls
- **Multi-tier Cache**: Memory cache with TTL
- **Cache Invalidation**: Automatic on mutations

### Request Batching
- Groups multiple similar requests
- Reduces network overhead
- Configurable batch windows

### Virtual Scrolling
- Efficient rendering of large lists
- Lazy loading of tree items
- Pagination support

### Error Recovery
- Automatic retry with exponential backoff
- Circuit breaker pattern
- Graceful degradation

## Security Considerations

### Credential Storage
- Credentials stored in VS Code secret storage (OS keychain)
- Never stored in plain text
- GitLab tokens managed separately per origin

### Git Operations
- Token injection for HTTPS URLs
- Automatic token refresh
- Repository backups before destructive operations

### API Communication
- HTTPS enforced for production
- JWT token expiration handling
- Request signing where applicable

## Extension Points

### VS Code Contributions

**Commands**: 80+ commands for all user actions
**Views**:
- 3 activity bar containers (Student, Tutor, Lecturer)
- Multiple tree views per role
- Test results panel

**Providers**:
- CodeLens for examples
- Completion for meta.yaml files
- Status bar items

**Menus**: Context menus for all tree items and views

## Testing

**Test Structure**:
- Unit tests with Mocha
- Integration tests with Jest
- Manual integration tests for Git and GitLab

**Test Files**:
- `.mocharc.unit.json`: Unit test configuration
- `jest.integration.config.js`: Integration test configuration
- `test/integration/manual/`: Manual test scripts

## Build Process

**Webpack Configuration**:
- TypeScript compilation
- Bundling for distribution
- Source maps for debugging

**NPM Scripts**:
- `npm run compile`: Type-check + webpack
- `npm run watch`: Development mode
- `npm run package`: Production build
- `npm run test`: Run all tests

## Dependencies

### Key Dependencies
- **simple-git**: Git operations
- **node-fetch**: HTTP requests
- **jszip**: ZIP file handling
- **js-yaml**: YAML parsing
- **date-fns**: Date formatting
- **uuid**: Unique ID generation

### Dev Dependencies
- **typescript**: TypeScript compiler
- **webpack**: Module bundler
- **eslint**: Code linting
- **mocha/chai**: Testing framework
