/**
 * React SDK 端的权限策略解析。
 *
 * 与服务端 record-access.ts 共享同一策略格式（ownerField / assigneeField / aclField
 * + when 状态条件），用于在前端判断是否展示某个操作按钮。
 *
 * 重要：本模块只用于 UI 展示判断，后端 CRUD API 才是记录级权限的安全边界。
 * 即使前端判断为「可以更新」，后端仍会再次校验。这里只是避免给用户展示无法使用的按钮。
 */

export type RecordAction = "read" | "create" | "update" | "delete";

export type RecordAccessMode = "ownerField" | "assigneeField" | "aclField" | "authenticated";

export interface RecordAccessPolicy {
  mode: RecordAccessMode;
  field?: string;
  when?: Record<string, unknown[]>;
}

export interface RecordAccess {
  read?: RecordAccessPolicy;
  create?: RecordAccessPolicy;
  update?: RecordAccessPolicy;
  delete?: RecordAccessPolicy;
}

export interface BusinessMetadata {
  kind?: string;
  ownerField?: string;
  assigneeField?: string;
  aclField?: string;
  statusField?: string;
  statuses?: unknown[];
  transitions?: unknown[];
  recordAccess?: RecordAccess;
}

export interface DataSchemaLike {
  business?: BusinessMetadata;
}

export interface CurrentUser {
  id: string;
  name?: string | null;
}

/**
 * 判断当前用户能否对特定记录执行某操作。
 *
 * - 无策略：返回 true（由后端兜底）
 * - mode=authenticated：登录即可
 * - mode=ownerField/assigneeField/aclField：record[field] 必须等于 user.id
 * - when 中的字段值必须在允许集合内
 */
export function checkPermission(
  action: RecordAction,
  record: Record<string, unknown> | null | undefined,
  schema: DataSchemaLike | null | undefined,
  user: CurrentUser | null | undefined,
): boolean {
  if (!user) return false;
  const policy = schema?.business?.recordAccess?.[action];
  if (!policy) return true;

  if (policy.mode === "authenticated") return true;

  const field = policy.field;
  if (!field) return true;

  if (!record) return false;
  const recordValue = record[field];
  if (recordValue === undefined || recordValue === null) return false;
  if (String(recordValue) !== String(user.id)) return false;

  if (policy.when) {
    for (const [key, allowed] of Object.entries(policy.when)) {
      if (!Array.isArray(allowed)) continue;
      if (!allowed.includes(record[key])) return false;
    }
  }
  return true;
}

/**
 * 创建绑定到特定用户的 `can` 函数，便于在 React Hook 中复用。
 */
export function createCan(user: CurrentUser | null | undefined) {
  return (
    action: RecordAction,
    record: Record<string, unknown> | null | undefined,
    schema: DataSchemaLike | null | undefined,
  ): boolean => checkPermission(action, record, schema, user);
}
