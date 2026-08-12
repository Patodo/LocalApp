import type { CliIo } from "../cli/output.js";
import { writeStructuredError } from "../cli/output.js";

export function writeCommandError(io: CliIo, code: string, message: string): void {
  writeStructuredError(io, { code, message });
}

export function writeCredentialSafeJson(io: CliIo, value: unknown, credential: string): void {
  const serialized = JSON.stringify(value);
  io.stdout(`${credential.length === 0 ? serialized : serialized.replaceAll(credential, "[REDACTED]")}\n`);
}
