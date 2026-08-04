"use client";

import { useEffect, useRef, useState } from "react";
import { ListPlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";

export function IssueTaskConvertDialog({ initialTitle, saving, error, onCancel, onConfirm }: {
  initialTitle: string;
  saving: boolean;
  error?: string | null;
  onCancel: () => void;
  onConfirm: (title: string) => Promise<void>;
}) {
  const [title, setTitle] = useState(initialTitle);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const count = Array.from(title).length;
  const invalid = !title.trim() || count > 256;
  useEffect(() => { inputRef.current?.focus(); inputRef.current?.select(); }, []);

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape" && !saving) { event.preventDefault(); event.stopPropagation(); onCancel(); return; }
    if (event.key !== "Tab") return;
    const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('input:not([disabled]), button:not([disabled])') ?? []);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };

  return <div data-localapp-issue-task-convert-layer className="absolute inset-0 z-[80] flex items-center justify-center bg-black/45 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onCancel(); }}>
    <div ref={dialogRef} role="alertdialog" aria-modal="true" aria-labelledby="issue-task-convert-title" aria-describedby="issue-task-convert-description" onKeyDown={onKeyDown} className="w-full max-w-lg overflow-hidden rounded-[6px] border bg-card shadow-2xl">
      <header className="flex items-center gap-3 border-b px-4 py-3"><ListPlus className="h-4 w-4" aria-hidden="true" /><h3 id="issue-task-convert-title" className="min-w-0 flex-1 text-sm font-semibold">转换为 Sub-issue</h3><Button type="button" variant="ghost" size="icon" className="h-11 w-11 sm:h-8 sm:w-8" aria-label="取消转换" disabled={saving} onClick={onCancel}><X className="h-4 w-4" /></Button></header>
      <div className="space-y-4 p-4"><p id="issue-task-convert-description" className="text-sm text-muted-foreground">将创建一个新的 Sub-issue，并把当前任务替换为可追踪的 Issue 引用。</p>{error && <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</div>}<label className="block space-y-1.5 text-sm font-medium"><span className="flex justify-between gap-3"><span>Sub-issue 标题</span><span className={count > 256 ? "text-destructive" : "text-muted-foreground"}>{count} / 256</span></span><input ref={inputRef} aria-label="Sub-issue 标题" aria-invalid={invalid || undefined} value={title} disabled={saving} onChange={(event) => setTitle(event.target.value)} className="block h-11 w-full rounded-md border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring" /></label></div>
      <footer className="flex justify-end gap-2 border-t px-4 py-3"><Button type="button" variant="ghost" size="sm" className="h-11 sm:h-8" disabled={saving} onClick={onCancel}>取消</Button><Button type="button" size="sm" className="h-11 sm:h-8" disabled={saving || invalid} onClick={() => { void onConfirm(title.trim()).catch(() => undefined); }}>{saving ? "正在创建..." : "创建 Sub-issue"}</Button></footer>
    </div>
  </div>;
}
