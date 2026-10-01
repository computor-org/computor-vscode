# Courses

A course is everything you are enrolled in for one class: its units, its
assignments, and the repository your work lives in. It is the top row in the
Computor view, and most of what this page describes applies everywhere below it.

```
📖 Programming in Physics
├── ⚫ Week 1 — Introduction
│   ├── 🟦 Lab 1
│   └── 🟦 Homework 1
└── 🟦 Final Project
```

Click a row to expand it. The structure comes from your lecturer; you cannot
change it.

## Your work lives in one repository

Every assignment of a course is a folder in a **single repository** that belongs
to you. This is the thing to understand first, because almost everything else
follows from it:

- Saving a file changes it **on your computer only**.
- **Committing** records your changes in the repository and uploads them to the
  server. This is your backup, and it is what your lecturer can see.
- **Submitting** is a separate, deliberate step that hands one assignment in for
  grading. Committing is not submitting.

Because the repository holds the whole course, *Commit Course* on the course row
saves everything you have worked on anywhere in the course, in one step. The
commit action on a single assignment does the same for that folder alone.

You normally never set the repository up yourself. It is created and downloaded
the first time you open the course, and again when the extension starts.

## The marks on a row

Rows carry small marks that tell you where your work stands. They appear on
assignments, on the units above them, and on the course row itself:

| Mark | Meaning |
|------|---------|
| `●` | You have changes that are not committed yet |
| `↑` | Committed, but not yet uploaded to the server |
| `⚠` | Uploading or fetching is failing — see *Fix Repository Authentication* |

On the course row the `↑` carries a number (`↑3`), counting the commits waiting
to be uploaded. A row with no marks is committed and uploaded — safe.

A `🔔` with a number means unread messages.

## Actions on the course

Right-click the course row. The icons on the row are shortcuts to the same
actions, and entries that cannot apply to your course are hidden rather than
shown and then refused.

### Commit Course

Saves **all** your work in the course and uploads it, in one step. Use it at the
end of a working session, before closing the workspace, or whenever you want
your work safely on the server.

### Update Repository from Template

Brings your repository up to date with the course material, and **puts back any
file you deleted**.

You rarely need to run it yourself: released updates arrive on their own when
the workspace starts and when the course view refreshes. This action is the
manual trigger for the same sync, for when you do not want to wait.

Two things happen:

1. New and changed material your lecturer has released is merged into your
   repository.
2. Every file the course material has and your folder does **not** is restored.
   Files you still have are left exactly as they are — your own work is never
   overwritten.

That second step is how you undo a mistake. If you have ruined a data file, a
figure or a starter file, **delete it** and run this action: a fresh copy comes
back.

> **Copy it first** if you want to keep what you wrote. Right-click the file →
> *Copy File…*, then delete the original.

### Show Messages

Announcements and discussions for the whole course. Lecturers and tutors post
updates, deadlines and clarifications here, and you can ask questions. Units and
assignments have their own messages for narrower topics.

### Export Course Examples

Packs the assignments you have on disk into a single ZIP, so you keep your work
after the course ends and your access to the repository stops. You choose the
layout:

- **Tree** — mirrors the course structure, folders named after the content titles
- **Flat** — one folder per assignment, named after its example identifier

In the browser the archive is saved in your workspace under `exports/` and then
downloaded to your computer. If your browser blocks the download, use the
*Download again* button on the page that opens, or right-click the file in the
Explorer and choose *Download…*. In desktop VS Code you are asked where to save.

### Working outside the workspace

The course page on the website (open the course, then *Check access* under
*Your repository*) hands you a ready-to-paste `git clone` command with your
personal access token in it. That gives you a **full git repository** on your
own computer: you can pull updates and push your work with that token from any
git client. The token works like a password, so treat it like one. It stays
valid on its own — it is not the credential the workspace manages.

This is different from *Export Course Examples* below: the export is a plain
ZIP of the files with no git in it, for keeping your work after the course.
The clone stays connected to the course. Either way, the workspace remains the
supported place to work — testing and submitting happen there.

### Fix Repository Authentication

Renews the credentials your repository uses. Use it when uploading suddenly
fails and the course row shows `⚠`. It does not touch any of your files.

### Set up Repository

Creates and downloads your repository. **You normally never need this** — it
runs by itself. The entry only appears while the course has no local copy yet,
for example after you moved to a different workspace folder or the first attempt
failed.

### Download Template

For courses handed out as a plain download instead of a repository: downloads the
material as a ZIP, or extracts it into a folder you choose. The material is also
fetched automatically when you first open such a course; use this if you want a
second copy elsewhere.

## When something looks wrong

- **A row shows `⚠`** — run *Fix Repository Authentication* on the course.
- **New material has not arrived** — run *Update Repository from Template*.
- **You deleted something you needed** — see the same action; deleting the file
  is what brings a fresh copy back.
- **The tree looks out of date** — collapse and expand the course, which reloads
  it from the server.

## Next

- [Units](student-unit.md) — how a course is organized, and readings
- [Assignments](student-assignment.md) — working, testing, submitting, files
