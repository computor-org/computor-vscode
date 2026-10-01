# Assignments

An assignment is a piece of work you hand in: a folder in your course repository
with the task description, the files you start from, and the files you are meant
to write. This page covers working on one, handing it in, and everything you can
do with the files inside it.

## What the row tells you

```
🟦 Lab 1: Hello World   ● 🔔 1 (2/5) (1/3) 85% 90%
```

Reading that from the left:

| Part | Meaning |
|------|---------|
| 🟦 | The content type your lecturer defined — lab, homework, exam. A tick or cross on the icon shows whether the last test passed |
| `●` `↑` `⚠` | Your work's state: uncommitted, not uploaded, upload failing. See [Courses](student-course.md#the-marks-on-a-row) |
| `🔔 1` | Unread messages on this assignment |
| `(2/5)` | Test runs: two used of five allowed. Just `(2)` when there is no limit |
| `(1/3)` | Submissions: one made of three allowed |
| `85%` | The **test result** — what the automated tests scored |
| `90%` | The **grade** — your lecturer's official mark, once graded |

The two percentages always keep their places: the test result first, the grade
second. If you have a grade but no test result, the first slot reads `-%`, so
the second number is always the grade and never has to be guessed at.

Hovering gives the same information in words, plus your team members if the
assignment is a team one.

## Working on an assignment

**1. Read the task.** Click the book icon on the row, or right-click →
*Show Description*. The description opens beside your code and stays there
while you work.

**2. Write your solution.** Expand the assignment to see its files and click one
to open it. Keep the files the task asks for under the names it asks for —
renaming a file the tests look for makes them fail.

**3. Test.** Click the beaker icon, or right-click → *Test Assignment*.

> Testing is not a local dry run. Computor saves your open files, commits them,
> uploads them, and runs the tests **on the server** — so a test run always
> uploads your current work, and it always costs one of your test runs if the
> assignment has a limit. Results come back into the Test Results panel; click a
> failed test to jump to the code it is about.

**4. Commit as you go.** The commit icon on the assignment saves and uploads
that folder; *Commit Course* on the course row does the whole course at once.
Commit early and often — it is your backup, and it costs nothing. It is not a
submission and nobody grades it.

**5. Submit when you are ready.** The upload icon, or right-click → *Submit*.
This is the deliberate act of handing in, it is limited, and the count only goes
up.

Computor submits the commit that was **tested**, not necessarily your newest
one. If those differ — because the last test could not run, for instance — you
are told before anything is handed in, so your newest work never gets graded
silently or left out silently.

**6. Read the feedback.** *Show Test Results* for the automated run,
*View Details* for the submission history and grading, *Show Messages* for what
your lecturer or tutor wrote. A status of *Correction Necessary* means changes
are expected; *Correction Possible* means you may revise if submissions remain.

## Test runs and submissions are limited

When your lecturer sets a limit, the row shows how much you have left, and
Computor tells you before an action would exceed it rather than after.

Spend test runs deliberately: read the error, reason about the code, then test.
Save submissions for work you believe in — once the count is reached you cannot
hand in again, and no amount of remaining time helps.

## Working with files

Expand an assignment to see its files. Right-click a file, a folder, or the
assignment itself. Everything here happens **on your computer only** — nothing
reaches the server until you commit.

**Creating.** *New File…* and *New Folder…* on the assignment or on a folder.
The new file opens straight away.

**Copying and moving.** *Copy File…* and *Move File…* offer only folders inside
the same assignment, so work cannot land in a different exercise by mistake. If
the name is taken you are asked to *Keep Both* or *Overwrite*. *Cut*, *Copy* and
*Paste* are the two-step alternative; *Paste* appears once something is waiting.

**Renaming and duplicating.** *Rename…* gives a new name; *Duplicate* makes a
copy beside the original.

**Deleting.** *Delete File* and *Delete Folder*, always after a confirmation.
If the file was part of an assignment you already submitted, the confirmation
says so — you may still delete it, but not without knowing. The same warning
appears when you move or rename such a file.

Deleting a file elsewhere — in the Explorer, or with `rm` in a terminal —
cannot be caught beforehand. Computor notices it immediately afterwards and, if
the file was part of a submission, offers to bring your last committed version
back with one click.

**Paths.** *Copy Path* for the full path, *Copy Relative Path* for its path
inside the repository, *Reveal in File Explorer* to show it in the file manager —
or in the VS Code Explorer when you work in the browser. If the browser refuses
Computor the clipboard, the path is shown in a box to copy by hand.

**What you cannot change.** A few things are managed for you: `.git`, and at the
top of an assignment the `README.md`, its translations, and `mediaFiles` — that
is the task description, which your lecturer maintains. READMEs in sub-folders
are yours to write.

## Getting a file back

If you have ruined a file that came with the assignment — data, a figure, the
starter code — you can have a fresh copy:

1. **Copy anything you want to keep** (right-click → *Copy File…*).
2. **Delete** the file.
3. Right-click the **course** → *Update Repository from Template*.

Every file the course material has and your folder does not is restored, and
files you still have are left untouched. That is why deleting first is a
required step rather than a shortcut: it is what makes the restore safe for
everything else you have written.

## Team assignments

Some assignments are handed in by a group. You share one folder and one
submission count with your teammates: any of you can commit, and any of you can
submit for all of you. The hover text lists who is on the team.

Agree on who submits and when. A submission spent by one member is spent for
everyone.

## When something goes wrong

**"I deleted a file I needed."** See [Getting a file back](#getting-a-file-back).
If you had committed the file, Computor may also have offered to restore your own
version right after the deletion.

**"Tests will not run."** The assignment has to be set up locally and your work
has to be uploadable — a `⚠` on the row means uploading is failing, so run
*Fix Repository Authentication* on the course first. If the run starts but every
test fails, read the output in Test Results before spending another attempt.

**"Submitting failed."** Check the submission count on the row. If the count is
not the problem, look for `⚠` — a submission needs your work on the server.

**"No test runs left."** Ask your lecturer in the course messages. Meanwhile
your last successful result still stands, and you can still submit.

**"My newest work was not graded."** Submitting hands in the *tested* commit.
Run a test on your latest commit, then submit again if you have one left.

## Next

- [Courses](student-course.md) — the repository, commits and the row marks
- [Units](student-unit.md) — how a course is organized, and readings
