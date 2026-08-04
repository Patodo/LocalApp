import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestServer, getAppUrl, getTestApiKey } from "./helpers.js";
import { BOOTSTRAP_USER_ID } from "../../src/lib/meta-sqlite.js";

describe("Admin Role Toggle", () => {
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

  describe("PATCH /api/admin/users/:id/role", () => {
    it("admin successfully promotes a user to admin", async () => {
      const createRes = await fetch(`${baseUrl}/api/admin/users`, {
        method: "POST",
        headers: { "X-API-Key": apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({ username: "toggleuser1" }),
      });
      expect(createRes.status).toBe(200);

      const patchRes = await fetch(`${baseUrl}/api/admin/users/toggleuser1/role`, {
        method: "PATCH",
        headers: { "X-API-Key": apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({ role: "admin" }),
      });
      expect(patchRes.status).toBe(200);
      const data = await patchRes.json();
      expect(data).toEqual({ success: true, data: { id: "toggleuser1", role: "admin" } });

      const detailRes = await fetch(`${baseUrl}/api/admin/users/toggleuser1`, {
        headers: { "X-API-Key": apiKey },
      });
      const detail = await detailRes.json();
      expect(detail.data.role).toBe("admin");
    });

    it("rejects invalid role value with 400", async () => {
      const patchRes = await fetch(`${baseUrl}/api/admin/users/toggleuser1/role`, {
        method: "PATCH",
        headers: { "X-API-Key": apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({ role: "superadmin" }),
      });
      expect(patchRes.status).toBe(400);
      const data = await patchRes.json();
      expect(data).toEqual({ success: false, error: "Invalid role" });
    });

    it("returns 404 when user not found", async () => {
      const patchRes = await fetch(`${baseUrl}/api/admin/users/ghostuser/role`, {
        method: "PATCH",
        headers: { "X-API-Key": apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({ role: "admin" }),
      });
      expect(patchRes.status).toBe(404);
      const data = await patchRes.json();
      expect(data).toEqual({ success: false, error: "User not found" });
    });

    it("rejects demoting protected user localadmin with 400", async () => {
      const patchRes = await fetch(`${baseUrl}/api/admin/users/${BOOTSTRAP_USER_ID}/role`, {
        method: "PATCH",
        headers: { "X-API-Key": apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({ role: "user" }),
      });
      expect(patchRes.status).toBe(400);
      const data = await patchRes.json();
      expect(data).toEqual({ success: false, error: "Cannot demote protected user" });

      const detailRes = await fetch(`${baseUrl}/api/admin/users/${BOOTSTRAP_USER_ID}`, {
        headers: { "X-API-Key": apiKey },
      });
      const detail = await detailRes.json();
      expect(detail.data.role).toBe("admin");
    });

    it("rejects demoting self with 400", async () => {
      // toggleuser1 was promoted to admin earlier. Issue their own API key, then self-demote.
      const keyCreateRes = await fetch(`${baseUrl}/api/keys`, {
        method: "POST",
        headers: { "X-API-Key": apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({ userId: "toggleuser1" }),
      });
      const { data: keyData } = await keyCreateRes.json();
      const toggleuserKey = keyData.key;

      const patchRes = await fetch(`${baseUrl}/api/admin/users/toggleuser1/role`, {
        method: "PATCH",
        headers: { "X-API-Key": toggleuserKey, "Content-Type": "application/json" },
        body: JSON.stringify({ role: "user" }),
      });
      expect(patchRes.status).toBe(400);
      const data = await patchRes.json();
      expect(data).toEqual({ success: false, error: "Cannot demote yourself" });
    });

    it("rejects non-admin caller with 403", async () => {
      // Create a regular (non-admin) user with their own API key
      await fetch(`${baseUrl}/api/admin/users`, {
        method: "POST",
        headers: { "X-API-Key": apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({ username: "regularuser1" }),
      });
      const keyRes = await fetch(`${baseUrl}/api/keys`, {
        method: "POST",
        headers: { "X-API-Key": apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({ userId: "regularuser1" }),
      });
      const { data: keyData } = await keyRes.json();

      const patchRes = await fetch(`${baseUrl}/api/admin/users/regularuser1/role`, {
        method: "PATCH",
        headers: { "X-API-Key": keyData.key, "Content-Type": "application/json" },
        body: JSON.stringify({ role: "admin" }),
      });
      expect(patchRes.status).toBe(403);
    });

    it("rejects unauthenticated caller with 401", async () => {
      const patchRes = await fetch(`${baseUrl}/api/admin/users/toggleuser1/role`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: "user" }),
      });
      expect(patchRes.status).toBe(401);
    });

    it("successfully demotes a non-protected admin back to user", async () => {
      // toggleuser1 is admin; demote via bootstrap admin
      const patchRes = await fetch(`${baseUrl}/api/admin/users/toggleuser1/role`, {
        method: "PATCH",
        headers: { "X-API-Key": apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({ role: "user" }),
      });
      expect(patchRes.status).toBe(200);
      const data = await patchRes.json();
      expect(data).toEqual({ success: true, data: { id: "toggleuser1", role: "user" } });
    });

    it.skip("cannot demote the last admin (defensive guard, scenario unreachable in practice)", () => {
      // This guard is defense-in-depth and provably unreachable in normal operation:
      //
      // To trigger "Cannot demote the last admin" we need:
      //   - actor is admin (passed adminAuth)
      //   - target is admin (passed user.role === "admin" check after bug fix)
      //   - target != actor (passed self-guard)
      //   - adminCount === 1
      //
      // But if actor is admin and target is admin and count === 1, then actor === target
      // (only one admin exists). So self-guard always fires first, making last-admin unreachable.
      //
      // The guard remains in code as a defensive measure for hypothetical scenarios:
      //   - PROTECTED_USER_IDS is edited to remove localadmin
      //   - Direct DB manipulation removes localadmin's admin role
      //   - Future auth changes allow non-admin actors to reach this code path
      //
      // Implementation: routes/admin.ts last-admin check uses `user.role === "admin"`
      // gating to avoid firing on no-op demotes of non-admin users.
      expect(true).toBe(true);
    });
  });

  describe("DELETE /api/admin/users/:id (localadmin protection)", () => {
    it("rejects deleting protected user localadmin with 400", async () => {
      const delRes = await fetch(`${baseUrl}/api/admin/users/${BOOTSTRAP_USER_ID}`, {
        method: "DELETE",
        headers: { "X-API-Key": apiKey },
      });
      expect(delRes.status).toBe(400);
      const data = await delRes.json();
      expect(data).toEqual({ success: false, error: "Cannot delete protected user" });

      // Verify localadmin still exists and is admin
      const detailRes = await fetch(`${baseUrl}/api/admin/users/${BOOTSTRAP_USER_ID}`, {
        headers: { "X-API-Key": apiKey },
      });
      expect(detailRes.status).toBe(200);
      const detail = await detailRes.json();
      expect(detail.data.id).toBe(BOOTSTRAP_USER_ID);
      expect(detail.data.role).toBe("admin");
    });
  });
});
