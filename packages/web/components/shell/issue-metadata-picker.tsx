"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Check, Pencil, Search } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface IssueMetadataPickerItem {
  id: string;
  label: string;
  description?: string;
  leading?: ReactNode;
}

interface IssueMetadataPickerProps {
  label: string;
  accessibleLabel?: string;
  items: readonly IssueMetadataPickerItem[];
  selectedIds: readonly string[];
  disabled?: boolean;
  onToggle: (id: string, selected: boolean) => Promise<void> | void;
}

export function IssueMetadataPicker({ label, accessibleLabel, items, selectedIds, disabled = false, onToggle }: IssueMetadataPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [toggleError, setToggleError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const optionRefs = useRef<Array<HTMLInputElement | null>>([]);
  const dialogId = useId();
  const localizedLabel = accessibleLabel ?? (label === "Labels" ? "标签" : label === "Assignees" ? "负责人" : label);
  const editLabel = `编辑${localizedLabel}`;
  const chooseLabel = `选择${localizedLabel}`;
  const searchLabel = `搜索${localizedLabel}`;
  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return items;
    return items.filter((item) => `${item.label}\n${item.id}\n${item.description ?? ""}`.toLocaleLowerCase().includes(needle));
  }, [items, query]);

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => searchRef.current?.focus());
    const closeOnOutside = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", closeOnOutside);
    return () => { window.cancelAnimationFrame(frame); document.removeEventListener("mousedown", closeOnOutside); };
  }, [open]);

  const closeWithFocus = () => {
    setOpen(false);
    setQuery("");
    setToggleError(null);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  };
  const toggle = async (item: IssueMetadataPickerItem) => {
    if (pendingId || disabled) return;
    setToggleError(null);
    setPendingId(item.id);
    try { await onToggle(item.id, !selected.has(item.id)); }
    catch (error) { setToggleError(error instanceof Error ? error.message : `${localizedLabel}更新失败`); }
    finally { setPendingId(null); }
  };
  const handlePickerKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closeWithFocus(); return; }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key) || filtered.length === 0) return;
    const currentIndex = optionRefs.current.findIndex((option) => option === document.activeElement);
    let nextIndex = currentIndex;
    if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = filtered.length - 1;
    else if (event.key === "ArrowDown") nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % filtered.length;
    else nextIndex = currentIndex < 0 ? filtered.length - 1 : (currentIndex - 1 + filtered.length) % filtered.length;
    event.preventDefault();
    optionRefs.current[nextIndex]?.focus();
  };

  return <div ref={rootRef} className="relative">
    <Button ref={triggerRef} type="button" variant="ghost" size="icon" className="h-11 w-11 sm:h-7 sm:w-7" aria-label={editLabel} title={editLabel} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? dialogId : undefined} disabled={disabled} onClick={() => { setOpen((value) => !value); setQuery(""); setToggleError(null); }}><Pencil className="h-3.5 w-3.5" /></Button>
    {open && <div id={dialogId} role="dialog" aria-label={chooseLabel} onKeyDown={handlePickerKeyDown} className="absolute right-0 top-12 z-40 w-[min(320px,calc(100vw-2rem))] overflow-hidden rounded-[6px] border bg-popover text-popover-foreground shadow-lg sm:top-8">
      <div className="relative border-b p-2"><Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" /><input ref={searchRef} type="search" role="searchbox" aria-label={searchLabel} value={query} onChange={(event) => setQuery(event.target.value)} className="h-11 w-full rounded border bg-background pl-8 pr-2 text-sm outline-none focus:ring-2 focus:ring-ring sm:h-8" /></div>
      {toggleError && <div role="alert" className="mx-2 mt-2 rounded border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">{toggleError}</div>}
      <div className="max-h-64 overflow-y-auto p-1">{filtered.length === 0 ? <p className="px-3 py-8 text-center text-sm text-muted-foreground">没有匹配项</p> : filtered.map((item, index) => <label key={item.id} className="flex min-h-11 cursor-pointer items-center gap-2 rounded px-2 py-1.5 hover:bg-muted focus-within:bg-muted focus-within:ring-2 focus-within:ring-ring"><input ref={(node) => { optionRefs.current[index] = node; }} type="checkbox" className="sr-only" aria-label={item.label} checked={selected.has(item.id)} disabled={disabled || pendingId !== null} onChange={() => void toggle(item)} /><span aria-hidden="true" className="flex h-4 w-4 shrink-0 items-center justify-center rounded border">{selected.has(item.id) && <Check className="h-3 w-3" />}</span>{item.leading}<span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{item.label}</span><span className="block truncate text-xs text-muted-foreground">{item.description || item.id}</span></span></label>)}</div>
    </div>}
  </div>;
}
