# Student Guide: Assignments

## Table of Contents

- [What is an Assignment?](#what-is-an-assignment)
- [What You See](#what-you-see)
- [Assignment Information](#assignment-information)
  - [Tooltip Information](#tooltip-information)
  - [Description in Tree](#description-in-tree)
- [Assignment Lifecycle](#assignment-lifecycle)
  - [1. Work on Your Code](#1-work-on-your-code)
  - [2. Test Locally](#2-test-locally)
  - [3. Commit Your Changes](#3-commit-your-changes)
  - [4. Submit the Assignment](#4-submit-the-assignment)
  - [5. View Feedback and Grades](#5-view-feedback-and-grades)
- [Available Actions](#available-actions)
  - [Show README Preview](#-show-readme-preview-inline-icon)
  - [Test Assignment](#-test-assignment-inline-icon-only-if-cloned)
  - [Commit Assignment](#-commit-assignment-inline-icon-only-if-cloned)
  - [Submit Assignment](#-submit-assignment-inline-icon-only-if-cloned)
  - [Show Test Results](#-show-test-results)
  - [View Details](#-view-details)
  - [Show Messages](#-show-messages)
  - [Help](#-help)
- [Assignment Types](#assignment-types)
  - [Individual Assignments](#individual-assignments)
  - [Team Assignments](#team-assignments)
- [Understanding Icons and Badges](#understanding-icons-and-badges)
  - [Assignment Icons](#assignment-icons)
  - [Inline Action Icons](#inline-action-icons)
- [File and Folder Expansion](#file-and-folder-expansion)
- [Common Scenarios](#common-scenarios)
  - [Starting a New Assignment](#starting-a-new-assignment)
  - [Debugging Test Failures](#debugging-test-failures)
  - [Submitting Work](#submitting-work)
  - [After Receiving Feedback](#after-receiving-feedback)
- [Tips and Best Practices](#tips-and-best-practices)
  - [Commit Frequently](#commit-frequently)
  - [Test Before Submitting](#test-before-submitting)
  - [Manage Test Attempts](#manage-test-attempts)
  - [Watch Submission Limits](#watch-submission-limits)
  - [Read Messages](#read-messages)
  - [Understand the Metrics](#understand-the-metrics)
- [Troubleshooting](#troubleshooting)
  - ["Cannot clone repository"](#cannot-clone-repository)
  - ["Tests won't run"](#tests-wont-run)
  - ["Submission failed"](#submission-failed)
  - ["No test attempts remaining"](#no-test-attempts-remaining)
- [Next Steps](#next-steps)

---

## What is an Assignment?

An **Assignment** is a submittable task with a Git repository where you write code, complete exercises, or create deliverables. Assignments are the core interactive element of your coursework - you clone them, work on them, test them, and submit them for grading.

## What You See

Assignments appear with a colored square icon:

```
📖 Introduction to Programming
├── ⚫ Week 1
│   ├── 🟦 Lab 1: Hello World
│   └── 🟦 Homework 1: Variables
└── 🟦 Final Project
```

The color of the square icon indicates the **content type** (lab, homework, exam, etc.) defined by your instructor.

## Assignment Information

### Tooltip Information

When you hover over an assignment, you'll see comprehensive details:

```
Repository: john-doe/cs101-lab1
Type: Lab
Unread messages: 1
Tests: 2 of 5
Submissions: 1 of 3
Result: 85.50%
Grading: 90.00%
Status: Corrected
Team members:
  - John Doe
  - Jane Smith
```

**What each line means:**

1. **Repository: [path]** - Your personal Git repository full path (e.g., `username/course-assignment`)
2. **Type: [Content Type]** - Assignment category (Lab, Homework, Exam, Project, etc.)
3. **Unread messages: [X]** - New announcements or feedback messages (only shown if > 0)
4. **Tests: [X] of [Y]** - Test runs you've used out of maximum allowed
   - Example: "2 of 5" means you've run tests 2 times, with 3 attempts remaining
   - If no limit: shows just the count (e.g., "Tests: 2")
5. **Submissions: [X] of [Y]** - Submissions made out of maximum allowed
   - Example: "1 of 3" means you've submitted once, with 2 submissions remaining
   - **Important:** Once you reach the limit, you cannot submit again
6. **Result: [X]%** - Your latest test result percentage (0-100%)
   - Based on automated test execution
   - Updates when you run local tests or submit
7. **Grading: [X]%** - Your official grade from the instructor (0-100%)
   - Only appears after grading
   - May differ from test results (instructors can adjust grades)
8. **Status** - Grading/correction status:
   - **Corrected** - Assignment has been graded
   - **Correction Necessary** - Instructor requires changes
   - **Correction Possible** - You can revise and resubmit
9. **Team members** - List of collaborators (only shown for team assignments)

### Description in Tree

Next to the assignment name, you'll see compact metrics:

```
🟦 Lab 1: Hello World    🔔 1 [2/5] [1/3] 85%
```

- **🔔 [X]** - Unread messages (bell icon, only if unread > 0)
- **[X/Y]** - Test runs used (e.g., `[2/5]`)
- **[X/Y]** - Submissions made (e.g., `[1/3]`)
- **[X]%** - Current result percentage (e.g., `85%`)

## Assignment Lifecycle

### 1. Work on Your Code

1. Edit files in your preferred editor
2. Make changes to complete the assignment requirements
3. Save your work frequently

**Tips:**
- Read the README for instructions (click preview icon or right-click → **Show README Preview**)
- Follow the assignment structure - don't rename required files
- Commit your work regularly (even before it's perfect)

### 2. Test Locally

Before submitting, run automated tests to check your work.

**How to test:**
1. Click the **🧪 beaker icon** next to the assignment (inline action)
   - Or right-click → **Test Assignment**
2. Tests execute locally on your machine
3. Results appear in the **Test Results** panel (bottom panel)
4. Click on failed tests to jump to the relevant code

**Important:**
- Testing uses one of your test attempts (if limited)
- **Tests: [X] of [Y]** in the tooltip shows remaining attempts
- Test locally before submitting to catch errors early
- Green checkmark badge = tests passing
- Red X badge = tests failing

**Viewing test results:**
- Right-click → **Show Test Results** to see detailed output
- Test results persist even after closing VS Code

### 3. Commit Your Changes

Save your progress to the Git repository regularly.

**How to commit:**
1. Click the **📝 git commit icon** next to the assignment (inline action)
   - Or right-click → **Commit Assignment**
2. Enter a descriptive commit message (e.g., "Implemented sorting function")
3. Changes are committed and pushed to your remote repository

**Why commit often:**
- Saves your progress remotely (backup)
- Allows instructors to see your work-in-progress
- Creates a history of your development process
- Required before submission

### 4. Submit the Assignment

When you're ready to be graded, submit your work.

**How to submit:**
1. Ensure all changes are committed
2. Click the **☁️ upload icon** next to the assignment (inline action)
   - Or right-click → **Submit Assignment**
3. Submission is created on the backend
4. You'll see the submission count increase

**Important:**
- **Submissions are limited!** Check "Submissions: [X] of [Y]" before submitting
- You cannot submit after reaching the maximum
- Only submit when you're confident in your work
- You can view submission details: right-click → **View Details**

### 5. View Feedback and Grades

After submission, instructors review and grade your work.

**How to check feedback:**
- Right-click → **View Details** to see:
  - Submission information
  - Test results
  - Grading percentage
  - Instructor comments
- Right-click → **Show Messages** for feedback discussions

**Status indicators:**
- **Corrected** - Graded and finalized
- **Correction Necessary** - Instructor requires changes (you may need to revise)
- **Correction Possible** - You can resubmit (if submissions remain)

## Available Actions

Right-click on an assignment to access:

### 📖 Show README Preview (inline icon)
Opens the assignment's README file in a preview panel. This typically contains:
- Assignment instructions
- Requirements and specifications
- Grading criteria
- Tips and hints

**When to use:** Before starting work, to understand what's expected

### 🧪 Test Assignment (inline icon, only if cloned)
Runs automated tests on your local code.

**When to use:**
- Before submitting
- After making significant changes
- To verify your solution works

**Note:** Uses one test attempt (if limited)

### 📝 Commit Assignment (inline icon, only if cloned)
Commits and pushes your changes to the remote repository.

**When to use:**
- After completing a feature or section
- Regularly throughout development
- Before running tests or submitting

### ☁️ Submit Assignment (inline icon, only if cloned)
Creates an official submission for grading.

**When to use:**
- When you're confident your work is complete
- After testing locally
- Before the deadline

**Warning:** Limited submissions - use wisely!

### 📋 Show Test Results
Opens the detailed test results panel.

**When to use:**
- After running tests
- To debug failing tests
- To see which requirements are met

### 📄 View Details
Opens a detailed view with all assignment information, including:
- Repository details
- Submission history
- Test results
- Grading information

**When to use:**
- To see comprehensive assignment status
- To review submission history
- To check grading details

### 💬 Show Messages
Opens the message panel for this assignment.

**When to use:**
- To read instructor feedback
- To ask questions about the assignment
- To view announcements

### ❓ Help
Opens this help guide (you're reading it now!).

## Assignment Types

### Individual Assignments
- You work alone
- Repository is in your name
- All commits and submissions are your own

### Team Assignments
- You work with teammates
- Shared repository
- Tooltip shows team member list
- All team members can commit and submit

**Identifying team assignments:**
- Tooltip includes "Team members:" section
- Context value includes `.team`
- Repository is shared among team members

## Understanding Icons and Badges

### Assignment Icons

**Base icon:** Colored square (🟦)
- Color indicates content type (set by instructor)

**Icon badges:**
- **✅ Green checkmark** - Tests passing
- **❌ Red X** - Tests failing
- **Corner badges:**
  - Small dot in corner indicates correction status
  - Different colors for Corrected, Correction Necessary, Correction Possible

### Inline Action Icons

Icons that appear to the right of the assignment name:

1. **📖 Preview icon** - Show README preview
2. **🧪 Beaker icon** - Test assignment (only if cloned)
3. **📝 Commit icon** - Commit changes (only if cloned)
4. **☁️ Upload icon** - Submit assignment (only if cloned)
5. **☁️ Download icon** - Clone repository (only if not cloned)

## File and Folder Expansion

After cloning, you can expand assignments to see their file structure:

```
🟦 Lab 1: Hello World
├── 📄 src/
│   ├── main.py
│   └── utils.py
├── 📄 tests/
│   └── test_main.py
└── 📄 README.md
```

**Actions on files:**
- **Click file** - Opens in editor
- **Right-click file** - Context menu with file operations

## Common Scenarios

### Starting a New Assignment

1. Read the README: Click preview icon 📖
2. Start coding: Open and edit files
3. Commit early: Save your initial work

### Debugging Test Failures

1. Run tests: Click beaker icon 🧪
2. View results: Right-click → **Show Test Results**
3. Click on failed test to jump to code
4. Fix the issue
5. Commit changes
6. Run tests again

### Submitting Work

1. Ensure all changes are committed (use commit icon 📝)
2. Run final tests (beaker icon 🧪)
3. Verify tests pass (check badge or results panel)
4. Check submission count: Hover to see "Submissions: [X] of [Y]"
5. Submit: Click upload icon ☁️

### After Receiving Feedback

1. Check messages: Right-click → **Show Messages**
2. View details: Right-click → **View Details**
3. Read instructor comments
4. If "Correction Necessary":
   - Make required changes
   - Commit updates
   - Test again
   - Resubmit (if submissions remain)

## Tips and Best Practices

### Commit Frequently
- Commit after completing each feature or section
- Use descriptive commit messages
- Don't wait until the assignment is perfect

### Test Before Submitting
- Always run tests locally first
- Fix all test failures if possible
- Understand what each test checks

### Manage Test Attempts
- If test runs are limited, use them wisely
- Debug code before running tests
- Review test code to understand requirements

### Watch Submission Limits
- Know your limit: Check "Submissions: [X] of [Y]"
- Don't waste submissions on incomplete work
- Test thoroughly before submitting

### Read Messages
- Check unread message count (🔔 bell icon)
- Instructors may post important clarifications
- Respond promptly to feedback requests

### Understand the Metrics
- **Result %** = Automated test score (technical correctness)
- **Grading %** = Instructor's final grade (may include style, documentation, etc.)
- These may differ - grading is the official score

## Troubleshooting

### "Cannot clone repository"
- Ensure you have a workspace directory selected
- Check your network connection
- Verify you have access to the course

### "Tests won't run"
- Ensure repository is cloned and opened in VS Code
- Check that dependencies are installed
- Review test output in the Test Results panel

### "Submission failed"
- Ensure all changes are committed first
- Check that you haven't exceeded submission limit
- Verify network connection to backend

### "No test attempts remaining"
- You've used all allowed test runs
- Contact your instructor if you need more attempts
- Submit your best effort based on current work

## Next Steps

- Learn about [Units and Folders](student-unit.md)
- Learn about [Courses](student-course.md)
