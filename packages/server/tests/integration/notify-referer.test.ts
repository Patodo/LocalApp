import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestServer, getAppUrl, createTestPage } from "./helpers.js";
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

describe("notify Referer 跨 app 冒用防护（spec: 跨 app 冒用防护）", () => {
  let app: FastifyInstance;
  let baseUrl: string;
  let baseUrlHost: string;
  let dataDir: string;
  let stop: () => Promise<void>;
  const owner = BOOTSTRAP_USER_ID;
  const pageName = "notify-referer-app";
  let adminCookie: string;

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

    await forceChangePassword(baseUrl, BOOTSTRAP_USER_ID, "localadmin", "test123456");
    adminCookie = await loginAndGetCookie(baseUrl, BOOTSTRAP_USER_ID, "test123456");
  });

  afterAll(async () => { await stop(); });

  async function postNotify(referer: string | null, body: unknown = { title: "x" }) {
    const headers: Record<string, string> = {
      "Cookie": adminCookie,
      "Content-Type": "application/json",
    };
    if (referer !== null) headers["Referer"] = referer;
    return fetch(`${baseUrl}/serve/${owner}/${pageName}/api/notify`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
  }

  it("Referer 来自同 app 页面（/{owner}/{app}/...）通过校验（不返回 403）", async () => {
    const referer = `http://${baseUrlHost}/${owner}/${pageName}/tasks/123`;
    const res = await postNotify(referer);
    expect(res.status).not.toBe(403);
  });

  it("Referer 来自其他 app 返回 403", async () => {
    const referer = `http://${baseUrlHost}/bob/other-app/page`;
    const res = await postNotify(referer);
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toMatch(/referer|app/i);
  });

  it("Referer 缺失返回 403", async () => {
    const res = await postNotify(null);
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toMatch(/referer/i);
  });

  it("Referer 来自非 LocalApp 域（不同 host）返回 403", async () => {
    const referer = `http://evil.com/${owner}/${pageName}/page`;
    const res = await postNotify(referer);
    expect(res.status).toBe(403);
  });

  it("Referer host 匹配但路径不以 /{owner}/{app}/ 开头返回 403", async () => {
    const referer = `http://${baseUrlHost}/some-other-path`;
    const res = await postNotify(referer);
    expect(res.status).toBe(403);
  });
});
