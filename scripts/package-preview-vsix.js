#!/usr/bin/env node

/** Package an immutable preview VSIX without modifying the checkout. */

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const repo = path.resolve(__dirname, "..");
const packageJsonPath = path.join(repo, "package.json");
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
const commit = process.env.PREVIEW_COMMIT || "local";
const branch = process.env.PREVIEW_BRANCH || "local";
const backendUrl = process.env.PREVIEW_BACKEND_URL || "";
const previewId = process.env.PREVIEW_ID || branch.replace(/[^A-Za-z0-9_.-]+/g, "-");
// Include the deployment identity so two builds of the same commit cannot
// overwrite one another in an artifact registry.
const previewSuffix = crypto.createHash("sha256").update(previewId).digest("hex").slice(0, 8);
const version = process.env.PREVIEW_VERSION || `2026.10.0-preview.${commit.slice(0, 8)}.${previewSuffix}`;
const outputDir = path.resolve(process.env.PREVIEW_OUTPUT_DIR || path.join(repo, "artifacts"));
const output = path.join(outputDir, `computor-${version}.vsix`);

if (!/^\d+\.\d+\.\d+-[0-9A-Za-z.-]+$/.test(version)) {
  throw new Error(`PREVIEW_VERSION is not a VS Code prerelease version: ${version}`);
}

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "computor-vsix-"));
try {
  fs.cpSync(repo, temp, {
    recursive: true,
    filter(source) {
      const relative = path.relative(repo, source);
      return !relative.startsWith(".git") &&
        !relative.startsWith("node_modules") &&
        !relative.startsWith("artifacts") &&
        !relative.startsWith("coverage") &&
        !relative.startsWith("out");
    },
  });

  const tempPackagePath = path.join(temp, "package.json");
  const tempPackage = JSON.parse(fs.readFileSync(tempPackagePath, "utf8"));
  tempPackage.version = version;
  // The production bundle is built in the source checkout by the outer
  // `package:preview` command.  Running vsce in the dependency-free staging
  // copy must not invoke that hook again: the copy intentionally excludes
  // node_modules and therefore cannot run TypeScript/Webpack.
  if (tempPackage.scripts) {
    delete tempPackage.scripts["vscode:prepublish"];
    delete tempPackage.scripts.prepublish;
  }
  fs.writeFileSync(tempPackagePath, `${JSON.stringify(tempPackage, null, 2)}\n`);

  fs.mkdirSync(outputDir, { recursive: true });
  if (fs.existsSync(output)) {
    throw new Error(`preview artifact already exists: ${output}`);
  }
  const vsce = path.join(repo, "node_modules", ".bin", "vsce");
  if (!fs.existsSync(vsce)) {
    throw new Error("@vscode/vsce is not installed; run npm ci first");
  }
  const result = spawnSync(vsce, ["package", "--no-dependencies", "--no-yarn", "--out", output], {
    cwd: temp,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }

  const digest = crypto.createHash("sha256").update(fs.readFileSync(output)).digest("hex");
  fs.writeFileSync(`${output}.sha256`, `${digest}  ${path.basename(output)}\n`);
  fs.writeFileSync(
    `${output}.preview.json`,
    `${JSON.stringify({
      preview_id: previewId,
      branch,
      commit,
      backend_url: backendUrl,
      version,
      vsix: path.basename(output),
      sha256: digest,
      built_at: new Date().toISOString(),
    }, null, 2)}\n`,
  );
  process.stdout.write(`${output}\n`);
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
