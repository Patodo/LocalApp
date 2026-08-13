import { createServer, type Server } from "node:http";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalAppClient } from "../src/http/localapp-client.js";

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

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => server.close((error) => error === undefined ? resolve() : reject(error)))));
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function createDirectory(): Promise<string> {
  const testRoot = path.resolve(process.cwd(), "../../tmp/localapp-task-2-tests");
  await mkdir(testRoot, { recursive: true });
  const directory = await mkdtemp(path.join(testRoot, "client-"));
  directories.push(directory);
  return directory;
}

async function bodyOf(request: import("node:http").IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

describe("LocalAppClient", () => {
  it("never forwards an API Key across a redirect", async () => {
    // Break caught: enabling automatic redirects leaks the profile credential to another origin.
    let externalObservedApiKey = false;
    const externalUrl = await listen(createServer((request, response) => {
      externalObservedApiKey = request.headers["x-api-key"] !== undefined;
      response.writeHead(200, { "content-type": "application/json" });
      response.end('{"success":true}');
    }));
    const platformUrl = await listen(createServer((_request, response) => {
      response.writeHead(302, { location: `${externalUrl}/target` });
      response.end();
    }));
    const client = new LocalAppClient({ name: "local", serverUrl: platformUrl, apiKey: "api-key-must-not-leak" });

    const result = await client.getJson("/api/me");

    expect(result).toEqual({ ok: false, status: 302, error: "Server redirected the request" });
    expect(externalObservedApiKey).toBe(false);
  });

  it("adds the API key and packed product version to JSON requests", async () => {
    // Break caught: requests that omit either authentication or version metadata cannot satisfy the Server contract.
    const platformUrl = await listen(createServer((request, response) => {
      expect(request.headers["x-api-key"]).toBe("valid-key");
      expect(request.headers["x-cli-version"]).toBe("0.1.1");
      response.writeHead(200, { "content-type": "application/json" });
      response.end('{"success":true,"data":{"id":"alice"}}');
    }));
    const client = new LocalAppClient({ name: "local", serverUrl: platformUrl, apiKey: "valid-key" });

    await expect(client.getJson("/api/me")).resolves.toEqual({
      ok: true,
      status: 200,
      body: { success: true, data: { id: "alice" } },
    });
  });

  it("posts JSON with authenticated headers to the LocalApp Server", async () => {
    // Break caught: postJson using the wrong method, payload, or credentials cannot perform authenticated mutations.
    const platformUrl = await listen(createServer(async (request, response) => {
      expect(request.method).toBe("POST");
      expect(request.headers["content-type"]).toBe("application/json");
      expect(request.headers["x-api-key"]).toBe("post-key");
      expect(await bodyOf(request)).toBe('{"app":"notes"}');
      response.writeHead(201, { "content-type": "application/json" });
      response.end('{"success":true,"data":{"created":true}}');
    }));

    await expect(new LocalAppClient({ name: "local", serverUrl: platformUrl, apiKey: "post-key" }).postJson("/api/me/apps", { app: "notes" }))
      .resolves.toEqual({ ok: true, status: 201, body: { success: true, data: { created: true } } });
  });

  it("preserves a public Server error from an unsuccessful JSON response", async () => {
    // Break caught: replacing a Server validation error with a generic client failure prevents commands from reportable, credential-safe sync failures.
    const platformUrl = await listen(createServer((_request, response) => {
      response.writeHead(400, { "content-type": "application/json" });
      response.end('{"success":false,"error":"Peer not found"}');
    }));

    await expect(new LocalAppClient({ name: "local", serverUrl: platformUrl, apiKey: "error-key" }).postJson("/api/me/apps/notes/sync", {}))
      .resolves.toEqual({ ok: false, status: 400, error: "Peer not found" });
  });

  it("uploads a package as authenticated multipart form data", async () => {
    // Break caught: installPackage omitting multipart bytes or authentication cannot install an application package.
    const fixture = path.join(await createDirectory(), "notes.localapp");
    await writeFile(fixture, "package payload");
    const platformUrl = await listen(createServer(async (request, response) => {
      expect(request.method).toBe("POST");
      expect(request.url).toBe("/api/me/apps/install");
      expect(request.headers["x-api-key"]).toBe("install-key");
      expect(request.headers["content-type"]).toMatch(/^multipart\/form-data; boundary=/);
      const body = await bodyOf(request);
      expect(body).toContain('name="package"; filename="notes.localapp"');
      expect(body).toContain("package payload");
      response.writeHead(200, { "content-type": "application/json" });
      response.end('{"success":true,"data":{"installed":true}}');
    }));

    await expect(new LocalAppClient({ name: "local", serverUrl: platformUrl, apiKey: "install-key" }).installPackage(fixture))
      .resolves.toEqual({ ok: true, status: 200, body: { success: true, data: { installed: true } } });
  });

  it("uses a literal 30-second timeout for ordinary requests", async () => {
    // Break caught: ordinary authenticated requests using the login timeout time out too aggressively.
    const observedTimeouts: number[] = [];
    const platformUrl = await listen(createServer((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end('{"success":true}');
    }));
    const client = new LocalAppClient({ name: "local", serverUrl: platformUrl, apiKey: "timeout-key" }, {
      setTimeout: (_callback: () => void, timeoutMs: number) => {
        observedTimeouts.push(timeoutMs);
        return undefined;
      },
      clearTimeout: () => undefined,
    });

    await expect(client.getJson("/api/me")).resolves.toEqual({ ok: true, status: 200, body: { success: true } });
    expect(observedTimeouts).toEqual([30_000]);
  });
});
