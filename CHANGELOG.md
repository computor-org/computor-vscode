# Changelog

Versions are semester CalVer (`YYYY.M.patch`, minor = semester start month).
See [RELEASING.md](RELEASING.md) for the scheme and the channel rules.

## 2027.3.11

- A workspace started from the web app without choosing a course opens in your reading
  language, including VS Code's own menus and the welcome page.
- Test results show each message, error and test type in your reading language, also for runs
  made while you read in the other language. Older results keep the language they were stored in.

## 2027.3.10

- The extension follows one reading language: your profile language, else the language the
  backend works out from your browser, else the VS Code display language. The course's language
  no longer decides. A change of your profile language applies at once, without a reload, and
  a half-written message keeps its text.
- Course, unit and assignment titles, content types, notifications, prompts, webviews, help
  pages and the tutor and lecturer views are in German for German readers. Error messages start
  with a German sentence and keep the raw detail as "Details:". Dates read "heute" or
  "vor 3 Tagen". Command and view names follow the VS Code display language, which VS Code
  sets for the whole window.
- Sign-in pages, the page after sign-in and every request to the backend carry the reading
  language, so the server answers, including errors and test feedback, in that language.
- Status icons update after a test, a submission, a commit or a tutor's grading.
- Tutors and lecturers open on an introduction to their own views; self-enrolled learners are
  told that Lena answers their messages.

## 2027.3.9

- In a browser workspace or a remote window, the extension no longer offers a browser sign-in
  that cannot complete there. When the workspace's sign-in has stopped working, it says to
  restart the workspace from the Computor web app or to use an API token.

## 2027.3.8

- The connection indicator follows the visible Computor views and asks for attention only after
  automatic reconnects have failed. Leaving a course stops its live updates, and a reconnect
  restores the remaining ones.

## 2027.3.7

- In courses where Lena, the AI tutor, answers messages without an @mention, the message box
  says so before you send, and Lena's messages carry an AI label. The placeholder names only
  `@lena`; `@luna` and `@ai` keep working.
- The @-mention list opens as an overlay at the caret instead of being cut off below the editor.
- A course opens at the first exercise you have not handed in, with one localized Welcome page
  shared by desktop VS Code and the browser workspace.
- Test and Submit from the Command Palette act on the selected assignment and confirm first.
- Assignment actions and workspace guidance are localized; the status bar shows workspace
  sign-in progress instead of a notification.
- Lecturers can import course members from Excel files again.
- Shipped dependencies with known vulnerabilities are updated.

## 2027.3.6

- Report a Problem sends your report to the Computor support team as a ticket on servers that
  support it (computor.at). You can attach a log file, and you follow replies and the status in
  the web app ("My Problem Reports"). On older servers the previous behaviour stays.
- Feedback and bug report links point to https://computor.at/problem.

## 2027.3.5

- After a Computor workspace installs a newer version of the extension in place, a notice
  offers Reload Window to switch to it. Nothing reloads on its own.

## 2027.3.4

- A new Welcome to Computor page opens after sign-in and walks you through your first assignment.
  Open it again any time from Computor: Welcome and Help.
- Links inside the help pages now stay in the help view in the browser editor.

## 2027.3.3

- Instructions follow the course language when you have not chosen a language in your
  profile: a German course shows the German README, also before the repository is cloned.
- The course start page shows the exercise heading once, in the reading language.

## 2027.3.2

- Support Lena, legacy Luna and AI tutor mention aliases in autocomplete; the
  composer advertises `@lena`, `@luna` and `@ai` only on servers that resolve them.
- Keep Ctrl/Cmd+Enter as Send while mention suggestions are open.
- Keep the draft when a message is rejected, e.g. for an ambiguous plain `@name`.

## 2027.3.1

- Selecting a unit or exercise title shows its own instructions beside code; keyboard selection,
  repeated clicks and rapid switching reuse one preview without stealing focus.
- Hosted course launches open the requested course and its released instructions,
  including before a local repository has been set up.
- Preserves desktop, public-course and Codespaces entry points.

## 2027.3.0

- Public courses, desktop VS Code and GitHub Codespaces available before login.
- Existing course messages continue to support Lena hints and feedback on submitted work.
- Supports both 26.10 and main/27.3 under the existing Marketplace identity.

## 2026.10.2

First stable release of the `2026.10` line.

- Expanded lecturer and tutor tree actions, including hierarchy deletion,
  course budget defaults, per-student overrides, and tutor help pages.
- Added document mirroring and PDF previews, course and assignment link checks,
  and improved example and course-content workflows.
- Improved student submission safeguards, file actions, hidden-content handling,
  and test-result targeting.
- Refined message notification behavior, permission refreshes, and generated
  backend error reporting.

## 2026.10.1 — pre-release

First VS Code Marketplace publication, on the pre-release channel. The
`2026.10` line stays pre-release until the 2026.10 system release ships, at
which point a higher patch is published as stable.

- Marketplace listing as `computor-org.computor`, with the Computor logo,
  MIT licence, and the corrected repository link.
- Release tooling: explicit `pre-release`/`stable` channel selection, git tag
  and GitHub pre-release checkbox validated against the published channel, VSIX
  and `SHA256SUMS` attached to every GitHub release.
- Preview VSIX builds for feature branches, versioned from the next patch so a
  pinned preview is not replaced by a Marketplace update.
