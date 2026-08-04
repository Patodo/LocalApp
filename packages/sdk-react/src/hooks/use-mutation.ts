import { useCallback, useState } from "react";
import { type ExecResult, LocalAppError } from "@localapp/sdk";
import { getClient } from "../client.js";

export interface UseMutationResult<T = ExecResult> {
  mutate: (name: string, params?: Record<string, unknown>) => Promise<T>;
  loading: boolean;
  error: LocalAppError | null;
}

export function useMutation<T = ExecResult>(): UseMutationResult<T> {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<LocalAppError | null>(null);

  const mutate = useCallback(async (name: string, params?: Record<string, unknown>): Promise<T> => {
    setLoading(true);
    setError(null);
    try {
      return await getClient().mutate<T>(name, params);
    } catch (e) {
      const qe = e instanceof LocalAppError ? e : new LocalAppError(String(e), 0);
      setError(qe);
      throw qe;
    } finally {
      setLoading(false);
    }
  }, []);

  return { mutate, loading, error };
}
