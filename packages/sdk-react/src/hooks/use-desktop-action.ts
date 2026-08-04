import { useCallback, useEffect, useRef, useState } from "react";
import {
  desktop,
  DesktopActionError,
  type DesktopActionRequest,
  type DesktopActionResultError,
  type DesktopActionRunOptions,
  type DesktopActionSnapshot,
  type DesktopActionStatus,
} from "@localapp/sdk";

export interface UseDesktopActionResult<TResult = unknown> {
  run: (
    request: DesktopActionRequest,
    options?: DesktopActionRunOptions<TResult>,
  ) => Promise<DesktopActionSnapshot<TResult>>;
  requestId: string | null;
  status: DesktopActionStatus | null;
  result: TResult | null;
  loading: boolean;
  error: DesktopActionError | DesktopActionResultError | null;
}

export function useDesktopAction<TResult = unknown>(): UseDesktopActionResult<TResult> {
  const mountedRef = useRef(true);
  const runSequenceRef = useRef(0);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [status, setStatus] = useState<DesktopActionStatus | null>(null);
  const [result, setResult] = useState<TResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<DesktopActionError | DesktopActionResultError | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const run = useCallback(async (
    request: DesktopActionRequest,
    options: DesktopActionRunOptions<TResult> = {},
  ): Promise<DesktopActionSnapshot<TResult>> => {
    const sequence = ++runSequenceRef.current;
    const isCurrent = (): boolean => mountedRef.current && runSequenceRef.current === sequence;

    if (isCurrent()) {
      setRequestId(null);
      setStatus(null);
      setResult(null);
      setError(null);
      setLoading(true);
    }

    try {
      const snapshot = await desktop.run<TResult>(request, {
        ...options,
        onRequestId: (nextRequestId) => {
          if (isCurrent()) setRequestId(nextRequestId);
          options.onRequestId?.(nextRequestId);
        },
        onStatus: (nextSnapshot) => {
          if (isCurrent()) {
            setRequestId(nextSnapshot.requestId);
            setStatus(nextSnapshot.status);
            setResult(nextSnapshot.result);
            setError(nextSnapshot.error);
          }
          options.onStatus?.(nextSnapshot);
        },
      });
      if (isCurrent()) {
        setRequestId(snapshot.requestId);
        setStatus(snapshot.status);
        setResult(snapshot.result);
        setError(snapshot.error);
      }
      return snapshot;
    } catch (caught) {
      const desktopError = caught instanceof DesktopActionError
        ? caught
        : new DesktopActionError("request_failed", caught instanceof Error ? caught.message : String(caught));
      if (isCurrent()) {
        if (desktopError.requestId) setRequestId(desktopError.requestId);
        setError(desktopError);
      }
      throw desktopError;
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, []);

  return { run, requestId, status, result, loading, error };
}
