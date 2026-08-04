import { useEffect, useRef, useState, type MouseEvent, type RefObject } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, CircleAlert, CircleCheck, CircleDot, CircleSlash2, Copy, ListFilter, LoaderCircle, LockKeyhole, MessageSquare, Pin, Search, SlidersHorizontal, UserRound, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { IssueLabelBadge } from "./issue-label-badge";
import type { IssueListQuery } from "./issue-list-query";
import { applyIssueSearchSuggestion, getIssueSearchSuggestions, type IssueSearchSuggestion, type IssueSearchSuggestionUser } from "./issue-search-query";
import { ISSUE_TYPE_LABELS, type Issue, type IssueLabelDefinition, type IssueListMeta, type IssueMilestoneDefinition, type IssueStatus, type IssueType } from "./issue-types";
import { IssueTime } from "./issue-time";
import { IssueSavedViews } from "./issue-saved-views";
import type { IssueSavedView } from "./issue-types";

interface IssueListWorkspaceProps {
  currentUserId?: string;
  error: string | null;
  issues: Issue[];
  pinnedIssues?: Issue[];
  labels: IssueLabelDefinition[];
  milestones: IssueMilestoneDefinition[];
  users: IssueSearchSuggestionUser[];
  loading: boolean;
  meta: IssueListMeta;
  query: IssueListQuery;
  searchInput: string;
  searchInputRef?: RefObject<HTMLInputElement>;
  onOpenIssue: (issue: Issue) => void;
  getIssueHref: (issue: Issue) => string;
  onQueryChange: (updates: Partial<IssueListQuery>) => void;
  onReset: () => void;
  onRetry: () => void;
  onSearchInputChange: (value: string) => void;
  onSubmitSearch: () => void;
  canBulkManage?: boolean;
  onBulkStatus?: (issueIds: number[], status: IssueStatus) => Promise<{ succeeded: number; failedIds: number[] }>;
  onBulkIssueType?: (issueIds: number[], issueType: IssueType) => Promise<{ succeeded: number; failedIds: number[] }>;
  onBulkLabel?: (issueIds: number[], labelId: string, selected: boolean) => Promise<{ succeeded: number; failedIds: number[] }>;
  onBulkAssignee?: (issueIds: number[], userId: string, selected: boolean) => Promise<{ succeeded: number; failedIds: number[] }>;
  onBulkMilestone?: (issueIds: number[], milestoneId: number | null) => Promise<{ succeeded: number; failedIds: number[] }>;
  savedViews?: IssueSavedView[];
  savedViewsLoading?: boolean;
  savedViewsError?: string | null;
  savedViewsSaving?: boolean;
  activeSavedViewId?: number | null;
  savedViewDirty?: boolean;
  onApplySavedView?: (view: IssueSavedView) => void;
  onCreateSavedView?: (name: string, description: string) => Promise<void>;
  onUpdateSavedView?: (id: number, input: { name?: string; description?: string; query?: IssueListQuery }) => Promise<void>;
  onCopySavedView?: (id: number) => Promise<void>;
  onDeleteSavedView?: (id: number) => Promise<void>;
  onRetrySavedViews?: () => void;
  onLeaveSavedView?: () => void;
}

type IssueListView = "all" | "assigned" | "created" | "participating" | "subscribed" | "mentioned" | "recent";

function activeAdvancedFilterCount(query: IssueListQuery, currentUserId?: string): number {
  const authorPreset = query.author === currentUserId && !query.participant && !query.assignee && !query.subscribed && !query.mentioned;
  const assigneePreset = query.assignee === currentUserId && !query.author && !query.participant && !query.subscribed && !query.mentioned;
  const author = authorPreset ? "" : query.author;
  const assignee = assigneePreset ? "" : query.assignee;
  return [query.issueType, query.label, author, assignee, query.milestone, query.locked, query.reason].filter(Boolean).length
    + Number(query.sort !== "activity" || query.direction !== "desc");
}

function IssueStatusIcon({ status, className = "h-4 w-4" }: { status: IssueStatus; className?: string }) {
  return status === "open"
    ? <CircleDot className={`${className} text-primary`} aria-hidden="true" />
    : <CircleCheck className={`${className} text-muted-foreground`} aria-hidden="true" />;
}

function IssueListStatusIcon({ issue, className = "h-4 w-4" }: { issue: Issue; className?: string }) {
  if (issue.status === "open") return <span aria-label="开启" title="开启" className={className}><CircleDot className="h-full w-full text-primary" aria-hidden="true" /></span>;
  const notPlanned = issue.state_reason === "not_planned";
  const label = notPlanned ? "已关闭：不计划处理" : "已关闭：已完成";
  return <span aria-label={label} title={label} className={className}>{notPlanned ? <CircleSlash2 className="h-full w-full text-muted-foreground" aria-hidden="true" /> : <CircleCheck className="h-full w-full text-primary" aria-hidden="true" />}</span>;
}

function IssueListActivityTime({ issue }: { issue: Issue }) {
  const timestamp = issue.last_activity_at ?? issue.updated_at ?? issue.created_at;
  const created = timestamp === issue.created_at;
  return <span data-localapp-issue-activity data-kind={created ? "created" : "activity"} className="inline-flex min-w-0 flex-wrap items-center gap-1"><span>{created ? "创建于" : "活动于"}</span><IssueTime timestamp={timestamp} /></span>;
}

function IssueListAssignees({ ids, users, onSelect }: { ids: readonly string[]; users: readonly IssueSearchSuggestionUser[]; onSelect: (userId: string) => void }) {
  const uniqueIds = Array.from(new Set(ids));
  if (uniqueIds.length === 0) return null;
  const identities = uniqueIds.map((id) => {
    const user = users.find((candidate) => candidate.id === id);
    return { id, label: user?.displayName || user?.name || id, avatarUrl: user?.avatarUrl ?? null };
  });
  const visible = identities.slice(0, 3);
  const overflow = identities.length - visible.length;
  return <div role="group" aria-label={`负责人：${identities.map((identity) => identity.label).join("、")}`} className="hidden shrink-0 self-center -space-x-1.5 sm:flex">{visible.map((identity) => <button type="button" key={identity.id} aria-label={`按负责人筛选 ${identity.label}`} title={`${identity.label} @${identity.id}`} onClick={() => onSelect(identity.id)} className="flex h-7 w-7 items-center justify-center overflow-hidden rounded-full border-2 border-background bg-muted text-[10px] font-semibold text-muted-foreground hover:z-10 hover:ring-2 hover:ring-ring focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{identity.avatarUrl ? <img src={identity.avatarUrl} alt="" className="h-full w-full object-cover" /> : Array.from(identity.label)[0]?.toLocaleUpperCase() || "?"}</button>)}{overflow > 0 && <span aria-label={`另外 ${overflow} 位负责人`} className="flex h-7 min-w-7 items-center justify-center rounded-full border-2 border-background bg-muted px-1 text-[10px] font-semibold text-muted-foreground">+{overflow}</span>}</div>;
}

function IssueListMilestone({ milestone, onSelect }: { milestone?: IssueMilestoneDefinition; onSelect: (milestoneId: number) => void }) {
  if (!milestone) return null;
  return <button type="button" aria-label={`按里程碑筛选 ${milestone.title}`} onClick={() => onSelect(milestone.id)} className="inline-flex min-h-6 max-w-full items-center gap-1 rounded-sm text-left hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><CalendarDays className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /><span className="break-words">{milestone.title}</span></button>;
}

export function IssueListWorkspace({
  currentUserId,
  error,
  issues,
  pinnedIssues = [],
  labels,
  milestones,
  users,
  loading,
  meta,
  query,
  searchInput,
  searchInputRef,
  onOpenIssue,
  getIssueHref,
  onQueryChange,
  onReset,
  onRetry,
  onSearchInputChange,
  onSubmitSearch,
  canBulkManage = false,
  onBulkStatus,
  onBulkIssueType,
  onBulkLabel,
  onBulkAssignee,
  onBulkMilestone,
  savedViews = [], savedViewsLoading = false, savedViewsError = null, savedViewsSaving = false, activeSavedViewId = null, savedViewDirty = false,
  onApplySavedView, onCreateSavedView, onUpdateSavedView, onCopySavedView, onDeleteSavedView, onRetrySavedViews, onLeaveSavedView,
}: IssueListWorkspaceProps) {
  const [activeView, setActiveView] = useState<IssueListView>("all");
  const advancedFilterCount = activeAdvancedFilterCount(query, currentUserId);
  const [advancedFiltersOpen, setAdvancedFiltersOpen] = useState(() => advancedFilterCount > 0);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkSaving, setBulkSaving] = useState(false);
  const [bulkMessage, setBulkMessage] = useState("");
  const [bulkIssueTypeAction, setBulkIssueTypeAction] = useState("");
  const [bulkLabelAction, setBulkLabelAction] = useState("");
  const [bulkAssigneeAction, setBulkAssigneeAction] = useState("");
  const [bulkMilestoneAction, setBulkMilestoneAction] = useState("");
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [suggestionCursor, setSuggestionCursor] = useState(searchInput.length);
  const [activeSuggestion, setActiveSuggestion] = useState(-1);
  const selectAllRef = useRef<HTMLInputElement>(null);
  const selectionAnchorIssueIdRef = useRef<number | null>(null);
  const focusedSelectionIdRef = useRef<number | null>(null);
  const bulkToolbarFocusedRef = useRef(false);
  const selectionReconciliationFocusRef = useRef(false);
  const insertedSuggestionCursorRef = useRef<number | null>(null);
  const paginationFocusPendingRef = useRef(false);
  const paginationFocusOffsetRef = useRef<number | null>(null);
  const issueResultsRef = useRef<HTMLDivElement | null>(null);
  const returnFirstPageRef = useRef<HTMLButtonElement | null>(null);
  const suggestionListId = "localapp-issue-search-suggestions";
  const suggestionResult = getIssueSearchSuggestions(searchInput, insertedSuggestionCursorRef.current ?? suggestionCursor, { currentUserId, labels, milestones, users });
  const visibleSuggestions = suggestionsOpen ? suggestionResult.items : [];
  useEffect(() => {
    if (currentUserId && query.mentioned && !query.author && !query.participant && !query.assignee && !query.subscribed) setActiveView("mentioned");
    else if (currentUserId && query.subscribed && !query.author && !query.participant && !query.assignee && !query.mentioned) setActiveView("subscribed");
    else if (currentUserId && query.assignee === currentUserId && !query.author && !query.participant && !query.subscribed && !query.mentioned) setActiveView("assigned");
    else if (currentUserId && query.author === currentUserId && !query.participant && !query.assignee && !query.subscribed && !query.mentioned) setActiveView("created");
    else if (currentUserId && query.participant === currentUserId && !query.author && !query.assignee && !query.subscribed && !query.mentioned) setActiveView("participating");
    else if (query.author || query.participant || query.assignee || query.subscribed || query.mentioned || activeView === "assigned" || activeView === "created" || activeView === "participating" || activeView === "subscribed" || activeView === "mentioned") setActiveView("all");
  }, [activeView, currentUserId, query.assignee, query.author, query.participant, query.subscribed, query.mentioned]);
  useEffect(() => {
    setSelectedIds(new Set());
    setBulkMessage("");
    selectionAnchorIssueIdRef.current = null;
  }, [query.q, query.status, query.issueType, query.label, query.author, query.participant, query.assignee, query.milestone, query.reason, query.subscribed, query.mentioned, query.locked, query.sort, query.direction, query.limit, query.offset]);
  const visibleIssueIdsKey = issues.map((issue) => issue.id).join(",");
  useEffect(() => { selectionAnchorIssueIdRef.current = null; }, [visibleIssueIdsKey]);
  useEffect(() => {
    if (selectedIds.size === 0) return;
    const visibleIds = new Set(issues.map((issue) => issue.id));
    const retainedIds = new Set(Array.from(selectedIds).filter((id) => visibleIds.has(id)));
    const removedCount = selectedIds.size - retainedIds.size;
    if (removedCount === 0) return;
    selectionReconciliationFocusRef.current = bulkToolbarFocusedRef.current || (focusedSelectionIdRef.current !== null && !visibleIds.has(focusedSelectionIdRef.current));
    setSelectedIds(retainedIds);
    setBulkMessage(`${removedCount} 条已选 Issue 已不在当前列表，选择已更新`);
    if (selectionReconciliationFocusRef.current) window.requestAnimationFrame(() => {
      selectAllRef.current?.focus();
      selectionReconciliationFocusRef.current = false;
      focusedSelectionIdRef.current = null;
      bulkToolbarFocusedRef.current = false;
    });
  }, [issues, selectedIds]);
  const hasActiveFilters = Boolean(query.q || query.searchIn || query.issueType || query.label || query.author || query.participant || query.assignee || query.milestone || query.reason || query.subscribed || query.mentioned || query.locked);
  const showPinnedIssues = activeView === "all" && query.status === "open" && query.offset === 0 && !hasActiveFilters && query.sort === "activity" && query.direction === "desc" && pinnedIssues.length > 0;
  const pageOutOfRange = query.offset > 0 && issues.length === 0;
  useEffect(() => {
    if (!paginationFocusPendingRef.current) return;
    if (paginationFocusOffsetRef.current !== query.offset) {
      paginationFocusPendingRef.current = false;
      paginationFocusOffsetRef.current = null;
      return;
    }
    if (loading || error || meta.offset !== query.offset) return;
    paginationFocusPendingRef.current = false;
    paginationFocusOffsetRef.current = null;
    const frame = window.requestAnimationFrame(() => {
      if (issues.length > 0) issueResultsRef.current?.querySelector<HTMLElement>("[data-localapp-issue-link]")?.focus();
      else if (pageOutOfRange) returnFirstPageRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [error, issues, loading, meta.offset, pageOutOfRange, query.offset]);
  const changePage = (offset: number) => {
    paginationFocusPendingRef.current = true;
    paginationFocusOffsetRef.current = offset;
    onQueryChange({ offset });
  };
  const userLabel = (userId: string) => {
    const identity = users.find((candidate) => candidate.id === userId);
    return identity?.displayName || identity?.name || userId;
  };
  const appliedFilters = [
    ...(query.issueType ? [{ key: "issueType" as const, kind: "类型", value: ISSUE_TYPE_LABELS[query.issueType] }] : []),
    ...(query.label ? [{ key: "label" as const, kind: "标签", value: query.label === "none" ? "未添加" : labels.find((label) => label.id === query.label)?.name ?? query.label }] : []),
    ...(query.author ? [{ key: "author" as const, kind: "作者", value: userLabel(query.author) }] : []),
    ...(query.participant ? [{ key: "participant" as const, kind: "参与者", value: userLabel(query.participant) }] : []),
    ...(query.assignee ? [{ key: "assignee" as const, kind: "负责人", value: query.assignee === "none" ? "未分配" : userLabel(query.assignee) }] : []),
    ...(query.milestone ? [{ key: "milestone" as const, kind: "里程碑", value: query.milestone === "none" ? "无里程碑" : milestones.find((item) => String(item.id) === query.milestone)?.title ?? `#${query.milestone}` }] : []),
    ...(query.reason ? [{ key: "reason" as const, kind: "关闭原因", value: query.reason === "not_planned" ? "不计划处理" : "已完成" }] : []),
    ...(query.subscribed ? [{ key: "subscribed" as const, kind: "关注", value: "我" }] : []),
    ...(query.mentioned ? [{ key: "mentioned" as const, kind: "提及", value: "我" }] : []),
    ...(query.locked ? [{ key: "locked" as const, kind: "对话", value: query.locked === "locked" ? "已锁定" : "未锁定" }] : []),
  ];
  const refreshing = loading && issues.length > 0;
  const selectedCount = selectedIds.size;
  const allSelected = issues.length > 0 && issues.every((issue) => selectedIds.has(issue.id));
  const partiallySelected = selectedCount > 0 && !allSelected;
  useEffect(() => { if (selectAllRef.current) selectAllRef.current.indeterminate = partiallySelected; }, [partiallySelected]);
  const views: Array<[IssueListView, string]> = [
    ["all", "全部 Issue"],
    ...(currentUserId ? [["assigned", "分配给我的"], ["created", "我创建的"], ["participating", "我参与的"], ["subscribed", "我关注的"], ["mentioned", "提及我的"]] as Array<[IssueListView, string]> : []),
    ["recent", "最近活动"],
  ];
  const selectView = (view: IssueListView) => {
    onLeaveSavedView?.();
    setActiveView(view);
    if (view === "assigned" && currentUserId) {
      onQueryChange({ author: "", participant: "", assignee: currentUserId, subscribed: false, mentioned: false });
      return;
    }
    if (view === "created" && currentUserId) {
      onQueryChange({ author: currentUserId, participant: "", assignee: "", subscribed: false, mentioned: false });
      return;
    }
    if (view === "participating" && currentUserId) {
      onQueryChange({ author: "", participant: currentUserId, assignee: "", subscribed: false, mentioned: false });
      return;
    }
    if (view === "subscribed" && currentUserId) {
      onQueryChange({ author: "", participant: "", assignee: "", subscribed: true, mentioned: false });
      return;
    }
    if (view === "mentioned" && currentUserId) {
      onQueryChange({ author: "", participant: "", assignee: "", subscribed: false, mentioned: true });
      return;
    }
    if (view === "recent") {
      onQueryChange({ author: "", participant: "", assignee: "", subscribed: false, mentioned: false, sort: "activity", direction: "desc" });
      return;
    }
    onQueryChange({ author: "", participant: "", assignee: "", subscribed: false, mentioned: false });
  };
  const resetAll = () => {
    setActiveView("all");
    onReset();
    window.requestAnimationFrame(() => searchInputRef?.current?.focus());
  };
  const removeAppliedFilter = (key: "issueType" | "label" | "author" | "participant" | "assignee" | "milestone" | "reason" | "subscribed" | "mentioned" | "locked") => {
    onQueryChange(key === "subscribed" ? { subscribed: false } : key === "mentioned" ? { mentioned: false } : { [key]: "" });
    window.requestAnimationFrame(() => searchInputRef?.current?.focus());
  };
  const selectStatus = (status: IssueStatus) => onQueryChange({ status });
  const openIssueFromLink = (event: MouseEvent<HTMLAnchorElement>, issue: Issue) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    onOpenIssue(issue);
  };
  const toggleSelected = (issueId: number, selected: boolean, range: boolean) => {
    const anchorId = selectionAnchorIssueIdRef.current;
    const anchorIndex = range && anchorId !== null ? issues.findIndex((issue) => issue.id === anchorId) : -1;
    const targetIndex = issues.findIndex((issue) => issue.id === issueId);
    setSelectedIds((current) => {
      const next = new Set(current);
      const rangeIds = anchorIndex >= 0 && targetIndex >= 0
        ? issues.slice(Math.min(anchorIndex, targetIndex), Math.max(anchorIndex, targetIndex) + 1).map((issue) => issue.id)
        : [issueId];
      for (const id of rangeIds) { if (selected) next.add(id); else next.delete(id); }
      return next;
    });
    selectionAnchorIssueIdRef.current = issueId;
  };
  const toggleAll = (selected: boolean) => { selectionAnchorIssueIdRef.current = null; setSelectedIds(selected ? new Set(issues.map((issue) => issue.id)) : new Set()); };
  const applyBulkStatus = async (status: IssueStatus) => {
    if (!onBulkStatus || selectedCount === 0 || bulkSaving) return;
    setBulkSaving(true);
    setBulkMessage("");
    try {
      const result = await onBulkStatus(Array.from(selectedIds), status);
      selectionAnchorIssueIdRef.current = null;
      setSelectedIds(new Set(result.failedIds));
      setBulkMessage(result.failedIds.length ? `${result.succeeded} 条成功，${result.failedIds.length} 条失败，可重试失败项` : `${result.succeeded} 条 Issue 已更新`);
      if (result.failedIds.length === 0) window.requestAnimationFrame(() => selectAllRef.current?.focus());
    } catch (bulkError) {
      setBulkMessage(bulkError instanceof Error ? bulkError.message : "批量更新失败");
    } finally { setBulkSaving(false); }
  };
  const applyBulkIssueType = async (value: string) => {
    if (!onBulkIssueType || selectedCount === 0 || bulkSaving || !value) return;
    const issueType = value as IssueType;
    setBulkSaving(true);
    setBulkMessage("");
    try {
      const result = await onBulkIssueType(Array.from(selectedIds), issueType);
      selectionAnchorIssueIdRef.current = null;
      setSelectedIds(new Set(result.failedIds));
      setBulkMessage(result.failedIds.length ? `${result.succeeded} 条成功，${result.failedIds.length} 条失败，可重试失败项` : `${result.succeeded} 条 Issue 已更新`);
      if (result.failedIds.length === 0) window.requestAnimationFrame(() => selectAllRef.current?.focus());
    } catch (bulkError) {
      setBulkMessage(bulkError instanceof Error ? bulkError.message : "批量更新失败");
    } finally { setBulkSaving(false); setBulkIssueTypeAction(""); }
  };
  const applyBulkLabel = async (value: string) => {
    if (!onBulkLabel || selectedCount === 0 || bulkSaving || !value) return;
    const [operation, labelId] = value.split(":", 2);
    if (!labelId || (operation !== "add" && operation !== "remove")) return;
    setBulkSaving(true);
    setBulkMessage("");
    try {
      const result = await onBulkLabel(Array.from(selectedIds), labelId, operation === "add");
      selectionAnchorIssueIdRef.current = null;
      setSelectedIds(new Set(result.failedIds));
      setBulkMessage(result.failedIds.length ? `${result.succeeded} 条成功，${result.failedIds.length} 条失败，可重试失败项` : `${result.succeeded} 条 Issue 已更新`);
      if (result.failedIds.length === 0) window.requestAnimationFrame(() => selectAllRef.current?.focus());
    } catch (bulkError) {
      setBulkMessage(bulkError instanceof Error ? bulkError.message : "批量更新失败");
    } finally { setBulkSaving(false); setBulkLabelAction(""); }
  };
  const applyBulkAssignee = async (value: string) => {
    if (!onBulkAssignee || selectedCount === 0 || bulkSaving || !value) return;
    const [operation, userId] = value.split(":", 2);
    if (!userId || (operation !== "add" && operation !== "remove")) return;
    setBulkSaving(true);
    setBulkMessage("");
    try {
      const result = await onBulkAssignee(Array.from(selectedIds), userId, operation === "add");
      selectionAnchorIssueIdRef.current = null;
      setSelectedIds(new Set(result.failedIds));
      setBulkMessage(result.failedIds.length ? `${result.succeeded} 条成功，${result.failedIds.length} 条失败，可重试失败项` : `${result.succeeded} 条 Issue 已更新`);
      if (result.failedIds.length === 0) window.requestAnimationFrame(() => selectAllRef.current?.focus());
    } catch (bulkError) {
      setBulkMessage(bulkError instanceof Error ? bulkError.message : "批量更新失败");
    } finally { setBulkSaving(false); setBulkAssigneeAction(""); }
  };
  const applyBulkMilestone = async (value: string) => {
    if (!onBulkMilestone || selectedCount === 0 || bulkSaving || !value) return;
    const milestoneId = value === "none" ? null : Number(value);
    if (milestoneId !== null && (!Number.isInteger(milestoneId) || milestoneId <= 0)) return;
    setBulkSaving(true);
    setBulkMessage("");
    try {
      const result = await onBulkMilestone(Array.from(selectedIds), milestoneId);
      selectionAnchorIssueIdRef.current = null;
      setSelectedIds(new Set(result.failedIds));
      setBulkMessage(result.failedIds.length ? `${result.succeeded} 条成功，${result.failedIds.length} 条失败，可重试失败项` : `${result.succeeded} 条 Issue 已更新`);
      if (result.failedIds.length === 0) window.requestAnimationFrame(() => selectAllRef.current?.focus());
    } catch (bulkError) {
      setBulkMessage(bulkError instanceof Error ? bulkError.message : "批量更新失败");
    } finally { setBulkSaving(false); setBulkMilestoneAction(""); }
  };
  const selectSuggestion = (suggestion: IssueSearchSuggestion) => {
    const next = applyIssueSearchSuggestion(searchInput, suggestionCursor, suggestionResult, suggestion.value);
    onSearchInputChange(next.value);
    insertedSuggestionCursorRef.current = next.cursor;
    setSuggestionCursor(next.cursor);
    setActiveSuggestion(-1);
    setSuggestionsOpen(true);
    searchInputRef?.current?.focus();
    window.requestAnimationFrame(() => {
      searchInputRef?.current?.setSelectionRange(next.cursor, next.cursor);
    });
  };
  const clearSearch = () => {
    onSearchInputChange("");
    onQueryChange({ q: "", searchIn: "", offset: 0 });
    setSuggestionsOpen(false);
    setActiveSuggestion(-1);
    setSuggestionCursor(0);
    window.requestAnimationFrame(() => searchInputRef?.current?.focus());
  };

  return (
    <section data-localapp-issue-list data-testid="issue-list-workspace" className="grid min-h-0 max-w-full flex-1 grid-rows-[auto_minmax(0,1fr)] overflow-x-hidden [&_[data-localapp-issue-bulk-toolbar]_label:focus-within]:ring-2 [&_[data-localapp-issue-bulk-toolbar]_label:focus-within]:ring-ring lg:grid-cols-[240px_minmax(0,1fr)] lg:grid-rows-1">
      <aside data-localapp-issue-view-rail data-testid="issue-view-rail" aria-label="Issue 视图" className="min-w-0 border-b bg-muted/20 px-3 py-2 lg:border-b-0 lg:border-r lg:px-3 lg:py-4">
        <label className="flex h-11 w-full items-center rounded-md border bg-background px-3 text-sm font-medium text-foreground focus-within:ring-2 focus-within:ring-ring lg:hidden"><span className="sr-only">Issue 视图</span><select aria-label="Issue 视图" value={activeSavedViewId ? `saved:${activeSavedViewId}` : activeView} onChange={(event) => { const value = event.target.value; if (value.startsWith("saved:")) { const saved = savedViews.find((item) => item.id === Number(value.slice(6))); if (saved) onApplySavedView?.(saved); } else selectView(value as IssueListView); }} className="h-full min-w-0 w-full cursor-pointer bg-transparent outline-none"><optgroup label="内置视图">{views.map(([view, label]) => <option key={view} value={view}>{label}</option>)}</optgroup>{savedViews.length > 0 && <optgroup label="保存的视图">{savedViews.map((saved) => <option key={saved.id} value={`saved:${saved.id}`}>{saved.name}{activeSavedViewId === saved.id && savedViewDirty ? " *" : ""}</option>)}</optgroup>}</select></label>
        <nav className="hidden max-w-full gap-1 lg:flex lg:flex-col" aria-label="Issue 视图导航">
          {views.map(([view, label]) => <button
            key={view}
            type="button"
            aria-pressed={activeView === view}
            onClick={() => selectView(view)}
            className={`h-11 shrink-0 rounded px-3 text-left text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-8 sm:px-2.5 ${activeView === view ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
          >{label}</button>)}
        </nav>
        {onCreateSavedView && onUpdateSavedView && onCopySavedView && onDeleteSavedView && onRetrySavedViews && <IssueSavedViews views={savedViews} activeViewId={activeSavedViewId} dirty={savedViewDirty} currentQuery={query} loading={savedViewsLoading} error={savedViewsError} saving={savedViewsSaving} onApply={(saved) => onApplySavedView?.(saved)} onCreate={onCreateSavedView} onUpdate={onUpdateSavedView} onCopy={onCopySavedView} onDelete={onDeleteSavedView} onRetry={onRetrySavedViews} />}
      </aside>

      <div className="flex min-w-0 max-w-full flex-col overflow-x-hidden">
        <div data-localapp-issue-toolbar data-testid="issue-toolbar" className="flex min-w-0 flex-col gap-2 border-b bg-muted/20 px-4 py-2.5 [&_label:focus-within]:ring-2 [&_label:focus-within]:ring-ring sm:flex-row sm:flex-wrap sm:items-center sm:px-5">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              ref={searchInputRef}
              type="search"
              aria-label="搜索 Issue"
              aria-keyshortcuts="Meta+/ Control+/"
              aria-autocomplete="list"
              aria-expanded={visibleSuggestions.length > 0}
              aria-controls={visibleSuggestions.length > 0 ? suggestionListId : undefined}
              aria-activedescendant={activeSuggestion >= 0 ? visibleSuggestions[activeSuggestion]?.id : undefined}
              value={searchInput}
              onFocus={(event) => { if (insertedSuggestionCursorRef.current === null) setSuggestionCursor(event.currentTarget.selectionStart ?? searchInput.length); setSuggestionsOpen(true); }}
              onBlur={() => window.setTimeout(() => setSuggestionsOpen(false), 0)}
              onChange={(event) => { insertedSuggestionCursorRef.current = null; onSearchInputChange(event.target.value); setSuggestionCursor(event.target.selectionStart ?? event.target.value.length); setActiveSuggestion(-1); setSuggestionsOpen(true); }}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown" && visibleSuggestions.length > 0) { event.preventDefault(); setActiveSuggestion((current) => (current + 1) % visibleSuggestions.length); return; }
                if (event.key === "ArrowUp" && visibleSuggestions.length > 0) { event.preventDefault(); setActiveSuggestion((current) => current <= 0 ? visibleSuggestions.length - 1 : current - 1); return; }
                if ((event.key === "Enter" || event.key === "Tab") && activeSuggestion >= 0 && visibleSuggestions[activeSuggestion]) { event.preventDefault(); selectSuggestion(visibleSuggestions[activeSuggestion]); return; }
                if (event.key === "Escape" && visibleSuggestions.length > 0) { event.preventDefault(); event.stopPropagation(); setSuggestionsOpen(false); setActiveSuggestion(-1); return; }
                if (event.key === "Escape" && searchInput) { event.preventDefault(); event.stopPropagation(); clearSearch(); return; }
                if (event.key === "Enter") { event.preventDefault(); setSuggestionsOpen(false); onSubmitSearch(); }
              }}
              placeholder="搜索 Issues"
              className="h-11 min-w-0 pl-8 pr-11 text-xs [&::-webkit-search-cancel-button]:appearance-none [&::-webkit-search-decoration]:appearance-none sm:h-8 sm:pr-9"
            />
            {searchInput && <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="清除 Issue 搜索"
              className="absolute right-0 top-0 h-11 w-11 sm:h-8 sm:w-8"
              onMouseDown={(event) => event.preventDefault()}
              onClick={clearSearch}
            ><X className="h-3.5 w-3.5" aria-hidden="true" /></Button>}
            {visibleSuggestions.length > 0 && <div id={suggestionListId} role="listbox" aria-label="搜索限定词建议" className="absolute left-0 right-0 top-[calc(100%+4px)] z-[65] max-h-72 overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-lg">
              {visibleSuggestions.map((suggestion, index) => <button
                id={suggestion.id}
                key={suggestion.id}
                type="button"
                role="option"
                aria-selected={activeSuggestion === index}
                aria-label={`${suggestion.label} ${suggestion.description}`}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => selectSuggestion(suggestion)}
                className={`flex min-h-11 w-full min-w-0 items-center gap-3 rounded px-3 py-1.5 text-left sm:min-h-10 sm:px-2.5 ${activeSuggestion === index ? "bg-accent text-accent-foreground" : "hover:bg-muted"}`}
              ><code className="shrink-0 text-xs font-semibold">{suggestion.value}</code><span className="min-w-0 truncate text-xs text-muted-foreground">{suggestion.description}</span></button>)}
            </div>}
          </div>
          <button
            type="button"
            aria-label={advancedFilterCount > 0 ? `筛选，已启用 ${advancedFilterCount} 项` : "筛选"}
            aria-expanded={advancedFiltersOpen}
            aria-controls="localapp-issue-advanced-filters"
            onClick={() => setAdvancedFiltersOpen((open) => !open)}
            className="flex h-11 w-full items-center justify-between rounded-md border bg-background px-3 text-xs font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:hidden"
          ><span className="inline-flex items-center gap-2"><ListFilter className="h-3.5 w-3.5" aria-hidden="true" />筛选</span>{advancedFilterCount > 0 && <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">{advancedFilterCount}</span>}</button>
          <div id="localapp-issue-advanced-filters" data-testid="issue-advanced-filters" className={`${advancedFiltersOpen ? "grid" : "hidden"} min-w-0 grid-cols-1 gap-2 min-[360px]:grid-cols-2 sm:contents [&>label]:min-w-0`}>
          <label className="flex h-11 shrink-0 items-center gap-1.5 rounded-md border bg-background px-3 text-xs text-muted-foreground sm:h-8 sm:px-2">
            <ListFilter className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="sr-only">按类型筛选</span>
            <select aria-label="按类型筛选" value={query.issueType} onChange={(event) => onQueryChange({ issueType: event.target.value as IssueListQuery["issueType"] })} className="h-full min-w-0 cursor-pointer bg-transparent outline-none">
              <option value="">全部类型</option>
              <option value="task">任务</option>
              <option value="bug">缺陷</option>
              <option value="feature">功能</option>
            </select>
          </label>
          <label className="flex h-11 shrink-0 items-center gap-1.5 rounded-md border bg-background px-3 text-xs text-muted-foreground sm:h-8 sm:px-2">
            <ListFilter className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="sr-only">按标签筛选</span>
            <select aria-label="按标签筛选" aria-keyshortcuts="L" value={query.label} onChange={(event) => onQueryChange({ label: event.target.value })} className="h-full min-w-0 cursor-pointer bg-transparent outline-none">
              <option value="">全部标签</option>
              <option value="none">无标签</option>
              {labels.map((label) => <option key={label.id} value={label.id}>{label.name}</option>)}
            </select>
          </label>
          {query.status === "closed" && <label className="flex h-11 shrink-0 items-center gap-1.5 rounded-md border bg-background px-3 text-xs text-muted-foreground sm:h-8 sm:px-2">
            <CircleSlash2 className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="sr-only">按关闭原因筛选</span>
            <select aria-label="按关闭原因筛选" value={query.reason} onChange={(event) => onQueryChange({ reason: event.target.value as IssueListQuery["reason"] })} className="h-full min-w-0 cursor-pointer bg-transparent outline-none">
              <option value="">全部关闭原因</option><option value="completed">已完成</option><option value="not_planned">不计划处理</option>
            </select>
          </label>}
          <label className="flex h-11 shrink-0 items-center gap-1.5 rounded-md border bg-background px-3 text-xs text-muted-foreground sm:h-8 sm:px-2">
            <UserRound className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="sr-only">按创建者筛选</span>
            <select aria-label="按创建者筛选" aria-keyshortcuts="U" value={query.author} onChange={(event) => onQueryChange({ author: event.target.value })} className="h-full min-w-0 cursor-pointer bg-transparent outline-none">
              <option value="">全部创建者</option>
              {query.author && !users.some((user) => user.id === query.author) && <option value={query.author}>{query.author}</option>}
              {users.map((user) => <option key={user.id} value={user.id}>{user.displayName || user.name || user.id}</option>)}
            </select>
          </label>
          <label className="flex h-11 shrink-0 items-center gap-1.5 rounded-md border bg-background px-3 text-xs text-muted-foreground sm:h-8 sm:px-2">
            <UserRound className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="sr-only">按负责人筛选</span>
            <select aria-label="按负责人筛选" aria-keyshortcuts="A" value={query.assignee} onChange={(event) => onQueryChange({ assignee: event.target.value })} className="h-full min-w-0 cursor-pointer bg-transparent outline-none">
              <option value="">全部负责人</option>
              <option value="none">未分配</option>
              {users.map((user) => <option key={user.id} value={user.id}>{user.displayName || user.name || user.id}</option>)}
            </select>
          </label>
          <label className="flex h-11 shrink-0 items-center gap-1.5 rounded-md border bg-background px-3 text-xs text-muted-foreground sm:h-8 sm:px-2">
            <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="sr-only">按里程碑筛选</span>
            <select aria-label="按里程碑筛选" aria-keyshortcuts="M" value={query.milestone} onChange={(event) => onQueryChange({ milestone: event.target.value })} className="h-full min-w-0 cursor-pointer bg-transparent outline-none">
              <option value="">全部里程碑</option><option value="none">无里程碑</option>
              {query.milestone && query.milestone !== "none" && !milestones.some((item) => String(item.id) === query.milestone) && <option value={query.milestone}>里程碑 #{query.milestone}</option>}
              {milestones.map((item) => <option key={item.id} value={item.id}>{item.title}{item.state === "closed" ? "（已关闭）" : ""}</option>)}
            </select>
          </label>
          <label className="flex h-11 shrink-0 items-center gap-1.5 rounded-md border bg-background px-3 text-xs text-muted-foreground sm:h-8 sm:px-2">
            <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="sr-only">排序 Issue</span>
            <select aria-label="排序 Issue" value={`${query.sort}:${query.direction}`} onChange={(event) => {
              const [sort, direction] = event.target.value.split(":") as [IssueListQuery["sort"], IssueListQuery["direction"]];
              onQueryChange({ sort, direction });
            }} className="h-full min-w-0 cursor-pointer bg-transparent outline-none">
              <option value="activity:desc">最近活动</option>
              <option value="created:desc">最新创建</option>
              <option value="created:asc">最早创建</option>
              <option value="updated:desc">最近更新</option>
              <option value="comments:desc">评论最多</option>
            </select>
          </label>
          </div>
        </div>
        {appliedFilters.length > 0 && <div role="region" aria-label="已应用筛选" className="flex min-w-0 flex-wrap items-center gap-1.5 border-b bg-muted/10 px-4 py-2 sm:px-5">
          {appliedFilters.map((filter) => <button
            key={filter.key}
            type="button"
            aria-label={`移除${filter.kind}筛选 ${filter.value}`}
            onClick={() => removeAppliedFilter(filter.key)}
            className="inline-flex h-11 max-w-full min-w-0 shrink-0 items-center gap-1.5 rounded-md border bg-background px-3 text-xs text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-7 sm:px-2"
          ><span className="truncate"><strong className="font-medium text-foreground">{filter.kind}:</strong> {filter.value}</span><X className="h-3 w-3 shrink-0" aria-hidden="true" /></button>)}
          <button type="button" onClick={resetAll} aria-label="清除全部筛选" className="h-11 shrink-0 rounded px-3 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-7 sm:px-2">清除全部</button>
        </div>}

        {showPinnedIssues && <section data-localapp-pinned-issues aria-labelledby="localapp-pinned-issues-title" className="border-b bg-muted/10 px-4 py-3 sm:px-5">
          <h3 id="localapp-pinned-issues-title" className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground"><Pin className="h-3.5 w-3.5" aria-hidden="true" />置顶 Issues</h3>
          <div className="grid min-w-0 gap-2 sm:grid-cols-2 xl:grid-cols-3">{pinnedIssues.map((issue) => <article key={issue.id} className="min-w-0 rounded-[6px] border bg-card px-3 py-3">
            <div className="flex min-w-0 items-start gap-2"><IssueListStatusIcon issue={issue} className="mt-1 h-4 w-4 shrink-0" /><a href={getIssueHref(issue)} aria-label={`#${issue.issue_number} ${issue.title}`} onClick={(event) => openIssueFromLink(event, issue)} className="min-h-6 min-w-0 flex-1 break-words font-semibold leading-6 hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{issue.title}</a></div>
            <div className="mt-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground"><span>#{issue.issue_number}</span><button type="button" onClick={() => onQueryChange({ issueType: issue.issue_type ?? issue.label, offset: 0 })} className="rounded border px-1.5 py-0.5 font-medium text-foreground hover:bg-muted">{ISSUE_TYPE_LABELS[issue.issue_type ?? issue.label]}</button>{issue.labels?.map((label) => <IssueLabelBadge key={label.id} label={label} />)}{Boolean(issue.is_duplicate) && <span className="inline-flex items-center gap-1"><Copy className="h-3.5 w-3.5" aria-hidden="true" />重复</span>}{Boolean(issue.is_blocked) && <span aria-label="已阻塞：存在未解决依赖" title="已阻塞：存在未解决依赖" className="inline-flex items-center gap-1 text-destructive"><CircleAlert className="h-3.5 w-3.5" aria-hidden="true" />已阻塞</span>}{(issue.comment_count ?? 0) > 0 && <span>{issue.comment_count} 条评论</span>}<IssueListActivityTime issue={issue} /></div>
          </article>)}</div>
        </section>}

        <div className="flex min-h-11 flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b px-4 py-2 sm:px-5">
          <div className="inline-flex min-w-0 items-center gap-1">
            {canBulkManage && <label className="-my-2 -ml-2 inline-flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded focus-within:ring-2 focus-within:ring-ring sm:-my-0 sm:-ml-1 sm:h-6 sm:w-6"><input ref={selectAllRef} type="checkbox" aria-label="选择当前页全部 Issue" checked={allSelected} disabled={loading || bulkSaving || issues.length === 0} onChange={(event) => toggleAll(event.target.checked)} className="h-4 w-4" /></label>}
            <button type="button" aria-label={`开启 ${meta.open}`} aria-pressed={query.status === "open"} onClick={() => selectStatus("open")} className={`inline-flex h-11 items-center gap-1.5 rounded px-3 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-8 sm:px-2 ${query.status === "open" ? "text-foreground" : "text-muted-foreground"}`}><CircleDot className="h-4 w-4" aria-hidden="true" />开启 {meta.open}</button>
            <button type="button" aria-label={`已关闭 ${meta.closed}`} aria-pressed={query.status === "closed"} onClick={() => selectStatus("closed")} className={`inline-flex h-11 items-center gap-1.5 rounded px-3 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-8 sm:px-2 ${query.status === "closed" ? "text-foreground" : "text-muted-foreground"}`}><CircleCheck className="h-4 w-4" aria-hidden="true" />已关闭 {meta.closed}</button>
          </div>
          <span role="status" aria-live="polite" className="inline-flex min-h-5 items-center gap-1.5 text-sm text-muted-foreground">{refreshing ? <><LoaderCircle className="h-3.5 w-3.5 motion-safe:animate-spin" aria-hidden="true" />正在更新结果</> : `${meta.total} 个结果`}</span>
        </div>

        {canBulkManage && <span role="status" aria-live="polite" aria-atomic="true" aria-label="Issue 选择状态" className="sr-only">{selectedCount > 0 ? `已选择 ${selectedCount} 条 Issue` : "未选择 Issue"}</span>}

        {canBulkManage && selectedCount > 0 && <div data-localapp-issue-bulk-toolbar role="toolbar" aria-label="批量 Issue 操作" onFocusCapture={() => { bulkToolbarFocusedRef.current = true; }} onBlurCapture={(event) => { const toolbar = event.currentTarget; window.requestAnimationFrame(() => { if (toolbar.isConnected && !toolbar.contains(document.activeElement)) bulkToolbarFocusedRef.current = false; }); }} className="flex min-h-11 flex-wrap items-center gap-2 border-b bg-muted/30 px-4 py-2 sm:px-5"><strong className="mr-auto text-sm">已选择 {selectedCount} 条</strong><label className="inline-flex h-11 items-center rounded-md border bg-background px-2 text-xs sm:h-7"><span className="sr-only">批量类型操作</span><select aria-label="批量类型操作" value={bulkIssueTypeAction} disabled={bulkSaving} onChange={(event) => { const value = event.target.value; setBulkIssueTypeAction(value); void applyBulkIssueType(value); }} className="h-full bg-transparent outline-none"><option value="" disabled>类型</option><option value="task">任务</option><option value="bug">缺陷</option><option value="feature">功能</option></select></label><label className="inline-flex h-11 items-center rounded-md border bg-background px-2 text-xs sm:h-7"><span className="sr-only">批量标签操作</span><select aria-label="批量标签操作" value={bulkLabelAction} disabled={bulkSaving} onChange={(event) => { const value = event.target.value; setBulkLabelAction(value); void applyBulkLabel(value); }} className="h-full bg-transparent outline-none"><option value="" disabled>标签</option><optgroup label="添加标签">{labels.map((label) => <option key={`add-${label.id}`} value={`add:${label.id}`}>添加：{label.name}</option>)}</optgroup><optgroup label="移除标签">{labels.map((label) => <option key={`remove-${label.id}`} value={`remove:${label.id}`}>移除：{label.name}</option>)}</optgroup></select></label><label className="inline-flex h-11 items-center rounded-md border bg-background px-2 text-xs sm:h-7"><span className="sr-only">批量负责人操作</span><select aria-label="批量负责人操作" value={bulkAssigneeAction} disabled={bulkSaving} onChange={(event) => { const value = event.target.value; setBulkAssigneeAction(value); void applyBulkAssignee(value); }} className="h-full bg-transparent outline-none"><option value="" disabled>负责人</option><optgroup label="添加负责人">{users.map((user) => <option key={`add-${user.id}`} value={`add:${user.id}`}>添加：{user.displayName || user.name || user.id}</option>)}</optgroup><optgroup label="移除负责人">{users.map((user) => <option key={`remove-${user.id}`} value={`remove:${user.id}`}>移除：{user.displayName || user.name || user.id}</option>)}</optgroup></select></label><label className="inline-flex h-11 items-center rounded-md border bg-background px-2 text-xs sm:h-7"><span className="sr-only">批量里程碑操作</span><select aria-label="批量里程碑操作" value={bulkMilestoneAction} disabled={bulkSaving} onChange={(event) => { const value = event.target.value; setBulkMilestoneAction(value); void applyBulkMilestone(value); }} className="h-full bg-transparent outline-none"><option value="" disabled>里程碑</option><option value="none">清除里程碑</option>{milestones.map((milestone) => <option key={milestone.id} value={milestone.id}>{milestone.title}{milestone.state === "closed" ? "（已关闭）" : ""}</option>)}</select></label><Button type="button" variant="outline" size="sm" className="h-11 sm:h-7" disabled={bulkSaving} onClick={() => void applyBulkStatus(query.status === "open" ? "closed" : "open")}>{query.status === "open" ? "关闭所选" : "重新打开所选"}</Button><Button type="button" variant="ghost" size="sm" className="h-11 sm:h-7" disabled={bulkSaving} onClick={() => { selectionAnchorIssueIdRef.current = null; setSelectedIds(new Set()); setBulkMessage(""); window.requestAnimationFrame(() => selectAllRef.current?.focus()); }}>清除选择</Button></div>}
        <span aria-live="polite" className="sr-only">{bulkSaving ? `正在更新 ${selectedCount} 条 Issue` : bulkMessage}</span>
        {bulkMessage && <div role={selectedCount > 0 ? "alert" : "status"} className="border-b bg-muted/20 px-4 py-2 text-xs text-muted-foreground sm:px-5">{bulkMessage}</div>}

        {error && issues.length > 0 && <div role="alert" className="flex items-center justify-between gap-3 border-b border-destructive/20 bg-destructive/10 px-4 py-2.5 text-sm text-destructive sm:px-5"><span>显示上次结果：{error}</span><Button type="button" variant="outline" size="sm" className="h-11 shrink-0 sm:h-7" onClick={onRetry}>重试</Button></div>}

        <div className="min-h-0 flex-1 overflow-y-auto" aria-busy={loading}>
          {loading && issues.length === 0 ? <div aria-label="正在加载 Issue" role="status" className="space-y-0"><span className="sr-only">正在加载 Issue 列表</span>{Array.from({ length: 6 }, (_, item) => <div key={item} className="flex h-[76px] items-start gap-3 border-b px-4 py-3 motion-safe:animate-pulse sm:px-5"><span className="mt-1 h-4 w-4 rounded-full bg-muted" /><span className="min-w-0 flex-1"><span className="block h-4 w-2/3 rounded bg-muted" /><span className="mt-3 block h-3 w-1/2 rounded bg-muted/70" /></span><span className="h-4 w-8 rounded bg-muted/70" /></div>)}</div>
            : error && issues.length === 0 ? <div role="alert" className="flex min-h-[280px] flex-col items-center justify-center px-6 text-center"><CircleAlert className="h-9 w-9 text-destructive" aria-hidden="true" /><p className="mt-3 text-sm font-semibold">无法加载 Issues</p><p className="mt-1 max-w-md text-sm text-muted-foreground">{error}</p><Button type="button" variant="outline" size="sm" className="mt-4 h-11 sm:h-8" onClick={onRetry}>重试</Button></div>
              : issues.length === 0 ? <div className="flex min-h-[260px] flex-col items-center justify-center px-6 text-center"><IssueStatusIcon status={query.status} className="h-8 w-8" /><p className="mt-3 text-sm font-medium">{pageOutOfRange ? "当前页已无 Issue" : hasActiveFilters ? "当前筛选没有匹配的 Issue" : `此应用还没有${query.status === "open" ? "开启" : "已关闭"}的 Issue`}</p>{pageOutOfRange ? <Button ref={returnFirstPageRef} type="button" variant="outline" size="sm" className="mt-4 h-11 sm:h-8" onClick={() => onQueryChange({ offset: 0 })}>返回第一页</Button> : hasActiveFilters && <Button type="button" variant="outline" size="sm" className="mt-4 h-11 sm:h-8" onClick={resetAll}>重置筛选</Button>}</div>
              : <div ref={issueResultsRef} id="localapp-issue-results" role="list" aria-label={`${query.status === "open" ? "开启" : "已关闭"}的 Issues`} aria-busy={refreshing} data-stale={refreshing ? "true" : undefined}>
                {issues.map((issue, index) => <article key={issue.id} data-localapp-issue-row data-testid={`issue-row-${issue.id}`} role="listitem" aria-posinset={meta.offset + index + 1} aria-setsize={meta.total} className="flex min-w-0 gap-3 border-b px-4 py-3 last:border-b-0 hover:bg-muted/25 focus-within:bg-muted/25 sm:px-5">
            {canBulkManage && <label className="-my-2 -ml-2 inline-flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded focus-within:ring-2 focus-within:ring-ring sm:-my-0 sm:-ml-1 sm:h-6 sm:w-6"><input type="checkbox" aria-label={`选择 Issue #${issue.issue_number}`} checked={selectedIds.has(issue.id)} disabled={bulkSaving} readOnly onFocus={() => { focusedSelectionIdRef.current = issue.id; }} onBlur={(event) => { if (event.currentTarget.isConnected) focusedSelectionIdRef.current = null; }} onKeyDown={(event) => { if (event.key === " ") { event.preventDefault(); toggleSelected(issue.id, !selectedIds.has(issue.id), false); } }} onClick={(event) => toggleSelected(issue.id, event.currentTarget.checked, event.shiftKey && event.detail > 0)} className="h-4 w-4" /></label>}
                  <IssueListStatusIcon issue={issue} className="mt-1 h-4 w-4 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <a href={getIssueHref(issue)} data-localapp-issue-link aria-label={`#${issue.issue_number} ${issue.title}`} aria-keyshortcuts="J K ArrowDown ArrowUp O Enter" onClick={(event) => openIssueFromLink(event, issue)} className="flex min-h-11 max-w-full items-center rounded-sm break-words text-left text-base font-semibold leading-6 text-foreground hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-6">{issue.title}</a>
                    <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-sm leading-5 text-muted-foreground"><button type="button" onClick={() => onQueryChange({ issueType: issue.issue_type ?? issue.label, offset: 0 })} className="rounded border px-1.5 py-0.5 text-xs font-medium text-foreground hover:bg-muted">{ISSUE_TYPE_LABELS[issue.issue_type ?? issue.label]}</button>{(issue.labels ?? []).map((label) => <IssueLabelBadge key={label.id} label={label} onSelect={(labelId) => onQueryChange({ label: labelId, offset: 0 })} />)}{Boolean(issue.is_duplicate) && <span className="inline-flex items-center gap-1"><Copy className="h-3.5 w-3.5" aria-hidden="true" />重复</span>}{issue.locked_at && <span aria-label="对话已锁定" title="对话已锁定" className="inline-flex items-center"><LockKeyhole className="h-3.5 w-3.5" aria-hidden="true" /></span>}{Boolean(issue.is_blocked) && <span aria-label="已阻塞：存在未解决依赖" title="已阻塞：存在未解决依赖" className="inline-flex items-center gap-1 text-destructive"><CircleAlert className="h-3.5 w-3.5" aria-hidden="true" />已阻塞</span>}<IssueListMilestone milestone={milestones.find((milestone) => milestone.id === issue.milestone_id)} onSelect={(milestoneId) => onQueryChange({ milestone: String(milestoneId), offset: 0 })} /><span>#{issue.issue_number}</span><button type="button" aria-label={`按创建者筛选 ${userLabel(issue.reporter_id)}`} title={`${userLabel(issue.reporter_id)} @${issue.reporter_id}`} onClick={() => onQueryChange({ author: issue.reporter_id, offset: 0 })} className="min-h-6 max-w-full rounded-sm break-words text-left hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{userLabel(issue.reporter_id)}</button><IssueListActivityTime issue={issue} />{issue.participant_ids?.length ? <span className="hidden sm:inline">{issue.participant_ids.length} 位参与者</span> : null}</div>
                  </div>
                  <IssueListAssignees ids={issue.assignee_ids ?? []} users={users} onSelect={(userId) => onQueryChange({ assignee: userId, offset: 0 })} />
                  {(issue.comment_count ?? 0) > 0 ? <a href={getIssueHref(issue)} aria-label={`${issue.issue_number} 的评论数 ${issue.comment_count}`} onClick={(event) => openIssueFromLink(event, issue)} className="-my-2 inline-flex h-11 w-11 shrink-0 items-center justify-center gap-1 rounded-sm text-sm leading-5 text-muted-foreground hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:-my-0 sm:h-6 sm:w-10"><MessageSquare className="h-4 w-4" aria-hidden="true" />{issue.comment_count}</a> : <span aria-hidden="true" className="h-11 w-11 shrink-0 sm:h-6 sm:w-10" />}
                </article>)}
              </div>}
        </div>

        <div className="flex min-h-11 items-center justify-between border-t px-4 text-xs text-muted-foreground sm:px-5"><span role="status" aria-live="polite" aria-atomic="true" aria-label={issues.length === 0 ? `当前没有可显示的 Issue，共 ${meta.total} 条 Issue` : `当前显示第 ${meta.offset + 1} 至 ${Math.min(meta.offset + issues.length, meta.total)} 条，共 ${meta.total} 条 Issue`}>{issues.length === 0 ? `0 / ${meta.total}` : `${meta.offset + 1}-${Math.min(meta.offset + issues.length, meta.total)} / ${meta.total}`}</span><div className="flex items-center gap-1"><Button type="button" variant="ghost" size="icon" className="h-11 w-11 sm:h-8 sm:w-8" aria-label="上一页" aria-controls="localapp-issue-results" disabled={query.offset === 0} onClick={() => changePage(Math.max(0, query.offset - query.limit))}><ChevronLeft className="h-4 w-4" /></Button><Button type="button" variant="ghost" size="icon" className="h-11 w-11 sm:h-8 sm:w-8" aria-label="下一页" aria-controls="localapp-issue-results" disabled={query.offset + query.limit >= meta.total} onClick={() => changePage(query.offset + query.limit)}><ChevronRight className="h-4 w-4" /></Button></div></div>
      </div>
    </section>
  );
}
