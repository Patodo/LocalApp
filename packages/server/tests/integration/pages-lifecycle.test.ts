import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestServer, getAppUrl, getTestApiKey, crudUrl } from "./helpers.js";
import { createTestUser } from "../helpers/createUser.js";
import { BOOTSTRAP_USER_ID } from "../../src/lib/meta-sqlite.js";
import fs from "node:fs";
import path from "node:path";
import { getObject, putObject } from "../../src/lib/s3-client.js";

describe("Pages lifecycle", () => {
  let baseUrl: string;
  let dataDir: string;
  let stop: () => Promise<void>;
  const apiKey = getTestApiKey();

  beforeAll(async () => {
    const server = await createTestServer();
    baseUrl = getAppUrl(server.app);
    dataDir = server.dataDir;
    stop = server.stop;
  });

  afterAll(async () => {
    await stop();
  });

  const headers = { "X-API-Key": apiKey, "Content-Type": "application/json" };

  describe("GET /api/pages", () => {
    it("returns empty array for user with no pages", async () => {
      // Create a fresh user via register (has no pages directory)
      await createTestUser(baseUrl, "nopagesuser", "password123");

      // This user has no API key, so test with admin who has no pages initially
      // admin user dir doesn't exist yet
      const res = await fetch(`${baseUrl}/api/pages`, { headers });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data).toEqual([]);
    });

    it("returns pages after creation", async () => {
      await fetch(`${baseUrl}/api/pages`, {
        method: "POST",
        headers,
        body: JSON.stringify({ name: "lifecycle-test-page" }),
      });

      const res = await fetch(`${baseUrl}/api/pages`, { headers });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.length).toBeGreaterThanOrEqual(1);

      const page = body.data.find((p: any) => p.name === "lifecycle-test-page");
      expect(page).toBeDefined();
      expect(page.currentVersion).toBe(0);
    });
  });

  describe("GET /api/pages/:name", () => {
    it("returns page details", async () => {
      const res = await fetch(`${baseUrl}/api/pages/lifecycle-test-page`, { headers });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.name).toBe("lifecycle-test-page");
      expect(body.data.versionCount).toBe(0);
      expect(body.data.versions).toEqual([]);
    });

    it("returns 404 for non-existent page", async () => {
      const res = await fetch(`${baseUrl}/api/pages/non-existent`, { headers });
      expect(res.status).toBe(404);
    });
  });

  describe("PUT /api/pages/:name", () => {
    it("updates pageAccess", async () => {
      const res = await fetch(`${baseUrl}/api/pages/lifecycle-test-page`, {
        method: "PUT",
        headers,
        body: JSON.stringify({ pageAccess: { level: "authenticated" } }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.pageAccess).toEqual({ level: "authenticated" });
    });

    it("returns 404 for non-existent page", async () => {
      const res = await fetch(`${baseUrl}/api/pages/non-existent`, {
        method: "PUT",
        headers,
        body: JSON.stringify({ pageAccess: { level: "public" } }),
      });
      expect(res.status).toBe(404);
    });
  });

  describe("DELETE /api/pages/:name", () => {
    it("deletes an existing page", async () => {
      // Create a page to delete
      await fetch(`${baseUrl}/api/pages`, {
        method: "POST",
        headers,
        body: JSON.stringify({ name: "to-delete-page" }),
      });

      // Verify it exists
      const before = await fetch(`${baseUrl}/api/pages/to-delete-page`, { headers });
      expect(before.status).toBe(200);
      const contentKey = `${BOOTSTRAP_USER_ID}/to-delete-page/0123456789abcdef0123.png`;
      const issueKey = `issues/${BOOTSTRAP_USER_ID}/to-delete-page/attachment/content`;
      await putObject(contentKey, Buffer.from("content"), "image/png");
      await putObject(issueKey, Buffer.from("issue"), "application/octet-stream");

      // Delete it
      const res = await fetch(`${baseUrl}/api/pages/to-delete-page`, {
        method: "DELETE",
        headers,
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.deleted).toBe(true);
      expect(body.data.name).toBe("to-delete-page");

      // Verify directory is gone
      const pageDir = path.join(dataDir, BOOTSTRAP_USER_ID, "to-delete-page");
      expect(fs.existsSync(pageDir)).toBe(false);
      expect(await getObject(contentKey)).toBeNull();
      expect(await getObject(issueKey)).toBeNull();

      // Verify 404 on GET
      const after = await fetch(`${baseUrl}/api/pages/to-delete-page`, { headers });
      expect(after.status).toBe(404);
    });

    it("returns 404 for non-existent page", async () => {
      const res = await fetch(`${baseUrl}/api/pages/non-existent`, {
        method: "DELETE",
        headers,
      });
      expect(res.status).toBe(404);
    });
  });
});
