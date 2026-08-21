# Student Guide: Courses

## Table of Contents

- [What is a Course?](#what-is-a-course)
- [What You See](#what-you-see)
- [Course Information](#course-information)
  - [Tooltip Information](#tooltip-information)
  - [Tree Structure](#tree-structure)
- [Available Actions](#available-actions)
  - [Commit Course](#commit-course)
  - [Update Repository from Template](#update-repository-from-template)
  - [Export Course Examples](#export-course-examples)
  - [Show Messages](#show-messages)
  - [Set up Repository](#set-up-repository)
  - [Download Template](#download-template)
  - [Fix Repository Authentication](#fix-repository-authentication)
  - [Help](#help)
- [Understanding Course Organization](#understanding-course-organization)
- [Tips](#tips)
- [Next Steps](#next-steps)

---

## What is a Course?

A **Course** is the top-level container in your student view. It represents a complete class or module you're enrolled in, such as "Introduction to Programming" or "Data Structures".

## What You See

When you see a course in your tree view:

```
📖 Introduction to Programming
```

The book icon (📖) indicates this is a course root. Clicking it expands to show all course content, including units and assignments.

## Course Information

### Tooltip Information

When you hover over a course, you'll see:
```
Course: [Course Name]
```

This confirms you're looking at a course-level item.

### Tree Structure

Courses contain:
- **📁 Units/Folders** - Organizational containers for related content
- **📝 Assignments** - Submittable tasks with repositories

## Available Actions

Right-click on a course to see everything it offers. The icons on the course row
are shortcuts to the same actions — the context menu always shows the full set.

Which entries appear depends on your course: actions that cannot apply are
hidden rather than shown and then refused.

### Commit Course

Saves **all** your work in this course and uploads it, in one step.

All the assignments of a course live in a single repository, so this is usually
what you want: it commits every change you have made anywhere in the course and
pushes it. The commit icon on an individual assignment does the same thing for
that one folder.

**When to use:**
- At the end of a working session
- Before you close the workspace
- Whenever you want your work backed up on the server

### Update Repository from Template

Brings your repository up to date with the course material and **puts back any
file you deleted**.

Two things happen:

1. New and changed material released by your lecturer is merged into your
   repository.
2. Every file the course template has and your folder does **not** is restored.
   Files you still have are left exactly as they are — your work is never
   overwritten.

That second step is how you undo a mistake. If you have ruined a data file, a
figure or a starter file, **delete it** and run this action: a fresh copy comes
back from the course template.

> **Make a copy first.** If you want to keep what you have written, copy the file
> (right-click → *Copy File…*) before deleting it.

### Export Course Examples

Packs the assignments you have on disk into a single ZIP archive, so you keep
your work after the course ends and your access to the course repository stops.

You are asked how the archive should be laid out:

- **Tree** — mirrors the course structure, folders named after the content titles
- **Flat** — one folder per assignment, named after its example identifier

In the browser (Computor workspaces), the archive is saved in your workspace
under `exports/` and then downloaded to your own computer. If your browser blocks
the download, use the **Download again** button on the page that opens, or
right-click the file in the Explorer and choose **Download…**.

On the desktop version of VS Code you are asked where to save it.

### Show Messages
View announcements and discussions related to this course. Lecturers and tutors may post important updates, deadlines, or course-wide information here.

**When to use:**
- Check for course announcements
- Participate in course discussions
- View important updates from instructors

### Set up Repository

Creates and downloads your personal repository for this course.

**You normally never need this.** It runs by itself the first time you open a
course or an assignment, and again when the extension starts. The entry only
appears while the course has no local copy yet — for example after you have
moved to a different workspace folder, or if the first attempt failed.

### Download Template

Downloads the course material as a ZIP, or extracts it into a folder you choose.

This appears only for courses handed out as a plain download rather than through
a repository. For those courses the material is also fetched automatically when
you first open the course; use this action if you want a second copy somewhere
else.

### Fix Repository Authentication

Renews the credentials your repository uses.

Use it if uploading suddenly fails — the tree shows a ⚠ badge on the course and
Computor tells you a push could not be repaired automatically. It does not touch
any of your files.

### Help
Opens this help guide (you're reading it now!).

## Understanding Course Organization

Courses are organized hierarchically:

```
📖 Course Name
├── 📁 Week 1 - Introduction
│   ├── 📝 Lab 1
│   └── 📝 Homework 1
├── 📁 Week 2 - Data Types
│   ├── 📝 Lab 2
│   └── 📝 Homework 2
└── 📝 Final Project
```

- **Top level:** All courses you're enrolled in
- **Second level:** Units and assignments within each course
- **Third level:** Nested content (assignments can contain files when expanded)

## Tips

- **Commit from the course row** — one action saves every assignment you touched
- **Deleted a file by accident?** See [Update Repository from Template](#update-repository-from-template)
- **Keep courses expanded** to quickly see what's available
- **Check messages regularly** for important announcements
- **Course structure is set by instructors** - you cannot modify the organization
- **All your enrolled courses appear here** - no need to search for them

## Next Steps

- Learn about [Units and Folders](student-unit.md)
- Learn about [Assignments](student-assignment.md)
