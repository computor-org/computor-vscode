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
5. The `Release VSIX` workflow validates, tests, packages, attaches the VSIX
   and `SHA256SUMS` to the release, and publishes to the Marketplace.

Step 4 is the only place the channel is chosen. The workflow's first job step
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
npm run package:vsix                                  # writes computor-<version>.vsix
COMPUTOR_RELEASE_CHANNEL=pre-release npm run publish:marketplace
```

`COMPUTOR_RELEASE_CHANNEL` must be `pre-release` or `stable`; there is no
default, so a publish cannot silently pick the wrong one. Authentication uses
`VSCE_PAT` when set, and otherwise the signed-in Microsoft Entra credential
(`az login`) via `vsce --azure-credential` — the same path hackl uses.

`publish` sends the artifact built by `package:vsix` rather than rebuilding, so
the bytes on the Marketplace are the bytes that were checksummed and attached
to the GitHub release.

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
