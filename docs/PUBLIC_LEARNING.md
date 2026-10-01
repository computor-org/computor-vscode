# Public courses and the Hackl tutor

License: CC BY 4.0. Attribution: Computor contributors, TU Graz.

Use **Computor: Public Courses** before signing in. You can read the three bilingual
Python courses, clone the public examples into desktop VS Code, or create a GitHub
Codespace. Reading needs no account. Codespaces needs a GitHub account and uses
your quota; local practice runs on your computer. Hosted workspace capacity does
not affect these choices.

The public repository contains exercise descriptions, templates and input files.
Follow its [getting-started guide](https://github.com/computor-org/data-science-python/blob/main/docs/GETTING_STARTED.md).
Private instructor solutions and grading tests remain separate. Sign into Computor
when you want enrolled-course progress, submissions or authenticated server tests.

Install Hackl from publisher `computor-org` to use **Computor: Open Tutor**. Configure
an OpenAI-compatible endpoint and model. Store an external provider key with
**Hackl: Set API Key**, never in settings or repository files. Desktop learners
may use a local model. Codespaces requires an external HTTPS provider and your own
key; it does not run an inference model. The provider receives the task context
and selected code or image, and its own terms and usage charges apply.

Existing courses use Ask-only: hints, explanations and review. File writes, shell,
MCP, Yolo and inline completion are unavailable. An independent check disables all
AI. The course policy changes with the active assignment, and invalid/unavailable
policy updates keep generation disabled. Leaving a course or logging out clears
its context without changing your global Hackl settings.

For plots, choose **Computor: Review Plot with Hackl** and select a PNG or JPEG inside
the workspace, at most 2 MB. Use a vision-capable model. Feedback addresses the
plot and numerical interpretation; server grading and instructor assessment are
separate. No background scan of your image folders occurs.

The current Computor extension supports both stable 26.10 and main/27.3. Its
publisher and extension ID stay the same. Legacy backends do not need new policy
endpoints. Missing Hackl does not prevent course management. If Hackl cannot be
installed on an older editor, course management remains available; use a current
desktop editor or Codespaces for the tutor.
