import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { initMetaDb, closeMetaDb, createUser, findUserById, findUserByName } from "../src/lib/meta-sqlite.js";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

describe("meta-sqlite: users", () => {
  let dataDir: string;

  beforeAll(async () => {
    dataDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "localapp-users-test-"));
    await initMetaDb(dataDir);
  });

  afterAll(async () => {
    closeMetaDb();
    await fs.promises.rm(dataDir, { recursive: true, force: true });
  });

  it("users 表在启动时自动创建", () => {
    const dbPath = path.join(dataDir, "meta.sqlite");
    expect(fs.existsSync(dbPath)).toBe(true);
  });

  it("重复 initMetaDb 不报错（表已存在）", async () => {
    closeMetaDb();
    await expect(initMetaDb(dataDir)).resolves.toBeUndefined();
  });

  describe("createUser", () => {
    it("创建用户成功", () => {
      const user = createUser("alice", "alice", "hash123");
      expect(user).toMatchObject({
        id: "alice",
        name: "alice",
        provider: "local",
        role: "user",
        createdAt: expect.any(String),
      });
    });

    it("重复 id 返回冲突错误", () => {
      expect(() => createUser("alice", "alice2", "hash456")).toThrow("USER_EXISTS");
    });

    it("不同 id 可正常创建", () => {
      const user = createUser("bob", "bob", "hash789");
      expect(user.id).toBe("bob");
    });
  });

  describe("findUserById", () => {
    it("按 id 查到用户（不含密码）", () => {
      const user = findUserById("alice");
      expect(user).not.toBeNull();
      expect(user!.id).toBe("alice");
      expect(user!.name).toBe("alice");
      expect((user as any).password).toBeUndefined();
    });

    it("id 不存在返回 null", () => {
      expect(findUserById("nonexistent")).toBeNull();
    });
  });

  describe("findUserByName", () => {
    it("按 name 查到用户（含密码）", () => {
      const user = findUserByName("alice");
      expect(user).not.toBeNull();
      expect(user!.id).toBe("alice");
      expect(user!.password).toBe("hash123");
    });

    it("name 不存在返回 null", () => {
      expect(findUserByName("nonexistent")).toBeNull();
    });
  });
});
