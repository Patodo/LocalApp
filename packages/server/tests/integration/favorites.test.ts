import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestServer, getAppUrl } from "./helpers.js";
import { registerAndLogin } from "../helpers/createUser.js";
import type { FastifyInstance } from "fastify";

describe("favorites-api", () => {
  let app: FastifyInstance;
  let baseUrl: string;
  let stop: () => Promise<void>;

  beforeAll(async () => {
    const server = await createTestServer();
    app = server.app;
    baseUrl = getAppUrl(app);
    stop = server.stop;
  });

  afterAll(async () => {
    await stop();
  });

  // --- POST /api/favorites ---
  describe("POST /api/favorites — add favorite", () => {
    it("should add a favorite", async () => {
      const cookie = await registerAndLogin(baseUrl, "favuser1");
      const res = await fetch(`${baseUrl}/api/favorites`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ pagePath: "owner/myapp", pageName: "My App", ownerName: "owner" }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data.favorited).toBe(true);
    });

    it("should be idempotent — adding same favorite twice does not error", async () => {
      const cookie = await registerAndLogin(baseUrl, "favuser2");
      await fetch(`${baseUrl}/api/favorites`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ pagePath: "owner/app1" }),
      });
      const res = await fetch(`${baseUrl}/api/favorites`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ pagePath: "owner/app1" }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
    });

    it("should return 400 without pagePath", async () => {
      const cookie = await registerAndLogin(baseUrl, "favuser3");
      const res = await fetch(`${baseUrl}/api/favorites`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
    });

    it("should return 401 without session", async () => {
      const res = await fetch(`${baseUrl}/api/favorites`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pagePath: "owner/app" }),
      });
      expect(res.status).toBe(401);
    });
  });

  // --- DELETE /api/favorites/:pagePath ---
  describe("DELETE /api/favorites/:pagePath — remove favorite", () => {
    it("should remove an existing favorite", async () => {
      const cookie = await registerAndLogin(baseUrl, "favuser4");
      await fetch(`${baseUrl}/api/favorites`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ pagePath: "owner/delapp" }),
      });
      const res = await fetch(`${baseUrl}/api/favorites/owner%2Fdelapp`, {
        method: "DELETE",
        headers: { Cookie: cookie },
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.favorited).toBe(false);

      // Verify it's actually removed
      const checkRes = await fetch(`${baseUrl}/api/favorites/check?pagePath=${encodeURIComponent("owner/delapp")}`, {
        headers: { Cookie: cookie },
      });
      const checkData = await checkRes.json();
      expect(checkData.data.favorited).toBe(false);
    });

    it("should return 401 without session", async () => {
      const res = await fetch(`${baseUrl}/api/favorites/owner%2Fapp`, { method: "DELETE" });
      expect(res.status).toBe(401);
    });
  });

  // --- GET /api/favorites/check ---
  describe("GET /api/favorites/check — check if favorited", () => {
    it("should return true after adding favorite", async () => {
      const cookie = await registerAndLogin(baseUrl, "favuser5");
      await fetch(`${baseUrl}/api/favorites`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ pagePath: "owner/checkapp" }),
      });
      const res = await fetch(`${baseUrl}/api/favorites/check?pagePath=${encodeURIComponent("owner/checkapp")}`, {
        headers: { Cookie: cookie },
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.favorited).toBe(true);
    });

    it("should return false for non-favorited page", async () => {
      const cookie = await registerAndLogin(baseUrl, "favuser6");
      const res = await fetch(`${baseUrl}/api/favorites/check?pagePath=${encodeURIComponent("owner/notfav")}`, {
        headers: { Cookie: cookie },
      });
      const data = await res.json();
      expect(data.data.favorited).toBe(false);
    });

    it("should return false without session (no error)", async () => {
      const res = await fetch(`${baseUrl}/api/favorites/check?pagePath=${encodeURIComponent("owner/app")}`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.favorited).toBe(false);
    });

    it("should return 400 without pagePath", async () => {
      const res = await fetch(`${baseUrl}/api/favorites/check`);
      expect(res.status).toBe(400);
    });
  });

  // --- GET /api/favorites/count ---
  describe("GET /api/favorites/count — get favorite count", () => {
    it("should return count for a page", async () => {
      const cookie1 = await registerAndLogin(baseUrl, "countuser1");
      const cookie2 = await registerAndLogin(baseUrl, "countuser2");
      await fetch(`${baseUrl}/api/favorites`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie1 },
        body: JSON.stringify({ pagePath: "owner/countapp" }),
      });
      await fetch(`${baseUrl}/api/favorites`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie2 },
        body: JSON.stringify({ pagePath: "owner/countapp" }),
      });
      const res = await fetch(`${baseUrl}/api/favorites/count?pagePath=${encodeURIComponent("owner/countapp")}`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.count).toBe(2);
    });

    it("should return 0 for page with no favorites", async () => {
      const res = await fetch(`${baseUrl}/api/favorites/count?pagePath=${encodeURIComponent("owner/nofavs")}`);
      const data = await res.json();
      expect(data.data.count).toBe(0);
    });

    it("should return 400 without pagePath", async () => {
      const res = await fetch(`${baseUrl}/api/favorites/count`);
      expect(res.status).toBe(400);
    });
  });

  // --- GET /api/me/favorites ---
  describe("GET /api/me/favorites — list user favorites", () => {
    it("should list user's favorites", async () => {
      const cookie = await registerAndLogin(baseUrl, "listuser1");
      await fetch(`${baseUrl}/api/favorites`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ pagePath: "own1/app1", pageName: "App 1" }),
      });
      await fetch(`${baseUrl}/api/favorites`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ pagePath: "own2/app2", pageName: "App 2" }),
      });
      const res = await fetch(`${baseUrl}/api/me/favorites`, { headers: { Cookie: cookie } });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data.length).toBe(2);
    });

    it("should respect limit parameter", async () => {
      const cookie = await registerAndLogin(baseUrl, "listuser2");
      for (let i = 0; i < 5; i++) {
        await fetch(`${baseUrl}/api/favorites`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Cookie: cookie },
          body: JSON.stringify({ pagePath: `own/app${i}` }),
        });
      }
      const res = await fetch(`${baseUrl}/api/me/favorites?limit=2`, { headers: { Cookie: cookie } });
      const data = await res.json();
      expect(data.data.length).toBe(2);
    });

    it("should return empty array for user with no favorites", async () => {
      const cookie = await registerAndLogin(baseUrl, "listuser3");
      const res = await fetch(`${baseUrl}/api/me/favorites`, { headers: { Cookie: cookie } });
      const data = await res.json();
      expect(data.data).toEqual([]);
    });

    it("should return 401 without session", async () => {
      const res = await fetch(`${baseUrl}/api/me/favorites`);
      expect(res.status).toBe(401);
    });
  });
});
