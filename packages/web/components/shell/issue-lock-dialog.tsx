"use client";

import { useEffect, useRef, useState } from "react";
import { LockKeyhole, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ISSUE_LOCK_REASON_LABELS, type IssueLockReason } from "./issue-types";

const REASONS = Object.entries(ISSUE_LOCK_REASON_LABELS) as Array<[IssueLockReason, string]>;

export function IssueLockDialog({ saving, error, onCancel, onConfirm }: {
  saving: boolean;
  error?: string | null;
  onCancel: () => void;
  onConfirm: (reason: IssueLockReason) => Promise<void>;
}) {
  const [reason, setReason] = useState<IssueLockReason>("resolved");
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const selectRef = useRef<HTMLSelectElement | null>(null);

  useEffect(() => { selectRef.current?.focus(); }, []);

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape" && !saving) { event.preventDefault(); event.stopPropagation(); onCancel(); return; }
    if (event.key !== "Tab") return;
    const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), select:not([disabled])') ?? []);
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };

  return <div data-localapp-issue-lock-layer className="absolute inset-0 z-[80] flex items-center justify-center bg-black/45 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onCancel(); }}>
    <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="issue-lock-title" aria-describedby="issue-lock-description" onKeyDown={onKeyDown} className="w-full max-w-md overflow-hidden rounded-[6px] border bg-card shadow-2xl">
      <header className="flex items-center gap-3 border-b px-4 py-3"><LockKeyhole className="h-4 w-4" aria-hidden="true" /><h3 id="issue-lock-title" className="min-w-0 flex-1 text-sm font-semibold">锁定对话</h3><Button type="button" variant="ghost" size="icon" className="h-11 w-11 sm:h-8 sm:w-8" aria-label="取消锁定" disabled={saving} onClick={onCancel}><X className="h-4 w-4" /></Button></header>
      <div className="space-y-4 p-4"><p id="issue-lock-description" className="text-sm text-muted-foreground">锁定后，参与者无法新增评论、表态或勾选任务。现有内容仍然可见。</p>{error && <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</div>}<label className="block space-y-1.5 text-sm font-medium">锁定原因<select ref={selectRef} aria-label="锁定原因" value={reason} disabled={saving} onChange={(event) => setReason(event.target.value as IssueLockReason)} className="block h-11 w-full rounded-md border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring sm:h-9">{REASONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div>
      <footer className="flex justify-end gap-2 border-t px-4 py-3"><Button type="button" variant="ghost" size="sm" className="h-11 sm:h-8" disabled={saving} onClick={onCancel}>取消</Button><Button type="button" size="sm" className="h-11 sm:h-8" disabled={saving} onClick={() => { void onConfirm(reason).catch(() => undefined); }}>{saving ? "正在锁定..." : "确认锁定"}</Button></footer>
    </div>
  </div>;
}
