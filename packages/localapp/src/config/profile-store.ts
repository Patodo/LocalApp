import { chmod, lstat, mkdir, open, rename, rm } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { localAppConfigDirectory, profilesPath } from "./paths.js";

export interface ServerProfile {
  name: string;
  serverUrl: string;
  apiKey: string;
}

export interface ProfileDocument {
  version: 1;
  currentProfile: string | null;
  profiles: Record<string, ServerProfile>;
}

const EMPTY_DOCUMENT: ProfileDocument = { version: 1, currentProfile: null, profiles: {} };

export function normalizeServerUrl(value: string): string {
  try {
    const url = new URL(value.trim());
    if (
      (url.protocol !== "http:" && url.protocol !== "https:")
      || url.hostname.length === 0
      || url.username.length > 0
      || url.password.length > 0
      || url.hash.length > 0
      || url.search.length > 0
      || url.pathname !== "/"
    ) {
      throw new Error("invalid server URL");
    }
    return url.origin;
  } catch {
    throw new Error("Server URL must be an HTTP or HTTPS origin");
  }
}

export class ProfileStore {
  readonly configDir: string;

  constructor(configDir = localAppConfigDirectory()) {
    this.configDir = configDir;
  }

  static async load(configDir?: string): Promise<ProfileDocument> {
    return new ProfileStore(configDir).load();
  }

  async load(): Promise<ProfileDocument> {
    try {
      return parseProfileDocument(await readProfileDocument(this.path()));
    } catch (error: unknown) {
      if (isNotFound(error)) return structuredClone(EMPTY_DOCUMENT);
      if (error instanceof SyntaxError) throw new Error("Profile document is invalid");
      if (isUnsafeSymlinkOpen(error)) throw new Error("Profile document path is unsafe");
      throw error;
    }
  }

  async save(document: ProfileDocument): Promise<void> {
    const normalized = validateDocument(document);
    await atomicWrite(this.path(), `${JSON.stringify(normalized, null, 2)}\n`);
  }

  async upsert(profile: ServerProfile): Promise<ProfileDocument> {
    const current = await this.load();
    const normalized = normalizeProfile(profile);
    const document: ProfileDocument = {
      version: 1,
      currentProfile: normalized.name,
      profiles: { ...current.profiles, [normalized.name]: normalized },
    };
    await this.save(document);
    return document;
  }

  async resolve(name?: string): Promise<ServerProfile> {
    const document = await this.load();
    const selected = name ?? document.currentProfile;
    if (selected === null || selected === undefined || document.profiles[selected] === undefined) {
      throw new Error("Server profile was not found");
    }
    return { ...document.profiles[selected] };
  }

  async remove(name?: string): Promise<ProfileDocument> {
    const document = await this.load();
    const selected = name ?? document.currentProfile;
    if (selected === null || selected === undefined || document.profiles[selected] === undefined) {
      throw new Error("Server profile was not found");
    }
    const { [selected]: _removed, ...profiles } = document.profiles;
    const next: ProfileDocument = {
      version: 1,
      currentProfile: document.currentProfile === selected ? null : document.currentProfile,
      profiles,
    };
    await this.save(next);
    return next;
  }

  private path(): string {
    return profilesPath(this.configDir);
  }
}

function parseProfileDocument(content: string): ProfileDocument {
  try {
    return validateDocument(JSON.parse(content));
  } catch (error) {
    if (error instanceof SyntaxError) throw error;
    throw new Error("Profile document is invalid");
  }
}

function validateDocument(value: unknown): ProfileDocument {
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.profiles)) {
    throw new Error("Profile document is invalid");
  }
  if (value.currentProfile !== null && typeof value.currentProfile !== "string") {
    throw new Error("Profile document is invalid");
  }
  const profiles: Record<string, ServerProfile> = {};
  for (const [name, profile] of Object.entries(value.profiles)) {
    const normalized = normalizeProfile(profile);
    if (normalized.name !== name) throw new Error("Profile document is invalid");
    profiles[name] = normalized;
  }
  if (value.currentProfile !== null && profiles[value.currentProfile] === undefined) {
    throw new Error("Profile document is invalid");
  }
  return { version: 1, currentProfile: value.currentProfile, profiles };
}

function normalizeProfile(value: unknown): ServerProfile {
  if (!isRecord(value) || typeof value.name !== "string" || typeof value.serverUrl !== "string" || typeof value.apiKey !== "string") {
    throw new Error("Profile document is invalid");
  }
  if (!/^[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(value.name) || value.name.includes("--")) {
    throw new Error("Server profile name is invalid");
  }
  if (value.apiKey.trim().length === 0) throw new Error("Server profile API Key cannot be empty");
  return { name: value.name, serverUrl: normalizeServerUrl(value.serverUrl), apiKey: value.apiKey };
}

async function readProfileDocument(filePath: string): Promise<string> {
  const pathMetadata = await lstat(filePath);
  if (!pathMetadata.isFile() || pathMetadata.isSymbolicLink()) {
    throw new Error("Profile document path is unsafe");
  }
  const handle = await open(filePath, process.platform === "win32" ? "r" : constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const metadata = await handle.stat();
    if (!metadata.isFile()) throw new Error("Profile document path is unsafe");
    if (process.platform !== "win32") {
      if ((metadata.mode & 0o777) !== 0o600) throw new Error("Profile document permissions are unsafe");
      if (metadata.uid !== process.getuid?.()) throw new Error("Profile document ownership is unsafe");
    }
    return handle.readFile({ encoding: "utf8" });
  } finally {
    await handle.close();
  }
}

async function atomicWrite(destination: string, content: string): Promise<void> {
  const directory = path.dirname(destination);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = path.join(directory, `.${path.basename(destination)}.${process.pid}.${randomUUID()}.tmp`);
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(temporary, "wx", 0o600);
    await handle.writeFile(content, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporary, destination);
    if (process.platform !== "win32") {
      await chmod(destination, 0o600);
      const directoryHandle = await open(directory, "r");
      try {
        await directoryHandle.sync();
      } finally {
        await directoryHandle.close();
      }
    }
  } catch (error) {
    await handle?.close().catch(() => undefined);
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNotFound(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function isUnsafeSymlinkOpen(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ELOOP";
}
