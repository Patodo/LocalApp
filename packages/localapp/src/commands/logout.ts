import type { CliIo } from "../cli/output.js";
import { ProfileStore } from "../config/profile-store.js";
import { writeCommandError } from "./shared.js";

export async function logout(command: { profile?: string }, io: CliIo): Promise<number> {
  try {
    await new ProfileStore().remove(command.profile);
  } catch {
    writeCommandError(io, "profile_not_found", "Server profile was not found");
    return 1;
  }
  io.stdout(`${JSON.stringify({ success: true, profile: command.profile ?? null })}\n`);
  return 0;
}
