import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestServer, getAppUrl, getTestApiKey, createTestPage, registerUser } from "./helpers.js";
import type { FastifyInstance } from "fastify";
import { BOOTSTRAP_USER_ID } from "../../src/lib/meta-sqlite.js";
import fs from "node:fs";
import path from "node:path";

async function loginAndGetCookie(baseUrl: string, username: string, password: string): Promise<string> {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) throw new Error(`login ${username} failed: ${await res.text()}`);
  const setCookie = res.headers.get("set-cookie");
  if (!setCookie) throw new Error(`no set-cookie for ${username}`);
  const tokenMatch = setCookie.match(/token=([^;]+)/);
  if (!tokenMatch) throw new Error(`no token in set-cookie: ${setCookie}`);
  return `token=${tokenMatch[1]}`;
}

async function forceChangePassword(baseUrl: string, userId: string, oldPassword: string, newPassword: string): Promise<void> {
  const res = await fetch(`${baseUrl}/api/auth/force-change-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId, oldPassword, newPassword }),
  });
  if (!res.ok) throw new Error(`force-change-password ${userId} failed: ${await res.text()}`);
}

describe("notify 权限 Level 1（owner-only，spec: Level 1 权限）", () => {
  let app: FastifyInstance;
  let baseUrl: string;
  let baseUrlHost: string;
  let dataDir: string;
  let stop: () => Promise<void>;
  const adminApiKey = getTestApiKey();
  const owner = BOOTSTRAP_USER_ID;
  const pageName = "notify-perm-l1-app";
  let adminCookie: string;
  let bobCookie: string;

  beforeAll(async () => {
    const server = await createTestServer();
    app = server.app;
    baseUrl = getAppUrl(app);
    baseUrlHost = new URL(baseUrl).host;
    dataDir = server.dataDir;
    stop = server.stop;

    await createTestPage(app, owner, pageName);
    fs.writeFileSync(
      path.join(dataDir, owner, pageName, "meta.json"),
      JSON.stringify({
        name: pageName,
        userId: owner,
        description: "",
        currentVersion: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        versions: [],
        metadata: {},
        notify: { enabled: true },
      }),
    );

    // Force-change admin password (initMetaDb sets must_change_password=1)
    await forceChangePassword(baseUrl, BOOTSTRAP_USER_ID, "localadmin", "test123456");
    adminCookie = await loginAndGetCookie(baseUrl, BOOTSTRAP_USER_ID, "test123456");

    await registerUser(baseUrl, "bob");
    bobCookie = await loginAndGetCookie(baseUrl, "bob", "test123456");
  });

  afterAll(async () => { await stop(); });

  async function postNotify(cookie: string | null, body: unknown = { title: "x" }) {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Referer": `http://${baseUrlHost}/${owner}/${pageName}/page`,
    };
    if (cookie) headers["Cookie"] = cookie;
    return fetch(`${baseUrl}/serve/${owner}/${pageName}/api/notify`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
  }

  it("owner 调用 notify 通过权限校验（不返回 401/403）", async () => {
    const res = await postNotify(adminCookie);
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });

  it("非 owner 已登录调 notify 返回 403", async () => {
    const res = await postNotify(bobCookie);
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toMatch(/permission|owner|forbidden|only/i);
  });

  it("未登录用户调 notify 返回 401", async () => {
    const res = await postNotify(null);
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toMatch(/auth/i);
  });
});
