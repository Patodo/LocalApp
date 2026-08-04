import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  closeMetaDb,
  createSavedReply,
  deleteSavedReply,
  initMetaDb,
  listSavedReplies,
  updateSavedReply,
} from "../src/lib/meta-sqlite.js";

describe("meta-sqlite: saved replies", () => {
  let dataDir: string;

  beforeAll(async () => {
    dataDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "localapp-saved-replies-"));
    await initMetaDb(dataDir);
  });

  afterAll(async () => {
    closeMetaDb();
    await fs.promises.rm(dataDir, { recursive: true, force: true });
  });

  it("keeps CRUD private to the authenticated user", () => {
    const created = createSavedReply("alice", { title: "  Need details  ", body: "Please add logs.\n\n%cursor%" });
    expect(created).toMatchObject({ userId: "alice", title: "Need details", body: "Please add logs.\n\n%cursor%" });
    expect(listSavedReplies("alice")).toEqual([created]);
    expect(listSavedReplies("bob")).toEqual([]);
    expect(updateSavedReply("bob", created.id, { title: "Stolen", body: "No" })).toBeNull();
    expect(deleteSavedReply("bob", created.id)).toBe(false);

    const updated = updateSavedReply("alice", created.id, { title: "Need reproduction", body: "Steps?" });
    expect(updated).toMatchObject({ id: created.id, title: "Need reproduction", body: "Steps?" });
    expect(deleteSavedReply("alice", created.id)).toBe(true);
    expect(listSavedReplies("alice")).toEqual([]);
  });

  it("enforces title uniqueness and the 100 reply limit per user", () => {
    createSavedReply("limit-user", { title: "Reply 1", body: "Body" });
    expect(() => createSavedReply("limit-user", { title: "Reply 1", body: "Other" })).toThrow("SAVED_REPLY_TITLE_CONFLICT");
    for (let index = 2; index <= 100; index += 1) {
      createSavedReply("limit-user", { title: `Reply ${index}`, body: "Body" });
    }
    expect(() => createSavedReply("limit-user", { title: "Reply 101", body: "Body" })).toThrow("SAVED_REPLY_LIMIT_EXCEEDED");
    expect(createSavedReply("another-user", { title: "Reply 101", body: "Body" })).toMatchObject({ userId: "another-user" });
  });
});
