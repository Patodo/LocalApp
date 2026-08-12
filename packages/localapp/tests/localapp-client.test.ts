import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { LocalAppClient } from "../src/http/localapp-client.js";

const servers: Server[] = [];

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
});

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
      expect(request.headers["x-cli-version"]).toBe("0.1.0");
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
});
