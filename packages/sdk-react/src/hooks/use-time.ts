import { useCallback, useEffect, useState } from "react";
import { LocalAppError, subscribe, type ServerTime } from "@localapp/sdk";
import { getClient } from "../client.js";

interface UseTimeResult {
  time: ServerTime | null;
  loading: boolean;
  error: LocalAppError | null;
  refresh: () => Promise<void>;
}

export function useTime(): UseTimeResult {
  const [time, setTime] = useState<ServerTime | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<LocalAppError | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setTime(await getClient().time());
    } catch (e) {
      setError(e instanceof LocalAppError ? e : new LocalAppError(String(e), 0));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => subscribe("__time", refresh), [refresh]);

  return { time, loading, error, refresh };
}
