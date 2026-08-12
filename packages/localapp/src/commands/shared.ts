import type { CliIo } from "../cli/output.js";
import { writeStructuredError } from "../cli/output.js";

export function writeCommandError(io: CliIo, code: string, message: string): void {
  writeStructuredError(io, { code, message });
}

export function writeCredentialSafeJson(io: CliIo, value: unknown, credential: string): void {
  io.stdout(`${JSON.stringify(sanitizeCredential(value, credential))}\n`);
}

function sanitizeCredential(value: unknown, credential: string): unknown {
  if (credential.length === 0) return value;
  if (typeof value === "string") return value.replaceAll(credential, "[REDACTED]");
  if (Array.isArray(value)) return value.map((item) => sanitizeCredential(item, credential));
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(Object.entries(value).map(([key, nested]) => [
    key.replaceAll(credential, "[REDACTED]"),
    sanitizeCredential(nested, credential),
  ]));
}
