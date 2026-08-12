import fs from "node:fs/promises";
import path from "node:path";
import { ProfileStore, type ServerProfile } from "../config/profile-store.js";
import { lifecycleError } from "../errors.js";
import { readVerifiedFile } from "./files.js";
import { unsafePath } from "./safety.js";

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
  const localAppDirectory = path.join(projectDir, ".localapp");
  const publishPath = path.join(localAppDirectory, "publish.json");
  const directory = await lstatOrAbsent(localAppDirectory);
  if (directory === undefined) return undefined;
  if (directory.isSymbolicLink() || !directory.isDirectory()) throw unsafePath();
  const publish = await lstatOrAbsent(publishPath);
  if (publish === undefined) return undefined;
  if (publish.isSymbolicLink() || !publish.isFile()) throw unsafePath();
  let content: Buffer;
  try {
    content = await readVerifiedFile(projectDir, publishPath, ".localapp/publish.json");
  } catch {
    throw lifecycleError("publish_config_unreadable", "Cannot safely read .localapp/publish.json");
  }
  let value: unknown;
  try { value = JSON.parse(content.toString("utf8")); } catch { throw invalidPublishConfig(); }
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw invalidPublishConfig();
  const profile = (value as Record<string, unknown>).defaultProfile;
  if (typeof profile !== "string" || !isProfileName(profile)) throw invalidPublishConfig();
  return profile;
}

async function lstatOrAbsent(target: string): Promise<Awaited<ReturnType<typeof fs.lstat>> | undefined> {
  try {
    return await fs.lstat(target);
  } catch (error: unknown) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return undefined;
    throw lifecycleError("publish_config_unreadable", "Cannot safely read .localapp/publish.json");
  }
}

function isProfileName(value: string): boolean {
  return /^[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(value) && !value.includes("--");
}

function invalidPublishConfig() {
  return lifecycleError("invalid_publish_config", ".localapp/publish.json must contain a valid non-empty defaultProfile");
}
