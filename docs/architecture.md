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
├── authentication/          # Keycloak SSO browser sign-in
│   └── SsoLoginService.ts
│
├── commands/                # VS Code command implementations
│   ├── DocumentsCommands.ts
│   ├── LecturerCommands.ts
│   ├── LecturerCourseGroupCommands.ts
│   ├── LecturerExampleCommands.ts
│   ├── StudentCommands.ts
│   ├── StudentFileCommands.ts
│   ├── StudentOfflineCommands.ts
│   ├── TutorCommands.ts
│   ├── UserManagerCommands.ts
│   └── manageRepositoryTokens.ts
│
├── exceptions/              # Backend error catalog and error classes (see USAGE.md)
│
├── git/                     # Git integration layer
│   ├── CTGit.ts             # Custom git operations
│   ├── GitWrapper.ts        # simple-git wrapper
│   ├── GitErrorHandler.ts
│   ├── gitCloneHelpers.ts
│   └── simpleGitFactory.ts
│
├── http/                    # HTTP client implementations
│   ├── cache/               # HTTP caching strategies
│   ├── ApiKeyHttpClient.ts
│   ├── BearerTokenHttpClient.ts
│   └── HttpClient.ts        # Base client
│
├── services/                # Business logic services
│   ├── BackendConnectionService.ts
│   ├── CacheService.ts
│   ├── ComputorApiService.ts     # Main API service
│   ├── CourseSelectionService.ts
│   ├── ErrorRecoveryService.ts
│   ├── ExtensionUpdateService.ts
│   ├── GitEnvironmentService.ts
│   ├── GitService.ts
│   ├── LecturerRepositoryManager.ts
│   ├── PerformanceMonitoringService.ts
│   ├── RepositoryTokenManager.ts
│   ├── RequestBatchingService.ts
│   ├── StudentRepositoryManager.ts
│   ├── TestResultService.ts
│   ├── TutorSelectionService.ts
│   ├── VirtualScrollingService.ts
│   └── WebSocketService.ts
│
├── settings/                # Settings and storage
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
│       ├── users.ts
│       └── websocket.ts
│
├── ui/                      # User interface components
│   ├── panels/              # Webview panels
│   ├── tree/                # Tree view providers
│   │   ├── chat/
│   │   ├── lecturer/
│   │   ├── lecturer-documents/
│   │   ├── student/
│   │   ├── tutor/
│   │   └── user-manager/
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
├── activation.ts            # Workspace marker detection
└── extension.ts             # Extension entry point
```

## Core Components

### Extension Entry Point

**File**: [extension.ts](../src/extension.ts)

The main extension activation flow:
1. Activates when the workspace contains a `.computor` or `.computor-public.json` marker,
   or when one of its commands or views is used
2. Checks for existing authentication
3. Prompts for login if needed
4. Initializes role-based views
5. Sets up commands and providers

Key class: `UnifiedController` - manages the extension lifecycle and view initialization.

### Authentication System

**Directories**: [authentication/](../src/authentication/), [http/](../src/http/)

Two ways to authenticate, both ending in a token sent on every request:

- **Keycloak SSO (default)** — a browser-based OIDC login. The extension starts a
  temporary loopback HTTP server, opens `{backend}/auth/keycloak/login` in the
  system browser, and captures the opaque **session token** the backend redirects
  back ([SsoLoginService.ts](../src/authentication/SsoLoginService.ts)). The token
  is used as `Authorization: Bearer <token>` via `BearerTokenHttpClient`.
- **API token (escape hatch)** — for automation / CI / headless workspaces. A
  Computor API token (`ctp_…`) is sent as `X-API-Token` via `ApiKeyHttpClient`,
  supplied interactively (`Computor: Sign in with API Token`) or through the
  `COMPUTOR_AUTH_TOKEN` environment variable.

The session token (opaque, sliding ~1h server TTL) is refreshed proactively via
`POST /auth/refresh` while VS Code is active; an expired session is recovered by
re-running the browser SSO flow. A refresh starts when less than 10% of the
token's lifetime remains, concurrent requests share one refresh, and after an
unrecoverable 401 further refreshes are suppressed until the user signs in
again. Tokens are stored in VS Code's secret storage.
The extension only ever talks to the backend, never directly to Keycloak.

### HTTP Layer

**Directory**: [http/](../src/http/)

**Architecture**:
- Abstract `HttpClient` interface
- Implementations: `BearerTokenHttpClient` (SSO session token, with automatic
  refresh) and `ApiKeyHttpClient` (API token)
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
- `GitService`: Commit, push and status operations used by the commands
- `GitWrapper`: Wrapper around simple-git library
- `CTGit`: Custom git operations specific to Computor
- `GitEnvironmentService`: Git environment validation

**Features**:
- Repository cloning with authentication
- Repository token management
- Commit and push operations
- Conflict detection and resolution
- Repository backup and recovery

### UI Architecture

**Directory**: [ui/](../src/ui/)

**Tree Views**:
- `LecturerTreeDataProvider`: Course management tree
- `LecturerExampleTreeProvider`: Example repository tree
- `StudentCourseContentTreeProvider`: Student course content tree
- `TutorStudentTreeProvider`: Tutor grading tree
- `TestResultsTreeDataProvider`: Test results tree

**Webview Providers**:
- Course details and management
- User profile editor
- Messages and comments
- Submission details
- Course member import (CSV/TSV, XLSX/XLS, XML and JSON files, previewed
  against the course and imported one member at a time)
- Test results panel

**Base Classes**:
- `BaseTreeDataProvider`: Common tree view functionality
- `BaseWebviewProvider`: Common webview functionality

### Settings Management

**Directory**: [settings/](../src/settings/)

**ComputorSettingsManager** manages:
- Backend URL configuration
- Auto-login
- GitLab instance URLs
- Workspace-specific settings via `.computor` file

Settings are stored in:
- `~/.computor/config.json` (non-sensitive)
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
- **RepositoryTokenManager**: GitLab PAT management per origin
- **LecturerRepositoryManager**: Lecturer repository operations
- **RequestBatchingService**: Request batching and deduplication
- **StudentRepositoryManager**: Student repository lifecycle
- **TestResultService**: Test execution and result parsing
- **WorkspaceStructureManager** (`utils/workspaceStructure.ts`): Workspace structure management

## Data Flow

### Student Assignment Workflow

```
1. Student browses courses
   └─> StudentCourseContentTreeProvider
       └─> ComputorApiService.getStudentCourseContents()
           └─> HTTP Client → Backend

2. Course repository is set up
   └─> StudentRepositoryManager.autoSetupRepositories()
       └─> git clone with the repository token

3. Student tests assignment
   └─> computor.student.testAssignment
       └─> GitService.stageAll() + commitChanges(), push
       └─> TestResultService.submitTestByArtifactAndAwaitResults()
           └─> Tests run on the server → Test Results panel

4. Student submits assignment
   └─> computor.student.submitAssignment
       └─> ComputorApiService.createStudentSubmission()
```

### Tutor Grading Workflow

```
1. Tutor selects course, group and member
   └─> Courses & Members tree (tutor-filter-tree-provider)
       └─> TutorSelectionService

2. Tutor opens a student's assignment
   └─> TutorStudentTreeProvider
       └─> ComputorApiService.listSubmissionArtifacts()
           └─> Download of submission and reference

3. Tutor grades submission
   └─> computor.tutor.assignment.grading
       └─> Input boxes for grade and status
           └─> ComputorApiService.submitTutorGrade()
```

### Lecturer Course Management

```
1. Lecturer creates course content
   └─> LecturerCommands (Create Unit / Create Assignment)
       └─> ComputorApiService.createCourseContent()

2. Lecturer uploads example
   └─> LecturerExampleCommands.uploadExample()
       └─> Collects the example's files
           └─> ComputorApiService.uploadExample()

3. Lecturer releases content
   └─> LecturerCommands.releaseCourseContent()
       └─> ComputorApiService.validateCourseForRelease()
       └─> ComputorApiService.generateStudentTemplate()
```

## Authentication Flow

```
1. Extension activates
2. On a detected .computor workspace, try to authenticate silently, in order:
   a. COMPUTOR_AUTH_TOKEN env var → ApiKeyHttpClient (X-API-Token)
   b. stored API token → ApiKeyHttpClient
   c. stored SSO session token → BearerTokenHttpClient (validated against /user)
3. If nothing valid is stored, prompt the user to sign in:
   - "Computor: Login" runs the Keycloak SSO browser flow:
     a. Start a loopback server on 127.0.0.1:<random-port>
     b. Open {backend}/auth/keycloak/login?redirect_uri=<loopback> in the browser
     c. User authenticates; backend 302s the session token back to the loopback
     d. Build BearerTokenHttpClient with the captured token
   - "Computor: Sign in with API Token" uses an entered ctp_ token instead
4. Store the token in secret storage
5. Initialize ComputorApiService
6. Fetch user views/roles
7. Initialize appropriate UI views
8. Create/refresh the .computor marker file in workspace
9. Session token auto-refreshes via POST /auth/refresh; on hard 401, re-run SSO
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
- Circuit breaker for dead sessions
- Graceful degradation

## Security Considerations

### Credential Storage
- Credentials stored in VS Code secret storage (OS keychain)
- Never stored in plain text
- Repository tokens managed separately per origin

### Git Operations
- Token injection for HTTPS URLs
- Automatic token refresh
- Repository backups before destructive operations

### API Communication
- Session token expiration handling

## Extension Points

### VS Code Contributions

**Commands**: Commands for all user actions, with titles localized in
`package.nls.json` (English) and `package.nls.de.json` (German)
**Views**:
- Activity bar containers for Student, Tutor, Lecturer, User Manager and Chat
- Multiple tree views per role
- Test results panel

**Providers**:
- Status bar items

**Menus**: Context menus for all tree items and views

## Testing

**Test Structure**:
- Unit tests with Mocha
- Extension host tests in a real VS Code (`test/extension-host/`)
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
- `npm run test:unit`: Run the unit tests
- `npm run test`: Compile, lint and run all Mocha tests

## Dependencies

### Key Dependencies
- **simple-git**: Git operations
- **node-fetch**: HTTP requests
- **jszip**: ZIP file handling
- **js-yaml**: YAML parsing
- **xlsx**, **fast-xml-parser**: Course member import files
- **semver**: Version comparison

### Dev Dependencies
- **typescript**: TypeScript compiler
- **webpack**: Module bundler
- **eslint**: Code linting
- **mocha/chai**: Testing framework
