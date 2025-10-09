# User Guide

This guide covers how to use the Computor VS Code Extension as a student, tutor, or lecturer.

## Table of Contents

- [Getting Started](#getting-started)
- [Student Guide](#student-guide)
- [Tutor Guide](#tutor-guide)
- [Lecturer Guide](#lecturer-guide)
- [Common Tasks](#common-tasks)
- [Troubleshooting](#troubleshooting)

## Getting Started

### Initial Setup

1. **Open a folder** in VS Code
   - The extension requires an open workspace to function
   - Use `File > Open Folder` to open or create a folder

2. **Login to Computor**
   - Open the command palette (`Ctrl+Shift+P` or `Cmd+Shift+P`)
   - Run: `Computor: Login`
   - Enter the backend URL when prompted
   - Enter your username and password

3. **Access your view**
   - After login, the appropriate view(s) appear in the activity bar
   - Click the icon to open your role view:
     - 📖 Student view
     - 👤 Tutor view
     - 🎓 Lecturer view

### Configuration

#### Backend URL
Change the backend URL at any time:
- Command: `Computor: Change Backend URL`

#### Workspace Directory
Select where repositories are cloned:
- Click the folder icon in the view title bar
- Command: `Select Workspace Directory`

#### User Profile
Edit your profile information:
- Click the account icon in the view title bar
- Command: `Computor: Edit Profile`

---

## Student Guide

As a student, you can browse courses, work on assignments, run tests, and submit your work.

### Browsing Courses

1. Open the **Computor Student** view from the activity bar
2. Browse the tree structure:
   ```
   Course Name
   ├── 📁 Course Group (optional)
   ├── 📄 Content Item
   └── 📝 Assignment
   ```

### Working on Assignments

#### Clone an Assignment

1. Find the assignment in the course tree
2. Click the **cloud download** icon next to it
   - Or right-click → `Clone Repository`
3. The repository is cloned to your workspace directory
4. VS Code opens the cloned repository

#### Run Tests Locally

1. Open the assignment repository
2. Click the **beaker** icon next to the assignment
   - Or right-click → `Test Assignment`
3. View results in the **Test Results** panel (bottom panel)
4. Click on failed tests to jump to the test file

#### Commit Changes

1. Make your code changes
2. Click the **git commit** icon next to the assignment
   - Or right-click → `Commit Assignment`
3. Enter a commit message
4. Changes are committed and pushed to your repository

#### Submit Assignment

1. Ensure all changes are committed
2. Click the **cloud upload** icon next to the assignment
   - Or right-click → `Submit Assignment`
3. The submission is created on the backend
4. You can view submission details by right-clicking → `View Details`

### Viewing Feedback

- **Test Results**: Click `Show Test Results` on any assignment
- **Messages**: Right-click on content → `Show Messages` for announcements
- **README Preview**: Click the preview icon to see assignment instructions

### Tips for Students

- **Commit often**: Use `Commit Assignment` regularly to save your progress
- **Test before submitting**: Always run tests locally before final submission
- **Check messages**: Lecturers and tutors may post important updates
- **Multiple courses**: You can work on multiple courses; each assignment is isolated

---

## Tutor Guide

As a tutor, you can monitor students, clone their repositories, review their work, and provide grades and feedback.

### Filtering Students

Use the **Filters** panel to narrow down students:

1. Open the **Computor Tutor** view
2. The **Filters** panel appears at the top
3. Available filters:
   - Course
   - Assignment
   - Submission status
   - Date ranges
4. Click **Reset Filters** to clear all filters

### Viewing Student Work

The tutor tree shows:
```
Course
├── Course Group
│   ├── Student Name
│   │   ├── Assignment 1
│   │   └── Assignment 2
```

Students are organized by course groups, making it easy to navigate.

### Cloning Student Repositories

1. Find the student's assignment
2. Click the **cloud download** icon
   - Or right-click → `Clone Student Repository`
3. The repository is cloned with the student's latest work
4. VS Code opens the repository for review

**Note**: You need GitLab access tokens configured. See [Managing GitLab Tokens](#managing-gitlab-tokens).

### Updating Student Repositories

If a student has made new commits since you cloned:
1. Click the **sync** icon
   - Or right-click → `Update Student Repository`
2. The latest changes are pulled

### Grading Students

1. Find the student's assignment
2. Right-click → `Grading…`
3. A webview opens with:
   - Student information
   - Submission details
   - Test results
   - Grading form
4. Enter grade and feedback
5. Click **Submit Grade**

### Downloading Example Solutions

To compare student work with the example solution:
1. Right-click on assignment → `Download Example for Comparison`
2. The example solution is downloaded
3. Use VS Code's diff tools to compare

### Providing Feedback

- **Messages**: Right-click → `Show Messages` to post messages
- **Comments**: Right-click on student → `Show Comments` for private notes
- **Grades**: Use the grading interface for official feedback

### Managing GitLab Tokens

Tutors need GitLab Personal Access Tokens (PAT) to clone student repositories.

1. Command: `Computor: Manage GitLab Tokens`
2. Choose action:
   - **Set token for an origin**: Add/update a token for a GitLab instance
   - **Remove token**: Delete a stored token
3. Enter the GitLab origin (e.g., `http://localhost:8084`)
4. Enter your GitLab Personal Access Token
5. Tokens are stored securely and used automatically

**Creating a GitLab PAT**:
- Go to your GitLab instance → Settings → Access Tokens
- Create token with `read_repository` scope
- Copy and paste into Computor

---

## Lecturer Guide

As a lecturer, you can create and manage courses, course content, examples, and monitor the entire teaching process.

### Course Management

#### Viewing Courses

The lecturer tree shows your organizational structure:
```
Organization
├── Course Family
│   ├── Course
│   │   ├── 📂 Course Contents
│   │   ├── 📊 Content Types
│   │   └── 👥 Course Groups
```

#### Creating Course Content

1. Right-click on `Course Contents` → `Create Course Content`
2. Enter content details:
   - Title
   - Content type
   - Release date (optional)
3. The content item is created

Content can be nested (hierarchical structure).

#### Creating Course Content Types

Content types define the nature of assignments:

1. Right-click on `Content Types` → `Create Content Type`
2. Configure:
   - Name (e.g., "Homework", "Lab", "Exam")
   - Properties (submittable, team-based, etc.)
3. Use this type when creating course content

#### Creating Course Groups

Groups organize students:

1. Right-click on `Course Groups` → `Create Course Group`
2. Enter group name
3. Students can be assigned to groups

#### Managing Course Content

- **Rename**: Right-click → `Rename`
- **Delete**: Right-click → `Delete`
- **Change Type**: Right-click → `Change Content Type`
- **View Details**: Right-click → `Show Details`

### Example Repository Management

Examples are reusable assignment templates stored in a central repository.

#### Browsing Examples

The **Examples** view shows all available examples:
```
Example Repository
├── Category 1
│   ├── Example A
│   └── Example B
```

#### Searching and Filtering Examples

Use the toolbar icons:
- **🔍 Search**: Search by title, identifier, or description
- **🏷️ Filter by Tags**: Select multiple tags
- **📂 Filter by Category**: Select a category
- **❌ Clear**: Reset all filters

#### Checking Out Examples

1. Find the example in the tree
2. Click the **cloud download** icon
   - Or right-click → `Checkout Example`
3. The example is downloaded to your workspace

You can also:
- **Checkout All Filtered Examples**: Download all currently visible examples
- **Checkout Multiple Examples**: Select specific examples

#### Uploading Examples

**Upload an existing example (after modifications)**:
1. Make changes to a checked-out example
2. Right-click on the example → `Upload Example`
3. The updated version is uploaded

**Upload as new example**:
1. Right-click on example repository root → `Upload as New Example`
2. Select a folder containing the example
3. Enter metadata (title, category, tags, etc.)

**Upload from ZIP**:
1. Right-click on example repository root → `Upload Examples from ZIP`
2. Select a ZIP file containing one or more examples
3. Each subfolder becomes a separate example

#### Creating Course Content from Examples

Link an example to course content:

1. Right-click on an example → `Create Assignment in Course`
2. Select target course
3. Select parent content (or root)
4. Enter assignment details
5. Assignment is created and linked to the example

Or assign to existing content:
1. Right-click on course content → `Assign Example`
2. Select the example from the list

#### Example File Management

When viewing an example's files:
- **Rename**: Right-click → `Rename`
- **Delete**: Right-click → `Delete`
- **Reveal in Explorer**: Open in VS Code file explorer

### Releasing Course Content

Students can't see content until it's released:

1. Right-click on course, course contents, or specific content → `Release Course Content`
2. Choose release scope:
   - Single content item
   - All content in a course
   - All content recursively
3. Content becomes visible to students

### Viewing Student Progress

- **Messages**: Right-click → `Show Messages` to see discussions
- **Member Comments**: Right-click → `Show Comments` for student notes
- **Open GitLab Repo**: Right-click on course → `Open GitLab Repository`

### Managing Files in Assignments

For submittable assignments, you can manage the file structure:

1. Right-click on assignment → `New Folder` or `New File`
2. Upload folder contents
3. Students will see this structure when they clone

---

## Common Tasks

### Changing Password

1. Command: `Computor: Change Password`
2. Enter current password
3. Enter new password
4. Confirm new password

### Checking Backend Connection

Test connectivity to the backend:

1. Command: `Computor: Check Backend Connection`
2. Results show:
   - Backend status
   - Authentication status
   - User information

### Viewing Messages

Messages are used for announcements and discussions:

1. Right-click on any course or content item
2. Select `Show Messages`
3. A webview opens with the message thread
4. You can post new messages and reply

### Working with Git Status

View git status of the current repository:

1. Command: `Computor: Show Git Status`
2. Status is displayed in the output panel

### Settings

Access extension settings:

1. Command: `Computor: Settings`
2. Configure:
   - Default workspace directory
   - Test runner preferences
   - UI preferences

---

## Troubleshooting

### Login Issues

**Problem**: "Login failed" or "Invalid credentials"

**Solutions**:
- Verify backend URL is correct
- Check username and password
- Ensure backend is accessible (try in browser)
- Try a different authentication method

### Repository Clone Fails

**Problem**: "Failed to clone repository"

**Solutions**:
- **Students**: Ensure you have access to the course
- **Tutors**: Check GitLab tokens are configured (`Manage GitLab Tokens`)
- Verify git is installed (`git --version` in terminal)
- Check network connectivity to GitLab

### GitLab Token Issues

**Problem**: "Authentication failed" when cloning student repositories

**Solutions**:
- Run `Computor: Manage GitLab Tokens`
- Ensure token is for the correct GitLab origin
- Verify token has `read_repository` or `write_repository` scope
- Check token hasn't expired in GitLab

### Test Execution Fails

**Problem**: Tests don't run or show errors

**Solutions**:
- Ensure repository is cloned and opened
- Check that dependencies are installed (`npm install` or similar)
- Verify test command in assignment configuration
- Check test output in Test Results panel for specific errors

### Views Not Showing

**Problem**: Student/Tutor/Lecturer view doesn't appear

**Solutions**:
- Log out and log back in
- Check that your account has the appropriate role
- Contact administrator to verify role assignment
- Try reloading VS Code window

### Backend Connection Issues

**Problem**: "Cannot connect to backend"

**Solutions**:
- Check backend URL in settings
- Verify backend is running
- Test network connectivity
- Check firewall/proxy settings
- Use `Computor: Check Backend Connection` to diagnose

### Workspace Marker Issues

**Problem**: Extension asks for login repeatedly

**Solutions**:
- Ensure you have an open folder in VS Code
- Check that `.computor` file exists in workspace root
- Re-run login to recreate the file
- Ensure workspace folder has write permissions

### Performance Issues

**Problem**: Extension is slow or unresponsive

**Solutions**:
- Clear extension cache (restart VS Code)
- Reduce number of open repositories
- Check backend server performance
- Disable unused views

### Example Upload Fails

**Problem**: "Failed to upload example"

**Solutions**:
- Ensure folder structure is valid
- Check for required files (e.g., `meta.yaml`)
- Verify file sizes aren't too large
- Check backend logs for specific errors

---

## Keyboard Shortcuts

The extension uses VS Code command palette for all actions. Common workflow:

1. `Ctrl+Shift+P` (or `Cmd+Shift+P`) - Open command palette
2. Type `Computor:` to see all available commands
3. Select the desired command

You can assign custom keyboard shortcuts to frequently used commands:

1. File → Preferences → Keyboard Shortcuts
2. Search for `Computor`
3. Add your preferred shortcut

---

## Tips and Best Practices

### For Students
- **Save frequently**: Commit your work often, not just before submission
- **Test locally**: Always run tests before submitting
- **Read messages**: Check for announcements from lecturers and tutors
- **Ask questions**: Use the message system to communicate with instructors

### For Tutors
- **Use filters**: Filter students to focus on specific groups or assignments
- **Download examples**: Compare student work with example solutions
- **Provide detailed feedback**: Use both grades and comments
- **Batch grading**: Use filters to grade multiple students efficiently

### For Lecturers
- **Use examples**: Create reusable examples for common assignment types
- **Organize with groups**: Use course groups to organize students
- **Progressive release**: Release content gradually throughout the course
- **Monitor progress**: Regularly check student submissions and messages
- **Use content types**: Define clear content types for different assessment methods

---

## Getting Help

- **Check this documentation**: Most common questions are answered here
- **Contact your administrator**: For account or access issues
- **Report bugs**: Contact your Computor administrator with bug reports
- **Feature requests**: Suggest improvements through your organization

---

## Appendix: File Structure

### Workspace Structure

When using Computor, your workspace might look like:

```
my-workspace/
├── .computor                    # Extension marker file
├── course-a/
│   ├── assignment-1/            # Student repositories
│   └── assignment-2/
├── course-b/
│   └── lab-1/
└── examples/                    # Downloaded examples
    ├── example-sorting/
    └── example-graphs/
```

### .computor Marker File

The `.computor` file stores workspace-specific settings:

```json
{
  "backendUrl": "http://localhost:8000"
}
```

This file is created automatically on first login.

### meta.yaml (Example Metadata)

Examples may contain a `meta.yaml` file with metadata:

```yaml
title: Sorting Algorithms
category: Algorithms
tags:
  - sorting
  - quicksort
  - mergesort
description: Implementation of common sorting algorithms
```

This file is used when uploading examples to the repository.
