# Quick Start Guide

Get up and running with Computor in 5 minutes.

## Installation

1. Install the extension from the VS Code marketplace
2. Reload VS Code

## First-Time Setup

### 1. Open a Folder
```
File → Open Folder
```
Choose or create a folder for your Computor workspace.

### 2. Login

Press `Ctrl+Shift+P` (or `Cmd+Shift+P` on Mac) and run:
```
Computor: Login
```

Follow the prompts:
1. Enter backend URL (e.g., `http://localhost:8000`)
2. Enter your username and password

### 3. Access Your View

After login, look for these icons in the activity bar:
- 📖 **Student** - If you're enrolled in courses
- 👤 **Tutor** - If you're grading students
- 🎓 **Lecturer** - If you're teaching courses

Click the appropriate icon to open your view.

## Common Tasks

### For Students

#### Clone an Assignment
1. Open **Computor Student** view
2. Navigate to your course → assignment
3. Click the **download cloud** icon
4. Assignment repository opens automatically

#### Run Tests
1. Open assignment repository
2. In **Computor Student** view, find the assignment
3. Click the **beaker** icon
4. View results in **Test Results** panel at bottom

#### Submit Assignment
1. Make sure all changes are committed
2. Click the **cloud upload** icon next to assignment
3. Submission is created

### For Tutors

#### Setup GitLab Access
Before cloning student repositories:
```
Ctrl+Shift+P → Computor: Manage GitLab Tokens
```
Enter your GitLab origin and Personal Access Token.

#### Clone Student Work
1. Open **Computor Tutor** view
2. Use **Filters** panel to find students
3. Navigate to student → assignment
4. Click **download cloud** icon

#### Grade Student
1. Right-click on student's assignment
2. Select **Grading…**
3. Enter grade and feedback
4. Submit

### For Lecturers

#### Create Course Content
1. Open **Computor Lecturer** view
2. Navigate to course → **Course Contents**
3. Right-click → **Create Course Content**
4. Fill in details

#### Upload Example
1. Switch to **Examples** view
2. Right-click on repository root
3. Select **Upload as New Example**
4. Select folder and enter metadata

#### Release Content
1. Right-click on course content
2. Select **Release Course Content**
3. Students can now see the content

## Keyboard Shortcuts

All Computor commands are accessible via:
```
Ctrl+Shift+P  (Windows/Linux)
Cmd+Shift+P   (Mac)
```

Type `Computor:` to see all available commands.

## Need Help?

- **Full documentation**: See [User Guide](user-guide.md)
- **Technical details**: See [Architecture](architecture.md)
- **Development**: See [Developer Guide](developer-guide.md)
- **API details**: See [API Reference](api-reference.md)

## Troubleshooting

### "Login failed"
- Check backend URL is correct
- Verify credentials
- Ensure backend is running

### "Failed to clone repository"
**Students**: Ensure you have access to the course
**Tutors**: Configure GitLab tokens via `Manage GitLab Tokens`

### Views not showing
- Log out and log back in
- Check your account has the appropriate role
- Reload VS Code window

### More help
See [Troubleshooting section](user-guide.md#troubleshooting) in the User Guide.
