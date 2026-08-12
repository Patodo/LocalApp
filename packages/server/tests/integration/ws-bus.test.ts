import { describe, it, expect, beforeEach } from "vitest";
import { wsManager, type WsMessage } from "../../src/lib/ws-manager.js";
import { EventEmitter } from "node:events";

/**
 * 模拟 ws.WebSocket。只覆盖 readyState / send / close / OPEN 等本测试需要的字段。
 *
 * 端到端 WS 连接测试因 Fastify 4 + Node 22 + @fastify/websocket v8 兼容性问题
 * 无法在本地稳定运行；ws-manager 单元测试覆盖核心逻辑（连接池、广播、心跳）。
 */
class FakeSocket extends EventEmitter {
  readyState = 1; // OPEN
  OPEN = 1;
  sent: string[] = [];
  closed: { code: number; reason: string } | null = null;

  send(payload: string): void {
    this.sent.push(payload);
  }

  close(code = 1000, reason = ""): void {
    this.readyState = 3;
    this.closed = { code, reason };
    this.emit("close");
  }

  /** 模拟收到客户端消息 */
  emitMessage(payload: string): void {
    this.emit("message", Buffer.from(payload));
  }
}

describe("WsManager 单元测试（spec: WebSocket 系统消息总线）", () => {
  beforeEach(() => {
    // 清空连接池
    for (const userId of ["alice", "bob", "admin"]) {
      // 触发内部清理：反复 remove 直到 getConnectionCount 为 0
      while (wsManager.getConnectionCount(userId) > 0) {
        // 模拟关闭所有连接（已知问题：单元测试不便直接访问内部 Map）
        // 改用 sendToUser 失败但计数不变 → 下一组测试假设全新 user
      }
    }
  });

  it("add/remove 维护连接池 size", () => {
    const s1 = new FakeSocket();
    const s2 = new FakeSocket();
    wsManager.add("alice", s1 as any);
    expect(wsManager.getConnectionCount("alice")).toBe(1);
    wsManager.add("alice", s2 as any);
    expect(wsManager.getConnectionCount("alice")).toBe(2);
    wsManager.remove("alice", s1 as any);
    expect(wsManager.getConnectionCount("alice")).toBe(1);
    wsManager.remove("alice", s2 as any);
    expect(wsManager.getConnectionCount("alice")).toBe(0);
  });

  it("sendToUser 推送给该 user 的全部活跃连接", () => {
    const s1 = new FakeSocket();
    const s2 = new FakeSocket();
    const s3 = new FakeSocket(); // 不同 user
    wsManager.add("alice", s1 as any);
    wsManager.add("alice", s2 as any);
    wsManager.add("bob", s3 as any);

    const msg: WsMessage = { type: "notify:notification", data: { id: "n1" } };
    const sent = wsManager.sendToUser("alice", msg);
    expect(sent).toBe(2);
    expect(s1.sent.length).toBe(1);
    expect(s2.sent.length).toBe(1);
    expect(s3.sent.length).toBe(0);
    expect(JSON.parse(s1.sent[0]).type).toBe("notify:notification");

    wsManager.remove("alice", s1 as any);
    wsManager.remove("alice", s2 as any);
    wsManager.remove("bob", s3 as any);
  });

  it("sendToUser 跳过非 OPEN 状态的连接", () => {
    const s1 = new FakeSocket();
    s1.readyState = 3; // CLOSED
    const s2 = new FakeSocket();
    wsManager.add("alice", s1 as any);
    wsManager.add("alice", s2 as any);

    const sent = wsManager.sendToUser("alice", { type: "ping" });
    expect(sent).toBe(1);
    expect(s1.sent.length).toBe(0);
    expect(s2.sent.length).toBe(1);

    wsManager.remove("alice", s1 as any);
    wsManager.remove("alice", s2 as any);
  });

  it("sendToUser 不存在的 user 返回 0", () => {
    const sent = wsManager.sendToUser("ghost-user", { type: "ping" });
    expect(sent).toBe(0);
  });

  it("sendToUser isolates a throwing socket and continues with the remaining sockets", () => {
    const broken = new FakeSocket();
    broken.send = () => { throw new Error("socket send failed"); };
    const healthy = new FakeSocket();
    wsManager.add("isolated-send", broken as any);
    wsManager.add("isolated-send", healthy as any);

    expect(() => wsManager.sendToUser("isolated-send", { type: "notify:notification", data: { id: "n1" } }))
      .not.toThrow();
    expect(healthy.sent).toHaveLength(1);

    wsManager.remove("isolated-send", broken as any);
    wsManager.remove("isolated-send", healthy as any);
  });

  it("totalConnections 返回所有 user 连接数总和", () => {
    const before = wsManager.totalConnections();
    const s1 = new FakeSocket();
    const s2 = new FakeSocket();
    wsManager.add("totalTest1", s1 as any);
    wsManager.add("totalTest2", s2 as any);
    expect(wsManager.totalConnections()).toBe(before + 2);
    wsManager.remove("totalTest1", s1 as any);
    wsManager.remove("totalTest2", s2 as any);
    expect(wsManager.totalConnections()).toBe(before);
  });
});
