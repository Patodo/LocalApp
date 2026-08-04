"use client";

import { useEffect, useRef, useState } from "react";
import { SmilePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ISSUE_REACTION_CONTENTS, type IssueReaction, type IssueReactionContent } from "./issue-types";

const REACTION_EMOJI: Record<IssueReactionContent, string> = { "+1": "👍", "-1": "👎", laugh: "😄", hooray: "🎉", confused: "😕", heart: "❤️", rocket: "🚀", eyes: "👀" };

export function IssueReactions({ reactions, commentId = 0, currentUserId, disabled = false, additionsDisabled = false, onToggle }: {
  reactions: readonly IssueReaction[];
  commentId?: number;
  currentUserId?: string;
  disabled?: boolean;
  additionsDisabled?: boolean;
  onToggle: (content: IssueReactionContent, reacted: boolean, commentId?: number) => Promise<void>;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [saving, setSaving] = useState<IssueReactionContent | null>(null);
  const [reactionError, setReactionError] = useState("");
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const target = reactions.filter((reaction) => reaction.comment_id === commentId);
  const summaries = ISSUE_REACTION_CONTENTS.map((content) => ({ content, entries: target.filter((reaction) => reaction.content === content) })).filter((summary) => summary.entries.length > 0);
  const toggle = async (content: IssueReactionContent, reacted: boolean) => {
    setSaving(content);
    setReactionError("");
    try { await onToggle(content, reacted, commentId === 0 ? undefined : commentId); closePicker(true); }
    catch (error) { setReactionError(error instanceof Error ? error.message : "表态更新失败"); }
    finally { setSaving(null); }
  };
  const closePicker = (restoreFocus: boolean) => {
    setPickerOpen(false);
    setReactionError("");
    if (restoreFocus) window.requestAnimationFrame(() => triggerRef.current?.focus());
  };
  useEffect(() => {
    if (additionsDisabled || !currentUserId) setPickerOpen(false);
    if (additionsDisabled || !currentUserId) setReactionError("");
  }, [additionsDisabled, currentUserId]);
  useEffect(() => {
    if (!pickerOpen) return;
    const frame = window.requestAnimationFrame(() => itemRefs.current[0]?.focus());
    const closeOnOutside = (event: MouseEvent) => { if (event.target instanceof Node && !rootRef.current?.contains(event.target)) closePicker(true); };
    document.addEventListener("mousedown", closeOnOutside);
    return () => { window.cancelAnimationFrame(frame); document.removeEventListener("mousedown", closeOnOutside); };
  }, [pickerOpen]);
  const handlePickerKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closePicker(true); return; }
    if (!["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const items = itemRefs.current.filter((item): item is HTMLButtonElement => Boolean(item && !item.disabled));
    if (!items.length) return;
    const current = Math.max(0, items.indexOf(document.activeElement as HTMLButtonElement));
    const delta = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : event.key === "ArrowDown" ? 4 : event.key === "ArrowUp" ? -4 : 0;
    const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (current + delta + items.length) % items.length;
    event.preventDefault(); event.stopPropagation(); items[next]?.focus();
  };
  if (!currentUserId && summaries.length === 0) return null;
  return <div ref={rootRef} className="relative mt-3 flex flex-wrap items-center gap-1.5" data-localapp-issue-reactions>
    {reactionError && <p role="alert" className="w-full text-xs text-destructive">{reactionError}</p>}
    {summaries.map(({ content, entries }) => {
      const selected = Boolean(currentUserId && entries.some((reaction) => reaction.user_id === currentUserId));
      const label = `${REACTION_EMOJI[content]} ${entries.length} 个表态`;
      return currentUserId
        ? <Button key={content} type="button" variant={selected ? "secondary" : "outline"} size="sm" className="h-11 min-w-11 gap-1 rounded-full px-3 text-xs sm:h-7 sm:min-w-10 sm:px-2.5" aria-label={label} aria-pressed={selected} disabled={disabled || saving !== null || (additionsDisabled && !selected)} onClick={() => void toggle(content, !selected)}><span aria-hidden="true">{REACTION_EMOJI[content]}</span><span>{entries.length}</span></Button>
        : <span key={content} aria-label={label} className="inline-flex h-11 min-w-11 items-center justify-center gap-1 rounded-full border px-3 text-xs sm:h-7 sm:min-w-10 sm:px-2.5"><span aria-hidden="true">{REACTION_EMOJI[content]}</span><span>{entries.length}</span></span>;
    })}
    {currentUserId && !additionsDisabled && <Button ref={triggerRef} type="button" variant="ghost" size="icon" className="h-11 w-11 rounded-full sm:h-7 sm:w-7" aria-label="添加表态" aria-haspopup="menu" aria-expanded={pickerOpen} disabled={disabled || saving !== null} onClick={() => setPickerOpen((open) => !open)}><SmilePlus className="h-4 w-4" /></Button>}
    {pickerOpen && currentUserId && !additionsDisabled && <div className="absolute bottom-12 left-0 z-20 grid grid-cols-4 gap-1 rounded-md border bg-popover p-1.5 shadow-lg sm:bottom-9" role="menu" aria-label="选择表态" onKeyDown={handlePickerKeyDown}>{ISSUE_REACTION_CONTENTS.map((content, index) => { const selected = target.some((reaction) => reaction.content === content && reaction.user_id === currentUserId); return <button ref={(element) => { itemRefs.current[index] = element; }} key={content} type="button" role="menuitemcheckbox" aria-checked={selected} aria-label={`${selected ? "取消" : "添加"} ${REACTION_EMOJI[content]} 表态`} disabled={disabled || saving !== null} className={`flex h-11 w-11 items-center justify-center rounded outline-none hover:bg-muted focus:bg-muted focus:ring-2 focus:ring-ring sm:h-8 sm:w-8 ${selected ? "bg-muted" : ""}`} onClick={() => void toggle(content, !selected)}>{REACTION_EMOJI[content]}</button>; })}</div>}
  </div>;
}
