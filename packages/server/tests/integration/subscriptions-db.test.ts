import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestServer } from "./helpers.js";
import type { FastifyInstance } from "fastify";
import {
  upsertSubscription,
  deleteSubscription,
  listSubscriptionsByUser,
  getSubscriptionStatus,
} from "../../src/lib/subscriptions-db.js";

describe("subscriptions-db CRUD（spec: 订阅数据模型）", () => {
  let app: FastifyInstance;
  let stop: () => Promise<void>;

  beforeAll(async () => {
    const server = await createTestServer();
    app = server.app;
    stop = server.stop;
  });

  afterAll(async () => { await stop(); });

  it("upsert 创建新订阅", () => {
    upsertSubscription("alice", "bob", "blog", "all");
    const status = getSubscriptionStatus("alice", "bob", "blog");
    expect(status).toEqual({ level: "all" });
  });

  it("upsert 更新已存在的订阅 level", () => {
    upsertSubscription("alice", "bob", "blog", "all");
    upsertSubscription("alice", "bob", "blog", "muted");
    const status = getSubscriptionStatus("alice", "bob", "blog");
    expect(status).toEqual({ level: "muted" });
  });

  it("getSubscriptionStatus 未订阅返回 null", () => {
    const status = getSubscriptionStatus("nobody", "bob", "blog");
    expect(status).toBeNull();
  });

  it("deleteSubscription 退订后 status 为 null", () => {
    upsertSubscription("alice", "charlie", "wiki", "important");
    deleteSubscription("alice", "charlie", "wiki");
    expect(getSubscriptionStatus("alice", "charlie", "wiki")).toBeNull();
  });

  it("listSubscriptionsByUser 返回用户全部订阅", () => {
    upsertSubscription("alice", "bob", "blog", "all");
    upsertSubscription("alice", "charlie", "wiki", "muted");
    upsertSubscription("alice", "dave", "tasks", "important");
    // 干扰项：bob 的视角不应混入
    upsertSubscription("bob", "charlie", "wiki", "all");

    const subs = listSubscriptionsByUser("alice");
    expect(subs.length).toBeGreaterThanOrEqual(3);
    const targets = subs.map((s) => `${s.app_owner}/${s.app_name}:${s.level}`);
    expect(targets).toContain("bob/blog:all");
    expect(targets).toContain("charlie/wiki:muted");
    expect(targets).toContain("dave/tasks:important");
    expect(targets.some((t) => t.startsWith("charlie/wiki:all"))).toBe(false); // 不应包含 bob 的订阅
  });

  it("非法 level 抛出错误", () => {
    expect(() => upsertSubscription("alice", "bob", "blog", "invalid-level" as any)).toThrow();
  });
});
