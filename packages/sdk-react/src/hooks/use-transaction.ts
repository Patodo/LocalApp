import { useCallback, useState } from "react";
import { type ExecResult, type NamedMutationStep, LocalAppError } from "@localapp/sdk";
import { getClient } from "../client.js";

export interface UseTransactionResult<T = ExecResult[]> {
  transaction: (mutations: NamedMutationStep[]) => Promise<T>;
  loading: boolean;
  error: LocalAppError | null;
}

export function useTransaction<T = ExecResult[]>(): UseTransactionResult<T> {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<LocalAppError | null>(null);

  const transaction = useCallback(async (mutations: NamedMutationStep[]): Promise<T> => {
    setLoading(true);
    setError(null);
    try {
      return await getClient().transaction<T>(mutations);
    } catch (e) {
      const qe = e instanceof LocalAppError ? e : new LocalAppError(String(e), 0);
      setError(qe);
      throw qe;
    } finally {
      setLoading(false);
    }
  }, []);

  return { transaction, loading, error };
}
