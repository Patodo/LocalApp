import { useState, useCallback, useMemo } from "react";
import { LocalAppError, invalidate, availableTransitions, type TransitionInfo, type ExecResult } from "@localapp/sdk";
import { getClient } from "../client.js";
import type { BusinessMetadata } from "../permissions.js";

export interface UseTransitionsOptions<T> {
  onSuccess?: (data: ExecResult) => void;
}

export interface UseTransitionsResult {
  transitions: TransitionInfo[];
  transition: (name: string, payload?: Record<string, unknown>) => Promise<ExecResult>;
  loading: boolean;
  error: LocalAppError | null;
}

/**
 * 根据 schema 元数据本地计算当前 record 可执行的 transitions，并通过 named mutation
 * 执行状态流转。
 *
 * 平台不再提供 GET/POST /api/<resource>/:id/transitions 端点（restrict-app-api-to-named-sql
 * 变更整体移除了 transition 服务端执行入口）。前端用 availableTransitions 本地计算，
 * 状态流转改由应用在 backend/resources/<resource>/mutations.json 中声明对应的
 * named mutation（如 $<resource>.approve）承担。
 *
 * 用法：
 * ```tsx
 * const schema = { statusField: "status", transitions: [
 *   { name: "approve", from: ["pending"], to: "approved", label: "批准" }
 * ]};
 * const { transitions, transition } = useTransitions("leaves", record, schema);
 * transitions.map(t => <button onClick={() => transition(t.name)}>{t.label}</button>)
 * ```
 */
export function useTransitions<TRecord extends { id?: number } = Record<string, unknown>>(
  resource: string,
  record: TRecord | null,
  schema: BusinessMetadata,
  options?: UseTransitionsOptions<TRecord>,
): UseTransitionsResult {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<LocalAppError | null>(null);

  const transitions = useMemo(() => {
    if (!record) return [];
    return availableTransitions(
      {
        statusField: schema.statusField,
        transitions: schema.transitions as Array<{ name: string; label?: string; to: unknown; from?: unknown[] }> | undefined,
      },
      record as Record<string, unknown>,
    );
  }, [record, schema.statusField, schema.transitions]);

  const transition = useCallback(
    async (name: string, payload?: Record<string, unknown>) => {
      if (!record?.id) {
        throw new LocalAppError("Cannot execute transition: record.id is missing", 0);
      }
      setLoading(true);
      setError(null);
      try {
        const result = await getClient().mutate<ExecResult>(`$${resource}.${name}`, {
          id: record.id,
          ...(payload ?? {}),
        });
        options?.onSuccess?.(result);
        invalidate(resource);
        return result;
      } catch (e) {
        const qe = e instanceof LocalAppError ? e : new LocalAppError(String(e), 0);
        setError(qe);
        throw qe;
      } finally {
        setLoading(false);
      }
    },
    [resource, record?.id, options?.onSuccess],
  );

  return { transitions, transition, loading, error };
}
