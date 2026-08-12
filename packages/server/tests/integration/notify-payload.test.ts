import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestServer, getAppUrl, createTestPage } from "./helpers.js";
import type { FastifyInstance } from "fastify";
import { BOOTSTRAP_USER_ID } from "../../src/lib/meta-sqlite.js";
import fs from "node:fs";
import path from "node:path";
import { validateRelativeUrl } from "../../src/lib/notify-payload.js";

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

describe("notify payload 校验（spec: 通知 payload 校验）", () => {
  let app: FastifyInstance;
  let baseUrl: string;
  let baseUrlHost: string;
  let dataDir: string;
  let stop: () => Promise<void>;
  const owner = BOOTSTRAP_USER_ID;
  const pageName = "notify-payload-app";
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

  async function postNotify(body: unknown) {
    return fetch(`${baseUrl}/serve/${owner}/${pageName}/api/notify`, {
      method: "POST",
      headers: {
        "Cookie": adminCookie,
        "Content-Type": "application/json",
        "Referer": `http://${baseUrlHost}/${owner}/${pageName}/page`,
      },
      body: JSON.stringify(body),
    });
  }

  it("缺 title 返回 400", async () => {
    const res = await postNotify({ body: "no title" });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error).toMatch(/title/i);
  });

  it("title 为空字符串返回 400", async () => {
    const res = await postNotify({ title: "" });
    expect(res.status).toBe(400);
  });

  it("url 为绝对 URL（https://）返回 400", async () => {
    const res = await postNotify({ title: "x", url: "https://evil.com/phish" });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/url|relative/i);
  });

  it("url 为协议相对（//）返回 400", async () => {
    const constres = await postNotify({ title: "x", url: "//evil.com" });
    expect(constres.status).toBe(400);
  });

  it.each([
    "/\\\\evil.example/x",
    "/safe\\evil",
    "/%2fevil.example/x",
    "/%2Fevil.example/x",
    "/%5cevil.example/x",
    "/%5Cevil.example/x",
    "/safe%00path",
    "/safe\u0009path",
    "/%2e%2e//evil.example/x",
    "/..//evil.example/x",
    "///user:pass@evil.example/x",
    "/\\user:pass@evil.example/x",
  ])("拒绝会跨源或经正规化形成危险目标的 url %j", (url) => {
    expect(validateRelativeUrl(url)).toBe(false);
  });

  it("合法相对路径 url 通过校验（不返回 400）", async () => {
    const res = await postNotify({ title: "x", url: "/alice/leave-app/tasks/123" });
    expect(res.status).not.toBe(400);
  });

  it("priority 默认 normal（不指定 priority 时不返回 400）", async () => {
    const res = await postNotify({ title: "x" });
    expect(res.status).not.toBe(400);
  });

  it("priority 非法值返回 400", async () => {
    const res = await postNotify({ title: "x", priority: "urgent" });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/priority/i);
  });

  it("to 字段为非数组类型返回 400", async () => {
    const res = await postNotify({ title: "x", to: "bob" });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/to/i);
  });
});
