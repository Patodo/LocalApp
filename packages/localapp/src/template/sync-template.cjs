const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { buildSyncInvocation } = require("./sync-template-command.cjs");

let executable;
try {
  executable = resolveLocalApp();
} catch {
  process.stderr.write("LocalApp managed template sync could not be started.\n");
  process.exitCode = 1;
}

if (executable === undefined && process.exitCode !== 1) {
  process.stderr.write("Warning: localapp executable was not found; managed template sync was skipped.\n");
  process.exitCode = 0;
} else if (executable !== undefined) {
  try {
    const invocation = buildSyncInvocation(executable);
    const child = spawn(invocation.command, invocation.args, {
      ...invocation.spawnOptions,
      stdio: "inherit",
    });
    let spawnFailed = false;

    child.once("error", (error) => {
      spawnFailed = true;
      if (error && error.code === "ENOENT" && !fs.existsSync(executable)) {
        process.stderr.write("Warning: localapp executable was not found; managed template sync was skipped.\n");
        process.exitCode = 0;
        return;
      }
      process.stderr.write("LocalApp managed template sync could not be started.\n");
      process.exitCode = 1;
    });

    child.once("exit", (code, signal) => {
      if (spawnFailed) return;
      process.exitCode = signal === null && code !== null ? code : 1;
    });
  } catch {
    process.stderr.write("LocalApp managed template sync could not be started.\n");
    process.exitCode = 1;
  }
}

function resolveLocalApp() {
  const searchPath = process.env.PATH ?? process.env.Path ?? "";
  const names = process.platform === "win32"
    ? (process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean).map((extension) => `localapp${extension.toLowerCase()}`)
    : ["localapp"];
  for (const directory of searchPath.split(path.delimiter).filter(Boolean)) {
    for (const name of names) {
      const candidate = path.join(stripQuotes(directory), name);
      try {
        const stat = fs.statSync(candidate);
        if (!stat.isFile()) continue;
        if (process.platform !== "win32") fs.accessSync(candidate, fs.constants.X_OK);
        return candidate;
      } catch (error) {
        if (error && (error.code === "ENOENT" || error.code === "ENOTDIR")) continue;
        throw error;
      }
    }
  }
  return undefined;
}

function stripQuotes(value) {
  return value.length >= 2 && value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1) : value;
}
