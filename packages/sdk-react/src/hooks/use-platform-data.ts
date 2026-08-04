import { useCallback, useEffect, useState } from "react";
import { LocalAppError } from "@localapp/sdk";

interface ApiResponse<T> {
  success: boolean;
  data: T;
  error?: string;
}

export interface UsePlatformDataResult<T> {
  data: T[];
  loading: boolean;
  error: LocalAppError | null;
  refresh: () => Promise<void>;
}

export interface PlatformUser {
  id: string;
  name: string;
  displayName?: string | null;
  avatarUrl?: string | null;
  role: string;
}

export interface PlatformGroup {
  id: string;
  name: string;
  description?: string;
  memberCount: number;
}

export interface PlatformRole {
  id: string;
  name: string;
  permissions: string[];
}

async function readPlatformDataResponse<T>(res: Response, resource: string): Promise<ApiResponse<T[]>> {
  try {
    return (await res.json()) as ApiResponse<T[]>;
  } catch {
    throw new LocalAppError(
      `Expected JSON from /api/platform/${resource}. If this is local development, start with npm run dev or localapp dev so requests reach the local mini-server.`,
      res.status,
    );
  }
}

export function usePlatformData<T = Record<string, unknown>>(resource: string): UsePlatformDataResult<T> {
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<LocalAppError | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/platform/${resource}`, { method: "GET" });
      const body = await readPlatformDataResponse<T>(res, resource);
      if (!res.ok || body.success === false) throw new LocalAppError(body.error || `HTTP ${res.status}`, res.status);
      setData(body.data);
    } catch (e) {
      setError(e instanceof LocalAppError ? e : new LocalAppError(String(e), 0));
    } finally {
      setLoading(false);
    }
  }, [resource]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/platform/${resource}`, { method: "GET" });
        const body = await readPlatformDataResponse<T>(res, resource);
        if (!res.ok || body.success === false) throw new LocalAppError(body.error || `HTTP ${res.status}`, res.status);
        if (!cancelled) setData(body.data);
      } catch (e) {
        if (!cancelled) setError(e instanceof LocalAppError ? e : new LocalAppError(String(e), 0));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [resource]);

  return { data, loading, error, refresh };
}
