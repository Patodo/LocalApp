import fs from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApiKey } from "../../server/src/lib/meta-sqlite.js";
import { createTestServer } from "../../server/tests/integration/helpers.js";
import { installApplication } from "../src/commands/app-install.js";
import { ProfileStore } from "../src/config/profile-store.js";
import { runLocalApp } from "../src/main.js";
import { resolveProjectTarget } from "../src/project/target.js";

const repositoryRoot = path.resolve(process.cwd(), "../..");
const testRoot = path.join(repositoryRoot, "tmp/task-5-app-install-tests");

describe("application installation", () => {
  let serverUrl: string;
  let stop: () => Promise<void>;
  let projectDir: string;
  let configDir: string;
  let apiKey: string;

  beforeAll(async () => {
    await fs.mkdir(testRoot, { recursive: true });
    const server = await createTestServer({ env: { DATA_DIR: await fs.mkdtemp(path.join(testRoot, "server-")) } });
    serverUrl = server.baseUrl;
    stop = server.stop;
    apiKey = createApiKey("localadmin").key;
    projectDir = await createProject();
    configDir = await fs.mkdtemp(path.join(testRoot, "profiles-"));
    await new ProfileStore(configDir).upsert({ name: "local", serverUrl, apiKey });
  });

  afterAll(async () => {
    await stop();
    await fs.rm(projectDir, { recursive: true, force: true });
    await fs.rm(configDir, { recursive: true, force: true });
  });

  it("builds and installs the current project into the selected Server", async () => {
    // Break caught: bypassing the canonical builder or losing target ownership makes a CLI install incompatible with Server packages.
    const result = await installApplication({ projectDir, target: "local", profileStore: new ProfileStore(configDir) });

    expect(result.serverUrl).toBe(serverUrl);
    expect(result.data.app.name).toBe("install-fixture");
    expect((await fetch(`${serverUrl}/localadmin/install-fixture/`)).status).toBe(200);
  });

  it("preserves the canonical outcome beneath data.app when a same-name version is updated", async () => {
    // Break caught: flattening or replacing the Server outcome loses the new app version and upgrade semantics for a same-name install.
    await fs.rm(path.join(projectDir, "install-fixture.localapp"));
    await fs.writeFile(path.join(projectDir, "package.json"), JSON.stringify({
      name: "install-fixture", version: "1.1.0", scripts: {
        test: "node -e \"process.exit(0)\"", build: "node -e \"process.exit(0)\"",
      },
    }));

    const result = await installApplication({ projectDir, target: "local", profileStore: new ProfileStore(configDir) });

    expect(result.data.app).toMatchObject({ name: "install-fixture", appVersion: "1.1.0", upgraded: true });
  });

  it("validates an explicit package before uploading without rebuilding", async () => {
    // Break caught: treating --package as an opaque upload permits an invalid artifact to reach the Server and reruns project scripts unexpectedly.
    const packagePath = path.join(projectDir, "invalid.localapp");
    await fs.writeFile(packagePath, "not a package");

    await expect(installApplication({ projectDir, packagePath, profileStore: new ProfileStore(configDir) }))
      .rejects.toThrow("Application package is invalid");
  });

  it("prefers explicit targets over the project default and current profile", async () => {
    // Break caught: choosing the current profile before a publish default can deploy the same package to the wrong Server.
    const store = new ProfileStore(configDir);
    await store.upsert({ name: "project", serverUrl, apiKey });
    const document = await store.load();
    await store.save({ ...document, currentProfile: "local" });
    await fs.mkdir(path.join(projectDir, ".localapp"), { recursive: true });
    await fs.writeFile(path.join(projectDir, ".localapp/publish.json"), JSON.stringify({ defaultProfile: "project" }));

    await expect(resolveProjectTarget({ projectDir, profileStore: store })).resolves.toMatchObject({ name: "project" });
    await expect(resolveProjectTarget({ projectDir, target: "local", profileStore: store })).resolves.toMatchObject({ name: "local" });
  });

  it("uses the project default target when the CLI redacts install output", async () => {
    // Break caught: resolving the current profile only for output redaction bypasses publish.json and deploys to the wrong Server.
    const previousConfigDir = process.env.LOCALAPP_CONFIG_DIR;
    let stdout = "";
    let stderr = "";
    process.env.LOCALAPP_CONFIG_DIR = configDir;
    try {
      const code = await withCwd(projectDir, () => runLocalApp(["app", "install", "--package", path.join(projectDir, "install-fixture.localapp")], {
        stdout: (value) => { stdout += value; }, stderr: (value) => { stderr += value; },
      }));
      expect(code).toBe(0);
    } finally {
      if (previousConfigDir === undefined) delete process.env.LOCALAPP_CONFIG_DIR;
      else process.env.LOCALAPP_CONFIG_DIR = previousConfigDir;
    }
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toMatchObject({ success: true, target: "project", serverUrl });
    expect(stdout).not.toContain(apiKey);
  });
});

async function withCwd<T>(directory: string, action: () => Promise<T>): Promise<T> {
  const current = process.cwd();
  process.chdir(directory);
  try {
    return await action();
  } finally {
    process.chdir(current);
  }
}

async function createProject(): Promise<string> {
  const projectDir = await fs.mkdtemp(path.join(testRoot, "project-"));
  await fs.mkdir(path.join(projectDir, "dist"), { recursive: true });
  await fs.mkdir(path.join(projectDir, "migrations"), { recursive: true });
  await fs.writeFile(path.join(projectDir, "manifest.json"), JSON.stringify({
    name: "install-fixture", platformVersion: "^1.0", pageAccess: { level: "public" },
  }));
  await fs.writeFile(path.join(projectDir, "package.json"), JSON.stringify({
    name: "install-fixture", version: "1.0.0", scripts: {
      test: "node -e \"process.exit(0)\"", build: "node -e \"process.exit(0)\"",
    },
  }));
  await fs.writeFile(path.join(projectDir, "package-lock.json"), "{}\n");
  await fs.writeFile(path.join(projectDir, "dist/index.html"), "<main>installed</main>\n");
  await fs.writeFile(path.join(projectDir, "migrations/001_init.sql"), "CREATE TABLE items (id TEXT PRIMARY KEY);\n");
  return projectDir;
}
