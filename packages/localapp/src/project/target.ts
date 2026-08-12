import fs from "node:fs/promises";
import path from "node:path";
import { ProfileStore, type ServerProfile } from "../config/profile-store.js";

export interface ResolveProjectTargetOptions {
  projectDir: string;
  target?: string;
  profileStore?: Pick<ProfileStore, "resolve">;
}

export async function resolveProjectTarget(options: ResolveProjectTargetOptions): Promise<ServerProfile> {
  const defaultProfile = await readDefaultProfile(options.projectDir);
  const store = options.profileStore ?? new ProfileStore();
  return store.resolve(options.target ?? defaultProfile);
}

async function readDefaultProfile(projectDir: string): Promise<string | undefined> {
  try {
    const value: unknown = JSON.parse(await fs.readFile(path.join(projectDir, ".localapp", "publish.json"), "utf8"));
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      const profile = (value as Record<string, unknown>).defaultProfile;
      return typeof profile === "string" && profile.length > 0 ? profile : undefined;
    }
  } catch (error: unknown) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return undefined;
  }
  return undefined;
}
