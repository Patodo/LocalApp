import { describe, it, expect } from "vitest";
import { checkAccess, checkPageAccess, checkRouteAccess } from "../src/lib/access-control.js";

describe("access-control: checkAccess", () => {
  it("public: 任何人都通过", () => {
    expect(checkAccess("public", null, "alice")).toBe(true);
    expect(checkAccess("public", "bob", "alice")).toBe(true);
    expect(checkAccess("public", "alice", "alice")).toBe(true);
  });

  it("authenticated: 仅登录用户通过", () => {
    expect(checkAccess("authenticated", null, "alice")).toBe(false);
    expect(checkAccess("authenticated", "bob", "alice")).toBe(true);
  });

  it("owner: 仅所有者通过", () => {
    expect(checkAccess("owner", null, "alice")).toBe(false);
    expect(checkAccess("owner", "bob", "alice")).toBe(false);
    expect(checkAccess("owner", "alice", "alice")).toBe(true);
  });

  it("acl: ACL 列表中的用户通过", () => {
    expect(checkAccess("acl", "bob", "alice", ["bob", "charlie"])).toBe(true);
    expect(checkAccess("acl", "charlie", "alice", ["bob", "charlie"])).toBe(true);
    expect(checkAccess("acl", "dave", "alice", ["bob", "charlie"])).toBe(false);
    expect(checkAccess("acl", null, "alice", ["bob", "charlie"])).toBe(false);
  });

  it("所有者始终通过（无论 level）", () => {
    expect(checkAccess("authenticated", "alice", "alice")).toBe(true);
    expect(checkAccess("owner", "alice", "alice")).toBe(true);
    expect(checkAccess("acl", "alice", "alice", ["bob"])).toBe(true);
  });
});

describe("access-control: checkPageAccess", () => {
  it("未配置 pageAccess 时默认通过", () => {
    expect(checkPageAccess(undefined, null, "alice")).toBe(true);
  });

  it("配置为 authenticated 时检查登录状态", () => {
    const policy = { level: "authenticated" as const };
    expect(checkPageAccess(policy, null, "alice")).toBe(false);
    expect(checkPageAccess(policy, "bob", "alice")).toBe(true);
  });

  it("配置为 acl 时检查列表", () => {
    const policy = { level: "acl" as const, acl: ["bob"] };
    expect(checkPageAccess(policy, "bob", "alice")).toBe(true);
    expect(checkPageAccess(policy, "charlie", "alice")).toBe(false);
    expect(checkPageAccess(policy, "alice", "alice")).toBe(true);
  });
});

describe("access-control: checkRouteAccess", () => {
  it("未配置 routeAccess 时默认通过", () => {
    expect(checkRouteAccess(undefined, "GET", null, "alice")).toBe(true);
    expect(checkRouteAccess(undefined, "POST", null, "alice")).toBe(true);
  });

  it("GET→read, POST→create, PUT→update, DELETE→delete 映射正确", () => {
    const ra: import("../src/types/models.js").RouteAccess = {
      read: "public",
      create: "authenticated",
      update: "owner",
      delete: "owner",
    };
    expect(checkRouteAccess(ra, "GET", null, "alice")).toBe(true);
    expect(checkRouteAccess(ra, "POST", null, "alice")).toBe(false);
    expect(checkRouteAccess(ra, "POST", "bob", "alice")).toBe(true);
    expect(checkRouteAccess(ra, "PUT", "bob", "alice")).toBe(false);
    expect(checkRouteAccess(ra, "PUT", "alice", "alice")).toBe(true);
    expect(checkRouteAccess(ra, "DELETE", "bob", "alice")).toBe(false);
    expect(checkRouteAccess(ra, "DELETE", "alice", "alice")).toBe(true);
  });

  it("routeAccess.acl 检查", () => {
    const ra: import("../src/types/models.js").RouteAccess = {
      update: "acl",
      acl: ["bob"],
    };
    expect(checkRouteAccess(ra, "PUT", "bob", "alice")).toBe(true);
    expect(checkRouteAccess(ra, "PUT", "charlie", "alice")).toBe(false);
    expect(checkRouteAccess(ra, "PUT", "alice", "alice")).toBe(true);
  });
});
