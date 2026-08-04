import { useState, useCallback } from "react";
import { LocalAppError, invalidate } from "@localapp/sdk";
import { getClient } from "../client.js";

interface UseDeleteOptions {
  onSuccess?: () => void;
}

interface UseDeleteResult {
  remove: (id: number) => Promise<void>;
  loading: boolean;
  error: LocalAppError | null;
}

export function useDelete(resource: string, options?: UseDeleteOptions): UseDeleteResult {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<LocalAppError | null>(null);

  const remove = useCallback(async (id: number) => {
    setLoading(true);
    setError(null);
    try {
      await getClient().delete(resource, id);
      options?.onSuccess?.();
      invalidate(resource);
    } catch (e) {
      const qe = e instanceof LocalAppError ? e : new LocalAppError(String(e), 0);
      setError(qe);
      throw qe;
    } finally {
      setLoading(false);
    }
  }, [resource, options?.onSuccess]);

  return { remove, loading, error };
}
