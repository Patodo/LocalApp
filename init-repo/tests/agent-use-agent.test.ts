import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import { parseAppName, fetchUser } from "@localapp/sdk-agent";

describe("parseAppName", () => {
  const originalLocation = window.location;

  function setPathname(pathname: string) {
    Object.defineProperty(globalThis, "window", {
      value: { location: { origin: "http://localhost:3000", pathname } },
      writable: true,
      configurable: true,
    });
  }

  afterEach(() => {
    Object.defineProperty(globalThis, "window", {
      value: { location: { origin: "http://localhost:3000", pathname: "/" } },
      writable: true,
      configurable: true,
    });
  });

  it("从 /serve/{userId}/{name}/ 路径解析应用名称", () => {
    setPathname("/serve/testuser/leave-form/");
    expect(parseAppName()).toBe("leave-form");
  });

  it("从 /serve/{userId}/{name} 路径解析应用名称（无尾斜杠）", () => {
    setPathname("/serve/testuser/my-app");
    expect(parseAppName()).toBe("my-app");
  });

  it("本地开发路径返回 null", () => {
    setPathname("/");
    expect(parseAppName()).toBeNull();
  });

  it("非 serve 路径返回 null", () => {
    setPathname("/some/other/path");
    expect(parseAppName()).toBeNull();
  });
});

describe("fetchUser", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("已登录用户返回用户信息", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ success: true, data: { id: "u1", name: "testuser" } }),
    });
    const user = await fetchUser();
    expect(user).toEqual({ name: "testuser" });
  });

  it("未登录用户返回 null", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ success: true, data: null }),
    });
    const user = await fetchUser();
    expect(user).toBeNull();
  });

  it("获取失败时降级为'未知'", async () => {
    mockFetch.mockRejectedValueOnce(new Error("network error"));
    const user = await fetchUser();
    expect(user).toEqual({ name: "未知" });
  });

  it("非 2xx 响应降级为'未知'", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: () => Promise.resolve({ success: false, error: "Unauthorized" }),
    });
    const user = await fetchUser();
    expect(user).toEqual({ name: "未知" });
  });
});
