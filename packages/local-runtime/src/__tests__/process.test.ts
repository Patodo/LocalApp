import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  loadLocalAppRegistry,
  startLocalRuntime,
  type LocalRuntimeProcess,
} from "../process.js";
import { createFixtureApp } from "./fixtures.js";

const roots: string[] = [];
const runtimes: LocalRuntimeProcess[] = [];

afterEach(async () => {
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.close()));
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("local runtime process", () => {
  it("loads the persistent registry and listens only on a random loopback port", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "localapp-runtime-process-"));
    roots.push(root);
    const alpha = createFixtureApp(root, "alpha-app");
    const registryPath = path.join(root, "registry.json");
    fs.writeFileSync(
      registryPath,
      JSON.stringify({ schemaVersion: 1, apps: [alpha] }),
    );

    const apps = loadLocalAppRegistry(registryPath);
    const runtime = await startLocalRuntime({
      apps,
      controlToken: "test-process-control-token",
      port: 0,
    });
    runtimes.push(runtime);

    expect(runtime.host).toBe("127.0.0.1");
    expect(runtime.port).toBeGreaterThan(0);
    const unauthorized = await request(runtime.port, "/health", {
      host: `control.localhost:${runtime.port}`,
    });
    expect(unauthorized.status).toBe(401);
    const response = await request(runtime.port, "/health", {
      host: `control.localhost:${runtime.port}`,
      authorization: "Bearer test-process-control-token",
    });
    expect(response.status).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({
      success: true,
      data: { registeredApps: 1, initializedApps: 0 },
    });
  });

  it("rejects malformed registry entries before listening", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "localapp-runtime-process-"));
    roots.push(root);
    const registryPath = path.join(root, "registry.json");
    fs.writeFileSync(
      registryPath,
      JSON.stringify({
        schemaVersion: 2,
        apps: [{ id: "bad app", versionRoot: "../escape", dataRoot: "/tmp/data" }],
      }),
    );

    expect(() => loadLocalAppRegistry(registryPath)).toThrow(
      /unsupported local app registry schema/i,
    );
  });
});

function request(
  port: number,
  pathname: string,
  headers: Record<string, string>,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path: pathname,
        method: "GET",
        headers,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () =>
          resolve({
            status: response.statusCode ?? 0,
            body: Buffer.concat(chunks).toString("utf8"),
          }),
        );
      },
    );
    request.once("error", reject);
    request.end();
  });
}
