import { LocalAppArgumentError, parseLocalAppArgs } from "./cli/args.js";
import { defaultCliIo, type CliIo, writeStructuredError } from "./cli/output.js";
import { fileURLToPath } from "node:url";

const VERSION = "0.1.0";

export async function runLocalApp(argv: string[], io: CliIo = defaultCliIo()): Promise<number> {
  try {
    const command = parseLocalAppArgs(argv);
    if (command.kind === "version") {
      io.stdout(`localapp ${VERSION}\n`);
    } else if (command.kind === "help") {
      io.stdout("Usage: localapp <command>\n");
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
    throw error;
  }
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  runLocalApp(process.argv.slice(2)).then((code) => { process.exitCode = code; });
}
