import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { closeAllConnections } from "../app-db.js";
import {
  IssueSavedViewLimitError,
  createIssueSavedView,
  deleteIssueSavedView,
  duplicateIssueSavedView,
  listIssueSavedViews,
  normalizeIssueSavedViewQuery,
  updateIssueSavedView,
} from "../issue-saved-views.js";

describe("Issue saved views", () => {
  let tempDir: string;
  let dbPath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "localapp-issue-saved-views-"));
    dbPath = path.join(tempDir, "app.db");
  });

  afterEach(() => {
    closeAllConnections();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("normalizes a strict list query and always resets pagination offset", () => {
    expect(normalizeIssueSavedViewQuery({
      q: " crash ", searchIn: ["title", "comments"], status: "closed", label: "bug",
      subscribed: true, sort: "comments", direction: "asc", limit: 50, offset: 75,
    })).toEqual({
      q: "crash", searchIn: ["title", "comments"], status: "closed", label: "bug",
      subscribed: true, sort: "comments", direction: "asc", limit: 50, offset: 0,
    });
    expect(() => normalizeIssueSavedViewQuery({ q: "ok", ownerId: "mallory" })).toThrow("Unknown saved view query field");
    expect(() => normalizeIssueSavedViewQuery({ q: "x", searchIn: ["comments", "title"] })).toThrow("Invalid saved view search scopes");
    expect(() => normalizeIssueSavedViewQuery({ q: "x", limit: 101 })).toThrow("Invalid saved view limit");
  });

  it("keeps records private to their owner and supports update, copy, and delete", async () => {
    const created = await createIssueSavedView(dbPath, "alice", {
      name: "待验收", description: "本周需要处理", query: { status: "open", label: "acceptance", offset: 50 },
    });

    expect(await listIssueSavedViews(dbPath, "alice")).toEqual([expect.objectContaining({ id: created.id, name: "待验收", user_id: "alice", query: { status: "open", label: "acceptance", offset: 0 } })]);
    expect(await listIssueSavedViews(dbPath, "bob")).toEqual([]);
    expect(await updateIssueSavedView(dbPath, "bob", created.id, { name: "偷改" })).toBeNull();
    expect(await deleteIssueSavedView(dbPath, "bob", created.id)).toBe(false);

    const updated = await updateIssueSavedView(dbPath, "alice", created.id, { name: "准备发布", query: { status: "closed", reason: "completed" } });
    expect(updated).toMatchObject({ name: "准备发布", description: "本周需要处理", query: { status: "closed", reason: "completed", offset: 0 } });
    const copy = await duplicateIssueSavedView(dbPath, "alice", created.id);
    expect(copy).toMatchObject({ name: "准备发布 copy", query: updated?.query });
    expect(copy?.id).not.toBe(created.id);
    expect(await deleteIssueSavedView(dbPath, "alice", created.id)).toBe(true);
    expect((await listIssueSavedViews(dbPath, "alice")).map((view) => view.id)).toEqual([copy?.id]);
  });

  it("enforces the 25-view limit atomically for create and duplicate", async () => {
    for (let index = 1; index <= 25; index += 1) {
      await createIssueSavedView(dbPath, "alice", { name: `视图 ${index}`, query: { status: "open" } });
    }
    await expect(createIssueSavedView(dbPath, "alice", { name: "第 26 个", query: {} })).rejects.toBeInstanceOf(IssueSavedViewLimitError);
    const first = (await listIssueSavedViews(dbPath, "alice"))[0];
    await expect(duplicateIssueSavedView(dbPath, "alice", first.id)).rejects.toBeInstanceOf(IssueSavedViewLimitError);
    expect(await listIssueSavedViews(dbPath, "alice")).toHaveLength(25);
  });

  it("validates Unicode names, descriptions, and duplicate names without exposing owner input", async () => {
    await expect(createIssueSavedView(dbPath, "alice", { name: " ", query: {} })).rejects.toThrow("Saved view name is required");
    await expect(createIssueSavedView(dbPath, "alice", { name: "a".repeat(51), query: {} })).rejects.toThrow("Saved view name is too long");
    await expect(createIssueSavedView(dbPath, "alice", { name: "ok", description: "a".repeat(201), query: {} })).rejects.toThrow("Saved view description is too long");
    await createIssueSavedView(dbPath, "alice", { name: "同名", query: {} });
    await expect(createIssueSavedView(dbPath, "alice", { name: "同名", query: {} })).rejects.toThrow("Saved view name already exists");
    await expect(createIssueSavedView(dbPath, "bob", { name: "同名", query: {} })).resolves.toMatchObject({ user_id: "bob" });
  });
});
