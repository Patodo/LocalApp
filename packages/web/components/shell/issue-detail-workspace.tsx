import { useEffect, useRef, useState, type ReactNode } from "react";
import { Bell, BellOff, CircleCheck, CircleDot, CircleSlash2, LockKeyhole, LockOpen, Pin, PinOff, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { IssueActor } from "./issue-actor";
import { resolveIssueIdentity } from "./issue-identity";
import { IssueLabelBadge } from "./issue-label-badge";
import { IssueMarkdown } from "./issue-markdown";
import { IssueMetadataPicker } from "./issue-metadata-picker";
import { IssueTimeline } from "./issue-timeline";
import { IssueReactions } from "./issue-reactions";
import { IssueLockDialog } from "./issue-lock-dialog";
import { IssueTime } from "./issue-time";
import { IssueSubIssues } from "./issue-sub-issues";
import { IssueTaskConvertDialog } from "./issue-task-convert-dialog";
import { IssueDependencies } from "./issue-dependencies";
import { IssueDuplicates } from "./issue-duplicates";
import { filterUnreferencedIssueAttachments } from "./issue-attachment-references";
import { attachmentUrl, formatFileSize, isSafeImage, ISSUE_TYPE_LABELS, type IssueAttachment, type IssueCommentMinimizedReason, type IssueDetail, type IssueLabelDefinition, type IssueLockReason, type IssueMilestoneDefinition, type IssueReactionContent, type IssueTimelineItem, type IssueType, type IssueUserIdentity } from "./issue-types";

export function AttachmentLinks({ pagePath, attachments, onRemove }: { pagePath: string; attachments: IssueAttachment[]; onRemove?: (attachmentId: string) => void }) {
  if (!attachments.length) return null;
  return <div className="mt-4 grid min-w-0 gap-2 sm:grid-cols-2">{attachments.map((attachment) => {
    const url = attachmentUrl(pagePath, attachment.id);
    return <div key={attachment.id} className="flex min-w-0 items-center gap-1">{isSafeImage(attachment.mime_type)
      ? <a href={url} target="_blank" rel="noreferrer" aria-label={`在新标签页打开附件 ${attachment.file_name}`} className="block min-w-0 flex-1 overflow-hidden rounded-[6px] border"><img src={url} alt={attachment.file_name} loading="lazy" decoding="async" className="max-h-64 max-w-full object-contain" /></a>
      : <a href={url} target="_blank" rel="noreferrer" aria-label={`在新标签页打开附件 ${attachment.file_name}`} className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-[6px] border px-3 py-2 text-xs text-primary hover:underline"><span className="min-w-0 flex-1 truncate">{attachment.file_name}</span><span className="shrink-0 text-muted-foreground">{formatFileSize(attachment.size_bytes)}</span></a>}
      {onRemove && <Button type="button" variant="ghost" size="icon" className="h-11 w-11 shrink-0 sm:h-8 sm:w-8" aria-label={`移除现有附件 ${attachment.file_name}`} onClick={() => onRemove(attachment.id)}><Trash2 className="h-4 w-4" /></Button>}
    </div>;
  })}</div>;
}

interface MetadataProps {
  detail: IssueDetail;
  identities: readonly IssueUserIdentity[];
  availableLabels: readonly IssueLabelDefinition[];
  availableMilestones: readonly IssueMilestoneDefinition[];
  currentUserId?: string;
  canManage: boolean;
  saving: boolean;
  onToggleLabel?: (labelId: string, selected: boolean) => Promise<void>;
  onSetIssueType?: (issueType: IssueType) => Promise<void>;
  onToggleAssignee?: (userId: string, selected: boolean) => Promise<void>;
  onSetMilestone?: (milestoneId: number | null) => Promise<void>;
  onToggleSubscription?: (subscribed: boolean) => Promise<void>;
  canManageLock?: boolean;
  onToggleLock?: (locked: boolean, reason?: IssueLockReason) => Promise<void>;
  canManagePin?: boolean;
  onTogglePin?: (pinned: boolean) => Promise<void>;
}

function ParticipantRoster({ participantIds, identities }: { participantIds: readonly string[]; identities: readonly IssueUserIdentity[] }) {
  const visibleIds = participantIds.slice(0, 8);
  const overflow = Math.max(0, participantIds.length - visibleIds.length);
  return <ul aria-label="Issue 参与者" className="flex flex-wrap gap-1.5">{visibleIds.map((id) => {
    const identity = resolveIssueIdentity(id, identities);
    const label = `${identity.displayName} @${identity.id}`;
    return <li key={id}><span aria-label={label} title={label} className="flex h-7 w-7 items-center justify-center overflow-hidden rounded-full border bg-muted text-[10px] font-semibold text-muted-foreground">{identity.avatarUrl ? <img src={identity.avatarUrl} alt="" className="h-full w-full object-cover" /> : Array.from(identity.displayName)[0]?.toLocaleUpperCase() || "?"}</span></li>;
  })}{overflow > 0 && <li><span aria-label={`另外 ${overflow} 位参与者`} title={`另外 ${overflow} 位参与者`} className="flex h-7 min-w-7 items-center justify-center rounded-full border bg-muted px-1 text-[10px] font-semibold text-muted-foreground">+{overflow}</span></li>}</ul>;
}

function Metadata({ detail, identities, availableLabels, availableMilestones, currentUserId, canManage, saving, onToggleLabel, onSetIssueType, onToggleAssignee, onSetMilestone, onToggleSubscription, canManageLock, onToggleLock, canManagePin, onTogglePin }: MetadataProps) {
  const [localMetadataError, setLocalMetadataError] = useState<string | null>(null);
  const [lockDialogOpen, setLockDialogOpen] = useState(false);
  const lockTriggerRef = useRef<HTMLButtonElement | null>(null);
  const collaboration = detail.collaboration;
  const participantIds = Array.from(new Set([
    detail.issue.reporter_id,
    ...(collaboration?.participant_ids ?? []),
    ...(detail.issue.participant_ids ?? []),
    ...detail.timeline.flatMap((item) => item.kind === "comment" ? [item.comment.author_id] : item.kind === "event" ? [item.event.actor_id] : [item.crossReference.actor_id]),
  ])).filter(Boolean);
  const reporter = resolveIssueIdentity(detail.issue.reporter_id, identities);
  const selectedLabelIds = collaboration?.labels.map((label) => label.id) ?? [];
  const labelCandidates = Array.from(new Map([
    ...(collaboration?.labels ?? []),
    ...availableLabels,
  ].map((label) => [label.id, label])).values());
  const assigneeIds = collaboration?.assignee_ids ?? [];
  const assigneeCandidates = Array.from(new Set([...assigneeIds, ...identities.map((identity) => identity.id)]))
    .map((id) => resolveIssueIdentity(id, identities));
  const subscribed = Boolean(currentUserId && collaboration?.subscriber_ids.includes(currentUserId));
  const runAction = async (action: Promise<void> | undefined) => {
    if (!action) return;
    setLocalMetadataError(null);
    try { await action; }
    catch (error) { setLocalMetadataError(error instanceof Error ? error.message : "Issue 元数据更新失败"); throw error; }
  };
  const closeLockDialog = () => {
    setLockDialogOpen(false);
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => lockTriggerRef.current?.focus()));
  };

  return <div className="space-y-5 text-sm">
    {localMetadataError && !lockDialogOpen && <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">{localMetadataError}</div>}
    <section><h4 className="mb-2 text-xs font-semibold text-muted-foreground">创建者</h4><IssueActor identity={reporter} /></section>
    <section><div className="mb-2 flex items-center justify-between gap-2"><h4 className="text-xs font-semibold text-muted-foreground">类型</h4>{canManage && <select aria-label="设置 Issue 类型" className="h-11 rounded-md border bg-background px-2 text-xs sm:h-8" disabled={saving} value={detail.issue.issue_type ?? detail.issue.label} onChange={(event) => void runAction(onSetIssueType?.(event.target.value as IssueType))}><option value="task">任务</option><option value="bug">缺陷</option><option value="feature">功能</option></select>}</div><p className="text-xs font-medium text-foreground">{ISSUE_TYPE_LABELS[detail.issue.issue_type ?? detail.issue.label]}</p></section>
    <section>
      <div className="mb-2 flex items-center justify-between"><h4 className="text-xs font-semibold text-muted-foreground">标签</h4>{canManage && <IssueMetadataPicker label="Labels" items={labelCandidates.map((label) => ({ id: label.id, label: label.name, description: label.description || label.id, leading: <span aria-hidden="true" className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: `#${label.color}` }} /> }))} selectedIds={selectedLabelIds} disabled={saving} onToggle={(labelId, selected) => onToggleLabel?.(labelId, selected)} />}</div>
      <div className="flex flex-wrap gap-1.5">{(collaboration?.labels ?? []).map((label) => <IssueLabelBadge key={label.id} label={label} />)}</div>
    </section>
    <section>
      <div className="mb-2 flex items-center justify-between"><h4 className="text-xs font-semibold text-muted-foreground">负责人</h4>{canManage && <IssueMetadataPicker label="Assignees" items={assigneeCandidates.map((identity) => ({ id: identity.id, label: identity.displayName, description: `@${identity.id}`, leading: <span aria-hidden="true" className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold">{Array.from(identity.displayName)[0]?.toLocaleUpperCase() || "?"}</span> }))} selectedIds={assigneeIds} disabled={saving} onToggle={(userId, selected) => onToggleAssignee?.(userId, selected)} />}</div>
      {assigneeIds.length > 0 ? <div className="space-y-2">{assigneeIds.map((id) => <IssueActor key={id} identity={resolveIssueIdentity(id, identities)} />)}</div> : <p className="text-xs text-muted-foreground">尚未分配</p>}
    </section>
    <section><div className="mb-2 flex items-center justify-between gap-2"><h4 className="text-xs font-semibold text-muted-foreground">里程碑</h4>{canManage && <select aria-label="设置里程碑" className="h-11 min-w-0 max-w-[170px] rounded-md border bg-background px-2 text-xs sm:h-8" disabled={saving} value={detail.issue.milestone_id ?? ""} onChange={(event) => void runAction(onSetMilestone?.(event.target.value ? Number(event.target.value) : null))}><option value="">无里程碑</option>{availableMilestones.map((item) => <option key={item.id} value={item.id}>{item.title}{item.state === "closed" ? "（已关闭）" : ""}</option>)}</select>}</div><p className="text-xs text-muted-foreground">{availableMilestones.find((item) => item.id === detail.issue.milestone_id)?.title ?? (detail.issue.milestone_id ? `里程碑 #${detail.issue.milestone_id}` : "尚未设置")}</p></section>
    {currentUserId && <section><h4 className="mb-2 text-xs font-semibold text-muted-foreground">通知</h4><Button type="button" variant="outline" size="sm" className="h-11 w-full justify-start gap-2 sm:h-8" disabled={saving} aria-label={subscribed ? "取消订阅" : "订阅 Issue"} onClick={() => runAction(onToggleSubscription?.(!subscribed))}>{subscribed ? <BellOff className="h-4 w-4" /> : <Bell className="h-4 w-4" />}{subscribed ? "取消订阅" : "订阅 Issue"}</Button></section>}
    {canManagePin && <section><h4 className="mb-2 text-xs font-semibold text-muted-foreground">置顶</h4><Button type="button" variant="outline" size="sm" className="h-11 w-full justify-start gap-2 sm:h-8" disabled={saving} aria-label={detail.issue.pinned_at ? "取消置顶" : "置顶 Issue"} onClick={() => { void runAction(onTogglePin?.(!detail.issue.pinned_at)).catch(() => undefined); }}>{detail.issue.pinned_at ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}{detail.issue.pinned_at ? "取消置顶" : "置顶 Issue"}</Button></section>}
    {canManageLock && <section><h4 className="mb-2 text-xs font-semibold text-muted-foreground">对话</h4><Button ref={lockTriggerRef} type="button" variant="outline" size="sm" className="h-11 w-full justify-start gap-2 sm:h-8" disabled={saving} aria-label={detail.issue.locked_at ? "解锁对话" : "锁定对话"} onClick={() => detail.issue.locked_at ? runAction(onToggleLock?.(false)) : setLockDialogOpen(true)}>{detail.issue.locked_at ? <LockOpen className="h-4 w-4" /> : <LockKeyhole className="h-4 w-4" />}{detail.issue.locked_at ? "解锁对话" : "锁定对话"}</Button></section>}
    <section><h4 className="mb-2 text-xs font-semibold text-muted-foreground">参与者</h4><ParticipantRoster participantIds={participantIds} identities={identities} /></section>
    {lockDialogOpen && <IssueLockDialog saving={saving} error={localMetadataError} onCancel={closeLockDialog} onConfirm={async (reason) => { await runAction(onToggleLock?.(true, reason)); closeLockDialog(); }} />}
  </div>;
}

interface IssueDetailWorkspaceProps {
  pagePath: string;
  detail: IssueDetail;
  identities: readonly IssueUserIdentity[];
  currentUserId?: string;
  availableLabels?: readonly IssueLabelDefinition[];
  availableMilestones?: readonly IssueMilestoneDefinition[];
  canManageMetadata?: boolean;
  metadataSaving?: boolean;
  headerAction?: ReactNode;
  bodyAction?: ReactNode;
  statusAction?: ReactNode;
  composer?: ReactNode;
  commentDraftPrefix?: string;
  onEditComment: (commentId: number, body: string, expectedUpdatedAt: string, draftId: string, attachmentIds: string[], removedAttachmentIds: string[]) => Promise<void>;
  onDeleteComment: (commentId: number) => Promise<void>;
  canManageCommentPins?: boolean;
  onToggleCommentPin?: (commentId: number, pinned: boolean) => Promise<void>;
  canManageCommentMinimization?: boolean;
  onToggleCommentMinimized?: (commentId: number, reason: IssueCommentMinimizedReason | null) => Promise<void>;
  onQuoteComment: (body: string, authorId: string) => void;
  onReferenceComment: (commentId: number, body: string, authorId: string, trigger: HTMLButtonElement | null) => void;
  selectedCommentId?: number | null;
  getCommentHref: (commentId: number) => string;
  getIssueHref: () => string;
  getIssueReferenceHref?: (issueNumber: number) => string;
  onOpenIssueReference?: (issueNumber: number, commentId?: number | null) => void;
  onCopyCommentLink: (commentId: number) => Promise<void>;
  onViewIssueHistory: (trigger: HTMLButtonElement) => void;
  onViewCommentHistory: (commentId: number, trigger: HTMLButtonElement) => void;
  onToggleLabel?: (labelId: string, selected: boolean) => Promise<void>;
  onSetIssueType?: (issueType: IssueType) => Promise<void>;
  onToggleAssignee?: (userId: string, selected: boolean) => Promise<void>;
  onSetMilestone?: (milestoneId: number | null) => Promise<void>;
  onToggleSubscription?: (subscribed: boolean) => Promise<void>;
  canManageLock?: boolean;
  onToggleLock?: (locked: boolean, reason?: IssueLockReason) => Promise<void>;
  canManagePin?: boolean;
  onTogglePin?: (pinned: boolean) => Promise<void>;
  canManageSubIssues?: boolean;
  onCreateSubIssue?: () => void;
  onLinkSubIssue?: (issueNumber: number) => Promise<void>;
  onRemoveSubIssue?: (childIssueId: number) => Promise<void>;
  onReprioritizeSubIssue?: (childIssueId: number, afterIssueId: number | null) => Promise<void>;
  canManageDependencies?: boolean;
  onAddDependency?: (direction: "blockedBy" | "blocking", issueNumber: number) => Promise<void>;
  onRemoveDependency?: (direction: "blockedBy" | "blocking", issueId: number) => Promise<void>;
  canManageDuplicates?: boolean;
  onUnmarkDuplicate?: (canonicalIssueId: number) => Promise<void>;
  onToggleReaction: (content: IssueReactionContent, reacted: boolean, commentId?: number) => Promise<void>;
  savingTaskTarget?: "issue" | number | null;
  onToggleIssueTask?: (taskIndex: number, checked: boolean) => Promise<void>;
  onConvertIssueTask?: (taskIndex: number, title: string) => Promise<number>;
  onToggleCommentTask?: (commentId: number, taskIndex: number, checked: boolean) => Promise<void>;
}

export function IssueDetailWorkspace({ pagePath, detail, identities, currentUserId, availableLabels = [], availableMilestones = [], canManageMetadata = false, metadataSaving = false, headerAction, bodyAction, statusAction, composer, commentDraftPrefix, onEditComment, onDeleteComment, canManageCommentPins = false, onToggleCommentPin, canManageCommentMinimization = false, onToggleCommentMinimized, onQuoteComment, onReferenceComment, selectedCommentId, getCommentHref, getIssueHref, getIssueReferenceHref, onOpenIssueReference, onCopyCommentLink, onViewIssueHistory, onViewCommentHistory, onToggleLabel, onSetIssueType, onToggleAssignee, onSetMilestone, onToggleSubscription, canManageLock = false, onToggleLock, canManagePin = false, onTogglePin, canManageSubIssues = false, onCreateSubIssue, onLinkSubIssue, onRemoveSubIssue, onReprioritizeSubIssue, canManageDependencies = false, onAddDependency, onRemoveDependency, canManageDuplicates = false, onUnmarkDuplicate, onToggleReaction, savingTaskTarget, onToggleIssueTask, onConvertIssueTask, onToggleCommentTask }: IssueDetailWorkspaceProps) {
  const [taskConvertTarget, setTaskConvertTarget] = useState<{ index: number; title: string; trigger: HTMLButtonElement } | null>(null);
  const [taskConvertSaving, setTaskConvertSaving] = useState(false);
  const [taskConvertError, setTaskConvertError] = useState<string | null>(null);
  const [taskConvertFocusIssueNumber, setTaskConvertFocusIssueNumber] = useState<number | null>(null);
  const reporter = resolveIssueIdentity(detail.issue.reporter_id, identities);
  const issueAttachments = filterUnreferencedIssueAttachments(detail.issue.description, detail.attachments.filter((attachment) => attachment.comment_id === null));
  const visibleComments = detail.timeline.filter((item): item is Extract<IssueTimelineItem, { kind: "comment" }> => item.kind === "comment" && !item.comment.deleted_at);
  const firstVisibleComment = visibleComments[0];
  const open = detail.issue.status === "open";
  const notPlanned = !open && detail.issue.state_reason === "not_planned";
  const metadataLabelCount = detail.collaboration?.labels.length ?? 0;
  const metadataAssigneeCount = detail.collaboration?.assignee_ids.length ?? 0;
  const mobileMetadataSummary = `${metadataLabelCount} 个标签 · ${metadataAssigneeCount ? `${metadataAssigneeCount} 位负责人` : "未分配"}${detail.issue.locked_at ? " · 已锁定" : ""}`;
  useEffect(() => {
    if (taskConvertFocusIssueNumber === null) return;
    let attempts = 0;
    let timer = 0;
    const focusReference = () => {
      const reference = document.querySelector<HTMLElement>(`[data-localapp-issue-reference="${taskConvertFocusIssueNumber}"]`);
      reference?.focus();
      if (reference && document.activeElement === reference) { setTaskConvertFocusIssueNumber(null); return; }
      if (attempts++ < 10) timer = window.setTimeout(focusReference, 30);
    };
    timer = window.setTimeout(focusReference, 0);
    return () => window.clearTimeout(timer);
  }, [detail.issue.description, taskConvertFocusIssueNumber]);

  return (
    <section data-localapp-issue-detail data-testid="issue-detail-workspace" className="relative grid min-w-0 grid-cols-1 lg:grid-cols-[minmax(0,3fr)_minmax(240px,1fr)] lg:gap-6">
      <span aria-label="Issue 元数据状态" aria-live="polite" className="sr-only">{metadataSaving ? "正在更新 Issue 元数据" : "Issue 元数据已同步"}</span>
      <span aria-live="polite" className="sr-only">{savingTaskTarget !== null && savingTaskTarget !== undefined ? "正在保存任务状态" : ""}</span>
      <header className="min-w-0 border-b pb-5 lg:col-span-2">
        <div className="flex min-w-0 items-start gap-3">
          <h3 data-localapp-issue-title tabIndex={-1} aria-label={detail.issue.title} className="min-w-0 flex-1 break-words text-2xl font-normal leading-8 tracking-normal outline-none sm:text-[32px] sm:leading-10">{detail.issue.title} <span className="whitespace-nowrap text-muted-foreground">#{detail.issue.issue_number}</span></h3>
          {headerAction}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-medium text-white ${open ? "bg-emerald-700" : "bg-violet-600"}`}>
            {open ? <CircleDot className="h-4 w-4" aria-hidden="true" /> : notPlanned ? <CircleSlash2 className="h-4 w-4" aria-hidden="true" /> : <CircleCheck className="h-4 w-4" aria-hidden="true" />}
            {open ? "开启" : detail.issue.state_reason === "not_planned" ? "已关闭 · 不计划处理" : "已关闭 · 已完成"}
          </span>
          <span className="min-w-0"><strong className="font-semibold text-foreground">{reporter.displayName}</strong> 打开了此 Issue <IssueTime timestamp={detail.issue.created_at} /></span>
          <span className="inline-flex items-center gap-2 whitespace-nowrap"><span className="hidden sm:inline" aria-hidden="true">·</span>{firstVisibleComment ? <a href={getCommentHref(firstVisibleComment.comment.id)} className="-my-2 inline-flex h-11 items-center px-1 font-medium text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:-my-0 sm:h-6">{visibleComments.length} 条评论</a> : <span>0 条评论</span>}</span>
          {detail.issue.locked_at && <span className="inline-flex items-center gap-1 font-medium text-foreground"><LockKeyhole className="h-4 w-4" aria-hidden="true" />已锁定</span>}
        </div>
        {detail.parent && <a href={getIssueReferenceHref?.(detail.parent.issue_number) ?? "#"} className="mt-2 inline-flex min-h-11 items-center text-sm font-medium text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-7" onClick={(event) => { if (!onOpenIssueReference || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; event.preventDefault(); onOpenIssueReference(detail.parent!.issue_number); }}>父 Issue：#{detail.parent.issue_number} {detail.parent.title}</a>}
      </header>
      {(detail.duplicateOf || detail.duplicates?.length) && <div className="min-w-0 lg:col-span-2"><IssueDuplicates duplicateOf={detail.duplicateOf} duplicates={detail.duplicates} canManage={canManageDuplicates} getIssueHref={(issueNumber) => getIssueReferenceHref?.(issueNumber) ?? "#"} onOpenIssue={onOpenIssueReference} onUnmark={onUnmarkDuplicate ?? (async () => undefined)} /></div>}

      <details data-localapp-issue-metadata data-testid="issue-metadata-mobile" className="border-b py-3 lg:hidden">
        <summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold"><span className="inline-flex w-[calc(100%-1.25rem)] items-center justify-between gap-3 align-middle"><span>Issue 详情</span><span data-localapp-issue-metadata-summary className="min-w-0 truncate text-xs font-normal text-muted-foreground">{mobileMetadataSummary}</span></span></summary>
        <div className="pt-4"><Metadata detail={detail} identities={identities} availableLabels={availableLabels} availableMilestones={availableMilestones} currentUserId={currentUserId} canManage={canManageMetadata} saving={metadataSaving} onToggleLabel={onToggleLabel} onSetIssueType={onSetIssueType} onToggleAssignee={onToggleAssignee} onSetMilestone={onSetMilestone} onToggleSubscription={onToggleSubscription} canManageLock={canManageLock} onToggleLock={onToggleLock} canManagePin={canManagePin} onTogglePin={onTogglePin} /></div>
      </details>

      <main data-localapp-issue-discussion data-testid="issue-discussion" className="min-w-0 py-6">
        <article data-localapp-issue-body-card data-testid="issue-body-card" className="min-w-0 overflow-hidden rounded-[6px] border bg-card">
          <header className="border-b bg-muted/20 px-4 py-3"><IssueActor identity={reporter} timestamp={detail.issue.created_at} timestampHref={getIssueHref()} timestampSuffix={detail.issue.revision_count ? <button type="button" aria-label={`查看 Issue 编辑历史，${detail.issue.revision_count} 次修改`} className="-my-2 inline-flex h-11 items-center px-1 text-muted-foreground hover:underline sm:-my-0 sm:h-6" onClick={(event) => onViewIssueHistory(event.currentTarget)}>edited</button> : undefined} badge="Author" action={bodyAction} /></header>
          <div className="min-w-0 px-4 py-4"><IssueMarkdown tasksDisabled={Boolean(detail.issue.locked_at) || savingTaskTarget === "issue" || taskConvertSaving} onToggleTask={onToggleIssueTask ? (taskIndex, checked) => { void onToggleIssueTask(taskIndex, checked).catch(() => undefined); } : undefined} onConvertTask={onConvertIssueTask && !detail.issue.locked_at ? (index, title, trigger) => { setTaskConvertError(null); setTaskConvertTarget({ index, title, trigger }); } : undefined} getIssueReferenceHref={getIssueReferenceHref} onOpenIssueReference={onOpenIssueReference}>{detail.issue.description.trim() || "未提供描述。"}</IssueMarkdown><AttachmentLinks pagePath={pagePath} attachments={issueAttachments} /><IssueReactions reactions={detail.reactions ?? []} currentUserId={currentUserId} additionsDisabled={Boolean(detail.issue.locked_at)} onToggle={onToggleReaction} /></div>
        </article>
        <IssueSubIssues pagePath={pagePath} detail={detail} identities={identities} canManage={canManageSubIssues} saving={metadataSaving} getIssueHref={getIssueReferenceHref} onOpenIssue={onOpenIssueReference} onCreate={onCreateSubIssue ?? (() => undefined)} onLink={onLinkSubIssue ?? (async () => undefined)} onRemove={onRemoveSubIssue ?? (async () => undefined)} onReprioritize={onReprioritizeSubIssue ?? (async () => undefined)} />
        <IssueDependencies detail={detail} identities={identities} canManage={canManageDependencies} saving={metadataSaving} getIssueHref={getIssueReferenceHref} onOpenIssue={onOpenIssueReference} onAdd={onAddDependency ?? (async () => undefined)} onRemove={onRemoveDependency ?? (async () => undefined)} />
        <div className="mt-5"><IssueTimeline issueId={detail.issue.id} reporterId={detail.issue.reporter_id} pagePath={pagePath} timeline={detail.timeline} attachments={detail.attachments} identities={identities} currentUserId={currentUserId} reactions={detail.reactions ?? []} commentDraftPrefix={commentDraftPrefix} onToggleReaction={onToggleReaction} onEditComment={onEditComment} onDeleteComment={onDeleteComment} canManageCommentPins={canManageCommentPins} onToggleCommentPin={onToggleCommentPin} canManageCommentMinimization={canManageCommentMinimization} onToggleCommentMinimized={onToggleCommentMinimized} onQuoteComment={onQuoteComment} onReferenceComment={onReferenceComment} selectedCommentId={selectedCommentId} getCommentHref={getCommentHref} getIssueReferenceHref={getIssueReferenceHref} onOpenIssueReference={onOpenIssueReference} onCopyCommentLink={onCopyCommentLink} onViewHistory={onViewCommentHistory} savingTaskTarget={typeof savingTaskTarget === "number" ? savingTaskTarget : null} onToggleCommentTask={onToggleCommentTask} interactionsLocked={Boolean(detail.issue.locked_at)} /></div>
        {statusAction && <div className="mt-4 flex justify-end">{statusAction}</div>}
        {composer && <div className="mt-6 border-t pt-5">{composer}</div>}
      </main>

      <aside data-localapp-issue-metadata data-testid="issue-metadata-desktop" className="max-lg:hidden min-w-0 border-l py-6 pl-6">
        <Metadata detail={detail} identities={identities} availableLabels={availableLabels} availableMilestones={availableMilestones} currentUserId={currentUserId} canManage={canManageMetadata} saving={metadataSaving} onToggleLabel={onToggleLabel} onSetIssueType={onSetIssueType} onToggleAssignee={onToggleAssignee} onSetMilestone={onSetMilestone} onToggleSubscription={onToggleSubscription} canManageLock={canManageLock} onToggleLock={onToggleLock} canManagePin={canManagePin} onTogglePin={onTogglePin} />
      </aside>
      {taskConvertTarget && <IssueTaskConvertDialog initialTitle={taskConvertTarget.title} saving={taskConvertSaving} error={taskConvertError} onCancel={() => { const trigger = taskConvertTarget.trigger; setTaskConvertTarget(null); setTaskConvertError(null); window.requestAnimationFrame(() => trigger.focus()); }} onConfirm={async (title) => {
        setTaskConvertSaving(true); setTaskConvertError(null);
        try {
          const issueNumber = await onConvertIssueTask!(taskConvertTarget.index, title);
          setTaskConvertFocusIssueNumber(issueNumber);
          setTaskConvertTarget(null);
        } catch (error) {
          setTaskConvertError(error instanceof Error ? error.message : "无法转换任务");
          throw error;
        } finally { setTaskConvertSaving(false); }
      }} />}
    </section>
  );
}
