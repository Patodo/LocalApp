import type { CliIo } from "../cli/output.js";
import { writeStructuredError } from "../cli/output.js";

export function writeCommandError(io: CliIo, code: string, message: string): void {
  writeStructuredError(io, { code, message });
}

export function writeCredentialSafeJson(io: CliIo, value: unknown, credential: string): void {
  io.stdout(`${JSON.stringify(sanitizeCredential(value, credential, redactionMarker(credential)))}\n`);
}

function redactionMarker(credential: string): string {
  if (!"[REDACTED]".includes(credential)) return "[REDACTED]";
  return credential === "\uE000" ? "\uE001" : "\uE000";
}

function sanitizeCredential(value: unknown, credential: string, marker: string): unknown {
  if (credential.length === 0) return value;
  if (typeof value === "string") return value.replaceAll(credential, marker);
  if (Array.isArray(value)) return value.map((item) => sanitizeCredential(item, credential, marker));
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(Object.entries(value).map(([key, nested]) => [
    key.replaceAll(credential, marker),
    sanitizeCredential(nested, credential, marker),
  ]));
}
