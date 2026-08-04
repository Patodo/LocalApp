import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  createTestServer,
  getAppUrl,
  getTestApiKey,
} from "./helpers.js";
import { createTestUser, registerAndLogin } from "../helpers/createUser.js";
import { BOOTSTRAP_USER_ID } from "../../src/lib/meta-sqlite.js";

describe("Security & Authorization Boundary", () => {
  let baseUrl: string;
  let stop: () => Promise<void>;
  const apiKey = getTestApiKey();

  beforeAll(async () => {
    const server = await createTestServer();
    baseUrl = getAppUrl(server.app);
    stop = server.stop;
  });

  afterAll(async () => {
    await stop();
  });

  // CRUD filter SQL injection 测试已随 REST CRUD 端点整体移除
  // （restrict-app-api-to-named-sql 变更）。filter SQL 注入面已不存在——
  // named SQL 使用参数化绑定，前端无法注入任意 SQL 文本。

  describe("XSS in uploaded HTML", () => {
    it("served HTML includes CSP header", async () => {
      const pageName = "xss-test-page";
      await fetch(`${baseUrl}/api/pages`, {
        method: "POST",
        headers: { "X-API-Key": apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({ name: pageName }),
      });

      // Upload with XSS content via multipart
      const formData = new FormData();
      formData.append("name", pageName);
      formData.append(
        "file",
        new File(
          ['<html><body><script>alert("xss")</script><h1>Hello</h1></body></html>'],
          "index.html",
          { type: "text/html" },
        ),
      );

      const uploadRes = await fetch(`${baseUrl}/api/upload`, {
        method: "POST",
        headers: { "X-API-Key": apiKey },
        body: formData,
      });
      expect(uploadRes.status).toBe(200);

      // Access the page and verify CSP header
      const serveRes = await fetch(`${baseUrl}/serve/${BOOTSTRAP_USER_ID}/${pageName}`);
      expect(serveRes.status).toBe(200);
      const csp = serveRes.headers.get("content-security-policy");
      expect(csp).toBeTruthy();
      expect(csp).toContain("script-src");
    });
  });

  describe("Non-owner page operations", () => {
    it("rejects PUT from non-owner (page not found in their scope)", async () => {
      // admin creates a page
      await fetch(`${baseUrl}/api/pages`, {
        method: "POST",
        headers: { "X-API-Key": apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({ name: "owner-test-page" }),
      });

      // Register another user and get their API key
      await createTestUser(baseUrl, "otheruser1", "password123");
      const keyRes = await fetch(`${baseUrl}/api/keys`, {
        method: "POST",
        headers: { "X-API-Key": apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({ userId: "otheruser1" }),
      });
      const { data: keyData } = await keyRes.json();
      const otherKey = keyData.key;

      // Non-owner tries to PUT — pages route scopes by authenticated user,
      // so otheruser1 sees their own directory (empty) → 404
      const putRes = await fetch(`${baseUrl}/api/pages/owner-test-page`, {
        method: "PUT",
        headers: { "X-API-Key": otherKey, "Content-Type": "application/json" },
        body: JSON.stringify({ pageAccess: { level: "public" } }),
      });
      // 404 is correct: page doesn't exist in otheruser1's scope
      expect(putRes.status).toBe(404);
    });

    it("rejects DELETE from non-owner (page not found in their scope)", async () => {
      await createTestUser(baseUrl, "otheruser2", "password123");
      const keyRes = await fetch(`${baseUrl}/api/keys`, {
        method: "POST",
        headers: { "X-API-Key": apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({ userId: "otheruser2" }),
      });
      const { data: keyData } = await keyRes.json();
      const otherKey = keyData.key;

      const delRes = await fetch(`${baseUrl}/api/pages/owner-test-page`, {
        method: "DELETE",
        headers: { "X-API-Key": otherKey },
      });
      expect(delRes.status).toBe(404);
    });
  });

  describe("Page-level ACL mode", () => {
    it("rejects unauthenticated access to ACL page with 401", async () => {
      const pageName = "acl-test-page";
      // admin creates page and sets ACL
      await fetch(`${baseUrl}/api/pages`, {
        method: "POST",
        headers: { "X-API-Key": apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({ name: pageName }),
      });
      await fetch(`${baseUrl}/api/pages/${pageName}`, {
        method: "PUT",
        headers: { "X-API-Key": apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({
          pageAccess: { level: "acl", acl: [BOOTSTRAP_USER_ID] },
        }),
      });

      // Upload so page has content
      const formData = new FormData();
      formData.append("name", pageName);
      formData.append(
        "file",
        new File(["<html><body>ACL page</body></html>"], "index.html", {
          type: "text/html",
        }),
      );
      await fetch(`${baseUrl}/api/upload`, {
        method: "POST",
        headers: { "X-API-Key": apiKey },
        body: formData,
      });

      // Unauthenticated access → 401 (session cookie needed for serve route)
      const res = await fetch(`${baseUrl}/serve/${BOOTSTRAP_USER_ID}/${pageName}`);
      expect(res.status).toBe(401);
    });

    it("allows access for ACL-listed user via session", async () => {
      const pageName = "acl-test-page";

      // admin user already exists from bootstrap, can't register again.
      // Instead, update the ACL to include a testable user.
      // The page was created with acl: ["localadmin"]. Let's change it to include a new user.
      await fetch(`${baseUrl}/api/pages/${pageName}`, {
        method: "PUT",
        headers: { "X-API-Key": apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({
          pageAccess: { level: "acl", acl: [BOOTSTRAP_USER_ID, "aclmember"] },
        }),
      });

      // Register and login as aclmember
      const cookies = await registerAndLogin(baseUrl, "aclmember", "password123");

      // Access page with session cookie
      const serveRes = await fetch(`${baseUrl}/serve/${BOOTSTRAP_USER_ID}/${pageName}`, {
        headers: { Cookie: cookies || "" },
      });
      expect(serveRes.status).toBe(200);
    });
  });

  describe("Upload size limit", () => {
    it("rejects upload exceeding 50MB with 413", async () => {
      const pageName = "size-limit-test";
      await fetch(`${baseUrl}/api/pages`, {
        method: "POST",
        headers: { "X-API-Key": apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({ name: pageName }),
      });

      // Create a file just over 50MB
      const bigBuffer = Buffer.alloc(51 * 1024 * 1024, "a");
      const formData = new FormData();
      formData.append("name", pageName);
      formData.append(
        "file",
        new File([bigBuffer], "bigfile.bin", { type: "application/octet-stream" }),
      );

      const res = await fetch(`${baseUrl}/api/upload`, {
        method: "POST",
        headers: { "X-API-Key": apiKey },
        body: formData,
      });
      expect(res.status).toBe(413);
    });
  });

  describe("Missing required fields", () => {
    it("rejects POST /api/pages without name with 400", async () => {
      const res = await fetch(`${baseUrl}/api/pages`, {
        method: "POST",
        headers: { "X-API-Key": apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
    });

    it("rejects GET /api/schemas without pageName with 400", async () => {
      const res = await fetch(`${baseUrl}/api/schemas`, {
        headers: { "X-API-Key": apiKey },
      });
      expect(res.status).toBe(400);
    });

    it("rejects DELETE /api/schemas/:name without pageName with 400", async () => {
      const res = await fetch(`${baseUrl}/api/schemas/some-schema`, {
        method: "DELETE",
        headers: { "X-API-Key": apiKey },
      });
      expect(res.status).toBe(400);
    });

    it("rejects POST /api/schemas without fields", async () => {
      const res = await fetch(`${baseUrl}/api/schemas`, {
        method: "POST",
        headers: { "X-API-Key": apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({ pageName: "test", name: "noschema" }),
      });
      expect(res.status).toBe(400);
    });
  });
});
