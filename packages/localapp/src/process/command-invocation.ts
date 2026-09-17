import fs from "node:fs";
import path from "node:path";

export interface ResolvedCommandInvocation {
  command: string;
  args: string[];
}

export interface ResolveCommandInvocationOptions {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  commandInterpreter?: string;
  /** Path-existence seam so the resolution rules stay testable off-Windows. */
  isFile?: (candidate: string) => boolean;
}

/**
 * Turns a logical command into something this platform can actually spawn.
 *
 * Node refuses to spawn a `.cmd`/`.bat` shim without a shell since the
 * CVE-2024-27980 fix, so `spawn("npm", …)` fails with ENOENT on Windows even
 * though `npm.cmd` is on PATH. Routing a bare name through the command
 * interpreter fixes that: the interpreter itself is absolute, and it resolves
 * the shim through PATHEXT.
 *
 * Only bare names are rewritten; a caller that already holds a path keeps it.
 * The arguments here are fixed internal values, never user input.
 */
export function resolveCommandInvocation(
  command: string,
  args: readonly string[],
  options: ResolveCommandInvocationOptions = {},
): ResolvedCommandInvocation {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  if (platform !== "win32" || !isBareCommandName(command)) return { command, args: [...args] };
  const interpreter = options.commandInterpreter ?? env.ComSpec ?? env.COMSPEC ?? defaultCommandInterpreter(env);
  return { command: interpreter, args: ["/d", "/s", "/c", command, ...args] };
}

function isBareCommandName(command: string): boolean {
  if (command.includes("/") || command.includes("\\") || command.includes("\0")) return false;
  // A name with an extension (npm.cmd, node.exe) is still bare: cmd resolves it
  // through PATHEXT exactly like the extensionless form.
  return command.length > 0;
}

function defaultCommandInterpreter(env: NodeJS.ProcessEnv): string {
  const systemRoot = env.SystemRoot ?? env.SYSTEMROOT ?? "C:\\Windows";
  return path.win32.join(systemRoot, "System32", "cmd.exe");
}

/**
 * Resolves a bare command name to the absolute file PATH would run, following
 * PATHEXT on Windows. Returns undefined for a path (already resolved) or when
 * nothing matches.
 */
export function resolveExecutablePath(command: string, options: ResolveCommandInvocationOptions = {}): string | undefined {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  if (!isBareCommandName(command)) return undefined;
  const pathApi = platform === "win32" ? path.win32 : path.posix;
  const searchPath = env.PATH ?? env.Path ?? env.path ?? "";
  // Windows resolves a bare name through PATHEXT, so an extensionless file of
  // the same name (npm ships one: the POSIX shell script) must not win.
  const extensions = platform === "win32"
    ? (env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean).map((entry) => entry.toLowerCase())
    : [""];
  const names = platform === "win32"
    ? (pathApi.extname(command) === "" ? extensions.map((extension) => `${command}${extension}`) : [command])
    : [command];
  const isFile = options.isFile ?? ((candidate: string) => {
    try {
      return fs.statSync(candidate).isFile();
    } catch {
      // A missing or unreadable candidate is not a match.
      return false;
    }
  });
  for (const directory of searchPath.split(pathApi.delimiter)) {
    const trimmed = directory.trim();
    if (trimmed === "") continue;
    const unquoted = trimmed.length >= 2 && trimmed.startsWith("\"") && trimmed.endsWith("\"") ? trimmed.slice(1, -1) : trimmed;
    for (const name of names) {
      const candidate = pathApi.join(unquoted, name);
      if (isFile(candidate)) return candidate;
    }
  }
  return undefined;
}

/**
 * The command to hand the owned-process wrapper, which validates an absolute
 * executable path and delegates a `.cmd`/`.bat` target to the command
 * interpreter itself. Falls back to the original name so the wrapper reports a
 * missing executable rather than this helper silently doing nothing.
 */
export function resolveOwnedCommand(command: string, options: ResolveCommandInvocationOptions = {}): string {
  const platform = options.platform ?? process.platform;
  if (platform !== "win32") return command;
  return resolveExecutablePath(command, options) ?? command;
}
