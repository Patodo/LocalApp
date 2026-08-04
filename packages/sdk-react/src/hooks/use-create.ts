import { useState, useCallback } from "react";
import { LocalAppError, invalidate } from "@localapp/sdk";
import { getClient } from "../client.js";

interface UseCreateOptions<T> {
  onSuccess?: (data: T) => void;
}

interface UseCreateResult<T> {
  create: (data: Record<string, unknown>) => Promise<T>;
  loading: boolean;
  error: LocalAppError | null;
}

export function useCreate<T = Record<string, unknown>>(resource: string, options?: UseCreateOptions<T>): UseCreateResult<T> {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<LocalAppError | null>(null);

  const create = useCallback(async (data: Record<string, unknown>) => {
    setLoading(true);
    setError(null);
    try {
      const result = await getClient().create<T>(resource, data);
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

  return { create, loading, error };
}
