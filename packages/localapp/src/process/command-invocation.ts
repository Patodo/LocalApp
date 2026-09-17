import path from "node:path";

export interface ResolvedCommandInvocation {
  command: string;
  args: string[];
}

export interface ResolveCommandInvocationOptions {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  commandInterpreter?: string;
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
