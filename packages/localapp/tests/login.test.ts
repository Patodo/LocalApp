import { createServer, type Server } from "node:http";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProfileStore } from "../src/config/profile-store.js";
import { login } from "../src/commands/login.js";
import { LocalAppClient } from "../src/http/localapp-client.js";
import { runLocalApp } from "../src/main.js";

const servers: Server[] = [];
const directories: string[] = [];

async function listen(server: Server): Promise<string> {
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Test server did not bind a TCP port");
  return `http://127.0.0.1:${address.port}`;
}

async function createConfigDirectory(): Promise<string> {
  const testRoot = path.resolve(process.cwd(), "../../tmp/localapp-task-2-tests");
  await mkdir(testRoot, { recursive: true });
  const directory = await mkdtemp(path.join(testRoot, "login-"));
  directories.push(directory);
  return directory;
}

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => server.close((error) => error === undefined ? resolve() : reject(error)))));
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("authentication commands", () => {
  it("validates login through api/me before saving the profile", async () => {
    // Break caught: saving credentials before /api/me accepts them leaves an unusable credential on disk.
    const configDir = await createConfigDirectory();
    const apiKey = "correct-api-key";
    const serverUrl = await listen(createServer((request, response) => {
      expect(request.url).toBe("/api/me");
      expect(request.headers["x-api-key"]).toBe(apiKey);
      response.writeHead(200, { "content-type": "application/json" });
      response.end('{"success":true,"data":{"id":"alice","name":"Alice","role":"user"}}');
    }));
    vi.stubEnv("LOCALAPP_CONFIG_DIR", configDir);
    let stdout = "";
    let stderr = "";

    const code = await runLocalApp(["login", serverUrl, "--api-key", apiKey, "--profile", "local"], {
      stdout: (value) => { stdout += value; },
      stderr: (value) => { stderr += value; },
    });

    expect(code).toBe(0);
    await expect(new ProfileStore(configDir).resolve("local")).resolves.toEqual({ name: "local", serverUrl, apiKey });
    expect(stdout).toBe('{"success":true,"user":{"id":"alice","name":"Alice","role":"user"},"profile":"local","serverUrl":"' + serverUrl + '"}\n');
    expect(stderr).toBe("");
    expect(`${stdout}${stderr}`).not.toContain(apiKey);
  });

  it("does not save an API key rejected by api/me", async () => {
    // Break caught: an unsuccessful /api/me response persists an invalid credential.
    const configDir = await createConfigDirectory();
    const serverUrl = await listen(createServer((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end('{"success":true,"data":null}');
    }));
    vi.stubEnv("LOCALAPP_CONFIG_DIR", configDir);
    let stderr = "";

    const code = await runLocalApp(["login", serverUrl, "--api-key", "rejected-api-key", "--profile", "local"], {
      stdout: () => undefined,
      stderr: (value) => { stderr += value; },
    });

    expect(code).toBe(1);
    await expect(new ProfileStore(configDir).resolve("local")).rejects.toThrow("Server profile was not found");
    expect(stderr).toBe('{"error":{"code":"login_invalid_api_key","message":"API Key was rejected by the LocalApp Server"}}\n');
    expect(stderr).not.toContain("rejected-api-key");
  });

  it("removes only the selected credential and prints an authenticated whoami envelope", async () => {
    // Break caught: logout deleting the whole store or whoami omitting the Server envelope breaks profile isolation.
    const configDir = await createConfigDirectory();
    const serverUrl = await listen(createServer((request, response) => {
      expect(request.headers["x-api-key"]).toBe("kept-key");
      response.writeHead(200, { "content-type": "application/json" });
      response.end('{"success":true,"data":{"id":"bob","name":"Bob","role":"admin"}}');
    }));
    const store = new ProfileStore(configDir);
    await store.upsert({ name: "removed", serverUrl, apiKey: "removed-key" });
    await store.upsert({ name: "kept", serverUrl, apiKey: "kept-key" });
    vi.stubEnv("LOCALAPP_CONFIG_DIR", configDir);
    let stdout = "";

    const whoamiCode = await runLocalApp(["whoami", "--profile", "kept"], {
      stdout: (value) => { stdout += value; },
      stderr: () => undefined,
    });
    const logoutCode = await runLocalApp(["logout", "--profile", "removed"], {
      stdout: () => undefined,
      stderr: () => undefined,
    });

    expect(whoamiCode).toBe(0);
    expect(stdout).toBe('{"success":true,"data":{"id":"bob","name":"Bob","role":"admin"}}\n');
    expect(logoutCode).toBe(0);
    await expect(store.resolve("removed")).rejects.toThrow("Server profile was not found");
    await expect(store.resolve("kept")).resolves.toEqual({ name: "kept", serverUrl, apiKey: "kept-key" });
  });

  it("does not serialize an API key supplied by a whoami response", async () => {
    // Break caught: forwarding an unexpected API-key field from the Server leaks a credential to stdout.
    const configDir = await createConfigDirectory();
    const apiKey = "credential-that-must-not-print";
    const serverUrl = await listen(createServer((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end('{"success":true,"data":{"id":"eve","name":"Eve","role":"user","apiKey":"unexpected"}}');
    }));
    await new ProfileStore(configDir).upsert({ name: "local", serverUrl, apiKey });
    vi.stubEnv("LOCALAPP_CONFIG_DIR", configDir);
    let stdout = "";

    const code = await runLocalApp(["whoami"], {
      stdout: (value) => { stdout += value; },
      stderr: () => undefined,
    });

    expect(code).toBe(0);
    expect(stdout.includes("unexpected")).toBe(false);
    expect(stdout.includes(apiKey)).toBe(false);
  });

  it("does not serialize a credential reflected as login identity data", async () => {
    // Break caught: serializing server-controlled id/name/role can reflect the submitted credential.
    const configDir = await createConfigDirectory();
    const apiKey = "reflected-login-credential";
    const serverUrl = await listen(createServer((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(`{"success":true,"data":{"id":"${apiKey}","name":"Alice","role":"user"}}`);
    }));
    vi.stubEnv("LOCALAPP_CONFIG_DIR", configDir);
    let stdout = "";
    let stderr = "";

    const code = await runLocalApp(["login", serverUrl, "--api-key", apiKey, "--profile", "local"], {
      stdout: (value) => { stdout += value; },
      stderr: (value) => { stderr += value; },
    });

    expect(code).toBe(0);
    expect(`${stdout}${stderr}`.includes(apiKey)).toBe(false);
  });

  it("does not serialize a credential reflected under arbitrary nested whoami data", async () => {
    // Break caught: key-name redaction alone misses a credential reflected in arbitrary nested data.
    const configDir = await createConfigDirectory();
    const apiKey = "reflected-whoami-credential";
    const serverUrl = await listen(createServer((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(`{"success":true,"data":{"id":"eve","name":"Eve","role":"user","metadata":{"echo":"${apiKey}"}}}`);
    }));
    await new ProfileStore(configDir).upsert({ name: "local", serverUrl, apiKey });
    vi.stubEnv("LOCALAPP_CONFIG_DIR", configDir);
    let stdout = "";
    let stderr = "";

    const code = await runLocalApp(["whoami"], {
      stdout: (value) => { stdout += value; },
      stderr: (value) => { stderr += value; },
    });

    expect(code).toBe(0);
    expect(`${stdout}${stderr}`.includes(apiKey)).toBe(false);
  });

  it("uses a literal 10-second timeout for login validation", async () => {
    // Break caught: login validation inheriting the ordinary 30-second timeout delays credential feedback.
    const configDir = await createConfigDirectory();
    const observedTimeouts: number[] = [];
    const serverUrl = await listen(createServer((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end('{"success":true,"data":{"id":"alice","name":"Alice","role":"user"}}');
    }));
    vi.stubEnv("LOCALAPP_CONFIG_DIR", configDir);

    const code = await login({ serverUrl, apiKey: "timeout-key", profile: "local" }, { stdout: () => undefined, stderr: () => undefined }, {
      createClient: (profile) => new LocalAppClient(profile, {
        setTimeout: (_callback: () => void, timeoutMs: number) => {
          observedTimeouts.push(timeoutMs);
          return undefined;
        },
        clearTimeout: () => undefined,
      }),
    });

    expect(code).toBe(0);
    expect(observedTimeouts).toEqual([10_000]);
  });
});
