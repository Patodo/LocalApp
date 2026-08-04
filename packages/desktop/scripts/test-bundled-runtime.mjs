import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const targetOption = process.argv.indexOf("--target");
const target = targetOption >= 0 ? process.argv[targetOption + 1] : undefined;
if (targetOption >= 0 && !target) throw new Error("--target requires a Rust target triple");
const releaseDirectory = path.join(
  packageRoot,
  "src-tauri",
  "target",
  ...(target ? [target] : []),
  "release",
);
const nodeName = process.platform === "win32" || target?.includes("windows") ? "node.exe" : "node";
if (!existsSync(path.join(releaseDirectory, nodeName))) {
  throw new Error(`Tauri release runtime is missing: ${releaseDirectory}`);
}

const arguments_ = [
  "test",
  "--manifest-path",
  path.join(packageRoot, "src-tauri", "Cargo.toml"),
  "--test",
  "bundled_runtime_e2e",
];
if (target) arguments_.push("--target", target);
arguments_.push("--", "--ignored", "--nocapture");
const result = spawnSync("cargo", arguments_, {
  cwd: packageRoot,
  env: { ...process.env, LOCALAPP_BUNDLED_RESOURCE_DIR: releaseDirectory },
  stdio: "inherit",
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
