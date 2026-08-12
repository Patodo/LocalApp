import { chmod, chown, mkdir, mkdtemp, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ProfileStore } from "../src/config/profile-store.js";

const createdDirectories: string[] = [];

async function createConfigDirectory(): Promise<string> {
  const testRoot = path.resolve(process.cwd(), "../../tmp/localapp-task-2-tests");
  await mkdir(testRoot, { recursive: true });
  const directory = await mkdtemp(path.join(testRoot, "profile-store-"));
  createdDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(createdDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("ProfileStore", () => {
  it("writes profiles atomically with user-only POSIX permissions", async () => {
    // Break caught: publishing directly or with default permissions exposes credentials.
    const configDir = await createConfigDirectory();
    const store = new ProfileStore(configDir);

    await store.upsert({ name: "office", serverUrl: "https://office.example/", apiKey: "secret" });

    const profilePath = path.join(configDir, "profiles.json");
    if (process.platform !== "win32") {
      expect((await stat(profilePath)).mode & 0o777).toBe(0o600);
    }
    await expect(store.resolve("office")).resolves.toEqual({
      name: "office",
      serverUrl: "https://office.example",
      apiKey: "secret",
    });
    await expect(ProfileStore.load(configDir)).resolves.toEqual({
      version: 1,
      currentProfile: "office",
      profiles: {
        office: { name: "office", serverUrl: "https://office.example", apiKey: "secret" },
      },
    });
    expect(await readdir(configDir)).toEqual(["profiles.json"]);
  });

  it("rejects credential-bearing and fragment-bearing server URLs", async () => {
    // Break caught: accepting a URL whose credentials or fragment could be persisted or sent.
    const store = new ProfileStore(await createConfigDirectory());

    await expect(store.upsert({ name: "office", serverUrl: "https://name:password@office.example", apiKey: "secret" }))
      .rejects.toThrow("Server URL must be an HTTP or HTTPS origin");
    await expect(store.upsert({ name: "office", serverUrl: "https://office.example/#fragment", apiKey: "secret" }))
      .rejects.toThrow("Server URL must be an HTTP or HTTPS origin");
  });

  it.runIf(process.platform !== "win32")("rejects an existing profile document that is not mode 0600", async () => {
    // Break caught: reading a group/world-readable document exposes persisted credentials.
    const configDir = await createConfigDirectory();
    const store = new ProfileStore(configDir);
    await store.upsert({ name: "office", serverUrl: "https://office.example", apiKey: "secret" });
    await chmod(path.join(configDir, "profiles.json"), 0o644);

    await expect(store.load()).rejects.toThrow("Profile document permissions are unsafe");
  });

  it.runIf(process.platform !== "win32")("rejects a symlinked existing profile document", async () => {
    // Break caught: following a symlink reads credentials from an attacker-selected path.
    const configDir = await createConfigDirectory();
    const profilePath = path.join(configDir, "profiles.json");
    const targetPath = path.join(configDir, "profile-target.json");
    await writeFile(targetPath, '{"version":1,"currentProfile":null,"profiles":{}}\n', { mode: 0o600 });
    await symlink("profile-target.json", profilePath);

    await expect(new ProfileStore(configDir).load()).rejects.toThrow("Profile document path is unsafe");
  });

  it.runIf(process.platform !== "win32" && process.getuid?.() === 0)("rejects an existing profile document owned by another UID", async () => {
    // Break caught: accepting another user's credential file crosses the local-user trust boundary.
    const configDir = await createConfigDirectory();
    const store = new ProfileStore(configDir);
    const profilePath = path.join(configDir, "profiles.json");
    await store.upsert({ name: "office", serverUrl: "https://office.example", apiKey: "secret" });
    await chown(profilePath, 1, -1);

    await expect(store.load()).rejects.toThrow("Profile document ownership is unsafe");
  });
});
