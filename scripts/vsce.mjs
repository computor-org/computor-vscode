/**
 * Package or publish the extension through vsce with the right channel flag.
 *
 * The channel is explicit — `COMPUTOR_RELEASE_CHANNEL`, or the second CLI
 * argument — because the Marketplace derives nothing from the version number.
 * Authentication prefers `VSCE_PAT` and otherwise falls back to the signed-in
 * Microsoft Entra credential (`az login`), which is how the hackl repository
 * publishes under the same `computor-org` publisher.
 */

import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { normaliseChannel, parseVersion, rootVersion } from "./release-channel.mjs";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(SCRIPT_PATH), "..");

export function vsixName(version) {
  parseVersion(version);
  return `computor-${version}.vsix`;
}

export function vsceArgs(action, version, channel, useAzureCredential = false) {
  if (!["package", "publish"].includes(action)) {
    throw new Error(`unknown vsce action: ${action}`);
  }
  const wanted = normaliseChannel(channel);
  const args = ["--no-install", "vsce", action];
  if (action === "package") {
    args.push("--out", vsixName(version));
  } else {
    // Publish the artifact that was built and checksummed, never a fresh
    // rebuild: the bytes on the GitHub release must be the bytes on the
    // Marketplace.
    args.push("--packagePath", vsixName(version));
  }
  // The repository carries a yarn.lock alongside package-lock.json, which
  // makes vsce switch to yarn and fail; CI installs with npm.
  args.push("--no-dependencies", "--no-yarn");
  if (wanted === "pre-release") {
    args.push("--pre-release");
  }
  if (action === "publish" && useAzureCredential) {
    args.push("--azure-credential");
  }
  return args;
}

export function runVsce(action, root = REPO_ROOT, channel = process.env.COMPUTOR_RELEASE_CHANNEL) {
  const version = rootVersion(root);
  const useAzureCredential = action === "publish" && !process.env.VSCE_PAT;
  const command = process.platform === "win32" ? "npx.cmd" : "npx";
  const args = vsceArgs(action, version, channel, useAzureCredential);
  console.log(`vsce ${action}: ${version} (${normaliseChannel(channel)})`);
  const result = spawnSync(command, args, {
    cwd: root,
    env: process.env,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_PATH) {
  const [action, channel] = process.argv.slice(2);
  runVsce(action, REPO_ROOT, channel || process.env.COMPUTOR_RELEASE_CHANNEL);
}
