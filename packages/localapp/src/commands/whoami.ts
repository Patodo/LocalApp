import type { CliIo } from "../cli/output.js";
import { ProfileStore } from "../config/profile-store.js";
import { LocalAppClient } from "../http/localapp-client.js";
import { writeCommandError } from "./shared.js";

export async function whoami(command: { profile?: string }, io: CliIo): Promise<number> {
  let profile;
  try {
    profile = await new ProfileStore().resolve(command.profile);
  } catch {
    writeCommandError(io, "profile_not_found", "Server profile was not found");
    return 1;
  }
  const result = await new LocalAppClient(profile).getJson("/api/me");
  if (!result.ok || !isAuthenticatedEnvelope(result.body)) {
    writeCommandError(io, "whoami_failed", "Could not authenticate with the LocalApp Server");
    return 1;
  }
  io.stdout(`${JSON.stringify(withoutApiKeys(result.body))}\n`);
  return 0;
}

function isAuthenticatedEnvelope(body: unknown): body is { success: true; data: Record<string, unknown> } {
  return typeof body === "object" && body !== null && "success" in body && body.success === true && "data" in body && typeof body.data === "object" && body.data !== null;
}

function withoutApiKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutApiKeys);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => key.replaceAll("_", "").replaceAll("-", "").toLowerCase() !== "apikey")
    .map(([key, nested]) => [key, withoutApiKeys(nested)]));
}
