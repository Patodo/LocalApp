"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

interface IssueDiscardDraftControlProps {
  triggerLabel: string;
  onConfirm: () => void;
  focusAfterConfirm?: () => void;
}

export function IssueDiscardDraftControl({ triggerLabel, onConfirm, focusAfterConfirm }: IssueDiscardDraftControlProps) {
  const [confirming, setConfirming] = useState(false);
  const descriptionId = `issue-discard-draft-${useId().replace(/[^A-Za-z0-9_-]/g, "")}`;
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const confirmRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (confirming) cancelRef.current?.focus();
  }, [confirming]);

  const keepDraft = () => {
    setConfirming(false);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  };

  const discardDraft = () => {
    setConfirming(false);
    onConfirm();
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => focusAfterConfirm?.()));
  };

  return <>
    <Button ref={triggerRef} type="button" variant="ghost" size="sm" className="h-11 shrink-0 sm:h-8" aria-expanded={confirming} onClick={() => setConfirming(true)}>{triggerLabel}</Button>
    {confirming && <div role="alertdialog" aria-label="丢弃草稿确认" aria-describedby={descriptionId} onKeyDown={(event) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); keepDraft(); return; }
      if (event.key !== "Tab") return;
      if (event.shiftKey && document.activeElement === cancelRef.current) { event.preventDefault(); confirmRef.current?.focus(); }
      else if (!event.shiftKey && document.activeElement === confirmRef.current) { event.preventDefault(); cancelRef.current?.focus(); }
    }} className="basis-full rounded-md border border-destructive/30 bg-destructive/5 p-3">
      <p className="font-medium">丢弃草稿？</p>
      <p id={descriptionId} className="mt-1 text-sm text-muted-foreground">未提交内容和已上传附件将被清除且无法恢复。</p>
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        <Button ref={cancelRef} type="button" variant="ghost" size="sm" className="h-11 sm:h-8" onClick={keepDraft}>保留草稿</Button>
        <Button ref={confirmRef} type="button" variant="destructive" size="sm" className="h-11 sm:h-8" onClick={discardDraft}>确认丢弃</Button>
      </div>
    </div>}
  </>;
}
