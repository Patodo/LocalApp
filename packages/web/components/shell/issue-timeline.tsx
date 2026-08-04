"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Bell, ChevronDown, CircleCheck, CircleDot, LockKeyhole, LockOpen, Pin, RefreshCcw, Tag, Trash2, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { IssueActor } from "./issue-actor";
import { clearIssueAttachmentDraft, discardIssueAttachmentDraft, IssueComposer } from "./issue-composer";
import { resolveIssueIdentity } from "./issue-identity";
import { IssueMarkdown } from "./issue-markdown";
import { ISSUE_COMMENT_MINIMIZED_REASON_LABELS, ISSUE_LOCK_REASON_LABELS, attachmentUrl, formatFileSize, isSafeImage, type IssueAttachment, type IssueCommentMinimizedReason, type IssueLockReason, type IssueReaction, type IssueReactionContent, type IssueTimelineItem, type IssueUserIdentity } from "./issue-types";
import { IssueReactions } from "./issue-reactions";
import { IssueActionMenu } from "./issue-action-menu";
import { filterIssueTimeline, groupIssueTimeline, type IssueTimelineDisplayItem, type IssueTimelineFilter } from "./issue-timeline-group";

const ISSUE_TIMELINE_PAGE_SIZE = 20;
import { IssueTime } from "./issue-time";
import { clearIssueCommentDeepLinkUrl } from "./issue-deep-link";
import { IssueDiscardDraftControl } from "./issue-discard-draft-control";
import { filterUnreferencedIssueAttachments } from "./issue-attachment-references";
import { IssueCrossReference } from "./issue-cross-reference";

function eventUserChanges(payloadJson: string): { added: string[]; removed: string[] } {
  try {
    const payload = JSON.parse(payloadJson) as { from?: unknown; to?: unknown };
    const from = Array.isArray(payload.from) ? payload.from.filter((value): value is string => typeof value === "string").slice(0, 20) : [];
    const to = Array.isArray(payload.to) ? payload.to.filter((value): value is string => typeof value === "string").slice(0, 20) : [];
    return { added: to.filter((value) => !from.includes(value)), removed: from.filter((value) => !to.includes(value)) };
  } catch {
    return { added: [], removed: [] };
  }
}

function eventNumber(payloadJson: string, key: string): number | null {
  try {
    const value = (JSON.parse(payloadJson) as Record<string, unknown>)[key];
    return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
  } catch { return null; }
}

function eventText(item: Extract<IssueTimelineItem, { kind: "event" }>, identities: readonly IssueUserIdentity[]): string {
  const event = item.event;
  if (event.event_type === "opened") return "打开了此 Issue";
  if (event.event_type === "closed") {
    try { return JSON.parse(event.payload_json)?.stateReason === "not_planned" ? "以不计划处理关闭了此 Issue" : "以已完成关闭了此 Issue"; }
    catch { return "以已完成关闭了此 Issue"; }
  }
  if (event.event_type === "reopened") return "重新打开了此 Issue";
  if (event.event_type === "edited") return "编辑了此 Issue";
  if (event.event_type === "labels_changed") return "更新了标签";
  if (event.event_type === "assignees_changed") {
    const { added, removed } = eventUserChanges(event.payload_json);
    if (added.length === 1 && removed.length === 0) return `将 ${resolveIssueIdentity(added[0], identities).displayName} 设为负责人`;
    if (removed.length === 1 && added.length === 0) return `取消了 ${resolveIssueIdentity(removed[0], identities).displayName} 的负责人`;
    return "更新了负责人";
  }
  if (event.event_type === "subscribed") return "订阅了此 Issue";
  if (event.event_type === "unsubscribed") return "取消订阅了此 Issue";
  if (event.event_type === "locked") {
    try {
      const reason = JSON.parse(event.payload_json)?.reason as IssueLockReason | undefined;
      return reason && ISSUE_LOCK_REASON_LABELS[reason] ? `锁定了对话（${ISSUE_LOCK_REASON_LABELS[reason]}）` : "锁定了对话";
    } catch { return "锁定了对话"; }
  }
  if (event.event_type === "unlocked") return "解锁了对话";
  if (event.event_type === "pinned") return "置顶了此 Issue";
  if (event.event_type === "unpinned") return "取消置顶了此 Issue";
  if (event.event_type === "comment_pinned") return `置顶了评论 #${eventNumber(event.payload_json, "commentId") ?? "?"}`;
  if (event.event_type === "comment_unpinned") return `取消置顶了评论 #${eventNumber(event.payload_json, "commentId") ?? "?"}`;
  if (event.event_type === "comment_minimized") return `最小化了评论 #${eventNumber(event.payload_json, "commentId") ?? "?"}`;
  if (event.event_type === "comment_unminimized") return `恢复了评论 #${eventNumber(event.payload_json, "commentId") ?? "?"}`;
  if (event.event_type === "sub_issue_added") return `添加了 Sub-issue #${eventNumber(event.payload_json, "childIssueNumber") ?? "?"}`;
  if (event.event_type === "sub_issue_removed") return `移除了 Sub-issue #${eventNumber(event.payload_json, "childIssueNumber") ?? "?"}`;
  if (event.event_type === "parent_added") return `设置了父 Issue #${eventNumber(event.payload_json, "parentIssueNumber") ?? "?"}`;
  if (event.event_type === "parent_removed") return `移除了父 Issue #${eventNumber(event.payload_json, "parentIssueNumber") ?? "?"}`;
  if (event.event_type === "marked_as_duplicate") return `将此 Issue 标记为 #${eventNumber(event.payload_json, "canonicalIssueNumber") ?? "?"} 的重复项`;
  if (event.event_type === "unmarked_as_duplicate") return `撤销了与 #${eventNumber(event.payload_json, "canonicalIssueNumber") ?? "?"} 的重复关系`;
  return "更新了此 Issue";
}

function EventIcon({ type }: { type: string }) {
  if (type === "closed") return <CircleCheck className="h-4 w-4" aria-hidden="true" />;
  if (type === "reopened") return <RefreshCcw className="h-4 w-4" aria-hidden="true" />;
  if (type === "labels_changed") return <Tag className="h-4 w-4" aria-hidden="true" />;
  if (type === "assignees_changed") return <UserRound className="h-4 w-4" aria-hidden="true" />;
  if (type === "subscribed" || type === "unsubscribed") return <Bell className="h-4 w-4" aria-hidden="true" />;
  if (type === "locked") return <LockKeyhole className="h-4 w-4" aria-hidden="true" />;
  if (type === "unlocked") return <LockOpen className="h-4 w-4" aria-hidden="true" />;
  if (type === "pinned" || type === "unpinned" || type === "comment_pinned" || type === "comment_unpinned") return <Pin className="h-4 w-4" aria-hidden="true" />;
  return <CircleDot className="h-4 w-4" aria-hidden="true" />;
}

function AttachmentLinks({ pagePath, attachments, onRemove }: { pagePath: string; attachments: IssueAttachment[]; onRemove?: (attachmentId: string) => void }) {
  if (!attachments.length) return null;
  return <div className="mt-3 grid gap-2 sm:grid-cols-2">{attachments.map((attachment) => {
    const url = attachmentUrl(pagePath, attachment.id);
    return <div key={attachment.id} className="flex min-w-0 items-center gap-1">{isSafeImage(attachment.mime_type)
      ? <a href={url} target="_blank" rel="noreferrer" aria-label={`在新标签页打开附件 ${attachment.file_name}`} className="block min-w-0 flex-1 overflow-hidden rounded border"><img src={url} alt={attachment.file_name} loading="lazy" decoding="async" className="max-h-64 w-full object-contain" /></a>
      : <a href={url} target="_blank" rel="noreferrer" aria-label={`在新标签页打开附件 ${attachment.file_name}`} className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded border px-3 py-2 text-xs text-primary hover:underline"><span className="min-w-0 flex-1 truncate">{attachment.file_name}</span><span className="shrink-0 text-muted-foreground">{formatFileSize(attachment.size_bytes)}</span></a>}
      {onRemove && <Button type="button" variant="ghost" size="icon" className="h-11 w-11 shrink-0 sm:h-8 sm:w-8" aria-label={`移除现有附件 ${attachment.file_name}`} onClick={() => onRemove(attachment.id)}><Trash2 className="h-4 w-4" /></Button>}
    </div>;
  })}</div>;
}

function EditEventGroup({ item, identities }: { item: Extract<IssueTimelineDisplayItem, { kind: "event-group" }>; identities: readonly IssueUserIdentity[] }) {
  const [expanded, setExpanded] = useState(false);
  const actor = resolveIssueIdentity(item.actorId!, identities).displayName;
  return <li data-localapp-issue-event-group className="relative min-w-0 py-2 pl-3 text-xs text-muted-foreground before:absolute before:bottom-0 before:left-[19px] before:top-0 before:w-px before:bg-border">
    <div className="flex min-w-0 items-center gap-2"><span className="relative z-10 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-card"><CircleDot className="h-4 w-4" aria-hidden="true" /></span><button type="button" aria-expanded={expanded} aria-controls={`${item.key}-events`} className="flex min-w-0 items-center gap-1 rounded text-left hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => setExpanded((value) => !value)}><strong className="font-semibold text-foreground">{actor}</strong><span>编辑了此 Issue {item.events.length} 次</span><ChevronDown className={`h-3.5 w-3.5 transition-transform motion-reduce:transition-none ${expanded ? "rotate-180" : ""}`} aria-hidden="true" /></button></div>
    {expanded && <ol id={`${item.key}-events`} aria-label={`${actor} 的编辑事件`} className="ml-6 mt-2 space-y-1 border-l pl-3">{item.events.map((event) => <li key={event.id}><IssueTime timestamp={event.created_at} precise /></li>)}</ol>}
  </li>;
}

function HistoryEventGroup({ item, identities }: { item: Extract<IssueTimelineDisplayItem, { kind: "event-group" }>; identities: readonly IssueUserIdentity[] }) {
  const [expanded, setExpanded] = useState(false);
  const actor = item.actorId ? resolveIssueIdentity(item.actorId, identities).displayName : null;
  return <li data-localapp-issue-history-group className="relative min-w-0 py-2 pl-3 text-xs text-muted-foreground before:absolute before:bottom-0 before:left-[19px] before:top-0 before:w-px before:bg-border">
    <div className="flex min-w-0 items-center gap-2"><span className="relative z-10 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-card"><CircleDot className="h-4 w-4" aria-hidden="true" /></span><button type="button" aria-expanded={expanded} aria-controls={`${item.key}-events`} className="flex min-w-0 items-center gap-1 rounded text-left hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => setExpanded((value) => !value)}>{actor && <><strong className="font-semibold text-foreground">{actor}</strong><span>进行了</span></>}<span>{item.events.length} 项历史更新</span><ChevronDown className={`h-3.5 w-3.5 shrink-0 transition-transform motion-reduce:transition-none ${expanded ? "rotate-180" : ""}`} aria-hidden="true" /></button></div>
    {expanded && <ol id={`${item.key}-events`} aria-label={`历史更新明细，共 ${item.events.length} 项`} className="ml-6 mt-2 space-y-2 border-l pl-3">{item.events.map((event) => <li key={event.id} className="flex min-w-0 items-start gap-2"><span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center"><EventIcon type={event.event_type} /></span><span className="min-w-0 break-words"><strong className="font-semibold text-foreground">{resolveIssueIdentity(event.actor_id, identities).displayName}</strong> {eventText({ kind: "event", event }, identities)} <IssueTime timestamp={event.created_at} precise /></span></li>)}</ol>}
  </li>;
}

interface IssueTimelineProps {
  issueId: number;
  reporterId: string;
  pagePath: string;
  timeline: IssueTimelineItem[];
  attachments: IssueAttachment[];
  identities: readonly IssueUserIdentity[];
  currentUserId?: string;
  reactions: IssueReaction[];
  commentDraftPrefix?: string;
  onToggleReaction: (content: IssueReactionContent, reacted: boolean, commentId?: number) => Promise<void>;
  onEditComment: (commentId: number, body: string, expectedUpdatedAt: string, draftId: string, attachmentIds: string[], removedAttachmentIds: string[]) => Promise<void>;
  onDeleteComment: (commentId: number) => Promise<void>;
  onQuoteComment: (body: string, authorId: string) => void;
  onReferenceComment: (commentId: number, body: string, authorId: string, trigger: HTMLButtonElement | null) => void;
  selectedCommentId?: number | null;
  getCommentHref: (commentId: number) => string;
  getIssueReferenceHref?: (issueNumber: number) => string;
  onOpenIssueReference?: (issueNumber: number, commentId?: number | null) => void;
  onCopyCommentLink: (commentId: number) => Promise<void>;
  onViewHistory: (commentId: number, trigger: HTMLButtonElement) => void;
  savingTaskTarget?: number | null;
  onToggleCommentTask?: (commentId: number, taskIndex: number, checked: boolean) => Promise<void>;
  interactionsLocked?: boolean;
  canManageCommentPins?: boolean;
  onToggleCommentPin?: (commentId: number, pinned: boolean) => Promise<void>;
  canManageCommentMinimization?: boolean;
  onToggleCommentMinimized?: (commentId: number, reason: IssueCommentMinimizedReason | null) => Promise<void>;
}

export function quoteIssueComment(body: string, authorId: string): string {
  const quoted = body.trim().split(/\r?\n/).map((line) => `> ${line}`).join("\n");
  return `${quoted}\n\n@${authorId} `;
}

export function IssueTimeline({ issueId, reporterId, pagePath, timeline, attachments, identities, currentUserId, reactions, commentDraftPrefix, onToggleReaction, onEditComment, onDeleteComment, onQuoteComment, onReferenceComment, selectedCommentId, getCommentHref, getIssueReferenceHref, onOpenIssueReference, onCopyCommentLink, onViewHistory, savingTaskTarget, onToggleCommentTask, interactionsLocked = false, canManageCommentPins = false, onToggleCommentPin, canManageCommentMinimization = false, onToggleCommentMinimized }: IssueTimelineProps) {
  const timelineRef = useRef<HTMLOListElement | null>(null);
  const revealEarlierRef = useRef<HTMLButtonElement | null>(null);
  const [editing, setEditing] = useState<{ id: number; expectedUpdatedAt: string; restoredDraft: boolean; draftId: string; removedAttachmentIds: string[] } | null>(null);
  const previousEditingIdRef = useRef<number | null>(null);
  const [deleting, setDeleting] = useState<number | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState<number | null>(null);
  const deleteCommentTriggerRef = useRef<HTMLButtonElement | null>(null);
  const deleteCommentCancelRef = useRef<HTMLButtonElement | null>(null);
  const deleteCommentConfirmRef = useRef<HTMLButtonElement | null>(null);
  const [copyAnnouncement, setCopyAnnouncement] = useState("");
  const [pinningCommentId, setPinningCommentId] = useState<number | null>(null);
  const [pinError, setPinError] = useState<string | null>(null);
  const [expandedMinimizedComments, setExpandedMinimizedComments] = useState<Set<number>>(() => new Set());
  const [minimizingCommentId, setMinimizingCommentId] = useState<number | null>(null);
  const [minimizedReason, setMinimizedReason] = useState<IssueCommentMinimizedReason>("off-topic");
  const [minimizationError, setMinimizationError] = useState<string | null>(null);
  const [minimizationSaving, setMinimizationSaving] = useState(false);
  const [activityFilter, setActivityFilter] = useState<IssueTimelineFilter>("all");
  const [visibleActivityCount, setVisibleActivityCount] = useState(ISSUE_TIMELINE_PAGE_SIZE);
  const filteredTimeline = filterIssueTimeline(timeline, activityFilter);
  const pinnedComment = filteredTimeline.find((item): item is Extract<IssueTimelineItem, { kind: "comment" }> => item.kind === "comment" && Boolean(item.comment.pinned_at) && !item.comment.deleted_at);
  if (pinnedComment) {
    filteredTimeline.splice(filteredTimeline.indexOf(pinnedComment), 1);
    filteredTimeline.unshift(pinnedComment);
  }
  const displayTimeline = groupIssueTimeline(filteredTimeline);
  const selectedDisplayIndex = selectedCommentId ? displayTimeline.findIndex((item) => item.kind === "comment" && item.comment.id === selectedCommentId) : -1;
  const defaultVisibleStart = Math.max(0, displayTimeline.length - visibleActivityCount);
  const visibleStart = selectedDisplayIndex >= 0 ? Math.min(defaultVisibleStart, selectedDisplayIndex) : defaultVisibleStart;
  const visibleDisplayTimeline = displayTimeline.slice(visibleStart);
  const hiddenTimelineCount = visibleStart;
  const activityCounts = { all: timeline.length, comments: timeline.filter((item) => item.kind === "comment").length, history: timeline.filter((item) => item.kind !== "comment").length };
  const activityOptions: Array<{ value: IssueTimelineFilter; label: string }> = [{ value: "all", label: "全部" }, { value: "comments", label: "评论" }, { value: "history", label: "历史" }];
  const selectedCommentVisible = Boolean(selectedCommentId && timeline.some((item) => item.kind === "comment" && item.comment.id === selectedCommentId && !item.comment.deleted_at));
  const commentDraftKey = (commentId: number, part: "body" | "version") => commentDraftPrefix ? `${commentDraftPrefix}:${commentId}:${part}` : undefined;
  const clearCommentDraft = (commentId: number, discardAttachments = false) => {
    try { (["body", "version"] as const).forEach((part) => { const key = commentDraftKey(commentId, part); if (key) window.sessionStorage.removeItem(key); }); } catch { /* Ignore unavailable storage. */ }
    const bodyKey = commentDraftKey(commentId, "body");
    if (discardAttachments) discardIssueAttachmentDraft(pagePath, bodyKey);
    else clearIssueAttachmentDraft(bodyKey);
  };

  useEffect(() => {
    setActivityFilter("all");
    setVisibleActivityCount(ISSUE_TIMELINE_PAGE_SIZE);
    setExpandedMinimizedComments(new Set());
    setMinimizingCommentId(null);
  }, [issueId]);

  useEffect(() => {
    setVisibleActivityCount(ISSUE_TIMELINE_PAGE_SIZE);
  }, [activityFilter]);

  useEffect(() => {
    if (selectedCommentVisible) setActivityFilter("comments");
  }, [selectedCommentId, selectedCommentVisible]);

  useEffect(() => {
    const previousEditingId = previousEditingIdRef.current;
    previousEditingIdRef.current = editing?.id ?? null;
    if (previousEditingId === null || editing !== null) return;
    const frame = window.requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-testid="issue-comment-${previousEditingId}"]`)?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [editing]);

  useEffect(() => {
    if (!editing) return;
    const editedComment = timeline.find((item): item is Extract<IssueTimelineItem, { kind: "comment" }> => item.kind === "comment" && item.comment.id === editing.id);
    if (editedComment && !editedComment.comment.deleted_at) return;
    setEditing(null);
    setCopyAnnouncement("评论已被删除，编辑已结束");
  }, [editing, timeline]);

  useEffect(() => {
    if (!selectedCommentVisible || activityFilter !== "comments") return;
    const frame = window.requestAnimationFrame(() => {
      const item = document.querySelector<HTMLElement>(`[data-testid="issue-comment-${selectedCommentId}"]:not([data-deleted="true"])`);
      if (!item) return;
      item.scrollIntoView?.({ block: "center" });
      item.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activityFilter, selectedCommentId, selectedCommentVisible, timeline]);

  useEffect(() => {
    if (confirmingDelete === null) return;
    const frame = window.requestAnimationFrame(() => deleteCommentCancelRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [confirmingDelete]);

  useEffect(() => {
    if (confirmingDelete === null) return;
    const confirmedComment = timeline.find((item): item is Extract<IssueTimelineItem, { kind: "comment" }> => item.kind === "comment" && item.comment.id === confirmingDelete);
    if (confirmedComment && !confirmedComment.comment.deleted_at) return;
    const commentId = confirmingDelete;
    setConfirmingDelete(null);
    window.requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-testid="issue-comment-${commentId}"]`)?.focus());
  }, [confirmingDelete, timeline]);

  const restoreDeleteCommentTriggerFocus = () => {
    setConfirmingDelete(null);
    window.requestAnimationFrame(() => deleteCommentTriggerRef.current?.focus());
  };

  const remove = async (commentId: number) => {
    setDeleting(commentId);
    try {
      await onDeleteComment(commentId);
      setConfirmingDelete(null);
      setCopyAnnouncement("评论已删除");
      const url = clearIssueCommentDeepLinkUrl(new URL(window.location.href), commentId);
      if (url.href !== window.location.href) window.history.replaceState(window.history.state, "", url);
      window.requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-testid="issue-comment-${commentId}"]`)?.focus());
    } catch {
      // The parent owns the visible mutation error.
    } finally {
      setDeleting(null);
    }
  };
  const handleDeleteConfirmationKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); restoreDeleteCommentTriggerFocus(); return; }
    if (event.key !== "Tab") return;
    if (event.shiftKey && document.activeElement === deleteCommentCancelRef.current) {
      event.preventDefault();
      deleteCommentConfirmRef.current?.focus();
    } else if (!event.shiftKey && document.activeElement === deleteCommentConfirmRef.current) {
      event.preventDefault();
      deleteCommentCancelRef.current?.focus();
    }
  };

  return (
    <><span role="status" aria-live="polite" aria-atomic="true" aria-label="时间线操作状态" className="sr-only">{copyAnnouncement}</span><div className="mb-3 flex min-w-0 flex-col items-stretch gap-2 border-y py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3"><span className="shrink-0 whitespace-nowrap text-xs font-medium text-muted-foreground">活动</span><div role="radiogroup" aria-label="筛选时间线活动" className="grid w-full grid-cols-3 rounded-md border bg-muted/20 p-0.5 sm:w-auto">{activityOptions.map((option, index) => <button key={option.value} type="button" role="radio" aria-checked={activityFilter === option.value} tabIndex={activityFilter === option.value ? 0 : -1} onClick={() => setActivityFilter(option.value)} onKeyDown={(event) => { let nextIndex: number; if (event.key === "Home") nextIndex = 0; else if (event.key === "End") nextIndex = activityOptions.length - 1; else if (["ArrowLeft", "ArrowUp"].includes(event.key)) nextIndex = (index - 1 + activityOptions.length) % activityOptions.length; else if (["ArrowRight", "ArrowDown"].includes(event.key)) nextIndex = (index + 1) % activityOptions.length; else return; event.preventDefault(); const next = activityOptions[nextIndex]; setActivityFilter(next.value); window.requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(`[data-issue-activity-filter="${next.value}"]`)?.focus()); }} data-issue-activity-filter={option.value} className={`h-11 rounded px-2.5 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-7 ${activityFilter === option.value ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>{option.label} {activityCounts[option.value]}</button>)}</div></div>{displayTimeline.length === 0 ? <div role="status" className="rounded-md border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">{activityFilter === "comments" ? "还没有评论" : activityFilter === "history" ? "还没有历史活动" : "还没有活动"}</div> : <ol ref={timelineRef} tabIndex={-1} aria-label="Issue 时间线" className="space-y-3 outline-none focus-visible:ring-2 focus-visible:ring-ring">
      {hiddenTimelineCount > 0 && <li className="relative z-10 flex justify-center bg-background py-1"><button ref={revealEarlierRef} type="button" aria-label={`显示更早的 ${hiddenTimelineCount} 条活动`} className="h-11 rounded-md border px-3 text-xs font-medium text-muted-foreground hover:bg-muted/30 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-8" onClick={() => { const revealingLastPage = hiddenTimelineCount <= ISSUE_TIMELINE_PAGE_SIZE; setVisibleActivityCount((count) => count + ISSUE_TIMELINE_PAGE_SIZE); window.requestAnimationFrame(() => { if (revealingLastPage) timelineRef.current?.focus(); else revealEarlierRef.current?.focus(); }); }}>显示更早活动 · {hiddenTimelineCount}</button></li>}
      {visibleDisplayTimeline.map((item) => item.kind === "event-group" ? item.groupType === "edited" ? <EditEventGroup key={item.key} item={item} identities={identities} /> : <HistoryEventGroup key={item.key} item={item} identities={identities} /> : item.kind === "event" ? (
        <li key={`event-${item.event.id}`} data-localapp-issue-event data-testid={`issue-event-${item.event.id}`} className="relative flex min-w-0 items-center gap-2 py-2 pl-3 text-xs text-muted-foreground before:absolute before:bottom-0 before:left-[19px] before:top-0 before:w-px before:bg-border">
          <span className="relative z-10 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-card"><EventIcon type={item.event.event_type} /></span>
          <span className="min-w-0 break-words"><strong className="font-semibold text-foreground">{resolveIssueIdentity(item.event.actor_id, identities).displayName}</strong> {eventText(item, identities)} <IssueTime timestamp={item.event.created_at} /></span>
        </li>
      ) : item.kind === "cross_reference" ? <IssueCrossReference key={`cross-reference-${item.crossReference.id}`} reference={item.crossReference} actorName={resolveIssueIdentity(item.crossReference.actor_id, identities).displayName} href={(() => { const base = getIssueReferenceHref?.(item.crossReference.source_issue_number) ?? "#"; if (item.crossReference.source_comment_id === null || base === "#") return base; const url = new URL(base, window.location.origin); url.searchParams.set("localappIssueCommentId", String(item.crossReference.source_comment_id)); return `${url.pathname}${url.search}${url.hash}`; })()} onOpen={(issueNumber, commentId) => onOpenIssueReference?.(issueNumber, commentId)} /> : (
        <li id={`issuecomment-${item.comment.id}`} key={`comment-${item.comment.id}`} data-localapp-issue-comment-card data-localapp-issue-comment-pinned={item.comment.pinned_at ? "true" : undefined} data-testid={`issue-comment-${item.comment.id}`} data-deleted={item.comment.deleted_at ? "true" : undefined} tabIndex={-1} aria-current={selectedCommentId === item.comment.id && !item.comment.deleted_at ? "location" : undefined} className={`min-w-0 overflow-hidden rounded-[6px] border bg-card outline-none ${item.comment.pinned_at ? "border-primary/50" : ""} ${selectedCommentId === item.comment.id && !item.comment.deleted_at ? "ring-2 ring-primary ring-offset-2" : ""}`}>
          {item.comment.pinned_at && <div className="flex min-h-9 items-center gap-2 border-b border-primary/20 bg-primary/5 px-4 py-2 text-xs font-medium text-foreground"><Pin className="h-3.5 w-3.5 text-primary" aria-hidden="true" /><span>置顶评论</span><span className="text-muted-foreground">由 {resolveIssueIdentity(item.comment.pinned_by ?? "", identities).displayName} 置顶 <IssueTime timestamp={item.comment.pinned_at} /></span></div>}
          <div className="border-b bg-muted/20 px-4 py-3"><IssueActor identity={resolveIssueIdentity(item.comment.author_id, identities)} timestamp={item.comment.created_at} timestampHref={item.comment.deleted_at ? undefined : getCommentHref(item.comment.id)} timestampSuffix={!item.comment.deleted_at && item.comment.revision_count ? <button type="button" aria-label={`查看评论编辑历史，${item.comment.revision_count} 次修改`} className="-my-2 inline-flex h-11 items-center px-1 text-muted-foreground hover:underline sm:-my-0 sm:h-6" onClick={(event) => onViewHistory(item.comment.id, event.currentTarget)}>edited</button> : undefined} badge={item.comment.author_id === reporterId ? "Author" : undefined} action={!item.comment.deleted_at ? <IssueActionMenu label="评论操作" items={[{ label: "复制评论链接", onSelect: () => { setCopyAnnouncement(""); void onCopyCommentLink(item.comment.id).then(() => setCopyAnnouncement("评论链接已复制")).catch(() => setCopyAnnouncement("无法复制评论链接")); } }, ...(canManageCommentPins && onToggleCommentPin ? [{ label: item.comment.pinned_at ? "取消置顶评论" : "置顶评论", disabled: pinningCommentId !== null, restoreFocus: false, onSelect: async () => { setPinError(null); setPinningCommentId(item.comment.id); try { await onToggleCommentPin(item.comment.id, !item.comment.pinned_at); window.requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-testid="issue-comment-${item.comment.id}"]`)?.focus()); } catch (error) { setPinError(error instanceof Error ? error.message : "无法更新置顶评论"); } finally { setPinningCommentId(null); } } }] : []), ...(canManageCommentMinimization && onToggleCommentMinimized ? [{ label: item.comment.minimized_at ? "取消最小化评论" : "最小化评论", restoreFocus: false, disabled: minimizationSaving, onSelect: (trigger: HTMLButtonElement | null) => { if (item.comment.minimized_at) { setMinimizationSaving(true); void onToggleCommentMinimized(item.comment.id, null).then(() => window.requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-testid="issue-comment-${item.comment.id}"]`)?.focus())).catch((error) => setCopyAnnouncement(error instanceof Error ? error.message : "无法恢复评论")).finally(() => setMinimizationSaving(false)); } else { deleteCommentTriggerRef.current = trigger; setMinimizedReason("off-topic"); setMinimizationError(null); setMinimizingCommentId(item.comment.id); } } }] : []), ...(currentUserId ? [{ label: "引用到新 Issue", restoreFocus: false, onSelect: (trigger: HTMLButtonElement | null) => onReferenceComment(item.comment.id, item.comment.body, item.comment.author_id, trigger) }] : []), ...(currentUserId && !interactionsLocked ? [{ label: "引用回复", restoreFocus: false, onSelect: () => onQuoteComment(item.comment.body, item.comment.author_id) }] : []), ...(currentUserId === item.comment.author_id ? [{ label: "编辑评论", restoreFocus: false, disabled: deleting === item.comment.id || confirmingDelete === item.comment.id, onSelect: () => { const versionKey = commentDraftKey(item.comment.id, "version"); const bodyKey = commentDraftKey(item.comment.id, "body"); let expectedUpdatedAt = item.comment.updated_at; let restoredDraft = false; try { const storedVersion = versionKey && window.sessionStorage.getItem(versionKey); restoredDraft = Boolean(storedVersion || (bodyKey && window.sessionStorage.getItem(bodyKey))); expectedUpdatedAt = storedVersion || expectedUpdatedAt; if (versionKey) window.sessionStorage.setItem(versionKey, expectedUpdatedAt); } catch { /* Ignore unavailable storage. */ } setEditing({ id: item.comment.id, expectedUpdatedAt, restoredDraft, draftId: crypto.randomUUID(), removedAttachmentIds: [] }); } }, { label: "删除评论", restoreFocus: false, destructive: true, disabled: deleting === item.comment.id, onSelect: (trigger: HTMLButtonElement | null) => { deleteCommentTriggerRef.current = trigger; setConfirmingDelete(item.comment.id); } }] : [])]} /> : undefined} /></div>
          <div className="px-3 py-3">
            {minimizingCommentId === item.comment.id && <div role="alertdialog" aria-label="最小化评论" className="mb-3 rounded-md border bg-muted/20 p-3"><p className="text-sm font-medium">选择最小化原因</p><div className="mt-3 grid gap-2 sm:grid-cols-2">{Object.entries(ISSUE_COMMENT_MINIMIZED_REASON_LABELS).map(([value, label]) => <label key={value} className="flex min-h-11 items-center gap-2 rounded border px-3 py-2 text-sm"><input type="radio" name={`minimize-reason-${item.comment.id}`} value={value} checked={minimizedReason === value} onChange={() => setMinimizedReason(value as IssueCommentMinimizedReason)} />{label}</label>)}</div>{minimizationError && <p role="alert" className="mt-3 text-sm text-destructive">{minimizationError}</p>}<div className="mt-3 flex justify-end gap-2"><Button type="button" variant="ghost" size="sm" className="h-11 sm:h-8" disabled={minimizationSaving} onClick={() => { setMinimizingCommentId(null); setMinimizationError(null); window.requestAnimationFrame(() => deleteCommentTriggerRef.current?.focus()); }}>取消</Button><Button type="button" size="sm" className="h-11 sm:h-8" disabled={minimizationSaving} onClick={() => { if (!onToggleCommentMinimized) return; setMinimizationSaving(true); setMinimizationError(null); void onToggleCommentMinimized(item.comment.id, minimizedReason).then(() => { setMinimizingCommentId(null); window.requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-testid="issue-comment-${item.comment.id}"]`)?.focus()); }).catch((error) => setMinimizationError(error instanceof Error ? error.message : "无法最小化评论")).finally(() => setMinimizationSaving(false)); }}>最小化评论</Button></div></div>}
            {confirmingDelete === item.comment.id && <div role="alertdialog" aria-label="删除评论确认" aria-describedby={`delete-comment-${item.comment.id}-description`} onKeyDown={handleDeleteConfirmationKeyDown} className="mb-3 rounded-md border border-destructive/30 bg-destructive/5 p-3"><p className="text-sm font-medium">确定删除这条评论吗？</p><p id={`delete-comment-${item.comment.id}-description`} className="mt-1 text-xs text-muted-foreground">删除后评论内容将不再显示。</p><div className="mt-3 flex flex-wrap justify-end gap-2"><Button ref={deleteCommentCancelRef} type="button" variant="ghost" size="sm" className="h-11 sm:h-8" disabled={deleting === item.comment.id} onClick={restoreDeleteCommentTriggerFocus}>取消删除</Button><Button ref={deleteCommentConfirmRef} type="button" variant="destructive" size="sm" className="h-11 sm:h-8" disabled={deleting === item.comment.id} onClick={() => void remove(item.comment.id)}>确认删除评论</Button></div></div>}
            {item.comment.deleted_at ? <p className="text-sm italic text-muted-foreground">此评论已删除。</p> : item.comment.minimized_at && !expandedMinimizedComments.has(item.comment.id) ? <div data-localapp-issue-comment-minimized className="flex min-h-11 flex-wrap items-center gap-2 text-sm text-muted-foreground"><span>此评论已最小化 · {ISSUE_COMMENT_MINIMIZED_REASON_LABELS[item.comment.minimized_reason ?? "off-topic"]}</span><Button type="button" variant="ghost" size="sm" className="h-11 sm:h-8" onClick={() => setExpandedMinimizedComments((current) => new Set(current).add(item.comment.id))}>显示评论</Button></div> : editing?.id === item.comment.id ? <>{editing.expectedUpdatedAt !== item.comment.updated_at && <div role="status" className="mb-3 flex items-center justify-between gap-3 rounded-md border bg-muted/30 px-3 py-2 text-sm"><span>此评论有新变更，当前草稿尚未被覆盖。</span><Button type="button" variant="outline" size="sm" className="h-11 shrink-0 sm:h-8" onClick={() => { clearCommentDraft(item.comment.id, true); setEditing(null); }}>加载最新内容</Button></div>}{editing.restoredDraft && <div role="status" className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/30 px-3 py-2 text-sm"><span>已恢复上次未完成的编辑</span><IssueDiscardDraftControl triggerLabel="丢弃已恢复草稿" onConfirm={() => { clearCommentDraft(item.comment.id, true); setEditing(null); }} focusAfterConfirm={() => document.getElementById(`issuecomment-${item.comment.id}`)?.focus()} /></div>}<IssueComposer key={`edit-comment-${item.comment.id}-${editing.expectedUpdatedAt}`} pagePath={pagePath} draftId={editing.draftId} persistenceKey={commentDraftKey(item.comment.id, "body")} preferPersistedDraft initialBody={item.comment.body} textareaLabel="编辑评论内容" placeholder="更新评论" submitLabel="保存评论" allowEmpty={attachments.some((attachment) => attachment.comment_id === item.comment.id && !editing.removedAttachmentIds.includes(attachment.id))} mentionCandidates={identities} onCancel={() => { clearCommentDraft(item.comment.id, true); setEditing(null); }} onSubmit={async ({ body, attachmentIds, draftId }) => { await onEditComment(item.comment.id, body, editing.expectedUpdatedAt, draftId, attachmentIds, editing.removedAttachmentIds); clearCommentDraft(item.comment.id); setEditing(null); }} /><AttachmentLinks pagePath={pagePath} attachments={attachments.filter((attachment) => attachment.comment_id === item.comment.id && !editing.removedAttachmentIds.includes(attachment.id))} onRemove={(attachmentId) => setEditing((current) => current ? { ...current, removedAttachmentIds: [...current.removedAttachmentIds, attachmentId] } : current)} /></> : <><IssueMarkdown tasksDisabled={interactionsLocked || savingTaskTarget === item.comment.id} onToggleTask={currentUserId === item.comment.author_id && onToggleCommentTask ? (taskIndex, checked) => { void onToggleCommentTask(item.comment.id, taskIndex, checked).catch(() => undefined); } : undefined} getIssueReferenceHref={getIssueReferenceHref} onOpenIssueReference={onOpenIssueReference}>{item.comment.body}</IssueMarkdown><AttachmentLinks pagePath={pagePath} attachments={filterUnreferencedIssueAttachments(item.comment.body, attachments.filter((attachment) => attachment.comment_id === item.comment.id))} /><IssueReactions reactions={reactions} commentId={item.comment.id} currentUserId={currentUserId} additionsDisabled={interactionsLocked} onToggle={onToggleReaction} /></>}
          </div>
        </li>
      ))}
    </ol>}</>
  );
}
