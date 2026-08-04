import { useCallback, useState } from "react";
import { LocalAppError } from "@localapp/sdk";
import { getClient } from "../client.js";

export interface UseActionResult<TInput = unknown, TResult = unknown> {
  run: (input?: TInput) => Promise<TResult>;
  loading: boolean;
  error: LocalAppError | null;
}

/**
 * @deprecated Hosted backend actions are disabled in stable LocalApp.
 * Use useQuery(), useMutation(), transaction mutation helpers, or a platform primitive instead.
 */
export function useAction<TInput = unknown, TResult = unknown>(name: string): UseActionResult<TInput, TResult> {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<LocalAppError | null>(null);

  const run = useCallback(async (input?: TInput): Promise<TResult> => {
    setLoading(true);
    setError(null);
    try {
      return await getClient().action<TResult>(name, input);
    } catch (e) {
      const qe = e instanceof LocalAppError ? e : new LocalAppError(String(e), 0);
      setError(qe);
      throw qe;
    } finally {
      setLoading(false);
    }
  }, [name]);

  return { run, loading, error };
}
