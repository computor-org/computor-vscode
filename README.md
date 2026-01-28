# Computor VS Code Extension

A comprehensive teaching and learning platform for VS Code that facilitates code-based education through integrated course management, assignment submission, and grading workflows.

## Overview

Computor is a VS Code extension designed for educational institutions to manage programming courses. It supports three main roles:

- **Students**: Browse courses, work on assignments, run tests, and submit solutions
- **Tutors**: Review and grade student submissions, provide feedback
- **Lecturers**: Create and manage courses, upload examples, release content

## Features

- 🎓 **Role-based Interface**: Dedicated views for students, tutors, and lecturers
- 📚 **Course Management**: Create, organize, and deploy course content
- 💻 **Git Integration**: Automatic repository management for assignments
- 🔐 **Secure Authentication**: Token-based authentication with automatic refresh
- ✅ **Test Integration**: Built-in test runner with result visualization
- 💬 **Messaging System**: Communication between students, tutors, and lecturers
- 📊 **Progress Tracking**: Real-time submission and grading status

## Getting Started

### Prerequisites

- Visual Studio Code (latest version)
- Git installed and configured
- Access to your institution's Computor backend server
- GitLab account (if your institution uses GitLab for repository hosting)

### Installation

1. Install the Computor extension from the VS Code marketplace
2. Restart VS Code after installation

### Initial Setup

#### Step 1: Configure Git

1. Open the Command Palette by pressing `F1` (or `Ctrl+Shift+P` / `Cmd+Shift+P`)

2. Search for and execute the command:
   ```
   Computor: Configure Git
   ```

3. You will be prompted to provide the following information:
   - **Name**: Enter your full name (e.g., "John Doe")
   - **Email**: Enter your institutional email address

#### Step 2: GitLab Token (if applicable)

**If your institution uses GitLab:**

Create a Personal Access Token:

1. Navigate to your GitLab instance's personal access token page
2. Click `Add new Token`
3. Configure the token:
   - Name it `computor`
   - Set an appropriate expiration date
   - Select the following scopes:
     - `api`
     - `read_repository`
     - `write_repository`
4. Copy and save the generated token - you'll need it in Step 4

#### Step 3: Configure Backend URL

1. Open the Command Palette (`F1`)

2. Search for and execute:
   ```
   Computor: Change Backend URL
   ```

3. Enter your institution's Computor backend URL (provided by your administrator)

#### Step 4: Sign Up and Set Password

**IMPORTANT:** Once you set your password, it cannot be changed using this command again. If you forget your password or need to reset it, you must contact your course administrator for a manual password reset. Only after an administrator resets your password can you use the `Computor: Sign Up (Set Initial Password)` command to set a new one.

1. Open the Command Palette (`F1`)

2. Search for and execute:
   ```
   Computor: Sign Up (Set Initial Password)
   ```

3. If your institution uses GitLab, you'll be prompted for:
   - **GitLab URL**: Enter your GitLab instance URL
   - **Personal Access Token**: Enter your GitLab personal access token (from Step 2)

4. The extension will validate your credentials

5. Set your password:
   - Enter your desired password
   - Confirm by entering it again

#### Step 5: Login

After setting up your password, you'll be prompted to log in.

Provide the following credentials:
- **Email**: Your institutional email address
- **Password**: The password you just created

You're now ready to use Computor!

## Usage

### For Students

1. **Browse Courses**: Access available courses in the Student view
2. **Clone Assignments**: Download assignment repositories to your workspace
3. **Run Tests**: Execute tests locally to verify your solution
4. **Submit Solutions**: Push your code and create submissions for grading

### For Tutors

1. **Filter Students**: Use filters to find specific submissions
2. **Clone Student Repositories**: Review student code locally
3. **Grade Submissions**: Provide grades and feedback
4. **Track Progress**: Monitor grading status across assignments

### For Lecturers

1. **Create Courses**: Set up new courses and course content
2. **Upload Examples**: Provide starter code and examples
3. **Release Content**: Deploy assignments to students
4. **Manage Users**: Handle course enrollments and permissions

## Advanced Features

### Token Management

- Use `Computor: Manage GitLab Tokens` to manage GitLab Personal Access Tokens per origin
- Tokens are stored securely in VS Code's secret storage
- Supports multiple GitLab instances

### Workspace Management

- Automatic workspace structure creation
- Repository backup before destructive operations
- Conflict detection and resolution

### Performance Features

- Response caching for improved performance
- Request batching to reduce network overhead
- Virtual scrolling for large lists

## Troubleshooting

### Common Issues

**Cannot connect to backend:**
- Verify your network connection
- Check the backend URL is correct
- Ensure your credentials are valid

**Git operations failing:**
- Verify Git is installed and configured
- Check GitLab token permissions
- Ensure repository access rights

**Authentication errors:**
- Try logging out and logging back in
- Verify your password is correct
- Contact administrator if password reset is needed

## Support

For issues and questions:
- Check the [documentation](docs/)
- Contact your course administrator
- Report bugs through your institution's support channels

## Development

For developers who want to contribute or extend the extension, see the [Developer Guide](docs/developer-guide.md) and [Architecture Overview](docs/architecture.md).
