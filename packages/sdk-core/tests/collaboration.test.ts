// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyCommittedEventToDraftState,
  subscribeCollaborationEvents,
  type CollaborationCommittedEvent,
} from "../src/collaboration.js";

class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
  listeners = new Map<string, Set<(event: MessageEvent) => void>>();
  close = vi.fn();

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: (event: MessageEvent) => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(listener);
  }

  removeEventListener(type: string, listener: (event: MessageEvent) => void) {
    this.listeners.get(type)?.delete(listener);
  }

  emit(type: string, data: unknown) {
    const event = new MessageEvent(type, { data: JSON.stringify(data) });
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

describe("collaboration SDK", () => {
  afterEach(() => {
    MockEventSource.instances = [];
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  it("subscribes to committed events from the detected app API base", () => {
    vi.stubGlobal("EventSource", MockEventSource as any);
    document.body.innerHTML = '<div data-localapp-app-resource-base="/serve/alice/research/"></div>';
    const handler = vi.fn();

    const cleanup = subscribeCollaborationEvents({ resource: "tasks" }, handler);
    expect(MockEventSource.instances[0].url).toBe("/serve/alice/research/api/collaboration/events?resource=tasks");

    const event: CollaborationCommittedEvent = {
      type: "collab:operation_committed",
      data: {
        appOwner: "alice",
        appName: "research",
        resource: "tasks",
        recordId: "task-1",
        revision: 2,
        actorId: "alice",
        operationId: "op-1",
      },
    };
    MockEventSource.instances[0].emit("collab:operation_committed", event);
    expect(handler).toHaveBeenCalledWith(event);

    cleanup();
    expect(MockEventSource.instances[0].close).toHaveBeenCalledTimes(1);
  });

  it("updates server snapshot without overwriting localDraft", () => {
    const localDraft = { id: "task-1", title: "My draft", status: "open" };
    const serverSnapshot = { id: "task-1", title: "Old", status: "open" };
    const event: CollaborationCommittedEvent = {
      type: "collab:operation_committed",
      data: {
        appOwner: "alice",
        appName: "research",
        resource: "tasks",
        recordId: "task-1",
        revision: 3,
        actorId: "bob",
        operationId: "op-remote",
        patch: { title: "Remote" },
      },
    };

    const next = applyCommittedEventToDraftState({ localDraft, serverSnapshot }, event);
    expect(next.localDraft).toBe(localDraft);
    expect(next.serverSnapshot).toEqual({ id: "task-1", title: "Remote", status: "open" });
    expect(next.hasRemoteUpdate).toBe(true);
  });
});
