import { describe, expect, it } from "vitest";
import {
  DESKTOP_ACTION_PROTOCOL_VERSION,
  WsManager,
  type WsConnectionMetadata,
} from "../src/lib/ws-manager.js";

class FakeSocket {
  readyState = 1;
  OPEN = 1;
  sent: string[] = [];

  send(payload: string): void {
    this.sent.push(payload);
  }
}

const desktop = (overrides: Partial<WsConnectionMetadata> = {}): WsConnectionMetadata => ({
  clientKind: "desktop",
  protocolVersion: DESKTOP_ACTION_PROTOCOL_VERSION,
  installationId: "desktop-a",
  ...overrides,
});

describe("WsManager desktop connection filtering", () => {
  it("keeps notification broadcasts compatible with generic and old clients", () => {
    const manager = new WsManager();
    const generic = new FakeSocket();
    const oldDesktop = new FakeSocket();
    const capableDesktop = new FakeSocket();

    manager.add("alice", generic as any);
    manager.add("alice", oldDesktop as any, { clientKind: "desktop" });
    manager.add("alice", capableDesktop as any, desktop());

    expect(manager.sendToUser("alice", {
      type: "notify:notification",
      data: { id: "notification-1" },
    })).toBe(3);
    expect(generic.sent).toHaveLength(1);
    expect(oldDesktop.sent).toHaveLength(1);
    expect(capableDesktop.sent).toHaveLength(1);
  });

  it("publishes desktop actions only to same-user capable desktop connections", () => {
    const manager = new WsManager();
    const generic = new FakeSocket();
    const oldDesktop = new FakeSocket();
    const capableDesktop = new FakeSocket();
    const otherUserDesktop = new FakeSocket();

    manager.add("alice", generic as any);
    manager.add("alice", oldDesktop as any, { clientKind: "desktop" });
    manager.add("alice", capableDesktop as any, desktop());
    manager.add("bob", otherUserDesktop as any, desktop({ installationId: "desktop-b" }));

    expect(manager.sendToDesktopUser("alice", { requestId: "action-1" })).toBe(1);
    expect(generic.sent).toEqual([]);
    expect(oldDesktop.sent).toEqual([]);
    expect(otherUserDesktop.sent).toEqual([]);
    expect(JSON.parse(capableDesktop.sent[0])).toEqual({
      type: "desktop:action-requested",
      data: { requestId: "action-1" },
    });
  });

  it("requires the requested minimum protocol and an open socket", () => {
    const manager = new WsManager();
    const v1 = new FakeSocket();
    const v2 = new FakeSocket();
    const closedV2 = new FakeSocket();
    closedV2.readyState = 3;

    manager.add("alice", v1 as any, desktop({ protocolVersion: 1 }));
    manager.add("alice", v2 as any, desktop({ protocolVersion: 2 }));
    manager.add("alice", closedV2 as any, desktop({ protocolVersion: 2 }));

    expect(manager.sendToDesktopUser("alice", { requestId: "action-2" }, 2)).toBe(1);
    expect(v1.sent).toEqual([]);
    expect(v2.sent).toHaveLength(1);
    expect(closedV2.sent).toEqual([]);
  });

  it("reports online desktop capability at a minimum protocol", () => {
    const manager = new WsManager();
    const generic = new FakeSocket();
    const v1 = new FakeSocket();
    const closedV2 = new FakeSocket();
    closedV2.readyState = 3;

    manager.add("alice", generic as any);
    manager.add("alice", v1 as any, desktop({ protocolVersion: 1 }));
    manager.add("alice", closedV2 as any, desktop({ protocolVersion: 2 }));

    expect(manager.getDesktopConnectionCount("alice", 1)).toBe(1);
    expect(manager.hasDesktopCapability("alice", 1)).toBe(true);
    expect(manager.getDesktopConnectionCount("alice", 2)).toBe(0);
    expect(manager.hasDesktopCapability("alice", 2)).toBe(false);
    expect(manager.hasDesktopCapability("bob", 1)).toBe(false);
  });
});
