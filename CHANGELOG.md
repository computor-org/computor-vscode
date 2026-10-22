# Changelog

Versions are semester CalVer (`YYYY.M.patch`, minor = semester start month).
See [RELEASING.md](RELEASING.md) for the scheme and the channel rules.

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
