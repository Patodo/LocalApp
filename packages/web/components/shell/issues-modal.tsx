"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, CalendarDays, Check, Copy, LoaderCircle, MessageSquare, Plus, Tag, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { discardIssueAttachmentDraft, IssueComposer } from "./issue-composer";
import { addIssueDependency, addIssueSubIssue, convertIssueTaskToSubIssue, createIssue, createIssueComment, createIssueLabel, createIssueMilestone, createIssueSavedView, deleteIssue, deleteIssueComment, deleteIssueLabel, deleteIssueMilestone, deleteIssueSavedView, duplicateIssueSavedView, getIssueDetail, getIssueDetailByNumber, IssueContentConflictError, listIssueLabels, listIssueMilestones, listIssueSavedViews, listIssues, listIssueTemplates, listIssueUsers, listPotentialDuplicateIssues, removeIssueDependency, removeIssueSubIssue, reprioritizeIssueSubIssue, requestIssueCatalogWithRetry, unmarkIssueDuplicate, updateIssue, updateIssueAssignees, updateIssueComment, updateIssueCommentMinimized, updateIssueCommentPin, updateIssueLabel, updateIssueLabels, updateIssueLock, updateIssueMilestone, updateIssueMilestoneAssignment, updateIssuePin, updateIssueReaction, updateIssueSavedView, updateIssueSubscription } from "./issue-api";
import { IssueLabelManager } from "./issue-label-manager";
import { IssueMilestoneManager } from "./issue-milestone-manager";
import { IssueListWorkspace } from "./issue-list-workspace";
import { AttachmentLinks, IssueDetailWorkspace } from "./issue-detail-workspace";
import { IssueActionMenu } from "./issue-action-menu";
import { IssueRevisionDialog } from "./issue-revision-dialog";
import { IssueMetadataPicker } from "./issue-metadata-picker";
import { IssueLabelBadge } from "./issue-label-badge";
import { IssueActor } from "./issue-actor";
import { IssueDiscardDraftControl } from "./issue-discard-draft-control";
import { resolveIssueIdentity } from "./issue-identity";
import { IssueDetailError, IssueDetailSkeleton } from "./issue-loading-state";
import { IssuePotentialDuplicates } from "./issue-potential-duplicates";
import { IssueTemplateChooser } from "./issue-template-chooser";
import { quoteIssueComment } from "./issue-timeline";
import { referenceIssueComment } from "./issue-comment-reference";
import { toggleIssueTask } from "./issue-task-list";
import { DEFAULT_ISSUE_LIST_QUERY, issueListQueryFromSavedView, issueSavedViewMatchesListQuery, normalizeIssueListQuery, readIssueListQuery, updateIssueListQueryUrl, type IssueListQuery } from "./issue-list-query";
import { formatIssueSearchInput, getIssueSearchSuggestions, parseIssueSearchInput } from "./issue-search-query";
import { copyIssueUrl, readIssueCommentDeepLinkId, updateIssueCommentDeepLinkUrl, updateIssueDeepLinkUrl, updateIssueNumberDeepLinkUrl } from "./issue-deep-link";
import { ISSUE_LOCK_REASON_LABELS, ISSUE_TYPE_LABELS, type ComposerSubmit, type Issue, type IssueDetail, type IssueLabelDefinition, type IssueListMeta, type IssueMilestoneDefinition, type IssuePotentialDuplicate, type IssueSavedView, type IssueStatus, type IssueTemplateConfig, type IssueType, type IssueUserIdentity, type ShellUser } from "./issue-types";

type IssuesView = { kind: "list" } | { kind: "templates" } | { kind: "labels" } | { kind: "milestones" } | { kind: "detail-loading"; issueId: number; lookupByNumber: boolean } | { kind: "detail"; detail: IssueDetail } | { kind: "create"; parentIssueId?: number; returnToTemplates?: boolean; reference?: { detail: IssueDetail; commentId: number; trigger: HTMLButtonElement | null } } | { kind: "edit"; detail: IssueDetail; originalDetail: IssueDetail; expectedUpdatedAt: string; restoredDraft: boolean; draftId: string; removedAttachmentIds: string[] };
type RevisionTarget = { commentId?: number; title?: string; body: string; updatedAt: string; returnFocus: HTMLElement };
type IssueEditDraft = { title: string; issueType: IssueType; expectedUpdatedAt: string };
const ISSUE_TITLE_MAX_CHARACTERS = 256;

function issueTitleCharacterCount(title: string): number {
  return Array.from(title.trim()).length;
}

export function isIssueFocusTargetVisible(element: HTMLElement, boundary: HTMLElement): boolean {
  for (let current: HTMLElement | null = element; current; current = current.parentElement) {
    if (current.hidden || current.getAttribute("aria-hidden") === "true") return false;
    const style = window.getComputedStyle(current);
    if (style.display === "none" || style.visibility === "hidden") return false;
    if (current === boundary) return true;
  }
  return false;
}

function readIssueEditDraft(key: string): IssueEditDraft | null {
  try {
    const value = JSON.parse(window.sessionStorage.getItem(key) ?? "null") as (Partial<IssueEditDraft> & { label?: unknown }) | null;
    const issueType = value?.issueType ?? value?.label;
    return value && typeof value.title === "string" && (issueType === "task" || issueType === "bug" || issueType === "feature") && typeof value.expectedUpdatedAt === "string" ? { title: value.title, issueType, expectedUpdatedAt: value.expectedUpdatedAt } : null;
  } catch { return null; }
}

function writeIssueEditDraft(key: string, value: IssueEditDraft | null) {
  try { value ? window.sessionStorage.setItem(key, JSON.stringify(value)) : window.sessionStorage.removeItem(key); } catch { /* Editing remains usable without session storage. */ }
}

interface IssuesModalProps {
  pagePath: string;
  pageName: string;
  user: ShellUser | null;
  onClose: () => void;
  onIssuesChanged?: () => void;
  selectedIssueId?: number | null;
  selectedIssueNumber?: number | null;
  onIssueNavigate?: (issueId: number | null, mode?: "push" | "replace") => void;
}

function newDraftId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `issue-draft-${Date.now()}-${Math.random()}`;
}

function issueDraftPrefix(pagePath: string, userId: string): string {
  return `localapp:issues:draft:v1:${encodeURIComponent(pagePath)}:${encodeURIComponent(userId)}`;
}

function readCreateDraft(key: string): { title: string; issueType: IssueType; labelIds: string[]; assigneeIds: string[]; milestoneId: number | null } {
  try {
    const value = JSON.parse(window.sessionStorage.getItem(key) ?? "null") as { title?: unknown; issueType?: unknown; label?: unknown; labelIds?: unknown; assigneeIds?: unknown; milestoneId?: unknown } | null;
    const issueType = value?.issueType ?? value?.label;
    return {
      title: typeof value?.title === "string" ? value.title : "",
      issueType: issueType === "feature" ? "feature" : issueType === "bug" ? "bug" : "task",
      labelIds: Array.isArray(value?.labelIds) ? value.labelIds.filter((id): id is string => typeof id === "string" && id !== "bug" && id !== "feature") : [],
      assigneeIds: Array.isArray(value?.assigneeIds) ? value.assigneeIds.filter((id): id is string => typeof id === "string") : [],
      milestoneId: typeof value?.milestoneId === "number" && Number.isSafeInteger(value?.milestoneId) && value.milestoneId > 0 ? value.milestoneId : null,
    };
  } catch { return { title: "", issueType: "task", labelIds: [], assigneeIds: [], milestoneId: null }; }
}

function hasPersistedCreateContent(key: string): boolean {
  try {
    const metadata = readCreateDraft(key);
    return Boolean(metadata.title || metadata.issueType !== "task" || metadata.labelIds.length || metadata.assigneeIds.length || metadata.milestoneId !== null || window.sessionStorage.getItem(`${key}:body`) || window.sessionStorage.getItem(`${key}:body:attachments`));
  } catch { return false; }
}

function writeCreateDraft(key: string, title: string, issueType: IssueType, labelIds: string[] = [], assigneeIds: string[] = [], milestoneId: number | null = null) {
  try {
    if (title || issueType !== "task" || labelIds.length > 0 || assigneeIds.length > 0 || milestoneId !== null) window.sessionStorage.setItem(key, JSON.stringify({ title, issueType, labelIds, assigneeIds, milestoneId }));
    else window.sessionStorage.removeItem(key);
  } catch {
    // Draft persistence is best-effort and must not block issue creation.
  }
}

function catalogFailureMessage(labelError: boolean, userError: boolean, milestoneError: boolean): string {
  const count = Number(labelError) + Number(userError) + Number(milestoneError);
  if (count > 1) return "元数据目录加载失败，正在显示可用的本地信息";
  if (labelError) return "标签目录暂不可用";
  if (userError) return "负责人目录加载失败，正在显示已知用户";
  return "里程碑目录加载失败，正在显示已知里程碑";
}

function catalogRetryLabel(labelError: boolean, userError: boolean, milestoneError: boolean): string {
  const count = Number(labelError) + Number(userError) + Number(milestoneError);
  if (count > 1) return "重试元数据目录";
  if (labelError) return "重试标签目录";
  if (userError) return "重试负责人目录";
  return "重试里程碑目录";
}

export function IssuesModal({ pagePath, pageName, user, onClose, onIssuesChanged, selectedIssueId, selectedIssueNumber, onIssueNavigate }: IssuesModalProps) {
  const [view, setView] = useState<IssuesView>({ kind: "list" });
  const [query, setQuery] = useState<IssueListQuery>(() => typeof window === "undefined" ? DEFAULT_ISSUE_LIST_QUERY : readIssueListQuery(new URL(window.location.href)));
  const [searchInput, setSearchInput] = useState(() => {
    if (typeof window === "undefined") return "";
    const restored = readIssueListQuery(new URL(window.location.href));
    return formatIssueSearchInput(restored.q, restored.searchIn);
  });
  const [issues, setIssues] = useState<Issue[]>([]);
  const [pinnedIssues, setPinnedIssues] = useState<Issue[]>([]);
  const [meta, setMeta] = useState<IssueListMeta>({ total: 0, open: 0, closed: 0, limit: 25, offset: 0 });
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDeleteIssue, setConfirmingDeleteIssue] = useState(false);
  const [deletingIssue, setDeletingIssue] = useState(false);
  const [deleteIssueError, setDeleteIssueError] = useState<string | null>(null);
  const deleteIssueTriggerRef = useRef<HTMLButtonElement | null>(null);
  const deleteIssueCancelRef = useRef<HTMLButtonElement | null>(null);
  const deleteIssueConfirmRef = useRef<HTMLButtonElement | null>(null);
  const [detailRetryIssue, setDetailRetryIssue] = useState<Issue | null>(null);
  const [createTitle, setCreateTitle] = useState("");
  const [createBody, setCreateBody] = useState("");
  const [createInitialBody, setCreateInitialBody] = useState("");
  const [createWasRestoredDraft, setCreateWasRestoredDraft] = useState(false);
  const [issueTemplates, setIssueTemplates] = useState<IssueTemplateConfig[]>([]);
  const [issueTemplatesLoaded, setIssueTemplatesLoaded] = useState(false);
  const [issueTemplatesLoading, setIssueTemplatesLoading] = useState(true);
  const [issueTemplatesError, setIssueTemplatesError] = useState<string | null>(null);
  const [issueTemplatesRevision, setIssueTemplatesRevision] = useState(0);
  const [issueTemplateNotice, setIssueTemplateNotice] = useState<string | null>(null);
  const [savedViews, setSavedViews] = useState<IssueSavedView[]>([]);
  const [savedViewsLoading, setSavedViewsLoading] = useState(false);
  const [savedViewsError, setSavedViewsError] = useState<string | null>(null);
  const [savedViewsSaving, setSavedViewsSaving] = useState(false);
  const [savedViewsRevision, setSavedViewsRevision] = useState(0);
  const [activeSavedViewId, setActiveSavedViewId] = useState<number | null>(null);
  const [potentialDuplicates, setPotentialDuplicates] = useState<IssuePotentialDuplicate[]>([]);
  const [potentialDuplicatesLoading, setPotentialDuplicatesLoading] = useState(false);
  const [potentialDuplicatesError, setPotentialDuplicatesError] = useState<string | null>(null);
  const [potentialDuplicatesRevision, setPotentialDuplicatesRevision] = useState(0);
  const [createType, setCreateType] = useState<IssueType>("task");
  const [createLabelIds, setCreateLabelIds] = useState<string[]>([]);
  const [createAssigneeIds, setCreateAssigneeIds] = useState<string[]>([]);
  const [createMilestoneId, setCreateMilestoneId] = useState<number | null>(null);
  const [createDraftId, setCreateDraftId] = useState(newDraftId);
  const [commentDraftId, setCommentDraftId] = useState(newDraftId);
  const [commentInsertRequest, setCommentInsertRequest] = useState<{ id: number; text: string } | null>(null);
  const [revisionTarget, setRevisionTarget] = useState<RevisionTarget | null>(null);
  const [platformIdentities, setPlatformIdentities] = useState<IssueUserIdentity[]>([]);
  const [userCatalogError, setUserCatalogError] = useState(false);
  const [userCatalogLoading, setUserCatalogLoading] = useState(false);
  const [userCatalogRevision, setUserCatalogRevision] = useState(0);
  const [issueLabels, setIssueLabels] = useState<IssueLabelDefinition[]>([]);
  const [labelCatalogError, setLabelCatalogError] = useState(false);
  const [labelCatalogLoading, setLabelCatalogLoading] = useState(false);
  const [labelCatalogRevision, setLabelCatalogRevision] = useState(0);
  const [labelSaving, setLabelSaving] = useState(false);
  const [labelManagerError, setLabelManagerError] = useState<string | null>(null);
  const [issueMilestones, setIssueMilestones] = useState<IssueMilestoneDefinition[]>([]);
  const [issueMilestonesLoaded, setIssueMilestonesLoaded] = useState(false);
  const [milestoneCatalogError, setMilestoneCatalogError] = useState(false);
  const [milestoneCatalogLoading, setMilestoneCatalogLoading] = useState(false);
  const [milestoneCatalogRevision, setMilestoneCatalogRevision] = useState(0);
  const [milestoneSaving, setMilestoneSaving] = useState(false);
  const [milestoneManagerError, setMilestoneManagerError] = useState<string | null>(null);
  const [statusSaving, setStatusSaving] = useState(false);
  const [closeReason, setCloseReason] = useState<"completed" | "not_planned">("completed");
  const [metadataSaving, setMetadataSaving] = useState(false);
  const [savingTaskTarget, setSavingTaskTarget] = useState<"issue" | number | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);
  const [remoteUpdateAvailable, setRemoteUpdateAvailable] = useState(false);
  const [remoteUpdateLoading, setRemoteUpdateLoading] = useState(false);
  const [detailSyncFailed, setDetailSyncFailed] = useState(false);
  const [detailSyncing, setDetailSyncing] = useState(false);
  const [detailUpdateNotice, setDetailUpdateNotice] = useState(false);
  const draftPrefix = user ? issueDraftPrefix(pagePath, user.id) : null;
  const createPersistenceKey = draftPrefix ? `${draftPrefix}:${view.kind === "create" && view.reference ? `reference-comment:${view.reference.detail.issue.id}:${view.reference.commentId}` : "create"}` : null;
  const ownerId = pagePath.split("/", 1)[0];
  const selectedCommentId = typeof window === "undefined" ? null : readIssueCommentDeepLinkId(new URL(window.location.href));
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const onCloseRef = useRef(onClose);
  const onIssueNavigateRef = useRef(onIssueNavigate);
  const listRequestGenerationRef = useRef(0);
  const listAbortRef = useRef<AbortController | null>(null);
  const detailRequestGenerationRef = useRef(0);
  const pendingIssueFocusIdRef = useRef<number | null>(null);
  const pendingTaskReferenceFocusRef = useRef<number | null>(null);
  const pendingReferenceCommentIdRef = useRef<number | null>(null);
  const statusActionRef = useRef<HTMLButtonElement | null>(null);
  const statusActionFocusPendingRef = useRef(false);
  const focusedDetailIdRef = useRef<number | null>(null);
  const createIssueTriggerRef = useRef<HTMLButtonElement | null>(null);
  const pendingCreateIssueFocusRef = useRef(false);
  const pendingListRetryFocusRef = useRef(false);
  const pendingCatalogRetryFocusRef = useRef(false);
  const commentInsertSequenceRef = useRef(0);
  const issueEventRefreshTimerRef = useRef<number | null>(null);
  const pendingIssueChangedIdsRef = useRef(new Set<number | null>());
  const viewRef = useRef(view);
  const previousEditingIssueIdRef = useRef<number | null>(null);
  const queryRef = useRef(query);
  const returnFocusRef = useRef<HTMLElement | null>(
    typeof document !== "undefined" && document.activeElement instanceof HTMLElement ? document.activeElement : null,
  );
  onCloseRef.current = onClose;
  onIssueNavigateRef.current = onIssueNavigate;
  viewRef.current = view;
  queryRef.current = query;
  const editingIssueId = view.kind === "edit" ? view.detail.issue.id : null;

  useEffect(() => {
    const previousEditingIssueId = previousEditingIssueIdRef.current;
    previousEditingIssueIdRef.current = editingIssueId;
    if (previousEditingIssueId === null || editingIssueId !== null) return;
    const frame = window.requestAnimationFrame(() => document.querySelector<HTMLButtonElement>('[data-testid="issue-body-card"] button[aria-label="Issue 操作"]')?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [editingIssueId]);

  const restoreFocus = useCallback(() => {
    if (returnFocusRef.current?.isConnected) returnFocusRef.current.focus();
  }, []);

  const applyListQuery = useCallback((updates: Partial<IssueListQuery>, historyMode: "push" | "replace" = "push") => {
    setQuery((current) => {
      const next = normalizeIssueListQuery(current, updates);
      const url = updateIssueListQueryUrl(new URL(window.location.href), next);
      if (url.href !== window.location.href) window.history[historyMode === "push" ? "pushState" : "replaceState"](null, "", url);
      return next;
    });
  }, []);

  useEffect(() => {
    const restoreListQuery = () => {
      const restored = readIssueListQuery(new URL(window.location.href));
      setQuery(restored);
      setSearchInput(formatIssueSearchInput(restored.q, restored.searchIn));
    };
    window.addEventListener("popstate", restoreListQuery);
    return () => window.removeEventListener("popstate", restoreListQuery);
  }, []);

  const closeModal = useCallback(() => {
    const busyAttachmentQueue = dialogRef.current?.querySelector<HTMLElement>('[data-localapp-issue-attachment-queue][aria-busy="true"]');
    if (busyAttachmentQueue) {
      busyAttachmentQueue.focus();
      busyAttachmentQueue.scrollIntoView?.({ block: "nearest" });
      return;
    }
    restoreFocus();
    onCloseRef.current();
  }, [restoreFocus]);

  const showCreateIssue = useCallback((parentIssueId?: number, template?: IssueTemplateConfig, returnToTemplates = false) => {
    setError(null);
    setIssueTemplateNotice(null);
    const createKey = user ? issueDraftPrefix(pagePath, user.id) + ":create" : null;
    const restored = createKey ? readCreateDraft(createKey) : { title: "", issueType: "task" as const, labelIds: [], assigneeIds: [], milestoneId: null };
    const hasDraft = createKey ? hasPersistedCreateContent(createKey) : false;
    setCreateWasRestoredDraft(hasDraft);
    const validTemplateLabels = template && !hasDraft ? template.labels.filter((id) => issueLabels.some((label) => label.id === id)) : [];
    const missingTemplateLabels = template && !hasDraft ? template.labels.filter((id) => !issueLabels.some((label) => label.id === id)) : [];
    setCreateTitle(hasDraft ? restored.title : template?.titlePrefix ?? "");
    const initialBody = hasDraft ? "" : template?.body ?? "";
    setCreateInitialBody(initialBody);
    setCreateBody(initialBody);
    setCreateType(hasDraft ? restored.issueType : template?.type ?? "task");
    setCreateLabelIds(hasDraft ? restored.labelIds : validTemplateLabels);
    setCreateAssigneeIds(restored.assigneeIds);
    setCreateMilestoneId(restored.milestoneId);
    if (missingTemplateLabels.length > 0) setIssueTemplateNotice(`模板中的标签已不可用：${missingTemplateLabels.join("、")}`);
    setCreateDraftId(newDraftId());
    setView({ kind: "create", ...(parentIssueId === undefined ? {} : { parentIssueId }), ...(returnToTemplates ? { returnToTemplates: true } : {}) });
  }, [issueLabels, pagePath, user]);

  const beginCreateIssue = useCallback(() => {
    const createKey = user ? `${issueDraftPrefix(pagePath, user.id)}:create` : null;
    if (createKey && hasPersistedCreateContent(createKey)) {
      showCreateIssue();
      return;
    }
    if (!issueTemplatesLoaded || issueTemplatesLoading || issueTemplatesError || issueTemplates.length > 0) {
      setView({ kind: "templates" });
      return;
    }
    showCreateIssue();
  }, [issueTemplates.length, issueTemplatesError, issueTemplatesLoaded, issueTemplatesLoading, pagePath, showCreateIssue, user]);

  useEffect(() => {
    const controller = new AbortController();
    setIssueTemplatesLoading(true);
    setIssueTemplatesError(null);
    void listIssueTemplates(pagePath, controller.signal)
      .then((templates) => { setIssueTemplates(templates); setIssueTemplatesLoaded(true); })
      .catch((requestError) => {
        if (controller.signal.aborted) return;
        setIssueTemplatesError(requestError instanceof Error ? requestError.message : "Issue 模板暂不可用");
        setIssueTemplatesLoaded(true);
      })
      .finally(() => { if (!controller.signal.aborted) setIssueTemplatesLoading(false); });
    return () => controller.abort();
  }, [issueTemplatesRevision, pagePath]);

  useEffect(() => {
    if (!user) { setSavedViews([]); setSavedViewsLoading(false); setSavedViewsError(null); setActiveSavedViewId(null); return; }
    const controller = new AbortController();
    setSavedViewsLoading(true);
    setSavedViewsError(null);
    void listIssueSavedViews(pagePath, controller.signal)
      .then(setSavedViews)
      .catch((requestError) => { if (!controller.signal.aborted) setSavedViewsError(requestError instanceof Error ? requestError.message : "保存视图加载失败"); })
      .finally(() => { if (!controller.signal.aborted) setSavedViewsLoading(false); });
    return () => controller.abort();
  }, [pagePath, savedViewsRevision, user?.id]);

  useEffect(() => {
    if (activeSavedViewId !== null && savedViews.some((saved) => saved.id === activeSavedViewId)) return;
    setActiveSavedViewId(savedViews.find((saved) => issueSavedViewMatchesListQuery(saved.query, query))?.id ?? null);
  }, [activeSavedViewId, query, savedViews]);

  useEffect(() => {
    if (view.kind !== "create" || !createTitle.trim() || Array.from(createBody).length < 100) {
      setPotentialDuplicates([]);
      setPotentialDuplicatesLoading(false);
      setPotentialDuplicatesError(null);
      return;
    }
    const controller = new AbortController();
    setPotentialDuplicates([]);
    setPotentialDuplicatesError(null);
    setPotentialDuplicatesLoading(true);
    const timer = window.setTimeout(() => {
      void listPotentialDuplicateIssues(pagePath, createTitle.trim(), createBody, controller.signal)
        .then(setPotentialDuplicates)
        .catch((requestError) => {
          if (controller.signal.aborted || (requestError instanceof Error && requestError.name === "AbortError")) return;
          setPotentialDuplicatesError("重复项建议暂不可用");
        })
        .finally(() => { if (!controller.signal.aborted) setPotentialDuplicatesLoading(false); });
    }, 400);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [createBody, createTitle, pagePath, potentialDuplicatesRevision, view.kind]);

  useEffect(() => {
    if (view.kind === "create" && createPersistenceKey) writeCreateDraft(createPersistenceKey, createTitle, createType, createLabelIds, createAssigneeIds, createMilestoneId);
  }, [createAssigneeIds, createType, createLabelIds, createMilestoneId, createTitle, draftPrefix, view.kind]);

  useEffect(() => {
    if (view.kind === "create" && issueMilestonesLoaded && createMilestoneId !== null && !issueMilestones.some((item) => item.id === createMilestoneId)) setCreateMilestoneId(null);
  }, [createMilestoneId, issueMilestones, issueMilestonesLoaded, view.kind]);

  const fetchIssues = useCallback(async (nextQuery: IssueListQuery) => {
    const generation = ++listRequestGenerationRef.current;
    listAbortRef.current?.abort();
    const controller = new AbortController();
    listAbortRef.current = controller;
    setLoading(true);
    setListError(null);
    try {
      const response = await listIssues(pagePath, nextQuery, controller.signal);
      if (listRequestGenerationRef.current !== generation) return;
      setIssues(response.data);
      setPinnedIssues(response.pinned);
      setMeta(response.meta);
    } catch (requestError) {
      if (listRequestGenerationRef.current !== generation) return;
      if (requestError instanceof DOMException && requestError.name === "AbortError") return;
      setListError(requestError instanceof Error ? requestError.message : "Issue 服务暂不可用");
    } finally {
      if (listRequestGenerationRef.current === generation) setLoading(false);
    }
  }, [pagePath]);

  useEffect(() => {
    if (typeof EventSource === "undefined") return;
    const params = new URLSearchParams({ pagePath });
    let events: EventSource | null = null;
    let windowActive = true;
    const handleIssueChanged = (event: MessageEvent) => {
      try {
        const parsed = JSON.parse(event.data) as { data?: { pagePath?: unknown; issueId?: unknown } };
        if (parsed.data?.pagePath !== pagePath) return;
        const changedIssueId = typeof parsed.data.issueId === "number" ? parsed.data.issueId : null;
        pendingIssueChangedIdsRef.current.add(changedIssueId);
        if (issueEventRefreshTimerRef.current !== null) window.clearTimeout(issueEventRefreshTimerRef.current);
        issueEventRefreshTimerRef.current = window.setTimeout(() => {
          issueEventRefreshTimerRef.current = null;
          const changedIssueIds = new Set(pendingIssueChangedIdsRef.current);
          pendingIssueChangedIdsRef.current.clear();
          void fetchIssues(queryRef.current);
          const current = viewRef.current;
          if (current.kind === "edit") {
            if (changedIssueIds.has(null) || changedIssueIds.has(current.detail.issue.id)) setRemoteUpdateAvailable(true);
            return;
          }
          if (current.kind !== "detail" || (!changedIssueIds.has(null) && !changedIssueIds.has(current.detail.issue.id))) return;
          const issueId = current.detail.issue.id;
          void getIssueDetail(pagePath, issueId).then((nextDetail) => {
            const changed = nextDetail.issue.updated_at !== current.detail.issue.updated_at || nextDetail.timeline.length !== current.detail.timeline.length;
            setView((latest) => latest.kind === "detail" && latest.detail.issue.id === issueId ? { kind: "detail", detail: nextDetail } : latest);
            if (changed) setDetailUpdateNotice(true);
            setRemoteUpdateAvailable(false);
          }).then(() => setDetailSyncFailed(false)).catch(() => {
            setDetailSyncFailed(true);
            setError("无法同步最新 Issue，当前内容可能已过期");
          });
        }, 120);
      } catch {
        // Ignore malformed invalidations; the next valid event will refresh state.
      }
    };
    const disconnect = () => {
      events?.close();
      events = null;
    };
    const connect = (refresh: boolean) => {
      if (document.visibilityState === "hidden" || !windowActive || events) return;
      events = new EventSource(`/api/issues/events?${params.toString()}`);
      events.addEventListener("issue:changed", handleIssueChanged);
      if (!refresh) return;
      void fetchIssues(queryRef.current);
      const current = viewRef.current;
      if (current.kind === "detail") {
        const issueId = current.detail.issue.id;
        void getIssueDetail(pagePath, issueId).then((nextDetail) => {
          setView((latest) => latest.kind === "detail" && latest.detail.issue.id === issueId ? { kind: "detail", detail: nextDetail } : latest);
          setDetailSyncFailed(false);
        }).catch(() => setDetailSyncFailed(true));
      }
    };
    const handleVisibilityChange = () => document.visibilityState === "hidden" ? disconnect() : connect(true);
    const handleWindowBlur = () => { windowActive = false; disconnect(); };
    const handleWindowFocus = () => { windowActive = true; connect(true); };
    connect(false);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("blur", handleWindowBlur);
    window.addEventListener("focus", handleWindowFocus);
    window.addEventListener("pagehide", handleWindowBlur);
    window.addEventListener("pageshow", handleWindowFocus);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("blur", handleWindowBlur);
      window.removeEventListener("focus", handleWindowFocus);
      window.removeEventListener("pagehide", handleWindowBlur);
      window.removeEventListener("pageshow", handleWindowFocus);
      disconnect();
      if (issueEventRefreshTimerRef.current !== null) window.clearTimeout(issueEventRefreshTimerRef.current);
      pendingIssueChangedIdsRef.current.clear();
    };
  }, [fetchIssues, pagePath]);

  useEffect(() => {
    void fetchIssues(query);
    return () => listAbortRef.current?.abort();
  }, [fetchIssues, query]);

  useEffect(() => {
    if (!user) {
      setUserCatalogError(false);
      setUserCatalogLoading(false);
      return;
    }
    const controller = new AbortController();
    let active = true;
    setUserCatalogError(false);
    setUserCatalogLoading(true);
    void requestIssueCatalogWithRetry(() => listIssueUsers(controller.signal), controller.signal).then((users) => {
      if (active) {
        setPlatformIdentities(users);
        setUserCatalogError(false);
      }
    }).catch((requestError) => {
      if (!(requestError instanceof Error && requestError.name === "AbortError")) {
        if (active) setUserCatalogError(true);
      }
    }).finally(() => { if (active) setUserCatalogLoading(false); });
    return () => {
      active = false;
      controller.abort();
    };
  }, [user?.id, userCatalogRevision]);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setLabelCatalogError(false);
    setLabelCatalogLoading(true);
    void requestIssueCatalogWithRetry(() => listIssueLabels(pagePath, controller.signal), controller.signal).then((labels) => {
      if (active) {
        setIssueLabels(labels);
        setLabelCatalogError(false);
      }
    }).catch((requestError) => {
      if (active && !(requestError instanceof Error && requestError.name === "AbortError")) setLabelCatalogError(true);
    }).finally(() => { if (active) setLabelCatalogLoading(false); });
    return () => { active = false; controller.abort(new DOMException("Superseded", "AbortError")); };
  }, [labelCatalogRevision, pagePath]);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setMilestoneCatalogError(false);
    setMilestoneCatalogLoading(true);
    void requestIssueCatalogWithRetry(() => listIssueMilestones(pagePath, controller.signal), controller.signal).then((items) => { if (active) { setIssueMilestones(items); setIssueMilestonesLoaded(true); setMilestoneCatalogError(false); } }).catch((requestError) => { if (active && !(requestError instanceof Error && requestError.name === "AbortError")) setMilestoneCatalogError(true); }).finally(() => { if (active) setMilestoneCatalogLoading(false); });
    return () => { active = false; controller.abort(new DOMException("Superseded", "AbortError")); };
  }, [milestoneCatalogRevision, pagePath]);

  useEffect(() => {
    if (searchInput.trim() === formatIssueSearchInput(query.q, query.searchIn)) return;
    const suggestionUsers = [
      ...(user ? [{ id: user.id, name: user.name, displayName: user.name }] : []),
      ...platformIdentities,
    ];
    if (getIssueSearchSuggestions(searchInput, searchInput.length, { currentUserId: user?.id, labels: issueLabels, users: suggestionUsers }).items.length > 0) return;
    const timer = window.setTimeout(() => {
      applyListQuery(parseIssueSearchInput(searchInput, { currentUserId: user?.id, labels: issueLabels, milestones: issueMilestones }), "replace");
    }, 250);
    return () => window.clearTimeout(timer);
  }, [applyListQuery, issueLabels, issueMilestones, platformIdentities, query.q, query.searchIn, searchInput, user]);
  useEffect(() => {
    if (view.kind !== "list" || loading || pendingIssueFocusIdRef.current === null) return;
    const issueId = pendingIssueFocusIdRef.current;
    const frame = window.requestAnimationFrame(() => {
      const link = document.querySelector<HTMLElement>(`[data-testid="issue-row-${issueId}"] a`);
      (link ?? searchInputRef.current)?.focus();
      pendingIssueFocusIdRef.current = null;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [issues, loading, view.kind]);
  useEffect(() => {
    dialogRef.current?.focus();
    const focusCommentComposer = () => {
      const textarea = dialogRef.current?.querySelector<HTMLTextAreaElement>('[data-localapp-issue-comment-composer] textarea');
      textarea?.scrollIntoView?.({ block: "center", behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
      window.requestAnimationFrame(() => textarea?.focus());
    };
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      const nestedDialog = target instanceof Element && target.closest('[role="dialog"]') !== dialogRef.current;
      if (nestedDialog) return;
      if (event.key === "Escape") {
        event.preventDefault();
        closeModal();
        return;
      }
      const editable = target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
      if (event.key === "/" && (event.metaKey || event.ctrlKey) && view.kind === "list" && !editable) {
        event.preventDefault();
        searchInputRef.current?.focus();
        return;
      }
      if (event.key === "/" && view.kind === "list" && !editable) {
        event.preventDefault();
        searchInputRef.current?.focus();
        return;
      }
      if (event.key.toLowerCase() === "c" && view.kind === "list" && user && !editable && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        beginCreateIssue();
        return;
      }
      if (event.key.toLowerCase() === "r" && view.kind === "detail" && user && dialogRef.current?.querySelector("[data-localapp-issue-comment-composer]") && !editable && !nestedDialog && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        focusCommentComposer();
        return;
      }
      const issueFilterShortcutLabels: Record<string, string> = { u: "按创建者筛选", l: "按标签筛选", m: "按里程碑筛选", a: "按负责人筛选" };
      const issueFilterLabel = issueFilterShortcutLabels[event.key.toLowerCase()];
      if (issueFilterLabel && view.kind === "list" && !editable && !nestedDialog && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey && dialogRef.current) {
        const filter = dialogRef.current.querySelector<HTMLSelectElement>(`select[aria-label="${issueFilterLabel}"]`);
        if (filter) {
          event.preventDefault();
          const container = filter.closest<HTMLElement>("#localapp-issue-advanced-filters");
          if (container?.classList.contains("hidden")) dialogRef.current.querySelector<HTMLButtonElement>('[aria-controls="localapp-issue-advanced-filters"]')?.click();
          window.requestAnimationFrame(() => filter.focus());
          return;
        }
      }
      if (event.key.toLowerCase() === "o" && view.kind === "list" && !editable && !nestedDialog && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey && document.activeElement instanceof HTMLAnchorElement && document.activeElement.matches("[data-localapp-issue-link]")) {
        event.preventDefault();
        document.activeElement.click();
        return;
      }
      const issueNavigationKey = event.key.toLowerCase();
      const issueNavigationDirection = issueNavigationKey === "j" || event.key === "ArrowDown" ? 1 : issueNavigationKey === "k" || event.key === "ArrowUp" ? -1 : 0;
      if (issueNavigationDirection !== 0 && view.kind === "list" && !editable && !nestedDialog && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey && dialogRef.current) {
        const links = Array.from(dialogRef.current.querySelectorAll<HTMLAnchorElement>("[data-localapp-issue-link]"));
        const currentIndex = links.indexOf(document.activeElement as HTMLAnchorElement);
        const usesStandardArrow = event.key === "ArrowDown" || event.key === "ArrowUp";
        if (links.length > 0 && (!usesStandardArrow || links.includes(document.activeElement as HTMLAnchorElement))) {
          event.preventDefault();
          const nextIndex = currentIndex < 0
            ? issueNavigationDirection > 0 ? 0 : links.length - 1
            : (currentIndex + issueNavigationDirection + links.length) % links.length;
          links[nextIndex]?.focus();
          return;
        }
      }
      if (event.key === "ArrowLeft" && event.altKey && !event.metaKey && !event.ctrlKey && !event.shiftKey && view.kind !== "list" && !editable && !nestedDialog) {
        event.preventDefault();
        showList();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(
        "button:not([disabled]), select:not([disabled]), input:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex='-1'])",
      )).filter((element) => isIssueFocusTargetVisible(element, dialogRef.current!));
      if (!focusable.length) {
        event.preventDefault();
        dialogRef.current.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialogRef.current)) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      restoreFocus();
    };
  }, [beginCreateIssue, closeModal, restoreFocus, user, view.kind]);

  const loadDetail = useCallback(async (issueId: number, issue?: Issue, lookupByNumber = false) => {
    const generation = ++detailRequestGenerationRef.current;
    setError(null);
    setDetailSyncFailed(false);
    setDetailUpdateNotice(false);
    setDetailRetryIssue(null);
    setView({ kind: "detail-loading", issueId, lookupByNumber });
    try {
      const detail = await (lookupByNumber ? getIssueDetailByNumber(pagePath, issueId) : getIssueDetail(pagePath, issueId));
      if (detailRequestGenerationRef.current !== generation) return;
      if (lookupByNumber) {
        onIssueNavigateRef.current?.(detail.issue.id, "replace");
        const commentId = pendingReferenceCommentIdRef.current;
        pendingReferenceCommentIdRef.current = null;
        if (commentId !== null) {
          const url = updateIssueCommentDeepLinkUrl(new URL(window.location.href), detail.issue.id, commentId);
          window.history.replaceState(window.history.state, "", url);
        }
      }
      setDetailRetryIssue(null);
      setCommentDraftId(newDraftId());
      setView({ kind: "detail", detail });
    } catch (requestError) {
      if (detailRequestGenerationRef.current !== generation) return;
      setDetailRetryIssue(issue ?? null);
      setError(requestError instanceof Error ? requestError.message : "Issue 服务暂不可用");
    }
  }, [pagePath]);

  useEffect(() => {
    if (selectedIssueId === undefined) return;
    if (selectedIssueId === null) {
      if (selectedIssueNumber !== undefined && selectedIssueNumber !== null) return;
      ++detailRequestGenerationRef.current;
      setView((current) => current.kind === "detail" || current.kind === "detail-loading" || current.kind === "edit" ? { kind: "list" } : current);
      return;
    }
    const currentIssueId = view.kind === "detail" || view.kind === "edit" ? view.detail.issue.id : view.kind === "detail-loading" && !view.lookupByNumber ? view.issueId : null;
    if (currentIssueId !== selectedIssueId) void loadDetail(selectedIssueId);
  }, [loadDetail, selectedIssueId, selectedIssueNumber, view]);

  useEffect(() => {
    if (selectedIssueNumber === undefined || selectedIssueNumber === null) return;
    const currentIssueNumber = view.kind === "detail" || view.kind === "edit" ? view.detail.issue.issue_number : view.kind === "detail-loading" && view.lookupByNumber ? view.issueId : null;
    if (currentIssueNumber !== selectedIssueNumber) void loadDetail(selectedIssueNumber, undefined, true);
  }, [loadDetail, selectedIssueNumber, view]);

  const openDetail = (issue: Issue) => {
    pendingIssueFocusIdRef.current = issue.id;
    onIssueNavigate?.(issue.id);
    void loadDetail(issue.id, issue);
  };
  const openIssueReference = (issueNumber: number, commentId: number | null = null) => {
    pendingReferenceCommentIdRef.current = commentId;
    void loadDetail(issueNumber, undefined, true);
  };

  const issueUrl = (issueId: number) => updateIssueDeepLinkUrl(new URL(window.location.href), issueId);
  const issueHref = (issueId: number) => {
    const url = issueUrl(issueId);
    return `${url.pathname}${url.search}${url.hash}`;
  };
  const issueNumberHref = (issueNumber: number) => {
    const url = updateIssueNumberDeepLinkUrl(new URL(window.location.href), issueNumber);
    return `${url.pathname}${url.search}${url.hash}`;
  };
  const commentUrl = (issueId: number, commentId: number) => updateIssueCommentDeepLinkUrl(new URL(window.location.href), issueId, commentId);
  const commentHref = (issueId: number, commentId: number) => {
    const url = commentUrl(issueId, commentId);
    return `${url.pathname}${url.search}${url.hash}`;
  };

  const showReferenceCommentIssue = (detail: IssueDetail, commentId: number, body: string, authorId: string, trigger: HTMLButtonElement | null) => {
    if (!user || !draftPrefix) return;
    const key = `${draftPrefix}:reference-comment:${detail.issue.id}:${commentId}`;
    const restored = readCreateDraft(key);
    const hasDraft = hasPersistedCreateContent(key);
    const initialBody = hasDraft ? "" : referenceIssueComment(body, authorId, detail.issue.issue_number, commentHref(detail.issue.id, commentId));
    setError(null);
    setIssueTemplateNotice(null);
    setCreateWasRestoredDraft(hasDraft);
    setCreateTitle(hasDraft ? restored.title : "");
    setCreateInitialBody(initialBody);
    setCreateBody(initialBody);
    setCreateType(hasDraft ? restored.issueType : "task");
    setCreateLabelIds(hasDraft ? restored.labelIds : []);
    setCreateAssigneeIds(hasDraft ? restored.assigneeIds : []);
    setCreateMilestoneId(hasDraft ? restored.milestoneId : null);
    setCreateDraftId(newDraftId());
    setView({ kind: "create", reference: { detail, commentId, trigger } });
  };

  const copyIssueLink = async (issueId: number) => {
    setError(null);
    try {
      await copyIssueUrl(issueUrl(issueId).href);
      setLinkCopied(true);
    } catch {
      setLinkCopied(false);
      setError("无法复制 Issue 链接，请从浏览器地址栏复制");
    }
  };

  const refreshDetail = async (issueId: number) => {
    const detail = await getIssueDetail(pagePath, issueId);
    setView({ kind: "detail", detail });
    setDetailSyncFailed(false);
  };

  const retryDetailSync = async () => {
    const current = viewRef.current;
    if (detailSyncing || current.kind !== "detail") return;
    setDetailSyncing(true);
    try {
      await refreshDetail(current.detail.issue.id);
      setError(null);
    } catch {
      setDetailSyncFailed(true);
      setError("无法同步最新 Issue，当前内容可能已过期");
    } finally {
      setDetailSyncing(false);
    }
  };

  const loadRemoteUpdate = async () => {
    const current = viewRef.current;
    if (remoteUpdateLoading || current.kind !== "edit") return;
    setRemoteUpdateLoading(true);
    try {
      const nextDetail = await getIssueDetail(pagePath, current.detail.issue.id);
      if (draftPrefix) {
        writeIssueEditDraft(`${draftPrefix}:edit:${current.detail.issue.id}:meta`, null);
        try { window.sessionStorage.removeItem(`${draftPrefix}:edit:${current.detail.issue.id}:body`); } catch { /* Ignore unavailable storage. */ }
      }
      setView({ kind: "detail", detail: nextDetail });
      setRemoteUpdateAvailable(false);
    } catch {
      setError("无法加载最新 Issue");
    } finally {
      setRemoteUpdateLoading(false);
    }
  };

  const showList = (nextStatus?: IssueStatus) => {
    const current = viewRef.current;
    if (current.kind === "create") pendingCreateIssueFocusRef.current = true;
    if ((current.kind === "detail" || current.kind === "edit") && pendingIssueFocusIdRef.current === null) pendingIssueFocusIdRef.current = current.detail.issue.id;
    ++detailRequestGenerationRef.current;
    if (nextStatus) {
      applyListQuery({ status: nextStatus });
    }
    setView({ kind: "list" });
    setDetailUpdateNotice(false);
    onIssueNavigate?.(null);
  };

  useEffect(() => {
    if (view.kind !== "list" || !pendingCreateIssueFocusRef.current) return;
    pendingCreateIssueFocusRef.current = false;
    const frame = window.requestAnimationFrame(() => createIssueTriggerRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [view.kind]);
  useEffect(() => {
    if (view.kind !== "list" || loading || listError || !pendingListRetryFocusRef.current) return;
    pendingListRetryFocusRef.current = false;
    const frame = window.requestAnimationFrame(() => searchInputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [listError, loading, view.kind]);
  const retryIssueList = () => {
    pendingListRetryFocusRef.current = true;
    void fetchIssues(query);
  };
  const catalogRetrying = labelCatalogLoading || userCatalogLoading || milestoneCatalogLoading;
  const focusAfterCatalogRetry = () => {
    const current = viewRef.current;
    const selector = current.kind === "list" ? null : current.kind === "create" ? "#issue-title" : current.kind === "edit" ? "#issue-edit-title" : "[data-localapp-issue-title]";
    window.requestAnimationFrame(() => (selector ? document.querySelector<HTMLElement>(selector) : searchInputRef.current)?.focus());
  };
  useEffect(() => {
    if (!pendingCatalogRetryFocusRef.current || catalogRetrying || labelCatalogError || userCatalogError || milestoneCatalogError) return;
    pendingCatalogRetryFocusRef.current = false;
    focusAfterCatalogRetry();
  }, [catalogRetrying, labelCatalogError, milestoneCatalogError, userCatalogError]);
  const retryCatalogs = () => {
    pendingCatalogRetryFocusRef.current = true;
    if (labelCatalogError) setLabelCatalogRevision((revision) => revision + 1);
    if (userCatalogError) setUserCatalogRevision((revision) => revision + 1);
    if (milestoneCatalogError) setMilestoneCatalogRevision((revision) => revision + 1);
  };

  const submitSearch = () => {
    const updates = parseIssueSearchInput(searchInput, { currentUserId: user?.id, labels: issueLabels, milestones: issueMilestones });
    setSearchInput(formatIssueSearchInput(updates.q, updates.searchIn ?? ""));
    applyListQuery(updates);
  };

  const resetListQuery = () => {
    setSearchInput("");
    applyListQuery({ q: "", searchIn: "", label: "", author: "", participant: "", assignee: "", milestone: "", subscribed: false, mentioned: false, locked: "", offset: 0 });
  };

  const activeSavedView = savedViews.find((saved) => saved.id === activeSavedViewId) ?? null;
  const savedViewDirty = Boolean(activeSavedView && !issueSavedViewMatchesListQuery(activeSavedView.query, query));
  const applySavedView = (saved: IssueSavedView) => {
    const restored = issueListQueryFromSavedView(saved.query);
    setActiveSavedViewId(saved.id);
    setSearchInput(formatIssueSearchInput(restored.q, restored.searchIn));
    applyListQuery(restored);
  };
  const createSavedView = async (name: string, description: string) => {
    setSavedViewsSaving(true);
    setSavedViewsError(null);
    try {
      const created = await createIssueSavedView(pagePath, name, description, query);
      setSavedViews((current) => [...current, created]);
      setActiveSavedViewId(created.id);
    } finally { setSavedViewsSaving(false); }
  };
  const updateSavedView = async (id: number, input: { name?: string; description?: string; query?: IssueListQuery }) => {
    setSavedViewsSaving(true);
    setSavedViewsError(null);
    try {
      const updated = await updateIssueSavedView(pagePath, id, input);
      setSavedViews((current) => current.map((saved) => saved.id === id ? updated : saved));
    } finally { setSavedViewsSaving(false); }
  };
  const copySavedView = async (id: number) => {
    setSavedViewsSaving(true);
    setSavedViewsError(null);
    try { const copied = await duplicateIssueSavedView(pagePath, id); setSavedViews((current) => [...current, copied]); }
    finally { setSavedViewsSaving(false); }
  };
  const removeSavedView = async (id: number) => {
    setSavedViewsSaving(true);
    setSavedViewsError(null);
    try {
      await deleteIssueSavedView(pagePath, id);
      setSavedViews((current) => current.filter((saved) => saved.id !== id));
      if (activeSavedViewId === id) setActiveSavedViewId(null);
    } finally { setSavedViewsSaving(false); }
  };

  const submitCreate = async ({ body, attachmentIds, draftId }: ComposerSubmit) => {
    if (!createTitle.trim()) return;
    setError(null);
    try {
      const created = await createIssue({ pagePath, title: createTitle.trim(), description: body, issueType: createType, draftId, attachmentIds, ...(user?.id === ownerId ? { labelIds: createLabelIds, assigneeIds: createAssigneeIds, ...(createMilestoneId === null ? {} : { milestoneId: createMilestoneId }), ...(view.kind === "create" && view.parentIssueId !== undefined ? { parentIssueId: view.parentIssueId } : {}) } : {}) });
      setCreateTitle("");
      setCreateInitialBody("");
      setCreateBody("");
      setCreateWasRestoredDraft(false);
      setCreateType("task");
      setCreateLabelIds([]);
      setCreateAssigneeIds([]);
      setCreateMilestoneId(null);
      if (draftPrefix) writeCreateDraft(createPersistenceKey ?? `${draftPrefix}:create`, "", "task", [], [], null);
      setCreateDraftId(newDraftId());
      setSearchInput("");
      applyListQuery({ ...DEFAULT_ISSUE_LIST_QUERY }, "replace");
      onIssuesChanged?.();
      onIssueNavigate?.(created.id);
      await loadDetail(created.id, created);
    } catch (requestError) {
      throw requestError;
    }
  };

  const cancelCreate = () => {
    if (view.kind === "create" && view.reference) {
      const { detail, commentId, trigger } = view.reference;
      setView({ kind: "detail", detail });
      const url = commentUrl(detail.issue.id, commentId);
      window.history.replaceState(null, "", url);
      window.requestAnimationFrame(() => window.requestAnimationFrame(() => trigger?.isConnected ? trigger.focus() : document.querySelector<HTMLButtonElement>(`[data-testid="issue-comment-${commentId}"] button[aria-label="评论操作"]`)?.focus()));
      return;
    }
    if (view.kind === "create" && view.returnToTemplates) setView({ kind: "templates" });
    else showList();
  };

  const updateSelectedIssue = async (detail: IssueDetail, updates: Parameters<typeof updateIssue>[2], refreshCount = false, errorSurface: "workspace" | "composer" = updates.draftId ? "composer" : "workspace") => {
    setError(null);
    try {
      const contentEdit = updates.title !== undefined || updates.description !== undefined;
      await updateIssue(pagePath, detail.issue.id, {
        ...updates,
        ...(contentEdit && updates.expectedUpdatedAt === undefined ? { expectedUpdatedAt: detail.issue.updated_at } : {}),
      });
      await Promise.all([refreshDetail(detail.issue.id), fetchIssues(query)]);
      if (refreshCount) onIssuesChanged?.();
    } catch (requestError) {
      if (requestError instanceof IssueContentConflictError) setRemoteUpdateAvailable(true);
      if (errorSurface === "workspace") setError(requestError instanceof Error ? requestError.message : "Issue 服务暂不可用");
      throw requestError;
    }
  };

  const submitComment = async (detail: IssueDetail, input: ComposerSubmit) => {
    setError(null);
    try {
      const updatedDetail = await createIssueComment(pagePath, detail.issue.id, input);
      const previousCommentIds = new Set(detail.timeline.flatMap((item) => item.kind === "comment" ? [item.comment.id] : []));
      const createdComment = updatedDetail.timeline.find((item) => item.kind === "comment" && !previousCommentIds.has(item.comment.id));
      if (createdComment?.kind === "comment") {
        const url = updateIssueCommentDeepLinkUrl(new URL(window.location.href), detail.issue.id, createdComment.comment.id);
        window.history.replaceState(window.history.state, "", url);
      }
      setCommentDraftId(newDraftId());
      setView({ kind: "detail", detail: updatedDetail });
      await fetchIssues(query);
      if (input.statusAction) onIssuesChanged?.();
    } catch (requestError) {
      throw requestError;
    }
  };

  const detail = view.kind === "detail" || view.kind === "edit" ? view.detail : null;
  const createTitleCharacterCount = issueTitleCharacterCount(createTitle);
  const createTitleTooLong = createTitleCharacterCount > ISSUE_TITLE_MAX_CHARACTERS;
  const editTitleCharacterCount = detail ? issueTitleCharacterCount(detail.issue.title) : 0;
  const editTitleTooLong = editTitleCharacterCount > ISSUE_TITLE_MAX_CHARACTERS;
  const focusCommentComposer = () => {
    const textarea = dialogRef.current?.querySelector<HTMLTextAreaElement>('[data-localapp-issue-comment-composer] textarea');
    textarea?.scrollIntoView?.({ block: "center", behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    window.requestAnimationFrame(() => textarea?.focus());
  };
  useEffect(() => {
    if (revisionTarget) return;
    if (view.kind === "list" || view.kind === "create" || view.kind === "detail-loading") { focusedDetailIdRef.current = null; return; }
    if (view.kind !== "detail" || !detail || focusedDetailIdRef.current === detail.issue.id) return;
    focusedDetailIdRef.current = detail.issue.id;
    if (selectedCommentId) return;
    const frame = window.requestAnimationFrame(() => document.querySelector<HTMLElement>("[data-localapp-issue-title]")?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [detail?.issue.id, revisionTarget, selectedCommentId, view.kind]);
  useEffect(() => {
    if (view.kind !== "detail" || pendingTaskReferenceFocusRef.current === null) return;
    const issueNumber = pendingTaskReferenceFocusRef.current;
    let attempts = 0;
    let timer = 0;
    const focusReference = () => {
      if (dialogRef.current?.querySelector('[role="alertdialog"]')) { if (attempts++ < 20) timer = window.setTimeout(focusReference, 30); return; }
      const reference = dialogRef.current?.querySelector<HTMLElement>(`[data-localapp-issue-reference="${issueNumber}"]`);
      reference?.focus();
      if (reference && document.activeElement === reference) { pendingTaskReferenceFocusRef.current = null; return; }
      if (attempts++ < 10) timer = window.setTimeout(focusReference, 30);
    };
    timer = window.setTimeout(focusReference, 0);
    return () => window.clearTimeout(timer);
  }, [detail?.issue.description, view.kind]);
  useEffect(() => {
    if (statusSaving || !statusActionFocusPendingRef.current) return;
    statusActionFocusPendingRef.current = false;
    const frame = window.requestAnimationFrame(() => statusActionRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [detail?.issue.status, statusSaving]);
  const canEditIssue = Boolean(detail && user && (user.id === detail.issue.reporter_id || user.id === ownerId));
  const canDeleteIssue = Boolean(detail && user?.id === ownerId);
  const issueEditMetaKey = detail && draftPrefix ? `${draftPrefix}:edit:${detail.issue.id}:meta` : null;
  const issueEditBodyKey = detail && draftPrefix ? `${draftPrefix}:edit:${detail.issue.id}:body` : undefined;
  const beginIssueEdit = (current: IssueDetail) => {
    const stored = draftPrefix ? readIssueEditDraft(`${draftPrefix}:edit:${current.issue.id}:meta`) : null;
    const expectedUpdatedAt = stored?.expectedUpdatedAt ?? current.issue.updated_at;
    if (draftPrefix && !stored) writeIssueEditDraft(`${draftPrefix}:edit:${current.issue.id}:meta`, { title: current.issue.title, issueType: current.issue.issue_type ?? current.issue.label, expectedUpdatedAt });
    setRemoteUpdateAvailable(Boolean(stored && stored.expectedUpdatedAt !== current.issue.updated_at));
    setView({
      kind: "edit",
      originalDetail: current,
      expectedUpdatedAt,
      restoredDraft: Boolean(stored),
      draftId: newDraftId(),
      removedAttachmentIds: [],
      detail: stored ? { ...current, issue: { ...current.issue, title: stored.title, issue_type: stored.issueType, label: stored.issueType } } : current,
    });
  };
  const discardIssueEdit = (current: Extract<IssuesView, { kind: "edit" }>) => {
    if (issueEditMetaKey) writeIssueEditDraft(issueEditMetaKey, null);
    if (issueEditBodyKey) try { window.sessionStorage.removeItem(issueEditBodyKey); } catch { /* Ignore unavailable storage. */ }
    discardIssueAttachmentDraft(pagePath, issueEditBodyKey);
    setRemoteUpdateAvailable(false);
    setView({ kind: "detail", detail: current.originalDetail });
  };
  const canEditLabel = Boolean(user && user.id === ownerId);
  const canManageStatus = canEditIssue;
  const visibleIssueEditAttachments = view.kind === "edit" ? view.detail.attachments.filter((attachment) => attachment.issue_id === view.detail.issue.id && attachment.comment_id === null && !view.removedAttachmentIds.includes(attachment.id)) : [];
  const issueAttachmentRemoveRequest = view.kind === "edit" && view.removedAttachmentIds.length > 0 ? (() => { const id = view.removedAttachmentIds.at(-1)!; const attachment = view.originalDetail.attachments.find((candidate) => candidate.id === id); return attachment ? { id, url: attachment.url } : null; })() : null;
  const identities: IssueUserIdentity[] = Array.from(new Map([
    ...(user ? [{ id: user.id, name: user.name, displayName: user.name, avatarUrl: null }] : []),
    ...platformIdentities,
  ].map((identity) => [identity.id, identity])).values());
  const createAdditionalLabels = issueLabels;
  const createAssignees = identities.filter((identity) => identity.id);

  const updateMetadata = async (operation: () => Promise<IssueDetail>) => {
    setMetadataSaving(true);
    setError(null);
    try {
      const updated = await operation();
      setView({ kind: "detail", detail: updated });
      await fetchIssues(query);
    } catch (requestError) {
      throw requestError;
    } finally {
      setMetadataSaving(false);
    }
  };

  const toggleStatus = async (selected: IssueDetail, stateReason: "completed" | "not_planned" = "completed") => {
    statusActionFocusPendingRef.current = true;
    setStatusSaving(true);
    try {
      await updateSelectedIssue(selected, selected.issue.status === "open" ? { status: "closed", stateReason } : { status: "open", stateReason: null }, true);
    } catch {
      // updateSelectedIssue owns the user-facing error state.
    } finally {
      setStatusSaving(false);
    }
  };

  const detailHeaderTitle = detail ? `Issue #${detail.issue.issue_number} · ${detail.issue.title}` : null;
  const workspaceTitle = view.kind === "templates" ? "新建 Issue" : view.kind === "create" ? view.parentIssueId === undefined ? "新建 Issue" : "新建 Sub-issue" : view.kind === "labels" ? "标签" : view.kind === "milestones" ? "里程碑" : view.kind === "detail-loading" ? `Issue #${view.issueId}` : detailHeaderTitle ?? "Issues";

  return (
    <div data-localapp-issues-layer className="absolute inset-0 z-50 flex items-center justify-center p-0 sm:p-2">
      <div className="pointer-events-none absolute inset-0 bg-black/45" aria-hidden="true" />
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="issues-dialog-title" tabIndex={-1} data-localapp-issues-workspace className="relative flex h-full w-full flex-col overflow-hidden bg-card shadow-2xl outline-none sm:rounded-lg sm:border">
        <header className="flex min-h-14 items-center gap-3 border-b px-4 py-3 sm:px-5">
          {view.kind !== "list" && <Button type="button" variant="ghost" size="icon" className="h-11 w-11 shrink-0 sm:h-8 sm:w-8" aria-label={view.kind === "create" && view.parentIssueId !== undefined ? "返回父 Issue" : view.kind === "create" && view.returnToTemplates ? "返回模板选择" : "返回 Issue 列表"} aria-keyshortcuts="Alt+ArrowLeft" onClick={() => { if (view.kind === "create" && view.parentIssueId !== undefined) { onIssueNavigate?.(view.parentIssueId); void loadDetail(view.parentIssueId); } else if (view.kind === "create" && view.returnToTemplates) setView({ kind: "templates" }); else showList(); }}><ArrowLeft className="h-4 w-4" /></Button>}
          <div className="min-w-0 flex-1"><h2 id="issues-dialog-title" title={detailHeaderTitle ?? undefined} className="min-w-0 truncate text-sm font-semibold">{workspaceTitle}</h2><p className="truncate text-xs text-muted-foreground">{pageName}</p></div>
          {view.kind === "list" && user?.id === ownerId && <Button type="button" variant="outline" size="sm" className="h-11 shrink-0 gap-1.5 sm:h-8" aria-label="管理 Issue 里程碑" onClick={() => { setMilestoneManagerError(null); setView({ kind: "milestones" }); void listIssueMilestones(pagePath).then(setIssueMilestones).catch((requestError) => setMilestoneManagerError(requestError instanceof Error ? requestError.message : "里程碑加载失败")); }}><CalendarDays className="h-4 w-4" /><span className="hidden md:inline">里程碑</span></Button>}
          {view.kind === "list" && user?.id === ownerId && <Button type="button" variant="outline" size="sm" className="h-11 shrink-0 gap-1.5 sm:h-8" aria-label="管理 Issue 标签" onClick={() => { setLabelManagerError(null); setView({ kind: "labels" }); }}><Tag className="h-4 w-4" /><span className="hidden sm:inline">标签</span></Button>}
          {view.kind === "list" && user && <Button ref={createIssueTriggerRef} type="button" size="sm" className="h-11 shrink-0 gap-1.5 sm:h-8" aria-label="新建 Issue" aria-keyshortcuts="C" onClick={beginCreateIssue}><Plus className="h-4 w-4" /><span className="hidden sm:inline">新建 Issue</span></Button>}
          <Button type="button" variant="ghost" size="icon" className="h-11 w-11 shrink-0 sm:h-8 sm:w-8" aria-label="关闭 Issue 面板" aria-keyshortcuts="Escape" onClick={closeModal}><X className="h-4 w-4" /></Button>
        </header>

        {(labelCatalogError || userCatalogError || milestoneCatalogError) && !(view.kind === "list" && listError && issues.length === 0) && <div role="alert" className="flex flex-wrap items-center justify-between gap-3 border-b border-amber-500/30 bg-amber-500/10 px-5 py-2.5 text-sm"><span>{catalogFailureMessage(labelCatalogError, userCatalogError, milestoneCatalogError)}</span><Button type="button" variant="outline" size="sm" className="h-11 shrink-0 sm:h-7" disabled={catalogRetrying} aria-label={catalogRetryLabel(labelCatalogError, userCatalogError, milestoneCatalogError)} onClick={retryCatalogs}>{catalogRetrying ? "正在重试..." : "重试"}</Button></div>}
        {error && view.kind !== "list" && view.kind !== "detail-loading" && <div role="alert" className="flex flex-wrap items-center justify-between gap-3 border-b border-destructive/20 bg-destructive/10 px-5 py-2.5 text-sm text-destructive"><span>{error}</span>{detailSyncFailed && <Button type="button" variant="outline" size="sm" className="h-11 shrink-0 sm:h-7" disabled={detailSyncing} onClick={() => void retryDetailSync()}>{detailSyncing ? "正在同步..." : "重新同步"}</Button>}</div>}
        {detailUpdateNotice && view.kind === "detail" && <div role="status" aria-label="Issue 协作更新" className="flex min-h-11 items-center gap-3 border-b bg-muted/60 px-5 py-2 text-sm"><span className="min-w-0 flex-1">已同步最新协作活动</span><Button type="button" variant="ghost" size="icon" className="h-11 w-11 shrink-0 sm:h-7 sm:w-7" aria-label="关闭协作更新提示" onClick={() => setDetailUpdateNotice(false)}><X className="h-4 w-4" /></Button></div>}
        {remoteUpdateAvailable && view.kind === "edit" && <div role="status" className="flex flex-wrap items-center justify-between gap-3 border-b bg-muted px-5 py-2.5 text-sm"><span>此 Issue 有新变更，你的编辑内容尚未被覆盖。</span><Button type="button" variant="outline" size="sm" className="h-11 shrink-0 sm:h-8" disabled={remoteUpdateLoading} onClick={() => { void loadRemoteUpdate(); }}>{remoteUpdateLoading ? "正在加载..." : "放弃草稿并加载最新"}</Button></div>}

        {view.kind === "list" && <IssueListWorkspace
          currentUserId={user?.id}
          error={listError}
          issues={issues}
          pinnedIssues={pinnedIssues}
          labels={issueLabels}
          milestones={issueMilestones}
          users={identities}
          loading={loading}
          meta={meta}
          query={query}
          searchInput={searchInput}
          searchInputRef={searchInputRef}
          onOpenIssue={openDetail}
          getIssueHref={(issue) => issueHref(issue.id)}
          onQueryChange={(updates) => applyListQuery(updates)}
          onReset={resetListQuery}
          onRetry={retryIssueList}
          onSearchInputChange={setSearchInput}
          onSubmitSearch={submitSearch}
          savedViews={savedViews}
          savedViewsLoading={savedViewsLoading}
          savedViewsError={savedViewsError}
          savedViewsSaving={savedViewsSaving}
          activeSavedViewId={activeSavedViewId}
          savedViewDirty={savedViewDirty}
          onApplySavedView={applySavedView}
          onCreateSavedView={createSavedView}
          onUpdateSavedView={updateSavedView}
          onCopySavedView={copySavedView}
          onDeleteSavedView={removeSavedView}
          onRetrySavedViews={() => setSavedViewsRevision((revision) => revision + 1)}
          onLeaveSavedView={() => setActiveSavedViewId(null)}
          canBulkManage={Boolean(user && user.id === pagePath.split("/", 1)[0])}
          onBulkStatus={async (issueIds, status) => {
            const results = await Promise.allSettled(issueIds.map((issueId) => updateIssue(pagePath, issueId, { status })));
            const failedIds = issueIds.filter((_, index) => results[index].status === "rejected");
            await fetchIssues(query);
            if (results.some((result) => result.status === "fulfilled")) onIssuesChanged?.();
            return { succeeded: results.length - failedIds.length, failedIds };
          }}
          onBulkIssueType={async (issueIds, issueType) => {
            const results = await Promise.allSettled(issueIds.map((issueId) => updateIssue(pagePath, issueId, { issueType })));
            const failedIds = issueIds.filter((_, index) => results[index].status === "rejected");
            await fetchIssues(query);
            if (results.some((result) => result.status === "fulfilled")) onIssuesChanged?.();
            return { succeeded: results.length - failedIds.length, failedIds };
          }}
          onBulkLabel={async (issueIds, labelId, selected) => {
            const results = await Promise.allSettled(issueIds.map((issueId) => {
              const issue = issues.find((candidate) => candidate.id === issueId);
              const current = issue?.labels?.map((label) => label.id) ?? [];
              const labelIds = selected ? Array.from(new Set([...current, labelId])) : current.filter((id) => id !== labelId);
              return updateIssueLabels(pagePath, issueId, labelIds);
            }));
            const failedIds = issueIds.filter((_, index) => results[index].status === "rejected");
            await fetchIssues(query);
            if (results.some((result) => result.status === "fulfilled")) onIssuesChanged?.();
            return { succeeded: results.length - failedIds.length, failedIds };
          }}
          onBulkAssignee={async (issueIds, userId, selected) => {
            const results = await Promise.allSettled(issueIds.map((issueId) => {
              const current = issues.find((candidate) => candidate.id === issueId)?.assignee_ids ?? [];
              const userIds = selected ? Array.from(new Set([...current, userId])) : current.filter((id) => id !== userId);
              return updateIssueAssignees(pagePath, issueId, userIds);
            }));
            const failedIds = issueIds.filter((_, index) => results[index].status === "rejected");
            await fetchIssues(query);
            if (results.some((result) => result.status === "fulfilled")) onIssuesChanged?.();
            return { succeeded: results.length - failedIds.length, failedIds };
          }}
          onBulkMilestone={async (issueIds, milestoneId) => {
            const results = await Promise.allSettled(issueIds.map((issueId) => updateIssueMilestoneAssignment(pagePath, issueId, milestoneId)));
            const failedIds = issueIds.filter((_, index) => results[index].status === "rejected");
            await fetchIssues(query);
            if (results.some((result) => result.status === "fulfilled")) onIssuesChanged?.();
            return { succeeded: results.length - failedIds.length, failedIds };
          }}
        />}

        {view.kind === "labels" && <IssueLabelManager labels={issueLabels} saving={labelSaving} error={labelManagerError} onCreate={async (draft) => { setLabelSaving(true); setLabelManagerError(null); try { await createIssueLabel(pagePath, draft); setIssueLabels(await listIssueLabels(pagePath)); } catch (requestError) { setLabelManagerError(requestError instanceof Error ? requestError.message : "标签保存失败"); throw requestError; } finally { setLabelSaving(false); } }} onUpdate={async (id, draft) => { setLabelSaving(true); setLabelManagerError(null); try { await updateIssueLabel(pagePath, id, draft); setIssueLabels(await listIssueLabels(pagePath)); } catch (requestError) { setLabelManagerError(requestError instanceof Error ? requestError.message : "标签保存失败"); throw requestError; } finally { setLabelSaving(false); } }} onDelete={async (id) => { setLabelSaving(true); setLabelManagerError(null); try { await deleteIssueLabel(pagePath, id); setIssueLabels(await listIssueLabels(pagePath)); await fetchIssues(query); } catch (requestError) { setLabelManagerError(requestError instanceof Error ? requestError.message : "标签删除失败"); throw requestError; } finally { setLabelSaving(false); } }} />}

        {view.kind === "milestones" && <IssueMilestoneManager milestones={issueMilestones} saving={milestoneSaving} error={milestoneManagerError} onCreate={async (draft) => { setMilestoneSaving(true); setMilestoneManagerError(null); try { await createIssueMilestone(pagePath, draft); setIssueMilestones(await listIssueMilestones(pagePath)); } catch (requestError) { setMilestoneManagerError(requestError instanceof Error ? requestError.message : "里程碑保存失败"); throw requestError; } finally { setMilestoneSaving(false); } }} onUpdate={async (id, draft) => { setMilestoneSaving(true); setMilestoneManagerError(null); try { await updateIssueMilestone(pagePath, id, draft); setIssueMilestones(await listIssueMilestones(pagePath)); } catch (requestError) { setMilestoneManagerError(requestError instanceof Error ? requestError.message : "里程碑保存失败"); throw requestError; } finally { setMilestoneSaving(false); } }} onDelete={async (id) => { setMilestoneSaving(true); setMilestoneManagerError(null); try { await deleteIssueMilestone(pagePath, id); setIssueMilestones(await listIssueMilestones(pagePath)); const nextQuery = query.milestone === String(id) ? { ...query, milestone: "none", offset: 0 } : query; if (nextQuery !== query) applyListQuery({ milestone: "none" }); await fetchIssues(nextQuery); } catch (requestError) { setMilestoneManagerError(requestError instanceof Error ? requestError.message : "里程碑删除失败"); throw requestError; } finally { setMilestoneSaving(false); } }} />}

        {view.kind === "detail-loading" && (error ? <IssueDetailError message={error} onRetry={() => void loadDetail(view.issueId, detailRetryIssue ?? undefined, view.lookupByNumber)} onBack={() => showList()} /> : <IssueDetailSkeleton />)}

        {detail && (view.kind === "detail" || view.kind === "edit") && <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">
          {confirmingDeleteIssue && <div role="alertdialog" aria-label="删除 Issue 确认" aria-describedby="delete-issue-description" onKeyDown={(event) => { if (event.key === "Escape" && !deletingIssue) { event.preventDefault(); setConfirmingDeleteIssue(false); setDeleteIssueError(null); window.requestAnimationFrame(() => deleteIssueTriggerRef.current?.focus()); } else if (event.key === "Tab") { const first = deleteIssueCancelRef.current; const last = deleteIssueConfirmRef.current; if (first && last && event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); } else if (first && last && !event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); } } }} className="mb-4 rounded-md border border-destructive/30 bg-destructive/5 p-4"><p className="font-medium">确定永久删除此 Issue 吗？</p><p id="delete-issue-description" className="mt-1 text-sm text-muted-foreground">评论、编辑历史、表态和附件都将被永久删除，此操作无法撤销。</p>{deleteIssueError && <p role="alert" className="mt-3 text-sm text-destructive">{deleteIssueError}</p>}<div className="mt-4 flex flex-wrap justify-end gap-2"><Button ref={deleteIssueCancelRef} type="button" variant="ghost" size="sm" className="h-11 sm:h-8" disabled={deletingIssue} onClick={() => { setConfirmingDeleteIssue(false); setDeleteIssueError(null); window.requestAnimationFrame(() => deleteIssueTriggerRef.current?.focus()); }}>取消删除</Button><Button ref={deleteIssueConfirmRef} type="button" variant="destructive" size="sm" className="h-11 sm:h-8" disabled={deletingIssue} onClick={() => { setDeletingIssue(true); setDeleteIssueError(null); void deleteIssue(pagePath, detail.issue.id).then(async () => { setConfirmingDeleteIssue(false); showList(); await fetchIssues(query); onIssuesChanged?.(); }).catch((requestError) => setDeleteIssueError(requestError instanceof Error ? requestError.message : "Issue 服务暂不可用")).finally(() => setDeletingIssue(false)); }}>确认删除 Issue</Button></div></div>}
          {view.kind === "edit" ? <div className="space-y-4">{view.restoredDraft && <div role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/30 px-3 py-2 text-sm"><span>已恢复上次未完成的编辑</span><IssueDiscardDraftControl triggerLabel="丢弃已恢复草稿" onConfirm={() => discardIssueEdit(view)} focusAfterConfirm={() => document.querySelector<HTMLElement>("[data-localapp-issue-title]")?.focus()} /></div>}<div className="space-y-1.5"><div className="flex items-center justify-between gap-3"><Label htmlFor="issue-edit-title">Issue 标题</Label><span className={`text-xs ${editTitleTooLong ? "text-destructive" : "text-muted-foreground"}`}>{editTitleCharacterCount} / {ISSUE_TITLE_MAX_CHARACTERS}</span></div><Input id="issue-edit-title" aria-label="Issue 标题" aria-invalid={editTitleTooLong || undefined} aria-describedby={editTitleTooLong ? "issue-edit-title-error" : undefined} className="h-11 sm:h-10" value={detail.issue.title} onChange={(event) => { const title = event.target.value; if (issueEditMetaKey) writeIssueEditDraft(issueEditMetaKey, { title, issueType: detail.issue.issue_type ?? detail.issue.label, expectedUpdatedAt: view.expectedUpdatedAt }); setView({ ...view, detail: { ...detail, issue: { ...detail.issue, title } } }); }} />{editTitleTooLong && <p id="issue-edit-title-error" role="alert" className="text-sm text-destructive">Issue 标题不能超过 256 个字符</p>}</div>{canEditLabel && <fieldset className="space-y-1.5"><legend className="text-sm font-medium">类型</legend><div className="inline-flex rounded-md border bg-background p-0.5">{(["task", "bug", "feature"] as const).map((value) => <button key={value} type="button" aria-pressed={(detail.issue.issue_type ?? detail.issue.label) === value} onClick={() => { if (issueEditMetaKey) writeIssueEditDraft(issueEditMetaKey, { title: detail.issue.title, issueType: value, expectedUpdatedAt: view.expectedUpdatedAt }); setView({ ...view, detail: { ...detail, issue: { ...detail.issue, issue_type: value, label: value } } }); }} className={`h-11 rounded px-3 text-xs font-medium sm:h-8 ${(detail.issue.issue_type ?? detail.issue.label) === value ? "bg-accent text-foreground" : "text-muted-foreground"}`}>{ISSUE_TYPE_LABELS[value]}</button>)}</div></fieldset>}<IssueComposer key={`edit-${detail.issue.id}-${view.expectedUpdatedAt}`} pagePath={pagePath} draftId={view.draftId} persistenceKey={issueEditBodyKey} preferPersistedDraft initialBody={detail.issue.description} textareaLabel="Issue 描述" placeholder="更新 Issue 描述" submitLabel="保存 Issue" mentionCandidates={identities} removeTextRequest={issueAttachmentRemoveRequest} allowEmpty submitDisabled={!detail.issue.title.trim() || editTitleTooLong} onCancel={() => discardIssueEdit(view)} onSubmit={async ({ body, attachmentIds, draftId }) => { await updateSelectedIssue(detail, { title: detail.issue.title.trim(), description: body, ...(canEditLabel ? { issueType: detail.issue.issue_type ?? detail.issue.label } : {}), expectedUpdatedAt: view.expectedUpdatedAt, draftId, attachmentIds, removedAttachmentIds: view.removedAttachmentIds }); if (issueEditMetaKey) writeIssueEditDraft(issueEditMetaKey, null); }} /><AttachmentLinks pagePath={pagePath} attachments={visibleIssueEditAttachments} onRemove={(attachmentId) => setView({ ...view, removedAttachmentIds: [...view.removedAttachmentIds, attachmentId] })} /></div> : <IssueDetailWorkspace
            pagePath={pagePath}
            detail={detail}
            identities={identities}
            currentUserId={user?.id}
            availableLabels={issueLabels}
            availableMilestones={issueMilestones}
            canManageMetadata={Boolean(user && user.id === ownerId)}
            canManageLock={canManageStatus}
            canManagePin={Boolean(user && user.id === ownerId)}
            metadataSaving={metadataSaving}
            savingTaskTarget={savingTaskTarget}
            headerAction={<div className="flex shrink-0 items-center gap-1">{user && !detail.issue.locked_at && <Button type="button" variant="ghost" size="icon" className="h-11 w-11 sm:h-8 sm:w-8" aria-label="添加评论" aria-keyshortcuts="R" title="添加评论" onClick={focusCommentComposer}><MessageSquare className="h-4 w-4" /></Button>}<Button type="button" variant="ghost" size="icon" className="h-11 w-11 sm:h-8 sm:w-8" aria-label={linkCopied ? "已复制 Issue 链接" : "复制 Issue 链接"} title={linkCopied ? "已复制" : "复制 Issue 链接"} onClick={() => void copyIssueLink(detail.issue.id)}>{linkCopied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}</Button></div>}
            bodyAction={canEditIssue || canDeleteIssue || (user && !detail.issue.locked_at && detail.issue.description.trim()) ? <IssueActionMenu label="Issue 操作" items={[...(canEditIssue ? [{ label: "编辑 Issue", restoreFocus: false, onSelect: () => beginIssueEdit(detail) }] : []), ...(user && !detail.issue.locked_at && detail.issue.description.trim() ? [{ label: "引用回复", restoreFocus: false, onSelect: () => setCommentInsertRequest({ id: ++commentInsertSequenceRef.current, text: quoteIssueComment(detail.issue.description, detail.issue.reporter_id) }) }] : []), ...(canDeleteIssue ? [{ label: "删除 Issue", destructive: true, restoreFocus: false, onSelect: (trigger: HTMLButtonElement | null) => { deleteIssueTriggerRef.current = trigger; setDeleteIssueError(null); setConfirmingDeleteIssue(true); window.requestAnimationFrame(() => deleteIssueCancelRef.current?.focus()); } }] : [])]} /> : undefined}
            statusAction={canManageStatus ? detail.issue.status === "open" ? <div role="group" aria-label="关闭 Issue" className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-fit sm:items-center sm:justify-end"><label className="inline-flex h-11 min-w-0 items-center justify-center rounded-md border bg-background px-2 text-xs text-muted-foreground focus-within:ring-2 focus-within:ring-ring sm:h-8"><span className="sr-only">关闭原因</span><select aria-label="关闭原因" value={closeReason} disabled={statusSaving} onChange={(event) => setCloseReason(event.target.value as "completed" | "not_planned")} className="h-full min-w-0 bg-transparent outline-none"><option value="completed">已完成</option><option value="not_planned">不计划处理</option></select></label><Button ref={statusActionRef} type="button" variant="outline" size="sm" className="h-11 min-w-[6.5rem] shrink-0 gap-1.5 sm:h-8" disabled={statusSaving} aria-busy={statusSaving || undefined} onClick={() => void toggleStatus(detail, closeReason)}>{statusSaving && <LoaderCircle className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />}关闭 Issue</Button></div> : <Button ref={statusActionRef} type="button" variant="outline" size="sm" className="h-11 min-w-[7.5rem] gap-1.5 sm:h-8" disabled={statusSaving} aria-busy={statusSaving || undefined} aria-label="重新打开 Issue" onClick={() => void toggleStatus(detail)}>{statusSaving && <LoaderCircle className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />}重新打开 Issue</Button> : undefined}
            composer={detail.issue.locked_at ? <div role="status" className="flex items-start gap-2 rounded-md border bg-muted/30 px-4 py-3 text-sm"><span className="font-medium">对话已锁定</span><span className="text-muted-foreground">{detail.issue.locked_by ? `@${detail.issue.locked_by} 锁定了此 Issue${detail.issue.lock_reason ? `（${ISSUE_LOCK_REASON_LABELS[detail.issue.lock_reason]}）` : ""}，解锁后可继续评论。` : "解锁后可继续评论。"}</span></div> : user ? <div data-localapp-issue-comment-composer><IssueComposer key={`comment-${detail.issue.id}`} pagePath={pagePath} draftId={commentDraftId} persistenceKey={`${draftPrefix}:comment:${detail.issue.id}:body`} showRestoredDraftNotice textareaLabel="评论内容" placeholder="留下评论" submitLabel="评论" status={canManageStatus ? detail.issue.status : undefined} closeReason={closeReason} mentionCandidates={identities} savedReplies insertRequest={commentInsertRequest} onInsertRequestApplied={(requestId) => setCommentInsertRequest((current) => current?.id === requestId ? null : current)} onSubmit={async (input) => submitComment(detail, input)} /></div> : undefined}
            commentDraftPrefix={draftPrefix ? `${draftPrefix}:edit-comment` : undefined}
            onEditComment={async (commentId, body, expectedUpdatedAt, draftId, attachmentIds, removedAttachmentIds) => { try { await updateIssueComment(pagePath, detail.issue.id, commentId, body, expectedUpdatedAt, draftId, attachmentIds, removedAttachmentIds); await Promise.all([refreshDetail(detail.issue.id), fetchIssues(query)]); } catch (requestError) { if (requestError instanceof IssueContentConflictError) await refreshDetail(detail.issue.id).catch(() => undefined); throw requestError; } }}
            onDeleteComment={async (commentId) => { try { await deleteIssueComment(pagePath, detail.issue.id, commentId); await Promise.all([refreshDetail(detail.issue.id), fetchIssues(query)]); } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "Issue 服务暂不可用"); throw requestError; } }}
            canManageCommentPins={Boolean(user && user.id === ownerId)}
            onToggleCommentPin={async (commentId, pinned) => {
              try {
                await updateIssueCommentPin(pagePath, detail.issue.id, commentId, pinned);
                await Promise.all([refreshDetail(detail.issue.id), fetchIssues(query)]);
              } catch (requestError) {
                setError(requestError instanceof Error ? requestError.message : "无法更新置顶评论");
                throw requestError;
              }
            }}
            canManageCommentMinimization={Boolean(user && user.id === ownerId)}
            onToggleCommentMinimized={async (commentId, reason) => {
              try {
                await updateIssueCommentMinimized(pagePath, detail.issue.id, commentId, reason);
                await Promise.all([refreshDetail(detail.issue.id), fetchIssues(query)]);
              } catch (requestError) {
                setError(requestError instanceof Error ? requestError.message : "无法更新评论最小化状态");
                throw requestError;
              }
            }}
            onQuoteComment={(body, authorId) => setCommentInsertRequest({ id: ++commentInsertSequenceRef.current, text: quoteIssueComment(body, authorId) })} onReferenceComment={(commentId, body, authorId, trigger) => showReferenceCommentIssue(detail, commentId, body, authorId, trigger)}
            selectedCommentId={selectedCommentId}
            getCommentHref={(commentId) => commentHref(detail.issue.id, commentId)}
            getIssueHref={() => issueHref(detail.issue.id)}
            getIssueReferenceHref={issueNumberHref}
            onOpenIssueReference={openIssueReference}
            onCopyCommentLink={async (commentId) => {
              setError(null);
              try { await copyIssueUrl(commentUrl(detail.issue.id, commentId).href); }
              catch { setError("无法复制评论链接，请从浏览器地址栏复制"); throw new Error("无法复制评论链接"); }
            }}
            onViewIssueHistory={(trigger) => setRevisionTarget({ title: detail.issue.title, body: detail.issue.description, updatedAt: detail.issue.updated_at, returnFocus: trigger })}
            onViewCommentHistory={(commentId, trigger) => {
              const comment = detail.timeline.find((item) => item.kind === "comment" && item.comment.id === commentId);
              if (comment?.kind === "comment") setRevisionTarget({ commentId, body: comment.comment.body, updatedAt: comment.comment.updated_at, returnFocus: trigger });
            }}
            onToggleLabel={async (labelId, selected) => {
              const current = detail.collaboration?.labels.map((label) => label.id) ?? [];
              const next = selected ? Array.from(new Set([...current, labelId])) : current.filter((id) => id !== labelId);
              await updateMetadata(() => updateIssueLabels(pagePath, detail.issue.id, next));
            }}
            onSetIssueType={async (issueType) => updateMetadata(async () => {
              await updateIssue(pagePath, detail.issue.id, { issueType });
              return getIssueDetail(pagePath, detail.issue.id);
            })}
            onToggleAssignee={async (userId, selected) => {
              const current = detail.collaboration?.assignee_ids ?? [];
              const next = selected ? Array.from(new Set([...current, userId])) : current.filter((id) => id !== userId);
              await updateMetadata(() => updateIssueAssignees(pagePath, detail.issue.id, next));
            }}
            onSetMilestone={async (milestoneId) => updateMetadata(() => updateIssueMilestoneAssignment(pagePath, detail.issue.id, milestoneId))}
            onToggleSubscription={async (subscribed) => updateMetadata(() => updateIssueSubscription(pagePath, detail.issue.id, subscribed))}
            onToggleLock={async (locked, reason) => updateMetadata(() => updateIssueLock(pagePath, detail.issue.id, locked, reason))}
            onTogglePin={async (pinned) => {
              await updateMetadata(() => updateIssuePin(pagePath, detail.issue.id, pinned));
              await fetchIssues(query);
            }}
            canManageSubIssues={user?.id === ownerId}
            onCreateSubIssue={() => showCreateIssue(detail.issue.id)}
            onLinkSubIssue={async (issueNumber) => {
              const child = await getIssueDetailByNumber(pagePath, issueNumber);
              await updateMetadata(() => addIssueSubIssue(pagePath, detail.issue.id, child.issue.id));
            }}
            onRemoveSubIssue={async (childIssueId) => updateMetadata(() => removeIssueSubIssue(pagePath, detail.issue.id, childIssueId))} onReprioritizeSubIssue={async (childIssueId, afterIssueId) => updateMetadata(() => reprioritizeIssueSubIssue(pagePath, detail.issue.id, childIssueId, afterIssueId))}
            canManageDependencies={user?.id === ownerId}
            onAddDependency={async (direction, issueNumber) => {
              const related = await getIssueDetailByNumber(pagePath, issueNumber);
              await updateMetadata(() => direction === "blockedBy"
                ? addIssueDependency(pagePath, detail.issue.id, related.issue.id)
                : addIssueDependency(pagePath, related.issue.id, detail.issue.id));
              await fetchIssues(query);
            }}
            onRemoveDependency={async (direction, issueId) => {
              await updateMetadata(() => direction === "blockedBy"
                ? removeIssueDependency(pagePath, detail.issue.id, issueId)
                : removeIssueDependency(pagePath, issueId, detail.issue.id));
              await fetchIssues(query);
            }}
            canManageDuplicates={user?.id === ownerId}
            onUnmarkDuplicate={async (canonicalIssueId) => {
              await updateMetadata(() => unmarkIssueDuplicate(pagePath, detail.issue.id, canonicalIssueId));
              await fetchIssues(query);
            }}
            onConvertIssueTask={user?.id === ownerId && !detail.issue.locked_at ? async (taskIndex, title) => {
              setError(null);
              try {
                const existingChildIds = new Set((detail.subIssues ?? []).map((item) => item.id));
                const updated = await convertIssueTaskToSubIssue(pagePath, detail.issue.id, taskIndex, detail.issue.updated_at, title);
                const child = (updated.subIssues ?? []).find((item) => !existingChildIds.has(item.id));
                if (!child) throw new Error("Sub-issue 已创建，但无法定位新引用");
                pendingTaskReferenceFocusRef.current = child.issue_number;
                setView({ kind: "detail", detail: updated });
                await fetchIssues(query);
                for (const delay of [100, 300, 600]) window.setTimeout(() => dialogRef.current?.querySelector<HTMLElement>(`[data-localapp-issue-reference="${child.issue_number}"]`)?.focus(), delay);
                return child.issue_number;
              } catch (requestError) {
                setError(requestError instanceof Error ? requestError.message : "无法转换任务");
                throw requestError;
              }
            } : undefined}
            onToggleIssueTask={canEditIssue && !detail.issue.locked_at ? async (taskIndex, checked) => {
              setSavingTaskTarget("issue");
              setError(null);
              try {
                const description = toggleIssueTask(detail.issue.description, taskIndex, checked);
                await updateIssue(pagePath, detail.issue.id, { description, expectedUpdatedAt: detail.issue.updated_at });
                await Promise.all([refreshDetail(detail.issue.id), fetchIssues(query)]);
              } catch (requestError) {
                await refreshDetail(detail.issue.id).catch(() => undefined);
                setError(requestError instanceof Error ? requestError.message : "任务状态更新失败");
                throw requestError;
              } finally {
                setSavingTaskTarget(null);
              }
            } : undefined}
            onToggleCommentTask={!detail.issue.locked_at ? async (commentId, taskIndex, checked) => {
              const item = detail.timeline.find((entry) => entry.kind === "comment" && entry.comment.id === commentId);
              if (!item || item.kind !== "comment" || item.comment.author_id !== user?.id) return;
              setSavingTaskTarget(commentId);
              setError(null);
              try {
                const body = toggleIssueTask(item.comment.body, taskIndex, checked);
                const updated = await updateIssueComment(pagePath, detail.issue.id, commentId, body, item.comment.updated_at);
                setView({ kind: "detail", detail: updated });
                await fetchIssues(query);
              } catch (requestError) {
                await refreshDetail(detail.issue.id).catch(() => undefined);
                setError(requestError instanceof Error ? requestError.message : "任务状态更新失败");
                throw requestError;
              } finally {
                setSavingTaskTarget(null);
              }
            } : undefined}
            onToggleReaction={async (content, reacted, commentId) => {
              setError(null);
              try {
                const updated = await updateIssueReaction(pagePath, detail.issue.id, content, reacted, commentId);
                setView({ kind: "detail", detail: updated });
                await fetchIssues(query);
              } catch (requestError) {
                setError(requestError instanceof Error ? requestError.message : "Issue 服务暂不可用");
                throw requestError;
              }
            }}
          />}
        </div>}

        {view.kind === "templates" && <IssueTemplateChooser templates={issueTemplates} loading={issueTemplatesLoading} error={issueTemplatesError} onSelect={(template) => showCreateIssue(undefined, template, true)} onBlank={() => showCreateIssue(undefined, undefined, true)} onRetry={() => setIssueTemplatesRevision((revision) => revision + 1)} />}

        {view.kind === "create" && <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">
          <div data-testid="issue-create-workspace" className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(240px,1fr)] lg:gap-6">
            <div data-testid="issue-create-main" className="min-w-0 space-y-4">
              {view.reference && <div role="status" className="rounded-md border bg-muted/30 px-3 py-2 text-sm"><strong>引用自 #{view.reference.detail.issue.issue_number} 评论</strong><p className="mt-1 text-muted-foreground">原评论保持不变，提交后将创建独立 Issue。</p></div>}
              <div className="space-y-1.5"><div className="flex items-center justify-between gap-3"><Label htmlFor="issue-title">标题</Label><span className={`text-xs ${createTitleTooLong ? "text-destructive" : "text-muted-foreground"}`}>{createTitleCharacterCount} / {ISSUE_TITLE_MAX_CHARACTERS}</span></div><Input id="issue-title" aria-label="标题" aria-invalid={createTitleTooLong || undefined} aria-describedby={createTitleTooLong ? "issue-title-error" : undefined} value={createTitle} onChange={(event) => setCreateTitle(event.target.value)} placeholder="简要描述问题或需求" className="h-11 sm:h-10" autoFocus required />{createTitleTooLong && <p id="issue-title-error" role="alert" className="text-sm text-destructive">Issue 标题不能超过 256 个字符</p>}</div>
              {issueTemplateNotice && <p role="status" aria-label="Issue 模板提示" className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm">{issueTemplateNotice}</p>}
              <IssuePotentialDuplicates candidates={potentialDuplicates} loading={potentialDuplicatesLoading} error={potentialDuplicatesError} getIssueHref={issueNumberHref} onOpenIssue={openIssueReference} onRetry={() => setPotentialDuplicatesRevision((revision) => revision + 1)} />
              <IssueComposer key={createDraftId} pagePath={pagePath} draftId={createDraftId} initialBody={createInitialBody} persistenceKey={createPersistenceKey ? `${createPersistenceKey}:body` : undefined} showRestoredDraftNotice restoredDraft={createWasRestoredDraft} onDiscardRestoredDraft={() => { setCreateTitle(""); setCreateInitialBody(""); setCreateBody(""); setCreateWasRestoredDraft(false); setCreateType("task"); setCreateLabelIds([]); setCreateAssigneeIds([]); setCreateMilestoneId(null); setIssueTemplateNotice(null); if (draftPrefix) writeCreateDraft(createPersistenceKey ?? `${draftPrefix}:create`, "", "task", [], [], null); }} onBodyChange={setCreateBody} textareaLabel="描述" placeholder="详细描述问题、复现步骤或期望结果" submitLabel="提交 Issue" mentionCandidates={identities} allowEmpty submitDisabled={!createTitle.trim() || createTitleTooLong} onSubmit={submitCreate} />
            </div>
            <aside data-testid="issue-create-triage" aria-label="Issue 分诊" className="min-w-0 space-y-4 border-t pt-4 lg:border-l lg:border-t-0 lg:pl-5 lg:pt-0">
              <fieldset className="space-y-1.5"><legend className="text-sm font-medium">类型</legend><div className="inline-flex rounded-md border bg-background p-0.5">{(["task", "bug", "feature"] as const).map((value) => <button key={value} type="button" aria-pressed={createType === value} onClick={() => setCreateType(value)} className={`h-11 rounded px-3 text-xs font-medium sm:h-8 ${createType === value ? "bg-accent text-foreground" : "text-muted-foreground"}`}>{ISSUE_TYPE_LABELS[value]}</button>)}</div></fieldset>
              {user?.id === ownerId && <div data-localapp-create-metadata className="space-y-4 border-t pt-4">
              <section><div className="mb-2 flex min-h-7 items-center justify-between"><h3 className="text-sm font-medium">附加标签</h3><IssueMetadataPicker label="附加标签" items={createAdditionalLabels.map((label) => ({ id: label.id, label: label.name, description: label.description || label.id, leading: <span aria-hidden="true" className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: `#${label.color}` }} /> }))} selectedIds={createLabelIds} onToggle={(labelId, selected) => setCreateLabelIds((current) => selected ? Array.from(new Set([...current, labelId])) : current.filter((id) => id !== labelId))} /></div>{createLabelIds.length > 0 ? <div className="flex flex-wrap gap-1.5">{createLabelIds.map((id) => issueLabels.find((label) => label.id === id)).filter((label): label is IssueLabelDefinition => Boolean(label)).map((label) => <IssueLabelBadge key={label.id} label={label} />)}</div> : <p className="text-xs text-muted-foreground">未添加附加标签</p>}</section>
              <section><div className="mb-2 flex min-h-7 items-center justify-between"><h3 className="text-sm font-medium">负责人</h3><IssueMetadataPicker label="负责人" items={createAssignees.map((identity) => ({ id: identity.id, label: identity.displayName || identity.name || identity.id, description: `@${identity.id}` }))} selectedIds={createAssigneeIds} onToggle={(userId, selected) => setCreateAssigneeIds((current) => selected ? Array.from(new Set([...current, userId])) : current.filter((id) => id !== userId))} /></div>{createAssigneeIds.length > 0 ? <div className="space-y-2">{createAssigneeIds.map((id) => <IssueActor key={id} identity={resolveIssueIdentity(id, identities)} />)}</div> : <p className="text-xs text-muted-foreground">尚未分配</p>}</section>
              <section><label className="mb-2 block text-sm font-medium" htmlFor="issue-create-milestone">里程碑</label><select id="issue-create-milestone" aria-label="里程碑" className="h-11 w-full rounded-md border bg-background px-3 text-sm sm:h-9" value={createMilestoneId ?? ""} onChange={(event) => setCreateMilestoneId(event.target.value ? Number(event.target.value) : null)}><option value="">无里程碑</option>{issueMilestones.map((item) => <option key={item.id} value={item.id}>{item.title}{item.state === "closed" ? "（已关闭）" : ""}</option>)}</select></section>
              </div>}
            </aside>
            <div className="flex justify-end border-t pt-4 lg:col-span-2"><Button type="button" variant="ghost" size="sm" className="h-11 sm:h-8" onClick={cancelCreate}>取消</Button></div>
          </div>
        </div>}
        {detail && revisionTarget && <IssueRevisionDialog pagePath={pagePath} issueId={detail.issue.id} commentId={revisionTarget.commentId} currentTitle={revisionTarget.title} currentBody={revisionTarget.body} currentUpdatedAt={revisionTarget.updatedAt} identities={identities} returnFocus={revisionTarget.returnFocus} onClose={() => setRevisionTarget(null)} />}
      </div>
    </div>
  );
}
