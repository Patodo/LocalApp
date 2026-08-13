import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectDirectory = path.resolve(scriptDirectory, "..");
const requiredFiles = [
  "package.json",
  "README.md",
  "LICENSE",
  ".localapp-artifact.json",
  "bin/localapp.mjs",
  "runtime/server/bin/server.mjs",
  "runtime/native/adapter-manifest.json",
  "template/package.json",
];

export async function checkNpmRelease({ tarballPath, expectedTag, runNpmDryRun = defaultNpmDryRun }) {
  if (typeof tarballPath !== "string" || tarballPath.length === 0) throw new Error("tarball path is required");
  if (typeof expectedTag !== "string" || expectedTag.length === 0) throw new Error("release tag is required");
  const resolvedTarball = path.resolve(tarballPath);
  const tarballStat = await fs.lstat(resolvedTarball).catch(() => null);
  if (!tarballStat?.isFile() || tarballStat.isSymbolicLink()) throw new Error(`release tarball is not a regular file: ${resolvedTarball}`);

  const entries = await listArchive(resolvedTarball);
  for (const entry of entries) {
    if (!isSafeArchivePath(entry)) throw new Error(`unsafe archive path: ${entry}`);
  }

  const extractionParent = path.join(projectDirectory, "tmp");
  await fs.mkdir(extractionParent, { recursive: true });
  const extractionRoot = await fs.mkdtemp(path.join(extractionParent, "npm-release-check-"));
  try {
    const extracted = await run("tar", ["-xzf", resolvedTarball, "-C", extractionRoot, "--no-same-owner"]);
    if (extracted.code !== 0) throw new Error(`could not extract release tarball: ${extracted.stderr.trim()}`);
    const packageRoot = path.join(extractionRoot, "package");
    await assertSafeTree(packageRoot);
    for (const relative of requiredFiles) await requireRegularFile(packageRoot, relative);

    const packageJson = await readJson(path.join(packageRoot, "package.json"), "package.json");
    validatePackageManifest(packageJson, expectedTag);
    const releaseTargets = await readJson(path.join(projectDirectory, "packages/shared/release-targets.json"), "release target manifest");
    const expectedTargets = sortedTargets(releaseTargets.nativeAdapters, "release target manifest");
    const artifact = await readJson(path.join(packageRoot, ".localapp-artifact.json"), ".localapp-artifact.json");
    const nativeManifest = await readJson(path.join(packageRoot, "runtime/native/adapter-manifest.json"), "native adapter manifest");
    if (artifact.name !== packageJson.name || artifact.version !== packageJson.version) {
      throw new Error("artifact identity does not match package name and version");
    }
    assertExactTargets(sortedTargets(artifact.nativeAdapters, "artifact native adapters"), expectedTargets);
    assertExactTargets(sortedTargets(nativeManifest.adapters, "native adapter manifest"), expectedTargets);

    await runNpmDryRun(resolvedTarball);
    return { name: packageJson.name, version: packageJson.version, targets: expectedTargets };
  } finally {
    await fs.rm(extractionRoot, { recursive: true, force: true });
  }
}

function validatePackageManifest(manifest, expectedTag) {
  if (manifest.name !== "@patodo/localapp") throw new Error(`package name must be @patodo/localapp, received ${String(manifest.name)}`);
  if (typeof manifest.version !== "string" || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(manifest.version)) {
    throw new Error("package version must be a valid release version");
  }
  if (expectedTag !== `v${manifest.version}`) throw new Error(`release tag ${expectedTag} does not match package version ${manifest.version}`);
  if (!sameObject(manifest.bin, { localapp: "bin/localapp.mjs" })) throw new Error("package binary must contain only localapp");
  if (manifest.dependencies !== undefined || manifest.devDependencies !== undefined || JSON.stringify(manifest).includes("workspace:")) {
    throw new Error("published package must not contain dependencies or workspace references");
  }
  const lifecycleNames = ["preinstall", "install", "postinstall", "prepublish", "prepublishOnly", "publish", "postpublish"];
  if (manifest.scripts && lifecycleNames.some((name) => Object.hasOwn(manifest.scripts, name))) {
    throw new Error("published package must not contain lifecycle scripts");
  }
  if (!sameObject(manifest.repository, { type: "git", url: "git+https://github.com/Patodo/LocalApp.git" })
    || manifest.homepage !== "https://github.com/Patodo/LocalApp#readme"
    || !sameObject(manifest.bugs, { url: "https://github.com/Patodo/LocalApp/issues" })) {
    throw new Error("published package metadata is incomplete");
  }
}

async function listArchive(tarball) {
  const listing = await run("tar", ["-tzf", tarball]);
  const entries = listing.stdout.split(/\r?\n/).filter(Boolean);
  for (const entry of entries) {
    if (!isSafeArchivePath(entry)) throw new Error(`unsafe archive path: ${entry}`);
  }
  if (listing.code !== 0) throw new Error(`could not list release tarball: ${listing.stderr.trim()}`);
  const verbose = await run("tar", ["-tvzf", tarball]);
  if (verbose.code !== 0) throw new Error(`could not inspect release tarball: ${verbose.stderr.trim()}`);
  for (const line of verbose.stdout.split(/\r?\n/).filter(Boolean)) {
    if (line[0] !== "-" && line[0] !== "d") throw new Error("release tarball contains a link or unsupported entry");
  }
  return entries;
}

function isSafeArchivePath(entry) {
  if (typeof entry !== "string" || entry.includes("\\") || entry.includes("\0") || entry.startsWith("/")) return false;
  const withoutTrailingSlash = entry.endsWith("/") ? entry.slice(0, -1) : entry;
  if (withoutTrailingSlash !== "package" && !withoutTrailingSlash.startsWith("package/")) return false;
  return withoutTrailingSlash.split("/").every((part) => part !== "" && part !== "." && part !== "..");
}

async function assertSafeTree(root) {
  const rootStat = await fs.lstat(root).catch(() => null);
  if (!rootStat?.isDirectory() || rootStat.isSymbolicLink()) throw new Error("release tarball must contain one package directory");
  const visit = async (directory) => {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      const stat = await fs.lstat(absolute);
      if (stat.isSymbolicLink()) throw new Error("release tarball contains a symbolic link");
      if (stat.isDirectory()) await visit(absolute);
      else if (!stat.isFile()) throw new Error("release tarball contains an unsupported entry");
    }
  };
  await visit(root);
}

async function requireRegularFile(root, relative) {
  const stat = await fs.lstat(path.join(root, relative)).catch(() => null);
  if (!stat?.isFile() || stat.isSymbolicLink()) throw new Error(`required package file is missing: ${relative}`);
}

async function readJson(filePath, label) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    throw new Error(`invalid ${label}: ${error.message}`);
  }
}

function sortedTargets(entries, label) {
  if (!Array.isArray(entries) || entries.some((entry) => !entry || typeof entry.target !== "string")) {
    throw new Error(`${label} is invalid`);
  }
  return entries.map((entry) => entry.target).sort();
}

function assertExactTargets(actual, expected) {
  if (new Set(actual).size !== actual.length || actual.length !== expected.length || actual.some((target, index) => target !== expected[index])) {
    throw new Error(`native adapter matrix must be exactly: ${expected.join(", ")}`);
  }
}

function sameObject(actual, expected) {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

async function defaultNpmDryRun(tarball) {
  const result = await run("npm", npmPublishDryRunArgs(tarball));
  if (result.code !== 0) throw new Error(`npm publish dry-run failed: ${result.stderr.trim() || result.stdout.trim()}`);
}

export function npmPublishDryRunArgs(tarball) {
  return ["publish", "--dry-run", "--access", "public", tarball];
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: projectDirectory, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("exit", (code) => resolve({ code, stdout, stderr }));
  });
}

export function parseArguments(argv) {
  if (argv[0] === "--") argv = argv.slice(1);
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if ((flag !== "--tarball" && flag !== "--tag") || !value) throw new Error("usage: check-npm-release --tarball <package.tgz> --tag v<version>");
    values[flag.slice(2)] = value;
  }
  if (!values.tarball || !values.tag) throw new Error("usage: check-npm-release --tarball <package.tgz> --tag v<version>");
  return values;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? path.join(os.tmpdir(), "missing")).href) {
  try {
    const args = parseArguments(process.argv.slice(2));
    const result = await checkNpmRelease({ tarballPath: args.tarball, expectedTag: args.tag });
    process.stdout.write(`${JSON.stringify({ ok: true, ...result })}\n`);
  } catch (error) {
    process.stderr.write(`npm release check failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}
