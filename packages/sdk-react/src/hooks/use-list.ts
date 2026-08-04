import { useState, useEffect, useCallback, useMemo } from "react";
import { LocalAppError, type Pagination, type ListOptions, subscribe } from "@localapp/sdk";
import { getClient } from "../client.js";

interface UseListResult<T> {
  rows: T[];
  pagination: Pagination;
  loading: boolean;
  error: LocalAppError | null;
  refresh: () => Promise<void>;
}

export function useList<T = Record<string, unknown>>(resource: string, options?: ListOptions): UseListResult<T> {
  const [rows, setRows] = useState<T[]>([]);
  const [pagination, setPagination] = useState<Pagination>({ offset: 0, limit: 50, total: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<LocalAppError | null>(null);

  const optionsKey = useMemo(() => JSON.stringify(options ?? {}), [options]);

  const fetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await getClient().list<T>(resource, options);
      setRows(result.rows);
      setPagination(result.pagination);
    } catch (e) {
      setError(e instanceof LocalAppError ? e : new LocalAppError(String(e), 0));
    } finally {
      setLoading(false);
    }
  }, [resource, optionsKey]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getClient().list<T>(resource, options).then((result) => {
      if (!cancelled) { setRows(result.rows); setPagination(result.pagination); setLoading(false); }
    }).catch((e) => {
      if (!cancelled) {
        setError(e instanceof LocalAppError ? e : new LocalAppError(String(e), 0));
        setLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, [resource, optionsKey]);

  useEffect(() => subscribe(resource, fetch), [resource, fetch]);

  return { rows, pagination, loading, error, refresh: fetch };
}
