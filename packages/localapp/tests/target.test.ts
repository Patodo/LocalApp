import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ProfileStore } from "../src/config/profile-store.js";
import { resolveProjectTarget } from "../src/project/target.js";

const repositoryRoot = path.resolve(process.cwd(), "../..");
const testRoot = path.join(repositoryRoot, "tmp/task-5-target-tests");
const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe("project publish target resolution", () => {
  it("uses the current profile when publish.json is stably absent", async () => {
    // Break caught: rejecting a genuinely absent publish configuration prevents projects from using their current profile.
    const { projectDir, store } = await createProject();
    await fs.mkdir(path.join(projectDir, ".localapp"));

    await expect(resolveProjectTarget({ projectDir, profileStore: store })).resolves.toMatchObject({ name: "current" });
  });

  it("rejects .localapp replacement before a missing publish.json can fall back", async () => {
    // Break caught: an attacker can replace the validated .localapp directory with a different directory lacking publish.json and redirect deployment to the current profile.
    const { projectDir, store } = await createProject();
    const localApp = path.join(projectDir, ".localapp");
    await fs.mkdir(localApp);

    await expect(resolveProjectTarget({
      projectDir,
      profileStore: store,
      readHooks: {
        afterLocalAppValidated: async () => {
          await fs.rename(localApp, `${localApp}.original`);
          await fs.mkdir(localApp);
        },
      },
    })).rejects.toMatchObject({ code: "unsafe_project_path" });
  });

  it.each([
    ["malformed JSON", "{", "invalid_publish_config"],
    ["missing default profile", "{}", "invalid_publish_config"],
    ["invalid default profile", '{"defaultProfile":"Wrong"}', "invalid_publish_config"],
  ])("fails closed for $0", async (_label, contents, code) => {
    // Break caught: malformed or incomplete publish configuration falls through to the current profile and deploys to an unintended Server.
    const { projectDir, store } = await createProject();
    await fs.mkdir(path.join(projectDir, ".localapp"));
    await fs.writeFile(path.join(projectDir, ".localapp/publish.json"), contents);

    await expect(resolveProjectTarget({ projectDir, profileStore: store })).rejects.toMatchObject({ code });
  });

  it("rejects a symlinked publish configuration", async () => {
    // Break caught: following a symlink lets a project outside the trusted directory choose the deployment target.
    const { projectDir, store } = await createProject();
    const outside = path.join(projectDir, "outside.json");
    await fs.mkdir(path.join(projectDir, ".localapp"));
    await fs.writeFile(outside, '{"defaultProfile":"project"}');
    await fs.symlink(outside, path.join(projectDir, ".localapp/publish.json"));

    await expect(resolveProjectTarget({ projectDir, profileStore: store })).rejects.toMatchObject({ code: "unsafe_project_path" });
  });

  it.runIf(process.getuid?.() !== 0)("fails closed when publish.json is unreadable", async () => {
    // Break caught: treating permission denial as no project default deploys to the current profile without the user's chosen target.
    const { projectDir, store } = await createProject();
    const localApp = path.join(projectDir, ".localapp");
    const publish = path.join(localApp, "publish.json");
    await fs.mkdir(localApp);
    await fs.writeFile(publish, '{"defaultProfile":"project"}');
    await fs.chmod(publish, 0o000);

    try {
      await expect(resolveProjectTarget({ projectDir, profileStore: store })).rejects.toMatchObject({ code: "publish_config_unreadable" });
    } finally {
      await fs.chmod(publish, 0o600);
    }
  });
});

async function createProject(): Promise<{ projectDir: string; store: ProfileStore }> {
  await fs.mkdir(testRoot, { recursive: true });
  const projectDir = await fs.mkdtemp(path.join(testRoot, "project-"));
  const configDir = await fs.mkdtemp(path.join(testRoot, "profiles-"));
  directories.push(projectDir, configDir);
  const store = new ProfileStore(configDir);
  await store.upsert({ name: "current", serverUrl: "http://127.0.0.1:3010", apiKey: "current-key" });
  await store.upsert({ name: "project", serverUrl: "http://127.0.0.1:3020", apiKey: "project-key" });
  const document = await store.load();
  await store.save({ ...document, currentProfile: "current" });
  return { projectDir, store };
}
