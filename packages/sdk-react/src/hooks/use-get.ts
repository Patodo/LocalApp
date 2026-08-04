import { useState, useEffect, useCallback } from "react";
import { LocalAppError, subscribe } from "@localapp/sdk";
import { getClient } from "../client.js";

interface UseGetResult<T> {
  row: T | null;
  loading: boolean;
  error: LocalAppError | null;
}

export function useGet<T = Record<string, unknown>>(resource: string, id: number | null): UseGetResult<T> {
  const [row, setRow] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<LocalAppError | null>(null);

  const fetch = useCallback(async () => {
    if (id === null) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      const data = await getClient().get<T>(resource, id);
      setRow(data ?? null);
    } catch (e) {
      setError(e instanceof LocalAppError ? e : new LocalAppError(String(e), 0));
    } finally {
      setLoading(false);
    }
  }, [resource, id]);

  useEffect(() => {
    fetch();
  }, [fetch]);

  useEffect(() => subscribe(resource, fetch), [resource, fetch]);

  return { row, loading, error };
}
