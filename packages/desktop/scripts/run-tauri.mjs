import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { buildLocalRuntime } from "./build-local-runtime.mjs";
import { prepareNodeRuntime } from "./prepare-node-runtime.mjs";

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const DESKTOP_DIRECTORY = path.resolve(SCRIPT_DIRECTORY, "..");
const PREPARED_COMMANDS = new Set(["build", "bundle", "dev"]);
const GLOBAL_OPTIONS_WITH_VALUE = new Set(["--color", "--config"]);

export async function runTauri({
  arguments_ = [],
  prepareRuntime = async (options) => {
    await Promise.all([prepareNodeRuntime(options), buildLocalRuntime()]);
  },
  launchTauri = launchLocalTauri,
} = {}) {
  if (PREPARED_COMMANDS.has(tauriCommand(arguments_))) {
    const targetTriple = optionValue(arguments_, ["--target", "-t"]);
    await prepareRuntime(targetTriple ? { target: runtimeTarget(targetTriple) } : {});
  }
  return launchTauri(arguments_);
}

function tauriCommand(arguments_) {
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (GLOBAL_OPTIONS_WITH_VALUE.has(argument)) {
      index += 1;
    } else if (!argument.startsWith("-")) {
      return argument;
    }
  }
  return undefined;
}

function optionValue(arguments_, options) {
  for (const option of options) {
    const assignment = arguments_.find((argument) => argument.startsWith(`${option}=`));
    if (assignment) return assignment.slice(option.length + 1);
    const index = arguments_.indexOf(option);
    if (index >= 0) return arguments_[index + 1];
  }
  return undefined;
}

function runtimeTarget(targetTriple) {
  const targets = {
    "x86_64-pc-windows-msvc": "win-x64",
    "aarch64-apple-darwin": "darwin-arm64",
    "x86_64-apple-darwin": "darwin-x64",
  };
  const target = targets[targetTriple];
  if (!target) throw new Error(`Unsupported Node runtime target triple: ${targetTriple}`);
  return target;
}

function launchLocalTauri(arguments_) {
  const cliPath = path.join(
    DESKTOP_DIRECTORY,
    "node_modules",
    "@tauri-apps",
    "cli",
    "tauri.js",
  );
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, ...arguments_], { stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`Tauri terminated by signal ${signal}`));
      } else {
        resolve(code ?? 1);
      }
    });
  });
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  runTauri({ arguments_: process.argv.slice(2) })
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : "Tauri packaging failed");
      process.exitCode = 1;
    });
}
