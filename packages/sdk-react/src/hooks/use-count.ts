import { useState, useEffect, useCallback } from "react";
import { LocalAppError, subscribe } from "@localapp/sdk";
import { getClient } from "../client.js";

interface UseCountResult {
  count: number;
  loading: boolean;
  error: LocalAppError | null;
  refresh: () => Promise<void>;
}

export function useCount(resource: string, filters?: Record<string, string>): UseCountResult {
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<LocalAppError | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getClient().count(resource, filters);
      setCount(data);
    } catch (e) {
      setError(e instanceof LocalAppError ? e : new LocalAppError(String(e), 0));
    } finally {
      setLoading(false);
    }
  }, [resource, JSON.stringify(filters)]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => subscribe(resource, refresh), [resource, refresh]);

  return { count, loading, error, refresh };
}
