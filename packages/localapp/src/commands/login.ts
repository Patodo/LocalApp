import type { CliIo } from "../cli/output.js";
import { normalizeServerUrl, ProfileStore } from "../config/profile-store.js";
import { LocalAppClient } from "../http/localapp-client.js";
import { writeCommandError } from "./shared.js";

export async function login(command: { serverUrl?: string; apiKey?: string; profile?: string }, io: CliIo): Promise<number> {
  if (command.serverUrl === undefined || command.apiKey === undefined) {
    writeCommandError(io, "login_input_required", "login requires a Server URL and --api-key");
    return 1;
  }
  let serverUrl: string;
  try {
    serverUrl = normalizeServerUrl(command.serverUrl);
  } catch {
    writeCommandError(io, "login_connection_failed", "Server URL must be an HTTP or HTTPS origin");
    return 1;
  }

  const result = await new LocalAppClient({ serverUrl, apiKey: command.apiKey }).getJson("/api/me", 10_000);
  if (!result.ok) {
    writeCommandError(io, result.status === 401 ? "login_invalid_api_key" : "login_connection_failed", result.status === 401 ? "API Key was rejected by the LocalApp Server" : "Could not validate the LocalApp Server");
    return 1;
  }
  const user = authenticatedUser(result.body);
  if (user === null) {
    writeCommandError(io, "login_invalid_api_key", "API Key was rejected by the LocalApp Server");
    return 1;
  }

  const profile = command.profile ?? "default";
  try {
    await new ProfileStore().upsert({ name: profile, serverUrl, apiKey: command.apiKey });
  } catch {
    writeCommandError(io, "profile_save_failed", "Could not save the authenticated profile");
    return 1;
  }
  io.stdout(`${JSON.stringify({ success: true, user, profile, serverUrl })}\n`);
  return 0;
}

function authenticatedUser(body: unknown): { id: string; name: string; role: string } | null {
  if (typeof body !== "object" || body === null || !("success" in body) || body.success !== true || !("data" in body)) return null;
  const data = body.data;
  if (typeof data !== "object" || data === null || !("id" in data) || !("name" in data) || !("role" in data)) return null;
  if (typeof data.id !== "string" || typeof data.name !== "string" || typeof data.role !== "string") return null;
  return { id: data.id, name: data.name, role: data.role };
}
