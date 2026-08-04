import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { createTestServer, getAppUrl, createTestPage } from "./helpers.js";
import type { FastifyInstance } from "fastify";
import { BOOTSTRAP_USER_ID } from "../../src/lib/meta-sqlite.js";
import fs from "node:fs";
import path from "node:path";
import { SlidingWindowRateLimiter } from "../../src/lib/notify-rate-limit.js";

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

describe("notify rate limiter（单元：SlidingWindowRateLimiter）", () => {
  let limiter: SlidingWindowRateLimiter;
  let now: number;

  beforeEach(() => {
    now = 1_000_000;
    limiter = new SlidingWindowRateLimiter({
      minuteLimit: 10,
      hourLimit: 100,
      now: () => now,
    });
  });

  it("1 分钟内 10 次请求全部允许，第 11 次拒绝", () => {
    for (let i = 0; i < 10; i++) {
      const r = limiter.check("app-1");
      expect(r.allowed).toBe(true);
    }
    const r = limiter.check("app-1");
    expect(r.allowed).toBe(false);
    expect(r.retryAfterSec).toBeGreaterThan(0);
  });

  it("1 小时内 100 次请求全部允许，第 101 次拒绝", () => {
    // 模拟每分钟打 10 次，共 10 分钟（100 次）
    for (let m = 0; m < 10; m++) {
      now = 1_000_000 + m * 60_000;
      for (let i = 0; i < 10; i++) {
        const r = limiter.check("app-2");
        expect(r.allowed).toBe(true);
      }
    }
    // 第 101 次（仍在 1 小时内）
    const r = limiter.check("app-2");
    expect(r.allowed).toBe(false);
  });

  it("窗口过后允许再次请求", () => {
    for (let i = 0; i < 10; i++) limiter.check("app-3");
    expect(limiter.check("app-3").allowed).toBe(false);
    // 推进 61 秒，旧记录出窗
    now += 61_000;
    expect(limiter.check("app-3").allowed).toBe(true);
  });

  it("不同 app 互不影响", () => {
    for (let i = 0; i < 10; i++) limiter.check("app-a");
    expect(limiter.check("app-a").allowed).toBe(false);
    expect(limiter.check("app-b").allowed).toBe(true);
  });
});

describe("notify rate limit（端点）", () => {
  let app: FastifyInstance;
  let baseUrl: string;
  let baseUrlHost: string;
  let dataDir: string;
  let stop: () => Promise<void>;
  const owner = BOOTSTRAP_USER_ID;
  const pageName = "notify-rate-app";
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

  async function postNotify() {
    return fetch(`${baseUrl}/serve/${owner}/${pageName}/api/notify`, {
      method: "POST",
      headers: {
        "Cookie": adminCookie,
        "Content-Type": "application/json",
        "Referer": `http://${baseUrlHost}/${owner}/${pageName}/page`,
      },
      body: JSON.stringify({ title: "x" }),
    });
  }

  it("1 分钟内第 11 次请求返回 429 + Retry-After 头", async () => {
    for (let i = 0; i < 10; i++) {
      const res = await postNotify();
      expect(res.status).not.toBe(429);
    }
    const blocked = await postNotify();
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toBeTruthy();
    const json = await blocked.json();
    expect(json.error).toMatch(/rate|too many/i);
  });
});
