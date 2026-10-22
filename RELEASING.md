# Releasing the Computor VS Code extension

The extension is published as [`computor-org.computor`](https://marketplace.visualstudio.com/items?itemName=computor-org.computor),
under the same Marketplace publisher as [hackl](https://marketplace.visualstudio.com/items?itemName=computor-org.hackl).

## Version scheme

Versions are **semester CalVer**: `YYYY.M.patch`, where the minor is the month
the semester starts.

| line | semester | example |
|---|---|---|
| `2026.10.x` | winter 2026/27 | `2026.10.1` |
| `2027.3.x` | summer 2027 | `2027.3.0` |
| `2027.10.x` | winter 2027/28 | `2027.10.0` |

Two rules the tooling enforces, because both are easy to get wrong:

- **No zero-padded month, anywhere.** The branch name and the version prefix
  are the same string: `release/2027.3` produces `2027.3.x`, so there is
  nothing to translate between them. A padded month is not valid semver —
  numeric identifiers may not have leading zeros, and npm and `vsce` reject
  `2027.03.1` — so `scripts/release-channel.mjs` fails loudly on it as a typo
  guard rather than letting it surface during a semester rollover.
- **The minor must be a semester month** (3 or 10). Anything else is a typo.

## Channels

The channel is an **explicit decision at release time**, not something derived
from the version number.

The VS Code Marketplace marks a pre-release solely through `vsce --pre-release`.
The common convention — odd minor for pre-release, even minor for stable —
cannot work here: the calendar owns our minor, October is even and March is
odd, so the meaning would flip every semester. We therefore pick the channel
per release and let the tooling guarantee nothing contradicts it.

The only ordering rule that matters:

> A stable release must be numerically **above** every pre-release published
> before it. Otherwise opted-in users sit above it and never come back down.

Always bumping the patch gives that for free. A worked line:

```
2026.10.1   pre-release
2026.10.2   pre-release
2026.10.3   pre-release
2026.10.4   STABLE        <- 2026.10 ships
2026.10.5   pre-release   <- ramp toward the next fix
2026.10.6   STABLE
2027.3.1    pre-release   <- next semester
```

Stable users never see an odd-numbered build in that list — they only ever
receive versions published without the flag. Pre-release users always sit on
the highest number of either kind.

## Cutting a release

1. Bump `version` in `package.json` on the release branch and update
   `CHANGELOG.md`.
2. Commit, then tag: `git tag v$(node scripts/release-channel.mjs version)`.
3. Push the branch and the tag.
4. Create a GitHub release on that tag. **Tick "set as a pre-release" for the
   pre-release channel; leave it unticked for stable.**
5. The `Release VSIX` workflow validates, tests, packages and attaches the VSIX
   and `SHA256SUMS` to the release. Creating a GitHub release does not publish
   to the Marketplace.
6. Publish the approved VSIX separately using the authenticated manual command
   below, or the workflow's opt-in `publish` input when its credentials are
   configured. Use the same channel as the GitHub release and verify its tag
   resolves to the reviewed commit.

For a GitHub release, step 4 chooses the channel. The workflow's first job step
runs:

```sh
node scripts/release-channel.mjs check-github <tag> <prerelease> <channel>
```

which refuses to continue if the tag does not match `package.json`, or if the
GitHub pre-release checkbox disagrees with the channel being published. That is
the guard against ticking "pre-release" on GitHub while publishing as stable.

### Publishing by hand

```sh
npm ci
COMPUTOR_RELEASE_CHANNEL=stable npm run package:vsix    # writes computor-<version>.vsix
COMPUTOR_RELEASE_CHANNEL=stable npm run publish:marketplace
```

`COMPUTOR_RELEASE_CHANNEL` must be `pre-release` or `stable`; there is no
default, so a publish cannot silently pick the wrong one. Authentication uses
`VSCE_PAT` when set, and otherwise the signed-in Microsoft Entra credential
(`az login`) via `vsce --azure-credential` — the same path hackl uses.

`publish` sends the existing VSIX rather than rebuilding. To publish the
GitHub release artifact, download its VSIX and `SHA256SUMS`, verify the checksum,
and place that approved VSIX in the repository root before running the publish
command. Packaging again in a separate run does not guarantee identical bytes.

## Backend compatibility

**Rule: while a semester line is live, every Marketplace release must stay
compatible with that line's backend.** The Marketplace has one extension for
every deployment, so a 2027.3.x release also reaches users of
code.tugraz.at, which runs backend `release/2026.10`. A newer endpoint or
response field may be used only behind feature detection: a capability the
backend advertises (for example `issue_reporting.mode` on `GET /instance-info`),
or an optional field whose absence the code handles.

`compat/lines.json` lists the live lines. For each, `compat/backend-<line>.json`
is a snapshot of that backend's API contract (paths, methods and response
schemas from its own OpenAPI). `npm run check:backend-compat`, part of CI and
of the release workflow, fails when:

- the extension calls a path/method that a live line lacks, unless the calling
  function is marked `@backendCompat <how it is feature-detected>` in its JSDoc
  (its callers must check that capability first);
- a response type the extension declares (`client.get<T>(…)`) has a required
  field, at any depth, that a live line does not return. Make it optional and
  handle its absence.

`compat/known-gaps.json` lists findings that predate the guard and fail
against backend main as well (dead or mistyped calls). It may only shrink.

The `backend-contract` workflow regenerates each snapshot from the public
backend branch weekly and when `compat/` changes, and fails if it is stale. To
refresh a snapshot by hand, in a computor-backend checkout of that branch:

```sh
uv run --project computor-backend python <vscode>/scripts/compat/dump-backend-contract.py \
  "computor-backend release/2026.10 $(git rev-parse --short=12 HEAD)" > <vscode>/compat/backend-2026.10.json
```

When a semester line is retired, remove its entry from `compat/lines.json`
and its snapshot. When a new line goes live on a deployment that keeps it
while main moves on, add it.

Before publishing, also smoke-test the VSIX against each live deployment with
a test account (read-only calls on the older line).

## Rolling a release out to the Computor workspaces

Hosted Coder workspaces do not take Marketplace updates. Each Computor instance
approves one release through a pin in
[computor-backend](https://github.com/computor-org/computor-backend), and its
workspaces install that version in place (no rebuild, home untouched; see
`ops/coder/templates/README.md`, "Extension updates", there). After the GitHub
release above has its VSIX and `SHA256SUMS`:

1. In computor-backend, on the branch the instance deploys (`main` for
   computor.at and the 2027.3 line, `release/2026.10` for code.tugraz.at and
   the 2026.10 line), run `ops/coder/pin-extension.py <version>`. It verifies
   the release VSIX against `SHA256SUMS` and rewrites
   `computor-backend/src/computor_backend/coder/approved_extension.json`.
2. Open a PR with that one-file change, merge it, and deploy the backend as
   usual (`./computor.sh update run prod`). The backend registers the pinned
   release at startup, running workspaces install it within 30 minutes and
   offer "Reload Window", stopped ones install it on their next start.

Only release versions (`x.y.z`) are pinned. A workspace never installs a
version older than the one it already has, so a template push with a newer
image is not undone; going back to an older release needs a template push.

## Preview VSIX (feature branches)

Preview builds are **sideload-only** and never reach the Marketplace: they
carry a semver pre-release suffix, which the Marketplace rejects.

```
2026.10.4-preview.<commit8>.<previewid8>
```

The version is derived from the **next** patch, which places it deliberately:

```
2026.10.3  <  2026.10.4-preview.<commit>.<id>  <  2026.10.4
   published            this preview              what it becomes
```

Above what is published, so VS Code does not quietly replace a pinned preview
on a workshop machine; below the patch it graduates into, so the release
supersedes it when it lands.

Build one with the `Preview VSIX` workflow (`workflow_dispatch`, optional
preview id and backend URL), or locally:

```sh
PREVIEW_COMMIT=$(git rev-parse HEAD) PREVIEW_BRANCH=$(git branch --show-current) \
  npm run package:preview
```

Each build writes the VSIX, a `.sha256`, and a `.preview.json` recording the
commit, branch, backend URL, and digest, and refuses to overwrite an existing
artifact.

Previews share the extension ID `computor-org.computor`, so only one is
installable at a time and a Marketplace release will supersede it — which is
the intended graduation path.

## Checks

```sh
npm run test:release      # version, channel, and preview-ordering rules
npm run test:coverage     # full unit suite
node scripts/release-channel.mjs version   # 2026.10.1
node scripts/release-channel.mjs tag       # v2026.10.1
node scripts/release-channel.mjs branch    # release/2026.10
```
