import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestServer, getAppUrl, getTestApiKey, createTestPage } from "./helpers.js";
import type { FastifyInstance } from "fastify";
import { BOOTSTRAP_USER_ID } from "../../src/lib/meta-sqlite.js";
import fs from "node:fs";
import path from "node:path";

describe("notify 端点条件注册（spec: Notify 端点路径）", () => {
  let app: FastifyInstance;
  let baseUrl: string;
  let dataDir: string;
  let stop: () => Promise<void>;
  const apiKey = getTestApiKey();
  const owner = BOOTSTRAP_USER_ID;

  beforeAll(async () => {
    const server = await createTestServer();
    app = server.app;
    baseUrl = getAppUrl(app);
    dataDir = server.dataDir;
    stop = server.stop;
  });

  afterAll(async () => { await stop(); });

  function writePageMeta(pageName: string, meta: Record<string, unknown>) {
    const metaPath = path.join(dataDir, owner, pageName, "meta.json");
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
  }

  it("manifest 不含 notify 字段时 POST /serve/{owner}/{app}/api/notify 返回 404", async () => {
    await createTestPage(app, owner, "no-notify-app");
    const res = await fetch(`${baseUrl}/serve/${owner}/no-notify-app/api/notify`, {
      method: "POST",
      headers: { "X-API-Key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ title: "x" }),
    });
    expect(res.status).toBe(404);
  });

  it("manifest.notify.enabled = false 时 POST /serve/{owner}/{app}/api/notify 返回 404", async () => {
    await createTestPage(app, owner, "notify-disabled-app");
    writePageMeta("notify-disabled-app", {
      name: "notify-disabled-app",
      userId: owner,
      description: "",
      currentVersion: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      versions: [],
      metadata: {},
      notify: { enabled: false },
    });
    const res = await fetch(`${baseUrl}/serve/${owner}/notify-disabled-app/api/notify`, {
      method: "POST",
      headers: { "X-API-Key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ title: "x" }),
    });
    expect(res.status).toBe(404);
  });

  it("manifest.notify.enabled = true 时端点存在（返回非 404，即便 401/403）", async () => {
    await createTestPage(app, owner, "notify-enabled-app");
    writePageMeta("notify-enabled-app", {
      name: "notify-enabled-app",
      userId: owner,
      description: "",
      currentVersion: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      versions: [],
      metadata: {},
      notify: { enabled: true },
    });
    const res = await fetch(`${baseUrl}/serve/${owner}/notify-enabled-app/api/notify`, {
      method: "POST",
      headers: { "X-API-Key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ title: "x" }),
    });
    expect(res.status).not.toBe(404);
  });
});
