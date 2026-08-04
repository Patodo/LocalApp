import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestServer, getAppUrl } from "./helpers.js";
import { registerAndLogin } from "../helpers/createUser.js";
import { insertPageViews } from "../../src/lib/meta-sqlite.js";
import type { FastifyInstance } from "fastify";

describe("recent-visits-api", () => {
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

  describe("GET /api/me/recent", () => {
    it("should return recent visits sorted by most recent first", async () => {
      const cookie = await registerAndLogin(baseUrl, "recentuser1");
      insertPageViews([
        { pagePath: "/owner/app-alpha", visitorId: "recentuser1", userId: "recentuser1" },
        { pagePath: "/owner/app-beta", visitorId: "recentuser1", userId: "recentuser1" },
      ]);

      const res = await fetch(`${baseUrl}/api/me/recent`, { headers: { Cookie: cookie } });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data.length).toBeGreaterThanOrEqual(2);
    });

    it("should deduplicate — visiting same page multiple times returns one entry", async () => {
      const cookie = await registerAndLogin(baseUrl, "recentuser2");
      insertPageViews([
        { pagePath: "/recentuser2/dedup-app", visitorId: "recentuser2", userId: "recentuser2" },
        { pagePath: "/recentuser2/dedup-app", visitorId: "recentuser2", userId: "recentuser2" },
        { pagePath: "/recentuser2/dedup-app", visitorId: "recentuser2", userId: "recentuser2" },
      ]);

      const res = await fetch(`${baseUrl}/api/me/recent`, { headers: { Cookie: cookie } });
      const data = await res.json();
      const entries = data.data.filter((e: { pagePath: string }) => e.pagePath.includes("dedup-app"));
      expect(entries.length).toBe(1);
    });

    it("should return empty array for user with no visits", async () => {
      const cookie = await registerAndLogin(baseUrl, "recentuser3");
      const res = await fetch(`${baseUrl}/api/me/recent`, { headers: { Cookie: cookie } });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data).toEqual([]);
    });

    it("should respect limit parameter", async () => {
      const cookie = await registerAndLogin(baseUrl, "recentuser4");
      for (let i = 0; i < 5; i++) {
        insertPageViews([
          { pagePath: `/recentuser4/limit-app-${i}`, visitorId: "recentuser4", userId: "recentuser4" },
        ]);
      }
      const res = await fetch(`${baseUrl}/api/me/recent?limit=2`, { headers: { Cookie: cookie } });
      const data = await res.json();
      expect(data.data.length).toBeLessThanOrEqual(2);
    });

    it("should return 401 without session", async () => {
      const res = await fetch(`${baseUrl}/api/me/recent`);
      expect(res.status).toBe(401);
    });
  });
});
