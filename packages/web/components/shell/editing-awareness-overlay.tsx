"use client";

import { useEffect, useMemo, useRef, useState } from "react";

export interface EditingOverlayPeer {
  clientId: string;
  user: {
    id: string;
    name: string;
    displayName: string | null;
    avatarUrl: string | null;
    color: string;
  };
  editing: {
    surfaceId: string;
    fieldId?: string;
    label?: string;
    kind?: "field" | "selection" | "canvas";
  };
  overlay?: boolean;
}

type OverlayLayout = {
  key: string;
  maskId: string;
  left: number;
  top: number;
  width: number;
  height: number;
  peers: EditingOverlayPeer[];
};

export function EditingAwarenessOverlay({ peers }: { peers: EditingOverlayPeer[] }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [layouts, setLayouts] = useState<OverlayLayout[]>([]);
  const groupedPeers = useMemo(() => groupPeers(peers.filter((peer) => peer.overlay !== false)), [peers]);

  useEffect(() => {
    let frame = 0;
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const layer = rootRef.current;
        const appArea = layer?.closest<HTMLElement>("[data-localapp-app-area]");
        const appRoot = appArea?.querySelector<HTMLElement>("[data-localapp-app-root]");
        if (!layer || !appArea || !appRoot) {
          setLayouts([]);
          return;
        }
        const areaRect = appArea.getBoundingClientRect();
        const next: OverlayLayout[] = [];
        for (const [key, targetPeers] of groupedPeers) {
          const target = findEditingTarget(appRoot, targetPeers[0]);
          if (!target) continue;
          const rect = target.getBoundingClientRect();
          const visibleLeft = Math.max(rect.left, areaRect.left);
          const visibleTop = Math.max(rect.top, areaRect.top);
          const visibleRight = Math.min(rect.right, areaRect.right);
          const visibleBottom = Math.min(rect.bottom, areaRect.bottom);
          if (visibleRight <= visibleLeft || visibleBottom <= visibleTop || rect.width <= 0 || rect.height <= 0) continue;
          next.push({
            key,
            maskId: editingMaskId(targetPeers[0]),
            left: visibleLeft - areaRect.left,
            top: visibleTop - areaRect.top,
            width: visibleRight - visibleLeft,
            height: visibleBottom - visibleTop,
            peers: targetPeers,
          });
        }
        setLayouts(next);
      });
    };

    schedule();
    const appArea = rootRef.current?.closest<HTMLElement>("[data-localapp-app-area]");
    const appRoot = appArea?.querySelector<HTMLElement>("[data-localapp-app-root]");
    const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
    if (resize && appArea) resize.observe(appArea);
    if (resize && appRoot) resize.observe(appRoot);
    const mutation = typeof MutationObserver === "undefined" || !appRoot ? null : new MutationObserver(schedule);
    if (mutation && appRoot) {
      mutation.observe(appRoot, { subtree: true, childList: true, attributes: true, attributeFilter: ["style", "class", "hidden", "data-localapp-edit-surface", "data-localapp-edit-field"] });
    }
    window.addEventListener("resize", schedule);
    document.addEventListener("scroll", schedule, true);
    return () => {
      cancelAnimationFrame(frame);
      resize?.disconnect();
      mutation?.disconnect();
      window.removeEventListener("resize", schedule);
      document.removeEventListener("scroll", schedule, true);
    };
  }, [groupedPeers]);

  return (
    <div
      ref={rootRef}
      className="pointer-events-none absolute inset-0 z-30 overflow-hidden"
      data-localapp-editing-awareness-overlay
      aria-live="polite"
    >
      {layouts.map((layout) => {
        const primary = layout.peers[0];
        const color = safeColor(primary.user.color);
        const names = layout.peers.map(peerName);
        const fieldLabel = primary.editing.label;
        return (
          <div
            key={layout.key}
            className="absolute rounded-sm border-2 motion-safe:transition-[top,left,width,height] motion-safe:duration-100"
            style={{
              left: layout.left,
              top: layout.top,
              width: layout.width,
              height: layout.height,
              borderColor: color,
              background: `color-mix(in srgb, ${color} 10%, transparent)`,
              boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${color} 28%, transparent)`,
            }}
            data-localapp-editing-mask={layout.maskId}
          >
            <div
              className="absolute left-0 top-0 flex max-w-[min(22rem,90vw)] -translate-y-full items-center gap-1 overflow-hidden rounded-t px-1.5 py-0.5 text-[11px] font-medium leading-4 text-white shadow-sm"
              style={{ backgroundColor: color }}
            >
              <span className="truncate">{names.join("、")}</span>
              {fieldLabel && <span className="shrink-0 opacity-80">· {fieldLabel}</span>}
            </div>
          </div>
        );
      })}
      <span className="sr-only">
        {layouts.map((layout) => `${layout.peers.map(peerName).join("、")}正在编辑${layout.peers[0].editing.label ?? layout.peers[0].editing.fieldId ?? layout.peers[0].editing.surfaceId}`).join("；")}
      </span>
    </div>
  );
}

function groupPeers(peers: EditingOverlayPeer[]): Map<string, EditingOverlayPeer[]> {
  const groups = new Map<string, EditingOverlayPeer[]>();
  for (const peer of peers) {
    if (!validId(peer.editing.surfaceId) || (peer.editing.fieldId && !validId(peer.editing.fieldId))) continue;
    const key = `${peer.editing.surfaceId}\u0000${peer.editing.fieldId ?? ""}`;
    const group = groups.get(key) ?? [];
    if (!group.some((entry) => entry.clientId === peer.clientId)) group.push(peer);
    groups.set(key, group);
  }
  return groups;
}

function findEditingTarget(root: HTMLElement, peer: EditingOverlayPeer): HTMLElement | null {
  const surfaces = root.querySelectorAll<HTMLElement>("[data-localapp-edit-surface]");
  const surface = [...surfaces].find((element) => element.dataset.localappEditSurface === peer.editing.surfaceId);
  if (!surface || !peer.editing.fieldId) return surface ?? null;
  const fields = surface.querySelectorAll<HTMLElement>("[data-localapp-edit-field]");
  return [...fields].find((element) => element.dataset.localappEditField === peer.editing.fieldId) ?? surface;
}

function editingMaskId(peer: EditingOverlayPeer): string {
  return `${encodeURIComponent(peer.editing.surfaceId)}:${encodeURIComponent(peer.editing.fieldId ?? "")}`;
}

function validId(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$/.test(value);
}

function safeColor(value: string): string {
  return /^(#[0-9a-f]{6}|hsl\(\d{1,3} 72% 48%\))$/i.test(value) ? value : "#2563eb";
}

function peerName(peer: EditingOverlayPeer): string {
  return peer.user.displayName?.trim() || peer.user.name || "协作者";
}
