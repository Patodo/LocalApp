import { LocalAppArgumentError, parseLocalAppArgs } from "./cli/args.js";
import { defaultCliIo, type CliIo, writeStructuredError } from "./cli/output.js";
import { login } from "./commands/login.js";
import { logout } from "./commands/logout.js";
import { whoami } from "./commands/whoami.js";
import { loadPackageVersion } from "./version.js";
import { fileURLToPath } from "node:url";

export async function runLocalApp(argv: string[], io: CliIo = defaultCliIo()): Promise<number> {
  try {
    const command = parseLocalAppArgs(argv);
    if (command.kind === "version") {
      io.stdout(`localapp ${await loadPackageVersion()}\n`);
    } else if (command.kind === "help") {
      io.stdout("Usage: localapp <command>\n");
    } else if (command.kind === "login") {
      return login(command, io);
    } else if (command.kind === "logout") {
      return logout(command, io);
    } else if (command.kind === "whoami") {
      return whoami(command, io);
    }
    return 0;
  } catch (error) {
    if (error instanceof LocalAppArgumentError) {
      writeStructuredError(io, {
        code: error.code,
        message: error.message,
        ...(error.option === undefined ? {} : { option: error.option }),
      });
      return 1;
    }
    writeStructuredError(io, { code: "command_failed", message: "LocalApp command failed" });
    return 1;
  }
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  runLocalApp(process.argv.slice(2)).then((code) => { process.exitCode = code; });
}
