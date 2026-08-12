import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DeliveryStore, type DeliveryNotification } from "../src/notifications/delivery-store.js";

const repositoryRoot = path.resolve(process.cwd(), "../..");
const testRoot = path.join(repositoryRoot, "tmp/task-10b1-delivery-store");
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function fixture(): Promise<{ root: string; statePath: string }> {
  const root = await fs.mkdtemp(`${testRoot}-`);
  roots.push(root);
  return { root, statePath: path.join(root, "private", "notifications.json") };
}

function notification(sequence = 1): DeliveryNotification {
  return {
    id: `notification-${sequence}`,
    sequence,
    app_owner: "local-user",
    app_name: "interview-app",
    title: "Interview ready",
    body: "Open the result",
    url: "/local-user/interview-app/results/1",
    priority: "normal",
    created_at: "2026-08-12T00:00:00.000Z",
  };
}

describe("DeliveryStore", () => {
  it("baselines, prepares stable pending state, and advances only after an outcome", async () => {
    const { statePath } = await fixture();
    const store = new DeliveryStore({
      statePath,
      now: () => new Date("2026-08-12T01:00:00.000Z"),
      randomBytes: (size) => Buffer.alloc(size, 7),
    });

    await store.baseline("local", 0);
    const pending = await store.preparePending("local", notification());
    if (pending === null) throw new Error("expected pending delivery");
    expect(await store.readSource("local")).toMatchObject({ cursor: 0, pending: { retryCount: 0 } });
    expect(await store.retryPending("local")).toEqual({ ...pending, retryCount: 1 });
    expect((await store.retryPending("local"))?.ticket).toBe(pending.ticket);
    expect((await store.retryPending("local"))?.nativeId).toBe(pending.nativeId);

    await store.commitShown("local", 1);
    await store.commitShown("local", 1);
    expect(await store.readSource("local")).toMatchObject({ cursor: 1, pending: null });
    expect(await fs.readFile(statePath, "utf8")).not.toContain(pending.ticket);
    expect(await store.preparePending("local", notification())).toBeNull();
  });

  it("rejects gaps, unsafe delivery serializers, and corrupt state without resetting", async () => {
    const { statePath } = await fixture();
    const store = new DeliveryStore({ statePath });
    await store.baseline("local", 3);
    await expect(store.preparePending("local", notification(5))).rejects.toThrow(/gap/i);
    await expect(store.preparePending("local", { ...notification(4), url: "//evil.example/x" })).rejects.toThrow(/delivery/i);
    await fs.writeFile(statePath, '{"version":2}', { mode: 0o600 });
    await expect(new DeliveryStore({ statePath }).readSource("local")).rejects.toThrow(/state/i);
  });

  it("rejects duplicate JSON keys before schema parsing", async () => {
    const { statePath } = await fixture();
    await fs.mkdir(path.dirname(statePath), { recursive: true, mode: 0o700 });
    await fs.writeFile(statePath, '{"version":1,"version":1,"sources":[]}\n', { mode: 0o600 });
    await expect(new DeliveryStore({ statePath }).readSource("local")).rejects.toThrow(/state/i);
  });

  it("commits inbox-only without a ticket and disables only the selected source", async () => {
    const { statePath } = await fixture();
    const store = new DeliveryStore({ statePath, randomBytes: (size) => Buffer.alloc(size, 9) });
    await store.baseline("one", 0);
    await store.baseline("two", 4);
    await store.preparePending("one", notification());
    await store.commitInboxOnly("one", 1);
    await store.disableSource("one");
    expect(await store.readSource("one")).toBeNull();
    expect(await store.readSource("two")).toMatchObject({ cursor: 4 });
    expect(await fs.readFile(statePath, "utf8")).not.toContain("api-key");
  });

  it.runIf(process.platform !== "win32")("uses private files and rejects symlink or broad-mode state", async () => {
    const { root, statePath } = await fixture();
    const store = new DeliveryStore({ statePath });
    await store.baseline("local", 0);
    expect((await fs.stat(path.dirname(statePath))).mode & 0o777).toBe(0o700);
    expect((await fs.stat(statePath)).mode & 0o777).toBe(0o600);

    await fs.chmod(statePath, 0o644);
    await expect(new DeliveryStore({ statePath }).readSource("local")).rejects.toThrow(/unsafe/i);
    await fs.rm(statePath);
    await fs.symlink(path.join(root, "missing"), statePath);
    await expect(new DeliveryStore({ statePath }).readSource("local")).rejects.toThrow(/unsafe/i);
  });

  it("poisons the instance after post-rename durability uncertainty", async () => {
    const { statePath } = await fixture();
    let fail = true;
    const store = new DeliveryStore({
      statePath,
      fault: (point) => {
        if (point === "after-rename" && fail) {
          fail = false;
          throw new Error("simulated directory fsync failure");
        }
      },
    });
    await expect(store.baseline("local", 0)).rejects.toThrow(/durability/i);
    await expect(store.readSource("local")).rejects.toThrow(/poisoned/i);
    expect(await new DeliveryStore({ statePath }).readSource("local")).toMatchObject({ cursor: 0 });
  });

  it("keeps the last visible image after a pre-rename failure", async () => {
    const { statePath } = await fixture();
    await new DeliveryStore({ statePath }).baseline("local", 2);
    const store = new DeliveryStore({ statePath, fault: (point) => {
      if (point === "before-rename") throw new Error("simulated write interruption");
    } });
    await expect(store.baseline("peer", 9)).rejects.toThrow(/interruption/i);
    expect(await new DeliveryStore({ statePath }).readSource("local")).toMatchObject({ cursor: 2 });
    expect(await new DeliveryStore({ statePath }).readSource("peer")).toBeNull();
  });

  it.runIf(process.platform !== "win32")("rejects hard-linked state and does not repair a broad parent", async () => {
    const { statePath } = await fixture();
    const store = new DeliveryStore({ statePath });
    await store.baseline("local", 0);
    await fs.link(statePath, `${statePath}.link`);
    await expect(new DeliveryStore({ statePath }).readSource("local")).rejects.toThrow(/unsafe/i);
    await fs.rm(`${statePath}.link`);
    await fs.chmod(path.dirname(statePath), 0o755);
    await expect(new DeliveryStore({ statePath }).readSource("local")).rejects.toThrow(/unsafe/i);
    expect((await fs.stat(path.dirname(statePath))).mode & 0o777).toBe(0o755);
  });

  it.runIf(process.platform !== "win32")("rejects a symlink in the parent ancestry", async () => {
    const { root } = await fixture();
    const external = path.join(root, "external");
    await fs.mkdir(external, { mode: 0o700 });
    await fs.symlink(external, path.join(root, "linked"));
    const statePath = path.join(root, "linked", "private", "notifications.json");
    await expect(new DeliveryStore({ statePath }).baseline("local", 0)).rejects.toThrow(/ancestor.*unsafe/i);
    await expect(fs.lstat(path.join(external, "private"))).rejects.toMatchObject({ code: "ENOENT" });
  });
});
