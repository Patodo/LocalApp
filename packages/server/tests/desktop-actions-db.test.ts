import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { closeMetaDb, getDb, initMetaDb } from "../src/lib/meta-sqlite.js";
import {
  claimDesktopAction,
  cleanupDesktopActions,
  createDesktopAction,
  expirePendingDesktopActions,
  getDesktopActionSnapshot,
  listRecoverableDesktopActions,
  listPendingDesktopActions,
  transitionDesktopAction,
} from "../src/lib/desktop-actions-db.js";
import { desktopActionsRoutes } from "../src/routes/desktop-actions.js";

const BASE_TIME = new Date("2026-07-14T00:00:00.000Z");

function actionInput(overrides: Record<string, unknown> = {}) {
  return {
    userId: "alice",
    serverOrigin: "https://localapp.example",
    appOwner: "tools",
    appName: "installer",
    appVersion: "v3",
    publisherUserId: "publisher-1",
    publisherDisplayName: "Release Owner",
    title: "Install tools",
    description: "Prepare the workstation",
    script: "return { ok: true };",
    dependencies: { "@localapp/skill-tools": "1.2.3", nanoid: "5.1.11-beta.1+build.7" },
    input: { selected: ["alpha"] },
    ...overrides,
  };
}

describe("desktop actions database", () => {
  let dataDir: string;

  beforeEach(async () => {
    dataDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "localapp-desktop-actions-"));
    await initMetaDb(dataDir);
  });

  afterEach(async () => {
    closeMetaDb();
    await fs.promises.rm(dataDir, { recursive: true, force: true });
  });

  it("creates the desktop_actions schema and recovery indexes", () => {
    const tables = getDb().exec("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'desktop_actions'");
    expect(tables[0]?.values).toEqual([["desktop_actions"]]);

    const indexes = getDb().exec("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'desktop_actions' ORDER BY name");
    expect(indexes[0]?.values).toEqual(expect.arrayContaining([
      ["idx_desktop_actions_expiry"],
      ["idx_desktop_actions_user_pending"],
    ]));
  });

  it("validates UTF-8 payload bytes, dependency count, exact versions, and timeout", () => {
    expect(createDesktopAction(actionInput({ script: "a".repeat(256 * 1024) }), BASE_TIME).timeoutSeconds).toBe(300);
    expect(() => createDesktopAction(actionInput({ script: `${"a".repeat(256 * 1024 - 1)}🙂` }), BASE_TIME)).toThrow("DESKTOP_ACTION_SCRIPT_TOO_LARGE");
    expect(() => createDesktopAction(actionInput({ input: { value: "a".repeat(1024 * 1024) } }), BASE_TIME)).toThrow("DESKTOP_ACTION_INPUT_TOO_LARGE");

    const sixtyFour = Object.fromEntries(Array.from({ length: 64 }, (_, index) => [`pkg-${index}`, "1.0.0"]));
    expect(() => createDesktopAction(actionInput({ dependencies: sixtyFour }), BASE_TIME)).not.toThrow();
    expect(() => createDesktopAction(actionInput({ dependencies: { ...sixtyFour, extra: "1.0.0" } }), BASE_TIME)).toThrow("DESKTOP_ACTION_TOO_MANY_DEPENDENCIES");

    for (const [name, version] of [
      ["Bad Package", "1.0.0"],
      ["@scope", "1.0.0"],
      ["pkg", "latest"],
      ["pkg", "^1.0.0"],
      ["pkg", "https://example.test/pkg.tgz"],
      ["pkg", "01.2.3"],
    ]) {
      expect(() => createDesktopAction(actionInput({ dependencies: { [name]: version } }), BASE_TIME)).toThrow("DESKTOP_ACTION_INVALID_DEPENDENCY");
    }

    expect(() => createDesktopAction(actionInput({ timeoutSeconds: 0 }), BASE_TIME)).toThrow("DESKTOP_ACTION_INVALID_TIMEOUT");
    expect(() => createDesktopAction(actionInput({ timeoutSeconds: 3601 }), BASE_TIME)).toThrow("DESKTOP_ACTION_INVALID_TIMEOUT");
    expect(() => createDesktopAction(actionInput({ timeoutSeconds: 1.5 }), BASE_TIME)).toThrow("DESKTOP_ACTION_INVALID_TIMEOUT");
  });

  it("expires pending actions after ten minutes and isolates reads by user", () => {
    const action = createDesktopAction(actionInput(), BASE_TIME);
    expect(listPendingDesktopActions("bob", new Date(BASE_TIME.getTime() + 9 * 60_000))).toEqual([]);
    expect(getDesktopActionSnapshot("bob", action.id, BASE_TIME)).toBeNull();
    expect(listPendingDesktopActions("alice", new Date(BASE_TIME.getTime() + 9 * 60_000))).toHaveLength(1);

    expect(listPendingDesktopActions("alice", new Date(BASE_TIME.getTime() + 10 * 60_000))).toEqual([]);
    expect(getDesktopActionSnapshot("alice", action.id, new Date(BASE_TIME.getTime() + 10 * 60_000))?.status).toBe("expired");
    expect(claimDesktopAction("alice", action.id, action.nonce, "desktop-a", new Date(BASE_TIME.getTime() + 10 * 60_000))).toMatchObject({ outcome: "expired" });
  });

  it("atomically binds a claim and makes retries idempotent only for that installation", () => {
    const action = createDesktopAction(actionInput(), BASE_TIME);
    const first = claimDesktopAction("alice", action.id, action.nonce, "desktop-a", BASE_TIME);
    expect(first).toMatchObject({ outcome: "claimed", idempotent: false, action: { script: action.script, installationId: "desktop-a" } });
    expect(claimDesktopAction("alice", action.id, action.nonce, "desktop-a", BASE_TIME)).toMatchObject({ outcome: "claimed", idempotent: true });
    expect(claimDesktopAction("alice", action.id, action.nonce, "desktop-b", BASE_TIME)).toEqual({ outcome: "conflict" });
    expect(claimDesktopAction("bob", action.id, action.nonce, "desktop-a", BASE_TIME)).toEqual({ outcome: "not_found" });
    expect(claimDesktopAction("alice", action.id, "wrong", "desktop-a", BASE_TIME)).toEqual({ outcome: "invalid_nonce" });
  });

  it("recovers only unclaimed pending actions and redacts public snapshots", () => {
    const pending = createDesktopAction(actionInput({ title: "Pending" }), BASE_TIME);
    const claimed = createDesktopAction(actionInput({ title: "Claimed" }), BASE_TIME);
    claimDesktopAction("alice", claimed.id, claimed.nonce, "desktop-a", BASE_TIME);

    expect(listPendingDesktopActions("alice", BASE_TIME)).toEqual([
      expect.objectContaining({ id: pending.id, nonce: pending.nonce, title: "Pending" }),
    ]);
    const snapshot = getDesktopActionSnapshot("alice", claimed.id, BASE_TIME)!;
    expect(snapshot.status).toBe("claimed");
    expect(snapshot).not.toHaveProperty("script");
    expect(snapshot).not.toHaveProperty("nonce");
    expect(snapshot).not.toHaveProperty("installationId");
  });

  it("recovers executable in-flight actions for one user and installation after reopen", async () => {
    const installationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const otherInstallationId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const statuses = ["claimed", "awaiting_trust", "preparing", "running"] as const;
    const expectedIds: string[] = [];

    for (const status of statuses) {
      const action = createDesktopAction(actionInput({ title: status }), BASE_TIME);
      claimDesktopAction("alice", action.id, action.nonce, installationId, BASE_TIME);
      if (status === "awaiting_trust") {
        transitionDesktopAction({ userId: "alice", id: action.id, installationId, status }, BASE_TIME);
      } else if (status === "preparing") {
        transitionDesktopAction({ userId: "alice", id: action.id, installationId, status }, BASE_TIME);
      } else if (status === "running") {
        transitionDesktopAction({ userId: "alice", id: action.id, installationId, status: "preparing" }, BASE_TIME);
        transitionDesktopAction({ userId: "alice", id: action.id, installationId, status }, BASE_TIME);
      }
      expectedIds.push(action.id);
    }

    const otherInstall = createDesktopAction(actionInput({ title: "other install" }), BASE_TIME);
    claimDesktopAction("alice", otherInstall.id, otherInstall.nonce, otherInstallationId, BASE_TIME);
    const otherUser = createDesktopAction(actionInput({ userId: "bob", title: "other user" }), BASE_TIME);
    claimDesktopAction("bob", otherUser.id, otherUser.nonce, installationId, BASE_TIME);
    const terminal = createDesktopAction(actionInput({ title: "terminal" }), BASE_TIME);
    claimDesktopAction("alice", terminal.id, terminal.nonce, installationId, BASE_TIME);
    transitionDesktopAction({ userId: "alice", id: terminal.id, installationId, status: "preparing" }, BASE_TIME);
    transitionDesktopAction({ userId: "alice", id: terminal.id, installationId, status: "failed" }, BASE_TIME);

    closeMetaDb();
    await initMetaDb(dataDir);
    const recovered = listRecoverableDesktopActions("alice", installationId);
    expect(recovered.map((action) => action.id).sort()).toEqual(expectedIds.sort());
    expect(recovered).toEqual(expect.arrayContaining([
      expect.objectContaining({
        status: "running",
        script: "return { ok: true };",
        dependencies: actionInput().dependencies,
        input: actionInput().input,
      }),
    ]));
    for (const action of recovered) {
      expect(action).not.toHaveProperty("nonce");
      expect(action).not.toHaveProperty("installationId");
    }
    expect(listRecoverableDesktopActions("alice", otherInstallationId).map((action) => action.id)).toEqual([otherInstall.id]);
    expect(listRecoverableDesktopActions("bob", installationId).map((action) => action.id)).toEqual([otherUser.id]);
  });

  it("enforces transitions, idempotent retries, and immutable terminal states", () => {
    const action = createDesktopAction(actionInput(), BASE_TIME);
    expect(transitionDesktopAction({ userId: "alice", id: action.id, installationId: "desktop-a", status: "running" }, BASE_TIME)).toEqual({ outcome: "not_found" });
    claimDesktopAction("alice", action.id, action.nonce, "desktop-a", BASE_TIME);
    expect(transitionDesktopAction({ userId: "alice", id: action.id, installationId: "desktop-b", status: "preparing" }, BASE_TIME)).toEqual({ outcome: "not_found" });

    for (const status of ["awaiting_trust", "preparing", "running"] as const) {
      expect(transitionDesktopAction({ userId: "alice", id: action.id, installationId: "desktop-a", status }, BASE_TIME)).toMatchObject({ outcome: "updated", changed: true, action: { status } });
      expect(transitionDesktopAction({ userId: "alice", id: action.id, installationId: "desktop-a", status }, BASE_TIME)).toMatchObject({ outcome: "updated", changed: false, action: { status } });
    }
    expect(transitionDesktopAction({ userId: "alice", id: action.id, installationId: "desktop-a", status: "succeeded", result: { value: 42 } }, BASE_TIME)).toMatchObject({ outcome: "updated", changed: true });
    expect(transitionDesktopAction({ userId: "alice", id: action.id, installationId: "desktop-a", status: "succeeded", result: { value: 99 } }, BASE_TIME)).toMatchObject({ outcome: "updated", changed: false, action: { result: { value: 42 } } });
    expect(transitionDesktopAction({ userId: "alice", id: action.id, installationId: "desktop-a", status: "failed", error: { message: "late" } }, BASE_TIME)).toEqual({ outcome: "terminal_conflict" });
  });

  it("rejects every installation transition until the action is claimed", () => {
    const action = createDesktopAction(actionInput(), BASE_TIME);
    const beforeExpiry = new Date(BASE_TIME.getTime() + 9 * 60_000);
    const expiry = new Date(BASE_TIME.getTime() + 10 * 60_000);

    expect(transitionDesktopAction({
      userId: "alice",
      id: action.id,
      installationId: "desktop-a",
      status: "expired",
    }, beforeExpiry)).toEqual({ outcome: "not_found" });
    expect(getDesktopActionSnapshot("alice", action.id, BASE_TIME)).toMatchObject({ status: "pending" });

    expect(expirePendingDesktopActions(expiry)).toBe(1);
    expect(getDesktopActionSnapshot("alice", action.id, expiry)).toMatchObject({ status: "expired" });
  });

  it("rejects oversized JSON results and truncates error summaries on UTF-8 boundaries", () => {
    const resultAction = createDesktopAction(actionInput(), BASE_TIME);
    claimDesktopAction("alice", resultAction.id, resultAction.nonce, "desktop-a", BASE_TIME);
    transitionDesktopAction({ userId: "alice", id: resultAction.id, installationId: "desktop-a", status: "preparing" }, BASE_TIME);
    transitionDesktopAction({ userId: "alice", id: resultAction.id, installationId: "desktop-a", status: "running" }, BASE_TIME);
    expect(() => transitionDesktopAction({ userId: "alice", id: resultAction.id, installationId: "desktop-a", status: "succeeded", result: "a".repeat(1024 * 1024) }, BASE_TIME)).toThrow("DESKTOP_ACTION_RESULT_TOO_LARGE");

    const errorAction = createDesktopAction(actionInput(), BASE_TIME);
    claimDesktopAction("alice", errorAction.id, errorAction.nonce, "desktop-a", BASE_TIME);
    transitionDesktopAction({ userId: "alice", id: errorAction.id, installationId: "desktop-a", status: "preparing" }, BASE_TIME);
    const updated = transitionDesktopAction({
      userId: "alice",
      id: errorAction.id,
      installationId: "desktop-a",
      status: "failed",
      error: { code: "RUN_FAILED", message: "🙂".repeat(20_000) },
    }, BASE_TIME);
    expect(updated).toMatchObject({ outcome: "updated", action: { error: { code: "RUN_FAILED" } } });
    if (updated.outcome !== "updated") throw new Error("expected update");
    expect(Buffer.byteLength(updated.action.error!.message, "utf8")).toBeLessThanOrEqual(64 * 1024);
    expect(updated.action.error!.message).not.toContain("�");
  });

  it("flushes mutations so actions survive reopening the sql.js database", async () => {
    const action = createDesktopAction(actionInput(), BASE_TIME);
    closeMetaDb();
    await initMetaDb(dataDir);
    expect(getDesktopActionSnapshot("alice", action.id, BASE_TIME)).toMatchObject({ id: action.id, status: "pending" });
  });

  it("cleans up only completed actions older than the cutoff", () => {
    const oldAction = createDesktopAction(actionInput(), BASE_TIME);
    listPendingDesktopActions("alice", new Date(BASE_TIME.getTime() + 10 * 60_000));
    const pendingAction = createDesktopAction(actionInput(), new Date(BASE_TIME.getTime() + 30 * 60_000));

    expect(cleanupDesktopActions(new Date(BASE_TIME.getTime() + 20 * 60_000))).toBe(1);
    expect(getDesktopActionSnapshot("alice", oldAction.id, new Date(BASE_TIME.getTime() + 31 * 60_000))).toBeNull();
    expect(getDesktopActionSnapshot("alice", pendingAction.id, new Date(BASE_TIME.getTime() + 31 * 60_000))).toMatchObject({ status: "pending" });
  });

  it("runs seven-day terminal cleanup at startup and clears its unref interval on close", async () => {
    const now = new Date();
    const createdAt = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000);
    const oldTerminal = createDesktopAction(actionInput({ title: "Old terminal" }), createdAt);
    const oldActive = createDesktopAction(actionInput({ title: "Old active" }), createdAt);
    claimDesktopAction("alice", oldActive.id, oldActive.nonce, "desktop-active", createdAt);
    transitionDesktopAction({
      userId: "alice",
      id: oldActive.id,
      installationId: "desktop-active",
      status: "preparing",
    }, createdAt);
    transitionDesktopAction({
      userId: "alice",
      id: oldActive.id,
      installationId: "desktop-active",
      status: "running",
    }, createdAt);
    expirePendingDesktopActions(new Date(createdAt.getTime() + 10 * 60_000));

    const setIntervalSpy = vi.spyOn(globalThis, "setInterval");
    const clearIntervalSpy = vi.spyOn(globalThis, "clearInterval");
    const app = Fastify();
    let closed = false;
    try {
      await app.register(desktopActionsRoutes);
      await app.ready();

      expect(getDesktopActionSnapshot("alice", oldTerminal.id, now)).toBeNull();
      expect(getDesktopActionSnapshot("alice", oldActive.id, now)).toMatchObject({ status: "running" });
      const cleanupTimer = setIntervalSpy.mock.results[0]?.value as NodeJS.Timeout;
      expect(cleanupTimer).toBeDefined();
      expect(cleanupTimer.hasRef()).toBe(false);

      await app.close();
      closed = true;
      expect(clearIntervalSpy).toHaveBeenCalledWith(cleanupTimer);
    } finally {
      if (!closed) await app.close();
      setIntervalSpy.mockRestore();
      clearIntervalSpy.mockRestore();
    }
  });
});
