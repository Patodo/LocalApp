import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cliDir = path.join(repoRoot, "packages", "cli");
const serverCliDir = path.join(repoRoot, "packages", "server", "static", "cli");
const cargoTomlPath = path.join(cliDir, "Cargo.toml");
const versionsPath = path.join(serverCliDir, "versions.json");

function readCargoVersion() {
  const cargoToml = fs.readFileSync(cargoTomlPath, "utf8");
  const match = cargoToml.match(/^version\s*=\s*"([^"]+)"/m);
  if (!match) {
    throw new Error("Unable to read CLI version from packages/cli/Cargo.toml");
  }
  return match[1];
}

function currentTarget() {
  const platform = os.platform();
  const arch = os.arch();

  if (platform === "win32" && arch === "x64") {
    return {
      os: "windows",
      arch: "x86_64",
      triple: "x86_64-pc-windows-msvc",
      sourceName: "localapp.exe",
      fileName: "localapp-cli-x86_64-pc-windows-msvc.exe",
    };
  }

  if (platform === "linux" && arch === "x64") {
    return {
      os: "linux",
      arch: "x86_64",
      triple: "x86_64-unknown-linux-gnu",
      sourceName: "localapp",
      fileName: "localapp-cli-x86_64-unknown-linux-gnu",
    };
  }

  if (platform === "darwin" && arch === "arm64") {
    return {
      os: "macos",
      arch: "aarch64",
      triple: "aarch64-apple-darwin",
      sourceName: "localapp",
      fileName: "localapp-cli-aarch64-apple-darwin",
    };
  }

  if (platform === "darwin" && arch === "x64") {
    return {
      os: "macos",
      arch: "x86_64",
      triple: "x86_64-apple-darwin",
      sourceName: "localapp",
      fileName: "localapp-cli-x86_64-apple-darwin",
    };
  }

  throw new Error(`Unsupported CLI release platform: ${platform}/${arch}`);
}

function readVersions() {
  if (!fs.existsSync(versionsPath)) {
    return { min: null, latest: null, versions: {} };
  }
  return JSON.parse(fs.readFileSync(versionsPath, "utf8"));
}

function writeVersions(version, target) {
  const versions = readVersions();
  versions.min = versions.min || version;
  versions.latest = version;
  versions.versions = versions.versions || {};

  const existing = versions.versions[version] || {};
  const platforms = existing.platforms || {};
  platforms[`${target.os}/${target.arch}`] = target.fileName;

  versions.versions[version] = {
    ...existing,
    released: existing.released || new Date().toISOString().slice(0, 10),
    platforms,
  };

  fs.mkdirSync(serverCliDir, { recursive: true });
  fs.writeFileSync(versionsPath, `${JSON.stringify(versions, null, 2)}\n`);
}

function run(command, args, options = {}) {
  execFileSync(command, args, {
    stdio: "inherit",
    ...options,
  });
}

const target = currentTarget();
const buildOnly = process.argv.includes("--build-only");

run("cargo", ["build", "--release"], { cwd: cliDir });
const version = readCargoVersion();

const sourcePath = path.join(cliDir, "target", "release", target.sourceName);

if (os.platform() === "darwin" && fs.existsSync(sourcePath)) {
  run("codesign", ["-s", "-", sourcePath]);
}

if (buildOnly) {
  console.log(`Built CLI ${version} at ${sourcePath}`);
  process.exit(0);
}

if (!fs.existsSync(sourcePath)) {
  throw new Error(`Built CLI binary not found: ${sourcePath}`);
}

const versionDir = path.join(serverCliDir, version);
const destinationPath = path.join(versionDir, target.fileName);

fs.mkdirSync(versionDir, { recursive: true });
fs.copyFileSync(sourcePath, destinationPath);
if (os.platform() !== "win32") {
  fs.chmodSync(destinationPath, 0o755);
}
writeVersions(version, target);

console.log(`Released CLI ${version} (${target.triple}) to ${destinationPath}`);
console.log(`Updated ${versionsPath}`);
