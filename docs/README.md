# Computor VS Code Extension Documentation

Welcome to the Computor VS Code Extension documentation. This extension provides a complete teaching and learning platform integrated directly into Visual Studio Code.

## Documentation Index

### User Documentation
- **[Quick Start Guide](quick-start.md)** - Get started in 5 minutes
- **[User Guide](user-guide.md)** - Complete guide for students, tutors, and lecturers

### Technical Documentation
- **[Architecture Overview](architecture.md)** - System architecture and design patterns
- **[Developer Guide](developer-guide.md)** - Contributing and development setup
- **[API Integration Guide](api-reference.md)** - How to use ComputorApiService with practical examples
- **[Backend API Specification](client-endpoints.md)** - Complete endpoint reference with request/response models

## What is Computor?

Computor is a comprehensive teaching platform that connects students, tutors, and lecturers through VS Code. It provides:

### For Students
- Browse and access course content
- Clone assignment repositories
- Run tests locally
- Submit assignments
- View test results and feedback
- Communicate with tutors and lecturers

### For Tutors
- Monitor student progress
- Clone student repositories
- Review and grade submissions
- Provide feedback and comments
- Filter and search students

### For Lecturers
- Create and manage courses
- Design course content and assignments
- Manage example repositories
- Release content to students
- Monitor course progress
- Create content types and groups

## Quick Start

1. **Install the extension** from the VS Code marketplace
2. **Open a folder** in VS Code (required for authentication)
3. **Run the command** `Computor: Login` from the command palette
4. **Enter your credentials** (username and password) when prompted
5. **Start using Computor** - the appropriate views will appear in the activity bar

## Key Features

### Role-Based Interface
The extension automatically shows the appropriate interface based on your role:
- Student view with course content tree
- Tutor view with student filtering and grading
- Lecturer view with course management and example repository

### Git Integration
- Automatic repository cloning and management
- GitLab token management for secure access
- Branch management and conflict resolution
- Repository backup and recovery

### Test Execution
- Run tests locally before submission
- View detailed test results in dedicated panel
- Navigate to failing tests with one click
- Support for various testing frameworks

### Secure Authentication
- Bearer token authentication (username/password login)
- Automatic token refresh
- Secure credential storage

## System Requirements

- VS Code version 1.74.0 or higher
- Git installed and available in PATH
- Node.js (for test execution)
- Network access to Computor backend

## Support

For issues and feature requests, please contact your Computor administrator or visit the project repository.
