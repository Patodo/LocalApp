"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Ellipsis } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface IssueActionMenuItem {
  label: string;
  onSelect: (trigger: HTMLButtonElement | null) => void;
  destructive?: boolean;
  disabled?: boolean;
  restoreFocus?: boolean;
}

export function IssueActionMenu({ label, items }: { label: string; items: readonly IssueActionMenuItem[] }) {
  const menuId = useId();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const initialFocusRef = useRef<"first" | "last">("first");

  const close = (restoreFocus: boolean) => {
    setOpen(false);
    if (restoreFocus) window.requestAnimationFrame(() => triggerRef.current?.focus());
  };

  useEffect(() => {
    if (!open) return;
    const enabledItems = () => itemRefs.current.filter((item): item is HTMLButtonElement => Boolean(item && !item.disabled));
    const frame = window.requestAnimationFrame(() => {
      const available = enabledItems();
      (initialFocusRef.current === "last" ? available.at(-1) : available[0])?.focus();
    });
    const onPointerDown = (event: MouseEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) close(true);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.target instanceof Node) || !rootRef.current?.contains(event.target)) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close(true);
        return;
      }
      const available = enabledItems();
      if (available.length === 0) return;
      const currentIndex = Math.max(0, available.indexOf(document.activeElement as HTMLButtonElement));
      let next: HTMLButtonElement | undefined;
      if (event.key === "ArrowDown") next = available[(currentIndex + 1) % available.length];
      else if (event.key === "ArrowUp") next = available[(currentIndex - 1 + available.length) % available.length];
      else if (event.key === "Home") next = available[0];
      else if (event.key === "End") next = available.at(-1);
      else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
        const key = event.key.toLocaleLowerCase();
        next = [...available.slice(currentIndex + 1), ...available.slice(0, currentIndex + 1)].find((item) => item.textContent?.trim().toLocaleLowerCase().startsWith(key));
      }
      if (!next) return;
      event.preventDefault();
      event.stopPropagation();
      next.focus();
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open]);

  useEffect(() => {
    if (items.length === 0) setOpen(false);
  }, [items.length]);

  useEffect(() => {
    if (!open || items.length === 0 || rootRef.current?.contains(document.activeElement)) return;
    const frame = window.requestAnimationFrame(() => {
      itemRefs.current.find((item) => item && !item.disabled)?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [items, open]);

  if (items.length === 0) return null;
  return <div ref={rootRef} className="relative shrink-0">
    <Button ref={triggerRef} type="button" variant="ghost" size="icon" className="h-11 w-11 sm:h-8 sm:w-8" aria-label={label} aria-haspopup="menu" aria-controls={menuId} aria-expanded={open} onKeyDown={(event) => { if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return; event.preventDefault(); event.stopPropagation(); initialFocusRef.current = event.key === "ArrowUp" ? "last" : "first"; setOpen(true); }} onClick={() => { initialFocusRef.current = "first"; setOpen((value) => !value); }}><Ellipsis className="h-4 w-4" /></Button>
    {open && <div id={menuId} role="menu" aria-label={label} className="absolute right-0 top-12 z-30 min-w-40 overflow-hidden rounded-[6px] border bg-popover p-1 shadow-lg sm:top-9">
      {items.map((item, index) => <button ref={(element) => { itemRefs.current[index] = element; }} key={item.label} type="button" role="menuitem" disabled={item.disabled} className={`flex min-h-11 w-full items-center rounded px-3 text-left text-sm outline-none hover:bg-muted focus:bg-muted disabled:opacity-50 sm:min-h-8 sm:px-2.5 ${item.destructive ? "text-destructive" : "text-popover-foreground"}`} onClick={() => { close(item.restoreFocus !== false); item.onSelect(triggerRef.current); }}>{item.label}</button>)}
    </div>}
  </div>;
}
