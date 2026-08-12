import type { CliIo } from "../cli/output.js";
import { writeStructuredError } from "../cli/output.js";

export function writeCommandError(io: CliIo, code: string, message: string): void {
  writeStructuredError(io, { code, message });
}
