# Changelog

## Unreleased

- Support Lena, legacy Luna and AI tutor mention aliases in autocomplete; the
  composer advertises `@lena`, `@luna` and `@ai` only on servers that resolve them.
- Keep Ctrl/Cmd+Enter as Send while mention suggestions are open.
- Keep the draft when a message is rejected, e.g. for an ambiguous plain `@name`.

Versions are semester CalVer (`YYYY.M.patch`, minor = semester start month).
See [RELEASING.md](RELEASING.md) for the scheme and the channel rules.

## 2026.10.3

- Selecting a unit or exercise title shows its own instructions beside code; keyboard selection,
  repeated clicks and rapid switching reuse one preview without stealing focus.
- Hosted course launches open the requested course and its released instructions,
  including before a local repository has been set up.
- Course, unit and assignment description actions use the same book icon.

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
