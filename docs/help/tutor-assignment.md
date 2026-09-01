# Grading an Assignment

One assignment, one student: this page walks through reviewing a submission
from opening it to the grade and the message that goes with it. How to find
the student and the assignment is covered in [The Tutor View](tutor-course.md).

## What is under an assignment

Click the assignment row (or right-click → *Checkout*) and Computor downloads
what you need. Expanding the row then shows:

- **Submissions** — the files of the student's latest submission. This is what
  you grade.
- **References** — the reference solution for the deployed version of the
  assignment, so you can see what was expected.
- **History** — earlier submissions, when there is more than one. Each entry
  can be expanded, tested and downloaded like the latest one.

Checkout from the context menu asks before re-downloading files you already
have; clicking the row just fetches what is missing.

## Reviewing the work

**Read the task first.** The preview icon on the row (or *Show README
Preview*) opens the assignment description the student worked from.

**Open the files.** Expand *Submissions* and click a file to read it. To see
how it differs from the sample solution, right-click a submission file →
*Compare with Reference* — a diff opens against the same file in the
reference.

**Look at their test result.** Clicking the row opens the student's own last
test run in the Test Results panel. Entries under *History* offer *Show Test
Results* for that particular submission.

**Run your own test.** *Run Test* on the assignment or a submission packages
the downloaded files and runs the course's tests on them. This is your test
run, not the student's — it does not use up their budget. On *References* the
same command checks that the reference itself still passes.

## Setting the grade

Click the grading icon on the assignment row, or right-click → *Grading…*.
You are asked for two things:

1. **The grade** — a number between 0.00 and 1.00. This is the official mark,
   shown to the student as a percentage next to their test result.
2. **The status** — what should happen next:

| Status | Meaning |
|--------|---------|
| corrected | Done. The work is reviewed and the grade stands |
| correction_necessary | The student must revise and submit again |
| improvement_possible | Good enough to stand, but the student may improve it |
| not_reviewed | Take the review back, e.g. after grading the wrong student |

The grade applies to the latest submitted version. If the student submits
again afterwards, the assignment shows up as unreviewed again.

**After a correction verdict, say what to change.** When you pick
*correction_necessary* or *improvement_possible*, the message conversation for
this assignment opens by itself. The student only sees the status and the
percentage — without a message they cannot know what was wrong, so write one
before moving on.

An assignment marked `👁 invisible` is graded exactly the same way — hidden
only means students cannot see the content any more, not that its submissions
stop needing marks.

## Granting extra attempts

When a student is out of test runs or submissions and asks for another
attempt, right-click the assignment → *Set Max Test Runs for Student…* or
*Set Max Submissions for Student…*. The number you enter applies to this
student on this assignment only; leaving the field empty puts them back on the
assignment's normal limit.

## Next

- [The Tutor View](tutor-course.md) — finding students, badges, hidden
  content, messages and comments
