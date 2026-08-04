import { useState, useCallback } from "react";
import { LocalAppError, type UploadResult } from "@localapp/sdk";
import { getClient } from "../client.js";

interface UseUploadResult {
  upload: (file: File) => Promise<UploadResult>;
  loading: boolean;
  error: LocalAppError | null;
}

export function useUpload(): UseUploadResult {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<LocalAppError | null>(null);

  const upload = useCallback(async (file: File): Promise<UploadResult> => {
    setLoading(true);
    setError(null);
    try {
      return await getClient().upload(file);
    } catch (e) {
      const err = e instanceof LocalAppError ? e : new LocalAppError(String(e), 0);
      setError(err);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  return { upload, loading, error };
}
