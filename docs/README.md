# Computor VS Code Extension Documentation

Welcome to the Computor VS Code Extension documentation. This extension provides a complete teaching and learning platform integrated directly into Visual Studio Code.

## Documentation Index

### User Documentation
- **[User Guide](user-guide.md)** - Complete guide for students, tutors, and lecturers

### Technical Documentation
- **[Architecture Overview](architecture.md)** - System architecture and design patterns
- **[Developer Guide](developer-guide.md)** - Contributing and development setup
- **[API Integration Guide](api-reference.md)** - How to use ComputorApiService with practical examples
- **Backend API Specification** - the backend's interactive OpenAPI reference at `<backend URL>/docs`

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
3. **Run the command** `Computor: Change Backend URL` and enter your institution's backend URL
4. **Run the command** `Computor: Login` and sign in through your institution's single sign-on page in the browser
5. **Start using Computor** - the appropriate views will appear in the activity bar

## Key Features

### Role-Based Interface
The extension automatically shows the appropriate interface based on your role:
- Student view with course content tree
- Tutor view with student filtering and grading
- Lecturer view with course management and example repository

### Git Integration
- Automatic repository cloning and management
- Repository token management for secure access
- Conflict detection and resolution
- Repository backup and recovery

### Test Execution
- Run the course's tests on the server before submission
- View detailed test results in dedicated panel
- Navigate to failing tests with one click

### Secure Authentication
- Browser-based single sign-on, or an API token for automation
- Automatic token refresh
- Secure credential storage

## System Requirements

- VS Code version 1.74.0 or higher
- Git installed and available in PATH
- Network access to Computor backend

## Support

For issues and feature requests, please contact your Computor administrator or visit the project repository.
