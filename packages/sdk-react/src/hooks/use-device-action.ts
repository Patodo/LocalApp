import { useCallback, useEffect, useRef, useState } from "react";
import {
  device,
  DeviceActionError,
  type DeviceActionRequest,
  type DeviceActionResultError,
  type DeviceActionRunOptions,
  type DeviceActionSnapshot,
  type DeviceActionStatus,
} from "@localapp/sdk";

export interface UseDeviceActionResult<TResult = unknown> {
  run: (request: DeviceActionRequest, options?: DeviceActionRunOptions<TResult>) => Promise<DeviceActionSnapshot<TResult>>;
  requestId: string | null;
  status: DeviceActionStatus | null;
  result: TResult | null;
  loading: boolean;
  error: DeviceActionError | DeviceActionResultError | null;
}

export function useDeviceAction<TResult = unknown>(): UseDeviceActionResult<TResult> {
  const mountedRef = useRef(true);
  const runSequenceRef = useRef(0);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [status, setStatus] = useState<DeviceActionStatus | null>(null);
  const [result, setResult] = useState<TResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<DeviceActionError | DeviceActionResultError | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const run = useCallback(async (request: DeviceActionRequest, options: DeviceActionRunOptions<TResult> = {}) => {
    const sequence = ++runSequenceRef.current;
    const current = () => mountedRef.current && runSequenceRef.current === sequence;
    if (current()) { setRequestId(null); setStatus(null); setResult(null); setError(null); setLoading(true); }
    try {
      const snapshot = await device.run<TResult>(request, {
        ...options,
        onRequestId: (id) => { if (current()) setRequestId(id); options.onRequestId?.(id); },
        onStatus: (next) => {
          if (current()) { setRequestId(next.requestId); setStatus(next.status); setResult(next.result); setError(next.error); }
          options.onStatus?.(next);
        },
      });
      if (current()) { setRequestId(snapshot.requestId); setStatus(snapshot.status); setResult(snapshot.result); setError(snapshot.error); }
      return snapshot;
    } catch (caught) {
      const actionError = caught instanceof DeviceActionError
        ? caught
        : new DeviceActionError("request_failed", caught instanceof Error ? caught.message : String(caught));
      if (current()) { if (actionError.requestId) setRequestId(actionError.requestId); setError(actionError); }
      throw actionError;
    } finally {
      if (current()) setLoading(false);
    }
  }, []);

  return { run, requestId, status, result, loading, error };
}
