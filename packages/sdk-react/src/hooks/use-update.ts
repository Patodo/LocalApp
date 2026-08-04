import { useState, useCallback } from "react";
import { LocalAppError, invalidate } from "@localapp/sdk";
import { getClient } from "../client.js";

interface UseUpdateOptions<T> {
  onSuccess?: (data: T) => void;
}

interface UseUpdateResult<T> {
  update: (id: number, data: Record<string, unknown>) => Promise<T>;
  loading: boolean;
  error: LocalAppError | null;
}

export function useUpdate<T = Record<string, unknown>>(resource: string, options?: UseUpdateOptions<T>): UseUpdateResult<T> {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<LocalAppError | null>(null);

  const update = useCallback(async (id: number, data: Record<string, unknown>) => {
    setLoading(true);
    setError(null);
    try {
      const result = await getClient().update<T>(resource, id, data);
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
  }, [resource, options?.onSuccess]);

  return { update, loading, error };
}
