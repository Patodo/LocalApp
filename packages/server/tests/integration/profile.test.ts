import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestServer, getAppUrl, getTestApiKey } from "./helpers.js";
import { registerAndLogin } from "../helpers/createUser.js";
import { updateUserRole } from "../../src/lib/meta-sqlite.js";
import type { FastifyInstance } from "fastify";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const TEST_PASSWORD = "test123456";

function extractTokenCookie(response: Response): string {
  return (response.headers.getSetCookie().find((cookie) => cookie.startsWith("token=")) || "").split(";")[0];
}

function makePngBuffer(size: number): Buffer {
  // Minimal valid PNG: 8-byte signature + IHDR + IEND
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(25);
  ihdr.writeUInt32BE(13, 0); // length
  ihdr.write("IHDR", 4);
  ihdr.writeUInt32BE(1, 8);  // width
  ihdr.writeUInt32BE(1, 12); // height
  ihdr[16] = 8; // bit depth
  ihdr[17] = 2; // color type (RGB)
  // Pad to desired size
  if (size <= sig.length + ihdr.length) return Buffer.concat([sig, ihdr]);
  return Buffer.concat([sig, ihdr, Buffer.alloc(size - sig.length - ihdr.length)]);
}

describe("user-profile-api", () => {
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

  // --- PUT /api/me/profile ---
  describe("PUT /api/me/profile", () => {
    it("should update display name and bio", async () => {
      const cookie = await registerAndLogin(baseUrl, "profileuser1");
      const res = await fetch(`${baseUrl}/api/me/profile`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ displayName: "张三", bio: "全栈开发者" }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data.displayName).toBe("张三");
      expect(data.data.bio).toBe("全栈开发者");
    });

    it("should update only display name", async () => {
      const cookie = await registerAndLogin(baseUrl, "profileuser2");
      await fetch(`${baseUrl}/api/me/profile`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ displayName: "昵称" }),
      });
      const res = await fetch(`${baseUrl}/api/me/profile`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ bio: "新的简介" }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.displayName).toBe("昵称");
      expect(data.data.bio).toBe("新的简介");
    });

    it("should reject display name longer than 32 chars", async () => {
      const cookie = await registerAndLogin(baseUrl, "profileuser3");
      const res = await fetch(`${baseUrl}/api/me/profile`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ displayName: "a".repeat(33) }),
      });
      expect(res.status).toBe(400);
    });

    it("should reject empty display name", async () => {
      const cookie = await registerAndLogin(baseUrl, "profileuser3b");
      const res = await fetch(`${baseUrl}/api/me/profile`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ displayName: "" }),
      });
      expect(res.status).toBe(400);
    });

    it("should return 401 without session", async () => {
      const res = await fetch(`${baseUrl}/api/me/profile`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: "test" }),
      });
      expect(res.status).toBe(401);
    });
  });

  // --- PUT /api/me/password ---
  describe("PUT /api/me/password", () => {
    it("should change password with correct old password", async () => {
      const firstCookie = await registerAndLogin(baseUrl, "pwuser1");
      const secondLogin = await fetch(`${baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "pwuser1", password: TEST_PASSWORD }),
      });
      const secondCookie = extractTokenCookie(secondLogin);

      const res = await fetch(`${baseUrl}/api/me/password`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Cookie: firstCookie },
        body: JSON.stringify({ oldPassword: TEST_PASSWORD, newPassword: "newpass123" }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);

      const replacementCookie = extractTokenCookie(res);
      expect(replacementCookie).toContain("token=");
      for (const oldCookie of [firstCookie, secondCookie]) {
        const meRes = await fetch(`${baseUrl}/api/me`, { headers: { Cookie: oldCookie } });
        expect((await meRes.json()).data).toBeNull();
      }
      const replacementMe = await fetch(`${baseUrl}/api/me`, { headers: { Cookie: replacementCookie } });
      expect((await replacementMe.json()).data.id).toBe("pwuser1");
    });

    it("should reject incorrect old password", async () => {
      const cookie = await registerAndLogin(baseUrl, "pwuser2");
      const res = await fetch(`${baseUrl}/api/me/password`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ oldPassword: "wrongpass", newPassword: "newpass123" }),
      });
      expect(res.status).toBe(401);
    });

    it("should reject new password shorter than 6 chars", async () => {
      const cookie = await registerAndLogin(baseUrl, "pwuser3");
      const res = await fetch(`${baseUrl}/api/me/password`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ oldPassword: TEST_PASSWORD, newPassword: "12345" }),
      });
      expect(res.status).toBe(400);
    });

    // Spec: Admin 管理操作不再限制 provider — admin 可自行修改密码（无 provider 拒绝）
    it("should allow admin to change own password (no provider rejection)", async () => {
      const adminCookie = await registerAndLogin(baseUrl, "profileadmin");
      updateUserRole("profileadmin", "admin");

      // Wrong old password still returns 401 (proving endpoint accepts admin session)
      const res = await fetch(`${baseUrl}/api/me/password`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Cookie: adminCookie },
        body: JSON.stringify({ oldPassword: "any", newPassword: "newpass123" }),
      });
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.error).toContain("Incorrect current password");
    });

    it("should return 401 without session", async () => {
      const res = await fetch(`${baseUrl}/api/me/password`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ oldPassword: "old", newPassword: "newpass123" }),
      });
      expect(res.status).toBe(401);
    });
  });

  // --- POST /api/me/avatar ---
  describe("POST /api/me/avatar", () => {
    it("should upload avatar", async () => {
      const cookie = await registerAndLogin(baseUrl, "avataruser1");
      const formData = new FormData();
      const pngBuffer = makePngBuffer(100);
      formData.append("avatar", new Blob([pngBuffer], { type: "image/png" }), "avatar.png");

      const res = await fetch(`${baseUrl}/api/me/avatar`, {
        method: "POST",
        headers: { Cookie: cookie },
        body: formData,
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data.avatarUrl).toBe("/api/avatar/avataruser1");
    });

    it("should reject file larger than 2MB", async () => {
      const cookie = await registerAndLogin(baseUrl, "avataruser2");
      const formData = new FormData();
      const bigBuffer = Buffer.alloc(3 * 1024 * 1024);
      formData.append("avatar", new Blob([bigBuffer], { type: "image/png" }), "big.png");

      const res = await fetch(`${baseUrl}/api/me/avatar`, {
        method: "POST",
        headers: { Cookie: cookie },
        body: formData,
      });
      expect(res.status).toBe(413);
    });

    it("should reject unsupported format", async () => {
      const cookie = await registerAndLogin(baseUrl, "avataruser3");
      const formData = new FormData();
      formData.append("avatar", new Blob(["not an image"], { type: "image/gif" }), "avatar.gif");

      const res = await fetch(`${baseUrl}/api/me/avatar`, {
        method: "POST",
        headers: { Cookie: cookie },
        body: formData,
      });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("JPG");
    });

    it("should replace old avatar", async () => {
      const cookie = await registerAndLogin(baseUrl, "avataruser4");

      // Upload PNG first
      const form1 = new FormData();
      form1.append("avatar", new Blob([makePngBuffer(100)], { type: "image/png" }), "a.png");
      await fetch(`${baseUrl}/api/me/avatar`, { method: "POST", headers: { Cookie: cookie }, body: form1 });

      // Upload JPG to replace
      const form2 = new FormData();
      const jpgBuf = Buffer.from([0xff, 0xd8, 0xff, 0xe0, ...Buffer.alloc(100)]);
      form2.append("avatar", new Blob([jpgBuf], { type: "image/jpeg" }), "b.jpg");
      const res = await fetch(`${baseUrl}/api/me/avatar`, { method: "POST", headers: { Cookie: cookie }, body: form2 });
      expect(res.status).toBe(200);
    });

    it("should return 401 without session", async () => {
      const formData = new FormData();
      formData.append("avatar", new Blob([makePngBuffer(50)], { type: "image/png" }), "a.png");
      const res = await fetch(`${baseUrl}/api/me/avatar`, { method: "POST", body: formData });
      expect(res.status).toBe(401);
    });
  });

  // --- GET /api/me/avatar ---
  describe("GET /api/me/avatar", () => {
    it("should return avatar for user with avatar", async () => {
      const cookie = await registerAndLogin(baseUrl, "getavatar1");
      const formData = new FormData();
      formData.append("avatar", new Blob([makePngBuffer(100)], { type: "image/png" }), "avatar.png");
      await fetch(`${baseUrl}/api/me/avatar`, { method: "POST", headers: { Cookie: cookie }, body: formData });

      const res = await fetch(`${baseUrl}/api/me/avatar`, { headers: { Cookie: cookie } });
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("image/png");
    });

    it("should return 404 for user without avatar", async () => {
      const cookie = await registerAndLogin(baseUrl, "getavatar2");
      const res = await fetch(`${baseUrl}/api/me/avatar`, { headers: { Cookie: cookie } });
      expect(res.status).toBe(404);
    });
  });

  // --- GET /api/avatar/:userId ---
  describe("GET /api/avatar/:userId", () => {
    it("should return avatar without authentication", async () => {
      const cookie = await registerAndLogin(baseUrl, "publicavatar1");
      const formData = new FormData();
      formData.append("avatar", new Blob([makePngBuffer(100)], { type: "image/png" }), "avatar.png");
      await fetch(`${baseUrl}/api/me/avatar`, { method: "POST", headers: { Cookie: cookie }, body: formData });

      const res = await fetch(`${baseUrl}/api/avatar/publicavatar1`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("image/png");
    });

    it("should return 404 for non-existent user", async () => {
      const res = await fetch(`${baseUrl}/api/avatar/nonexistent`);
      expect(res.status).toBe(404);
    });
  });

  // --- GET /api/me extended fields ---
  describe("GET /api/me — extended fields", () => {
    it("should return displayName, avatarUrl, bio", async () => {
      const cookie = await registerAndLogin(baseUrl, "meuser1");
      await fetch(`${baseUrl}/api/me/profile`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ displayName: "显示名", bio: "简介" }),
      });

      const res = await fetch(`${baseUrl}/api/me`, { headers: { Cookie: cookie } });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.displayName).toBe("显示名");
      expect(data.data.bio).toBe("简介");
      expect(data.data.avatarUrl).toBeNull();
    });

    it("should return null fields for new user", async () => {
      const cookie = await registerAndLogin(baseUrl, "meuser2");
      const res = await fetch(`${baseUrl}/api/me`, { headers: { Cookie: cookie } });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.displayName).toBeNull();
      expect(data.data.avatarUrl).toBeNull();
      expect(data.data.bio).toBeNull();
    });
  });

  // --- Unauthenticated access ---
  describe("Unauthenticated profile access", () => {
    it("should return 401 for PUT /api/me/profile", async () => {
      const res = await fetch(`${baseUrl}/api/me/profile`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: "test" }),
      });
      expect(res.status).toBe(401);
    });

    it("should return 401 for PUT /api/me/password", async () => {
      const res = await fetch(`${baseUrl}/api/me/password`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ oldPassword: "a", newPassword: "b" }),
      });
      expect(res.status).toBe(401);
    });

    it("should return 401 for POST /api/me/avatar without login", async () => {
      const formData = new FormData();
      formData.append("avatar", new Blob([makePngBuffer(50)], { type: "image/png" }), "a.png");
      const res = await fetch(`${baseUrl}/api/me/avatar`, { method: "POST", body: formData });
      expect(res.status).toBe(401);
    });
  });
});
