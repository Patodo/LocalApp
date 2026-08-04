import { useCallback, useEffect, useState } from "react";
import { LocalAppError, type PlatformCapabilities } from "@localapp/sdk";

import { getClient } from "../client.js";

export interface UseCapabilitiesResult {
  capabilities: PlatformCapabilities | null;
  loading: boolean;
  error: LocalAppError | null;
  refresh: () => Promise<void>;
}

export function useCapabilities(): UseCapabilitiesResult {
  const [capabilities, setCapabilities] = useState<PlatformCapabilities | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<LocalAppError | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setCapabilities(await getClient().capabilities());
    } catch (caught) {
      setError(caught instanceof LocalAppError ? caught : new LocalAppError(String(caught), 0));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { capabilities, loading, error, refresh };
}
