import fs from "node:fs/promises";
import { createServer, type Server } from "node:http";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApiKey } from "../../server/src/lib/meta-sqlite.js";
import { createTestServer, registerUser } from "../../server/tests/integration/helpers.js";
import { installApplication } from "../src/commands/app-install.js";
import { syncApplication } from "../src/commands/app-sync.js";
import { ProfileStore } from "../src/config/profile-store.js";

const repositoryRoot = path.resolve(process.cwd(), "../..");
const testRoot = path.join(repositoryRoot, "tmp/task-5-app-sync-tests");

describe("application synchronization", () => {
  let projectDir: string;
  let configDir: string;
  let serverUrl: string;
  let stop: () => Promise<void>;
  let sourceKey: string;

  beforeAll(async () => {
    await fs.mkdir(testRoot, { recursive: true });
    projectDir = await fs.mkdtemp(path.join(testRoot, "project-"));
    await fs.mkdir(path.join(projectDir, "dist"), { recursive: true });
    await fs.mkdir(path.join(projectDir, "migrations"), { recursive: true });
    await fs.writeFile(path.join(projectDir, "manifest.json"), JSON.stringify({ name: "install-fixture", platformVersion: "^1.0", pageAccess: { level: "public" } }));
    await fs.writeFile(path.join(projectDir, "package.json"), JSON.stringify({
      name: "install-fixture", version: "1.0.0", scripts: {
        test: "node -e \"process.exit(0)\"", build: "node -e \"process.exit(0)\"",
      },
    }));
    await fs.writeFile(path.join(projectDir, "package-lock.json"), "{}\n");
    await fs.writeFile(path.join(projectDir, "dist/index.html"), "<main>synced</main>\n");
    await fs.writeFile(path.join(projectDir, "migrations/001_init.sql"), "CREATE TABLE items (id TEXT PRIMARY KEY);\n");
    const server = await createTestServer({ env: { DATA_DIR: await fs.mkdtemp(path.join(testRoot, "server-")) } });
    serverUrl = server.baseUrl;
    stop = server.stop;
    sourceKey = createApiKey("localadmin").key;
    await registerUser(serverUrl, "target-owner", "target-password");
    const targetKey = createApiKey("target-owner").key;
    const login = await fetch(`${serverUrl}/api/auth/login`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "localadmin", password: "localadmin" }),
    });
    const peer = await fetch(`${serverUrl}/api/peers`, {
      method: "POST", headers: { "content-type": "application/json", cookie: login.headers.get("set-cookie")!.split(";", 1)[0] },
      body: JSON.stringify({ name: "target", baseUrl: serverUrl, apiKey: targetKey, acceptInsecureHttp: true }),
    });
    expect(peer.status).toBe(201);
    configDir = await fs.mkdtemp(path.join(testRoot, "profiles-"));
    await new ProfileStore(configDir).upsert({ name: "source", serverUrl, apiKey: sourceKey });
    await installApplication({ projectDir, target: "source", profileStore: new ProfileStore(configDir) });
  });

  afterAll(async () => {
    await fs.rm(projectDir, { recursive: true, force: true });
    await fs.rm(configDir, { recursive: true, force: true });
    await stop();
  });

  it("requires an exact app-name confirmation before data sync", async () => {
    // Break caught: dispatching a data replacement request before local confirmation allows a typo to start an irreversible sync.
    await expect(syncApplication({ projectDir, target: "source", peer: "target", withData: true, confirmation: "wrong" }))
      .rejects.toThrow("--confirm-app install-fixture");
  });

  it("starts synchronization on the selected source Server and returns the completed job", async () => {
    // Break caught: sending peer credentials from the CLI or polling another Server bypasses source-side peer resolution and cannot transfer the app.
    const job = await syncApplication({
      projectDir, target: "source", peer: "target", withData: false,
      profileStore: new ProfileStore(configDir),
    });

    expect(job.status).toBe("completed");
    const targetLogin = await fetch(`${serverUrl}/api/auth/login`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "target-owner", password: "target-password" }),
    });
    expect((await fetch(`${serverUrl}/target-owner/install-fixture/`, {
      headers: { cookie: targetLogin.headers.get("set-cookie")!.split(";", 1)[0] },
    })).status).toBe(200);
  });

  it("waits exactly 250 ms before each non-terminal status poll", async () => {
    // Break caught: a tight loop or changed interval overloads the source Server while a synchronization job is running.
    let server: Server | undefined;
    const waited: number[] = [];
    try {
      const serverUrl = await listen(createServer((request, response) => {
        response.setHeader("content-type", "application/json");
        if (request.method === "POST") response.end('{"success":true,"data":{"id":"job-1","status":"queued"}}');
        else response.end('{"success":true,"data":{"id":"job-1","status":"completed"}}');
      }), (value) => { server = value; });
      const profileStore = { resolve: async () => ({ name: "source", serverUrl, apiKey: "source-key" }) };

      await expect(syncApplication({
        projectDir, target: "source", peer: "target", withData: false, profileStore,
        wait: async (milliseconds) => { waited.push(milliseconds); },
      })).resolves.toMatchObject({ id: "job-1", status: "completed" });
      expect(waited).toEqual([250]);
    } finally {
      await close(server);
    }
  });
});

async function listen(server: Server, ready: (server: Server) => void): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  ready(server);
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("test server did not listen");
  return `http://127.0.0.1:${address.port}`;
}

async function close(server: Server | undefined): Promise<void> {
  if (server === undefined) return;
  await new Promise<void>((resolve, reject) => server.close((error) => error === undefined ? resolve() : reject(error)));
}
