import { describe, it, expect } from "vitest";
import {
  checkPermission,
  createCan,
  type RecordAction,
  type RecordAccess,
  type DataSchemaLike,
  type CurrentUser,
} from "../src/permissions.js";

const user: CurrentUser = { id: "u-1", name: "alice" };
const otherUser: CurrentUser = { id: "u-2", name: "bob" };

function schemaWith(recordAccess: RecordAccess): DataSchemaLike {
  return { business: { recordAccess } };
}

describe("checkPermission - 无策略", () => {
  it("未登录用户对无策略操作返回 false", () => {
    expect(checkPermission("read", {}, { business: {} }, null)).toBe(false);
  });

  it("登录用户对无策略操作返回 true（交由后端兜底）", () => {
    expect(checkPermission("read", {}, { business: {} }, user)).toBe(true);
  });

  it("schema 为 null 时登录用户返回 true", () => {
    expect(checkPermission("read", {}, null, user)).toBe(true);
  });
});

describe("checkPermission - authenticated 模式", () => {
  it("登录用户即可执行操作", () => {
    const schema = schemaWith({ read: { mode: "authenticated" } });
    expect(checkPermission("read", {}, schema, user)).toBe(true);
  });

  it("未登录用户不可执行操作", () => {
    const schema = schemaWith({ read: { mode: "authenticated" } });
    expect(checkPermission("read", {}, schema, null)).toBe(false);
  });
});

describe("checkPermission - ownerField 模式", () => {
  const schema = schemaWith({
    update: { mode: "ownerField", field: "ownerId" },
  });

  it("记录字段等于当前用户 ID 时允许", () => {
    expect(checkPermission("update", { ownerId: "u-1" }, schema, user)).toBe(true);
  });

  it("记录字段不等于当前用户 ID 时拒绝", () => {
    expect(checkPermission("update", { ownerId: "u-2" }, schema, user)).toBe(false);
  });

  it("记录字段缺失时拒绝", () => {
    expect(checkPermission("update", {}, schema, user)).toBe(false);
  });

  it("记录字段为 null 时拒绝", () => {
    expect(checkPermission("update", { ownerId: null }, schema, user)).toBe(false);
  });

  it("无 record 时拒绝", () => {
    expect(checkPermission("update", null, schema, user)).toBe(false);
  });

  it("字符串/数字 ID 等价处理", () => {
    const s = schemaWith({ update: { mode: "ownerField", field: "id" } });
    expect(checkPermission("update", { id: 123 }, s, { id: "123", name: null })).toBe(true);
  });
});

describe("checkPermission - assigneeField / aclField 模式", () => {
  it("assigneeField 匹配时允许", () => {
    const schema = schemaWith({
      update: { mode: "assigneeField", field: "assigneeId" },
    });
    expect(checkPermission("update", { assigneeId: "u-1" }, schema, user)).toBe(true);
    expect(checkPermission("update", { assigneeId: "u-2" }, schema, user)).toBe(false);
  });

  it("aclField 匹配时允许", () => {
    const schema = schemaWith({
      read: { mode: "aclField", field: "acl" },
    });
    expect(checkPermission("read", { acl: "u-1" }, schema, user)).toBe(true);
    expect(checkPermission("read", { acl: "u-2" }, schema, user)).toBe(false);
  });
});

describe("checkPermission - when 状态条件", () => {
  const schema = schemaWith({
    update: {
      mode: "ownerField",
      field: "ownerId",
      when: { status: ["draft"] },
    },
  });

  it("记录字段匹配且状态满足条件时允许", () => {
    expect(
      checkPermission("update", { ownerId: "u-1", status: "draft" }, schema, user),
    ).toBe(true);
  });

  it("记录字段匹配但状态不满足时拒绝", () => {
    expect(
      checkPermission("update", { ownerId: "u-1", status: "approved" }, schema, user),
    ).toBe(false);
  });

  it("状态字段缺失时拒绝", () => {
    expect(checkPermission("update", { ownerId: "u-1" }, schema, user)).toBe(false);
  });
});

describe("checkPermission - 不同动作独立判断", () => {
  const schema = schemaWith({
    read: { mode: "authenticated" },
    update: { mode: "ownerField", field: "ownerId" },
    delete: { mode: "ownerField", field: "ownerId", when: { status: ["draft"] } },
  });

  it("read 用 authenticated 策略", () => {
    expect(checkPermission("read", {}, schema, user)).toBe(true);
  });

  it("update 用 ownerField 策略", () => {
    expect(checkPermission("update", { ownerId: "u-1" }, schema, user)).toBe(true);
    expect(checkPermission("update", { ownerId: "u-2" }, schema, user)).toBe(false);
  });

  it("delete 用 ownerField+when 策略", () => {
    expect(
      checkPermission("delete", { ownerId: "u-1", status: "draft" }, schema, user),
    ).toBe(true);
    expect(
      checkPermission("delete", { ownerId: "u-1", status: "archived" }, schema, user),
    ).toBe(false);
  });
});

describe("createCan", () => {
  it("返回绑定到指定用户的 can 函数", () => {
    const can = createCan(user);
    const schema = schemaWith({ update: { mode: "ownerField", field: "ownerId" } });
    expect(can("update", { ownerId: "u-1" }, schema)).toBe(true);
    expect(can("update", { ownerId: "u-2" }, schema)).toBe(false);
  });

  it("未登录用户对所有者策略一律拒绝", () => {
    const can = createCan(null);
    const schema = schemaWith({ update: { mode: "ownerField", field: "ownerId" } });
    expect(can("update", { ownerId: "u-1" }, schema)).toBe(false);
  });

  it("未登录用户对 authenticated 策略拒绝", () => {
    const can = createCan(null);
    const schema = schemaWith({ read: { mode: "authenticated" } });
    expect(can("read", {}, schema)).toBe(false);
  });

  it("undefined 用户视为未登录", () => {
    const can = createCan(undefined);
    expect(can("read", {}, schemaWith({ read: { mode: "authenticated" } }))).toBe(false);
  });

  it("切换用户后策略判断随之变化", () => {
    const schema = schemaWith({ update: { mode: "ownerField", field: "ownerId" } });
    const record = { ownerId: "u-1" };
    expect(createCan(user)("update", record, schema)).toBe(true);
    expect(createCan(otherUser)("update", record, schema)).toBe(false);
  });
});
