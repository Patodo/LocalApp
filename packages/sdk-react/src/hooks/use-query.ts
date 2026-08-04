import { useCallback, useState } from "react";
import { type NamedQueryResult, LocalAppError } from "@localapp/sdk";
import { getClient } from "../client.js";

export interface UseQueryResult<T = NamedQueryResult> {
  query: (name: string, params?: Record<string, unknown>) => Promise<T>;
  loading: boolean;
  error: LocalAppError | null;
}

export function useQuery<T = NamedQueryResult>(): UseQueryResult<T> {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<LocalAppError | null>(null);

  const query = useCallback(async (name: string, params?: Record<string, unknown>): Promise<T> => {
    setLoading(true);
    setError(null);
    try {
      return await getClient().query<T>(name, params);
    } catch (e) {
      const qe = e instanceof LocalAppError ? e : new LocalAppError(String(e), 0);
      setError(qe);
      throw qe;
    } finally {
      setLoading(false);
    }
  }, []);

  return { query, loading, error };
}
