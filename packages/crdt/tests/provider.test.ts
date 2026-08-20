// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import {
  createLocalAppCrdt,
  decodeRelativePosition,
  encodeRelativePosition,
  type EditingPeer,
} from "../src/index.js";

class MockEventSource {
  static instances: MockEventSource[] = [];
  readonly url: string;
  readonly listeners = new Map<string, Set<(event: MessageEvent) => void>>();
  readonly close = vi.fn();

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: (event: MessageEvent) => void): void {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  emit(type: string, body: unknown): void {
    const event = new MessageEvent(type, { data: JSON.stringify(body) });
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

describe("LocalAppCrdtProvider", () => {
  afterEach(() => {
    MockEventSource.instances = [];
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("uploads document edits made before connect and applies remote updates", async () => {
    vi.stubGlobal("EventSource", MockEventSource as unknown as typeof EventSource);
    const serverDoc = new Y.Doc();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/crdt/sync")) return jsonResponse({ success: true, data: { update: "" } });
      if (url.endsWith("/crdt/update")) {
        const body = JSON.parse(String(init?.body));
        Y.applyUpdate(serverDoc, decode(body.update));
        return jsonResponse({ success: true, data: { snapshotBytes: body.update.length, updatedAt: new Date().toISOString() } });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const localDoc = new Y.Doc();
    localDoc.getText("body").insert(0, "local draft");
    const provider = createLocalAppCrdt({
      resource: "documents",
      documentId: "proposal-1",
      clientId: "window-1",
      basePath: "/serve/alice/editor/api",
      doc: localDoc,
      autoConnect: false,
      awareness: false,
    });

    expect(fetchMock).not.toHaveBeenCalled();
    await provider.connect();
    expect(provider.status).toBe("connected");
    expect(serverDoc.getText("body").toString()).toBe("local draft");
    expect(MockEventSource.instances[0].url).toContain("/crdt/events?resource=documents&documentId=proposal-1&clientId=window-1");

    const remoteDoc = new Y.Doc();
    remoteDoc.getText("body").insert(0, "remote ");
    MockEventSource.instances[0].emit("crdt:update", {
      type: "crdt:update",
      data: { clientId: "window-2", update: encode(Y.encodeStateAsUpdate(remoteDoc)) },
    });
    expect(localDoc.getText("body").toString()).toContain("remote ");

    await provider.destroy();
    expect(MockEventSource.instances[0].close).toHaveBeenCalledOnce();
  });

  it("publishes canonical remote editing awareness and clears its lease on destroy", async () => {
    vi.stubGlobal("EventSource", MockEventSource as unknown as typeof EventSource);
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/crdt/sync")) return jsonResponse({ success: true, data: { update: "" } });
      if (url.endsWith("/crdt/awareness")) return jsonResponse({ success: true, data: { status: "editing" } });
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const provider = createLocalAppCrdt({
      resource: "documents",
      documentId: "proposal-2",
      clientId: "window-1",
      basePath: "/serve/alice/editor/api",
      autoConnect: false,
    });
    const received: readonly EditingPeer[][] = [];
    provider.onAwareness((peers) => received.push(peers));
    await provider.connect();
    provider.setEditingTarget({ surfaceId: "proposal:2", fieldId: "title", label: "标题" });
    await vi.waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/crdt/awareness"))).toBe(true));

    MockEventSource.instances[0].emit("crdt:awareness", {
      type: "crdt:awareness",
      data: {
        peers: [{
          clientId: "window-2",
          clock: 3,
          user: { id: "bob", name: "bob", displayName: "Bob", avatarUrl: null, color: "#2563eb" },
          editing: { surfaceId: "proposal:2", fieldId: "title", label: "标题", kind: "field" },
          overlay: true,
          updatedAt: "2026-08-20T00:00:00.000Z",
        }],
      },
    });
    expect(received.at(-1)?.[0]).toMatchObject({ clientId: "window-2", user: { id: "bob" }, editing: { fieldId: "title" } });

    await provider.destroy();
    const awarenessBodies = fetchMock.mock.calls
      .filter(([url]) => String(url).endsWith("/crdt/awareness"))
      .map(([, init]) => JSON.parse(String(init?.body)));
    expect(awarenessBodies.at(-1)?.state).toBeNull();
  });

  it("encodes stable Yjs relative positions and rejects unsafe identifiers", () => {
    const doc = new Y.Doc();
    const text = doc.getText("body");
    text.insert(0, "hello");
    const encoded = encodeRelativePosition(Y.createRelativePositionFromTypeIndex(text, 3));
    const absolute = Y.createAbsolutePositionFromRelativePosition(decodeRelativePosition(encoded), doc);
    expect(absolute?.index).toBe(3);

    expect(() => createLocalAppCrdt({ resource: "../files", documentId: "doc", autoConnect: false })).toThrow("Invalid CRDT resource");
    expect(() => createLocalAppCrdt({ resource: "documents", documentId: "../doc", autoConnect: false })).toThrow("Invalid CRDT documentId");
  });

  it("does not perform network cleanup when an autoConnect=false provider never connected", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const provider = createLocalAppCrdt({
      resource: "documents",
      documentId: "draft-1",
      autoConnect: false,
    });

    await provider.destroy();

    expect(provider.status).toBe("destroyed");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { "Content-Type": "application/json" } });
}

function encode(value: Uint8Array): string {
  return Buffer.from(value).toString("base64url");
}

function decode(value: string): Uint8Array {
  return Buffer.from(value, "base64url");
}
