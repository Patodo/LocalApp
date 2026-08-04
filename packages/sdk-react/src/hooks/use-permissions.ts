import { useMemo } from "react";
import { LocalAppError, type User } from "@localapp/sdk";
import { useMe } from "./use-me.js";
import { createCan, type RecordAction, type DataSchemaLike } from "../permissions.js";

export interface CanFn {
  (
    action: RecordAction,
    record: Record<string, unknown> | null | undefined,
    schema?: DataSchemaLike | null,
  ): boolean;
}

export interface UsePermissionsResult {
  can: CanFn;
  loading: boolean;
  error: LocalAppError | null;
}

/**
 * 判断当前用户能否对记录执行操作，用于 UI 展示。
 *
 * 重要：仅用于 UI 展示判断（如隐藏不可用的按钮），后端 CRUD API 才是记录级权限的安全边界。
 * 敏感数据权限必须由后端记录级访问控制执行。
 */
export function usePermissions(): UsePermissionsResult {
  const { me, loading, error } = useMe();

  const can = useMemo(
    () => createCan(me ? { id: me.id, name: me.name } : null),
    [me],
  );

  return { can, loading, error };
}

export type { User };
