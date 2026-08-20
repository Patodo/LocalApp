import { useEffect, useMemo, useState } from "react";
import {
  createLocalAppCrdt,
  type EditingPeer,
  type EditingTarget,
  type LocalAppCrdtOptions,
  type LocalAppCrdtProvider,
  type LocalAppCrdtStatus,
} from "./index.js";

export interface UseLocalAppCrdtResult {
  provider: LocalAppCrdtProvider;
  doc: LocalAppCrdtProvider["doc"];
  status: LocalAppCrdtStatus;
  peers: readonly EditingPeer[];
}

export function useLocalAppCrdt(options: LocalAppCrdtOptions): UseLocalAppCrdtResult {
  const provider = useMemo(() => createLocalAppCrdt({ ...options, autoConnect: false }), [
    options.resource,
    options.documentId,
    options.doc,
    options.basePath,
    options.clientId,
    options.awareness,
  ]);
  const [status, setStatus] = useState(provider.status);
  const [peers, setPeers] = useState<readonly EditingPeer[]>(provider.awareness);

  useEffect(() => {
    const offStatus = provider.onStatus(setStatus);
    const offAwareness = provider.onAwareness(setPeers);
    if (options.autoConnect !== false) void provider.connect();
    return () => {
      offStatus();
      offAwareness();
      void provider.destroy();
    };
  }, [options.autoConnect, provider]);

  return { provider, doc: provider.doc, status, peers };
}

export function useEditingTarget(
  provider: LocalAppCrdtProvider | null | undefined,
  target: EditingTarget | null | undefined,
  active = true,
): void {
  const surfaceId = target?.surfaceId;
  const fieldId = target?.fieldId;
  const label = target?.label;
  const kind = target?.kind;
  const anchor = target?.selection?.anchor;
  const head = target?.selection?.head;

  useEffect(() => {
    if (!provider || !active || !surfaceId) return;
    provider.setEditingTarget({
      surfaceId,
      ...(fieldId ? { fieldId } : {}),
      ...(label ? { label } : {}),
      ...(kind ? { kind } : {}),
      ...(anchor && head ? { selection: { anchor, head } } : {}),
    });
    return () => provider.setEditingTarget(null);
  }, [provider, active, surfaceId, fieldId, label, kind, anchor, head]);
}
