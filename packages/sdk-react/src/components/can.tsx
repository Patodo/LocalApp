import { type ReactNode } from "react";
import { usePermissions } from "../hooks/use-permissions.js";
import type { RecordAction, DataSchemaLike } from "../permissions.js";

export interface CanProps {
  action: RecordAction;
  record?: Record<string, unknown> | null;
  schema?: DataSchemaLike | null;
  children: ReactNode;
  /**
   * 当用户无权限时渲染的兜底内容。默认不渲染任何节点。
   */
  fallback?: ReactNode;
}

/**
 * 根据当前用户对记录的权限条件渲染子节点。
 *
 * 仅用于 UI 展示判断，后端 CRUD API 才是记录级权限的安全边界。
 */
export function Can({ action, record, schema, children, fallback = null }: CanProps) {
  const { can } = usePermissions();
  return <>{can(action, record ?? null, schema ?? null) ? children : fallback}</>;
}
