import type { CliIo } from "../cli/output.js";
import { writeStructuredError } from "../cli/output.js";

export function writeCommandError(io: CliIo, code: string, message: string): void {
  writeStructuredError(io, { code, message });
}

export function writeCredentialSafeJson(io: CliIo, value: unknown, credential: string): void {
  io.stdout(`${JSON.stringify(sanitizeCredential(value, credential))}\n`);
}

export function sanitizeCredential(value: unknown, credential: string): unknown {
  return sanitizeCredentialWithMarker(value, credential, redactionMarker(credential));
}

function redactionMarker(credential: string): string {
  if (!"[REDACTED]".includes(credential)) return "[REDACTED]";
  return credential === "\uE000" ? "\uE001" : "\uE000";
}

function sanitizeCredentialWithMarker(value: unknown, credential: string, marker: string): unknown {
  if (credential.length === 0) return value;
  if (typeof value === "string") return redactString(value, credential, marker);
  if (Array.isArray(value)) return value.map((item) => sanitizeCredentialWithMarker(item, credential, marker));
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(Object.entries(value).map(([key, nested]) => [
    redactString(key, credential, marker),
    sanitizeCredentialWithMarker(nested, credential, marker),
  ]));
}

function redactString(value: string, credential: string, marker: string): string {
  return value.replaceAll(credential, marker).replace(escapedCredentialPattern(credential), marker);
}

function escapedCredentialPattern(credential: string): RegExp {
  const encoded = Array.from({ length: credential.length }, (_, index) => {
    const character = credential[index];
    const literal = character.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
    const unicode = `\\\\u${unicodeHexPattern(credential.charCodeAt(index).toString(16).padStart(4, "0"))}`;
    return `(?:${literal}|${unicode})`;
  }).join("");
  return new RegExp(encoded, "g");
}

function unicodeHexPattern(value: string): string {
  return Array.from(value).map((character) => /[a-f]/.test(character)
    ? `[${character}${character.toUpperCase()}]`
    : character).join("");
}
