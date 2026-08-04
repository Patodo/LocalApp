import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestServer, getAppUrl, getTestApiKey, createTestPage } from "./helpers.js";
import { BOOTSTRAP_USER_ID } from "../../src/lib/meta-sqlite.js";
import type { FastifyInstance } from "fastify";
import fs from "node:fs";
import path from "node:path";

describe("management API: access policy config", () => {
  let app: FastifyInstance;
  let baseUrl: string;
  let dataDir: string;
  let stop: () => Promise<void>;
  const apiKey = getTestApiKey();
  const pageName = "policy-test";

  beforeAll(async () => {
    const server = await createTestServer();
    app = server.app;
    baseUrl = getAppUrl(app);
    dataDir = server.dataDir;
    stop = server.stop;
    await createTestPage(app, BOOTSTRAP_USER_ID, pageName);
  });

  afterAll(async () => { await stop(); });

  describe("POST /api/schemas with routeAccess", () => {
    it("创建 schema 时指定 routeAccess 成功存储", async () => {
      const res = await fetch(`${baseUrl}/api/schemas`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-API-Key": apiKey },
        body: JSON.stringify({
          pageName,
          name: "comments",
          fields: { content: { type: "string" } },
          routeAccess: { read: "public", create: "authenticated", update: "owner", delete: "owner" },
        }),
      });
      expect(res.status).toBe(200);

      // Verify stored in meta.json
      const metaPath = path.join(dataDir, BOOTSTRAP_USER_ID, pageName, "meta.json");
      const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
      const schema = meta.schemas.find((s: any) => s.name === "comments");
      expect(schema.routeAccess).toEqual({ read: "public", create: "authenticated", update: "owner", delete: "owner" });
    });

    it("不指定 routeAccess 时 meta.json 中无该字段", async () => {
      const res = await fetch(`${baseUrl}/api/schemas`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-API-Key": apiKey },
        body: JSON.stringify({
          pageName,
          name: "logs",
          fields: { message: { type: "string" } },
        }),
      });
      expect(res.status).toBe(200);

      const metaPath = path.join(dataDir, BOOTSTRAP_USER_ID, pageName, "meta.json");
      const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
      const schema = meta.schemas.find((s: any) => s.name === "logs");
      expect(schema.routeAccess).toBeUndefined();
    });
  });

  describe("PUT /api/pages/:name with pageAccess", () => {
    it("更新页面 pageAccess 成功", async () => {
      const res = await fetch(`${baseUrl}/api/pages/${pageName}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "X-API-Key": apiKey },
        body: JSON.stringify({ pageAccess: { level: "authenticated" } }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.pageAccess).toEqual({ level: "authenticated" });

      // Verify in meta.json
      const metaPath = path.join(dataDir, BOOTSTRAP_USER_ID, pageName, "meta.json");
      const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
      expect(meta.pageAccess).toEqual({ level: "authenticated" });
    });
  });
});
