import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestServer, getAppUrl, getTestApiKey, createTestPage } from "./helpers.js";
import { registerAndLogin } from "../helpers/createUser.js";
import type { FastifyInstance } from "fastify";
import { readPageMeta, writePageMeta } from "../../src/plugins/storage.js";
import fs from "node:fs";
import path from "node:path";
import { getObject, putObject } from "../../src/lib/s3-client.js";

describe("me-pages-api", () => {
  let app: FastifyInstance;
  let baseUrl: string;
  let stop: () => Promise<void>;
  let dataDir: string;

  beforeAll(async () => {
    const server = await createTestServer();
    app = server.app;
    baseUrl = getAppUrl(app);
    stop = server.stop;
    dataDir = server.dataDir;
  });

  afterAll(async () => {
    await stop();
  });

  describe("GET /api/me/pages", () => {
    it("should list user's pages", async () => {
      const cookie = await registerAndLogin(baseUrl, "pagesuser1");
      await createTestPage(app, "pagesuser1", "my-app-1");
      await createTestPage(app, "pagesuser1", "my-app-2");
      const offlineMeta = readPageMeta(dataDir, "pagesuser1", "my-app-2")!;
      offlineMeta.lifecycle = { status: "offline" };
      writePageMeta(dataDir, "pagesuser1", "my-app-2", offlineMeta);

      const res = await fetch(`${baseUrl}/api/me/pages`, { headers: { Cookie: cookie } });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data.length).toBeGreaterThanOrEqual(2);
      const names = data.data.map((p: { name: string }) => p.name);
      expect(names).toContain("my-app-1");
      expect(names).toContain("my-app-2");
      expect(data.data.find((page: { name: string }) => page.name === "my-app-1")).toMatchObject({
        lifecycleStatus: "online",
      });
      expect(data.data.find((page: { name: string }) => page.name === "my-app-2")).toMatchObject({
        lifecycleStatus: "offline",
      });
    });

    it("should respect limit parameter", async () => {
      const cookie = await registerAndLogin(baseUrl, "pagesuser2");
      for (let i = 0; i < 5; i++) {
        await createTestPage(app, "pagesuser2", `app-${i}`);
      }
      const res = await fetch(`${baseUrl}/api/me/pages?limit=2`, { headers: { Cookie: cookie } });
      const data = await res.json();
      expect(data.data.length).toBeLessThanOrEqual(2);
    });

    it("should return empty array for user with no pages", async () => {
      const cookie = await registerAndLogin(baseUrl, "pagesuser3");
      const res = await fetch(`${baseUrl}/api/me/pages`, { headers: { Cookie: cookie } });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data).toEqual([]);
    });

    it("should return 401 without session", async () => {
      const res = await fetch(`${baseUrl}/api/me/pages`);
      expect(res.status).toBe(401);
    });
  });

  describe("GET /api/me/pages/:name", () => {
    it("should return single page detail", async () => {
      const cookie = await registerAndLogin(baseUrl, "pagesuser4");
      await createTestPage(app, "pagesuser4", "detail-app");

      const res = await fetch(`${baseUrl}/api/me/pages/detail-app`, { headers: { Cookie: cookie } });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data.name).toBe("detail-app");
      expect(data.data.currentVersion).toBe(1);
      expect(data.data.lifecycleStatus).toBe("online");
    });

    it("should return 404 for non-existent page", async () => {
      const cookie = await registerAndLogin(baseUrl, "pagesuser5");
      const res = await fetch(`${baseUrl}/api/me/pages/no-such-page`, { headers: { Cookie: cookie } });
      expect(res.status).toBe(404);
    });
  });

  describe("DELETE /api/me/pages/:name", () => {
    it("lets only the session owner permanently delete app data and stored files", async () => {
      const owner = "pagedeleteowner";
      const pageName = "delete-everything";
      const ownerCookie = await registerAndLogin(baseUrl, owner);
      const otherCookie = await registerAndLogin(baseUrl, "pagedeleteother");
      await createTestPage(app, owner, pageName);

      const pageDir = path.join(dataDir, owner, pageName);
      fs.writeFileSync(path.join(pageDir, "manifest.platform.json"), JSON.stringify({ lifecycle: { status: "offline" } }));
      fs.writeFileSync(path.join(pageDir, "app.db"), "database");
      fs.mkdirSync(path.join(pageDir, "files"), { recursive: true });
      fs.writeFileSync(path.join(pageDir, "files", "evidence.txt"), "file data");
      const contentKey = `${owner}/${pageName}/0123456789abcdef0123.png`;
      const issueKey = `issues/${owner}/${pageName}/attachment/content`;
      await putObject(contentKey, Buffer.from("content"), "image/png");
      await putObject(issueKey, Buffer.from("issue"), "application/octet-stream");

      const unauthenticated = await fetch(`${baseUrl}/api/me/pages/${pageName}`, { method: "DELETE" });
      expect(unauthenticated.status).toBe(401);
      const forbidden = await fetch(`${baseUrl}/api/me/pages/${pageName}`, {
        method: "DELETE",
        headers: { Cookie: otherCookie },
      });
      expect(forbidden.status).toBe(404);
      expect(fs.existsSync(pageDir)).toBe(true);

      const response = await fetch(`${baseUrl}/api/me/pages/${pageName}`, {
        method: "DELETE",
        headers: { Cookie: ownerCookie },
      });
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        success: true,
        data: { deleted: true, name: pageName },
      });
      expect(fs.existsSync(pageDir)).toBe(false);
      expect(await getObject(contentKey)).toBeNull();
      expect(await getObject(issueKey)).toBeNull();
    });
  });

  describe("GET /api/pages/:userId/:name/meta", () => {
    it("should return public page metadata without auth", async () => {
      await createTestPage(app, "metauser1", "public-app");
      const meta = readPageMeta(dataDir, "metauser1", "public-app")!;
      meta.lifecycle = { status: "offline" };
      writePageMeta(dataDir, "metauser1", "public-app", meta);

      const res = await fetch(`${baseUrl}/api/pages/metauser1/public-app/meta`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data.name).toBe("public-app");
      expect(data.data.userId).toBe("metauser1");
      expect(data.data.lifecycleStatus).toBe("offline");
    });

    it("should return 404 for non-existent page", async () => {
      const res = await fetch(`${baseUrl}/api/pages/nobody/no-page/meta`);
      expect(res.status).toBe(404);
    });
  });
});
