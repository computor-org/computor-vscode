/**
 * Version and release-channel rules for the Computor extension.
 *
 * Versions are semester CalVer: `YYYY.M.patch`, where the minor is the month a
 * semester starts — 10 for the winter semester, 3 for the summer semester.
 * So 2026.10.x is the WS 2026/27 line and 2027.3.x is the SS 2027 line.
 *
 * The channel is NOT derived from the version. The VS Code Marketplace marks a
 * pre-release solely through the `--pre-release` flag, so the usual
 * odd/even-minor convention would only fight the calendar here: October is
 * even and March is odd, which would flip the meaning every semester. The
 * channel is therefore an explicit input to the release, and this module's job
 * is to make sure the version, the git tag, and the GitHub pre-release
 * checkbox cannot disagree with the flag that is actually passed to vsce.
 *
 * The single ordering invariant that matters: a stable release must be
 * numerically above every pre-release published before it, otherwise opted-in
 * users sit above it and never come back down. Always bumping the patch gives
 * that for free.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const CHANNELS = ["pre-release", "stable"];
/** Months a semester starts in. A version outside these is a typo, not a release. */
export const SEMESTER_MONTHS = [3, 10];

/**
 * Parse and validate a Computor extension version.
 *
 * The month is never zero-padded, in the version or in the branch name, so
 * `release/2027.3` produces `2027.3.x` and there is nothing to translate
 * between the two. The leading-zero check below is therefore a typo guard
 * rather than a conversion: a padded month is not valid semver and npm/vsce
 * reject it, so it fails here instead of at publish time.
 */
export function parseVersion(version) {
  if (typeof version !== "string" || !/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(
      `version must be YYYY.M.patch with no pre-release suffix: ${version}`
    );
  }
  const [yearText, monthText, patchText] = version.split(".");
  if (/^0\d/.test(monthText)) {
    throw new Error(
      `version minor must not have a leading zero (use 2027.3.x, not ${version}); ` +
        "the release branch keeps the zero-padded name"
    );
  }
  const year = Number(yearText);
  const month = Number(monthText);
  const patch = Number(patchText);
  if (year < 2000 || year > 2999) {
    throw new Error(`version major must be a four-digit year: ${version}`);
  }
  if (!SEMESTER_MONTHS.includes(month)) {
    throw new Error(
      `version minor must be a semester start month (${SEMESTER_MONTHS.join(
        " or "
      )}): ${version}`
    );
  }
  return { year, month, patch };
}

export function normaliseChannel(channel) {
  if (!CHANNELS.includes(channel)) {
    throw new Error(`channel must be one of ${CHANNELS.join(", ")}: ${channel}`);
  }
  return channel;
}

/** Git tag for a version. The `v` prefix matches the hackl repositories. */
export function releaseTag(version) {
  parseVersion(version);
  return `v${version}`;
}

/**
 * The release branch a version belongs to. The branch name and the version
 * prefix are the same string, so this is a plain concatenation:
 * `2027.3.4` -> `release/2027.3`.
 */
export function releaseBranch(version) {
  const { year, month } = parseVersion(version);
  return `release/${year}.${month}`;
}

/**
 * Guard the three things that can silently disagree at release time: the tag,
 * the GitHub pre-release checkbox, and the channel the workflow was asked for.
 * A mismatch here is how a pre-release gets published as stable.
 */
export function validateGitHubRelease(version, tag, markedPrerelease, channel) {
  parseVersion(version);
  const wanted = normaliseChannel(channel);
  const expectedTag = releaseTag(version);
  if (tag !== expectedTag) {
    throw new Error(`release tag ${tag} must match ${expectedTag}`);
  }
  const expectedPrerelease = wanted === "pre-release";
  if (markedPrerelease !== expectedPrerelease) {
    throw new Error(
      `channel ${wanted} requires the GitHub pre-release flag to be ` +
        `${expectedPrerelease}, got ${markedPrerelease}`
    );
  }
  return wanted;
}

export function rootVersion(root = process.cwd()) {
  return JSON.parse(
    fs.readFileSync(path.join(root, "package.json"), "utf8")
  ).version;
}

const SCRIPT_PATH = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_PATH) {
  const [command, ...rest] = process.argv.slice(2);
  if (command === "check-github") {
    const [tag, prerelease, channel] = rest;
    if (!tag || !["true", "false"].includes(prerelease) || !channel) {
      throw new Error(
        "usage: release-channel.js check-github <tag> <true|false> <pre-release|stable>"
      );
    }
    console.log(
      validateGitHubRelease(
        rootVersion(),
        tag,
        prerelease === "true",
        channel
      )
    );
  } else if (command === "version") {
    console.log(rootVersion());
  } else if (command === "tag") {
    console.log(releaseTag(rootVersion()));
  } else if (command === "branch") {
    console.log(releaseBranch(rootVersion()));
  } else {
    throw new Error("usage: release-channel.js <check-github|version|tag|branch>");
  }
}
