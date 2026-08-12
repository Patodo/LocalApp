import fs from "node:fs/promises";
import type { BigIntStats } from "node:fs";
import path from "node:path";
import { ProfileStore, type ServerProfile } from "../config/profile-store.js";
import { lifecycleError } from "../errors.js";
import { readVerifiedFile } from "./files.js";
import { unsafePath } from "./safety.js";

export interface ResolveProjectTargetOptions {
  projectDir: string;
  target?: string;
  profileStore?: Pick<ProfileStore, "resolve">;
  readHooks?: ProjectTargetReadHooks;
}

export interface ProjectTargetReadHooks {
  afterLocalAppValidated?(directory: string): Promise<void>;
}

export async function resolveProjectTarget(options: ResolveProjectTargetOptions): Promise<ServerProfile> {
  const defaultProfile = await readDefaultProfile(options.projectDir, options.readHooks);
  const store = options.profileStore ?? new ProfileStore();
  return store.resolve(options.target ?? defaultProfile);
}

interface DirectoryIdentity {
  path: string;
  device: bigint;
  inode: bigint;
}

async function readDefaultProfile(projectDir: string, hooks?: ProjectTargetReadHooks): Promise<string | undefined> {
  const root = await captureDirectory(path.resolve(projectDir));
  if (root === undefined) throw unsafePath();
  const localAppDirectory = path.join(root.path, ".localapp");
  const publishPath = path.join(localAppDirectory, "publish.json");
  const directory = await captureDirectory(localAppDirectory);
  if (directory === undefined) {
    await verifyDirectory(root);
    return undefined;
  }
  await hooks?.afterLocalAppValidated?.(localAppDirectory);
  const publish = await lstatOrAbsent(publishPath);
  if (publish === undefined) {
    await verifyDirectory(root);
    await verifyDirectory(directory);
    return undefined;
  }
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

async function captureDirectory(target: string): Promise<DirectoryIdentity | undefined> {
  let stat: BigIntStats;
  try {
    stat = await fs.lstat(target, { bigint: true });
  } catch (error: unknown) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return undefined;
    throw lifecycleError("publish_config_unreadable", "Cannot safely read .localapp/publish.json");
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw unsafePath();
  return { path: target, device: stat.dev, inode: stat.ino };
}

async function verifyDirectory(expected: DirectoryIdentity): Promise<void> {
  const stat = await fs.lstat(expected.path, { bigint: true }).catch(() => undefined);
  if (stat === undefined || stat.isSymbolicLink() || !stat.isDirectory() || stat.dev !== expected.device || stat.ino !== expected.inode) {
    throw unsafePath();
  }
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
