import { useCallback, useState, useEffect } from "react";
import { LocalAppError, subscribe, type User } from "@localapp/sdk";
import { getClient } from "../client.js";

interface UseMeResult {
  me: User | null;
  loading: boolean;
  error: LocalAppError | null;
}

export function useMe(): UseMeResult {
  const [me, setMe] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<LocalAppError | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setMe(await getClient().me());
    } catch (e) {
      setError(e instanceof LocalAppError ? e : new LocalAppError(String(e), 0));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => subscribe("__me", refresh), [refresh]);

  return { me, loading, error };
}
