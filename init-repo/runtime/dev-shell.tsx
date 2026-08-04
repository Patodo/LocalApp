import React, { useState, useEffect, useLayoutEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import ReactMarkdown from "react-markdown";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import { Bell, Bold, CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight, CircleAlert, CircleCheck, CircleDot, CircleSlash2, Code, Copy, Ellipsis, FileText, GitBranch, GripVertical, Heading2, Italic, Link, Link2, List, ListFilter, ListOrdered, ListPlus, ListTodo, LoaderCircle, LockKeyhole, LockOpen, MessageSquare, MessageSquareReply, Network, Pencil, Pin, PinOff, Plus, Quote, RotateCw, Search, SlidersHorizontal, SmilePlus, Tag, Trash2, Unlink, Upload, UserRound, X } from "lucide-react";
import { setDevRegistry } from "@localapp/sdk-agent/dev-bridge";
import { setPlatformToolRegistry } from "@localapp/sdk-agent/native-registry";
import { isPlatformRequestMessage, type PlatformRequestMessage, type ToolSchema } from "@localapp/sdk-agent/postmessage-types";
import { readDevIssueReference, remarkDevIssueReferences } from "./issue-reference";

const TOOL_TIMEOUT_MS = 30_000;
const AI_SIDEBAR_WIDTH_STORAGE_KEY = "localapp-ai-sidebar-width";
const AI_SIDEBAR_DEFAULT_WIDTH = 380;
const AI_SIDEBAR_MIN_WIDTH = 280;
const AI_SIDEBAR_MAX_WIDTH = 600;
const DEV_ISSUE_DEEP_LINK_PARAM = "localappIssueId";
const DEV_ISSUE_NUMBER_DEEP_LINK_PARAM = "localappIssueNumber";
const DEV_ISSUE_COMMENT_DEEP_LINK_PARAM = "localappIssueCommentId";
const DEV_ISSUES_WORKSPACE_PARAM = "localappIssues";
const DEV_ISSUE_LIST_REQUEST_TIMEOUT_MS = 8_000;
const DEV_ISSUE_REQUEST_TIMEOUT_MS = 8_000;
const DEV_ISSUE_TIMELINE_PAGE_SIZE = 20;
const DEV_ISSUE_MARKDOWN_PUNCTUATION = new Set(Array.from("!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~"));

function DevSubIssueReorderControls({ issue, index, subIssues, saving, onMove, onDragStart, onDragEnd }: { issue: DevIssueSubIssueItem; index: number; subIssues: DevIssueSubIssueItem[]; saving: boolean; onMove: (afterId: number | null) => void; onDragStart: () => void; onDragEnd: () => void }) {
  const previousAfterId = index <= 1 ? null : subIssues[index - 2].id;
  const nextAfterId = index < subIssues.length - 1 ? subIssues[index + 1].id : issue.id;
  const lastAfterId = subIssues.at(-1)?.id ?? issue.id;
  return <><button type="button" draggable={!saving} aria-label={`拖动 Sub-issue #${issue.issue_number}`} title="拖动重排" disabled={saving} className={`${DEV_ICON_BUTTON} hidden h-8 w-8 shrink-0 cursor-grab sm:flex`} onDragStart={(event) => { event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", String(issue.id)); onDragStart(); }} onDragEnd={onDragEnd}><GripVertical className="h-4 w-4" /></button><DevIssueActionMenu label={`重排 Sub-issue #${issue.issue_number}`} items={[
    { label: "移到顶部", disabled: saving || index === 0, restoreFocus: false, onSelect: () => onMove(null) },
    { label: "上移", disabled: saving || index === 0, restoreFocus: false, onSelect: () => onMove(previousAfterId) },
    { label: "下移", disabled: saving || index === subIssues.length - 1, restoreFocus: false, onSelect: () => onMove(nextAfterId) },
    { label: "移到底部", disabled: saving || index === subIssues.length - 1, restoreFocus: false, onSelect: () => onMove(lastAfterId) },
  ]} /></>;
}

function readDevPositiveIntegerParam(url: URL, name: string): number | null {
  const raw = url.searchParams.get(name);
  if (!raw || !/^\d+$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

function readDevIssueDeepLinkId(url: URL): number | null {
  return readDevPositiveIntegerParam(url, DEV_ISSUE_DEEP_LINK_PARAM);
}
function readDevIssueDeepLinkNumber(url: URL): number | null {
  return readDevPositiveIntegerParam(url, DEV_ISSUE_NUMBER_DEEP_LINK_PARAM);
}

function readDevIssueCommentDeepLinkId(url: URL): number | null {
  return readDevPositiveIntegerParam(url, DEV_ISSUE_COMMENT_DEEP_LINK_PARAM);
}

function readDevIssuesWorkspaceOpen(url: URL): boolean {
  return url.searchParams.get(DEV_ISSUES_WORKSPACE_PARAM) === "1" || readDevIssueDeepLinkId(url) !== null || readDevIssueDeepLinkNumber(url) !== null;
}

function updateDevIssuesWorkspaceUrl(source: URL, open: boolean): URL {
  const url = new URL(source.href);
  if (open) url.searchParams.set(DEV_ISSUES_WORKSPACE_PARAM, "1");
  else {
    url.searchParams.delete(DEV_ISSUES_WORKSPACE_PARAM);
    url.searchParams.delete(DEV_ISSUE_DEEP_LINK_PARAM);
    url.searchParams.delete(DEV_ISSUE_NUMBER_DEEP_LINK_PARAM);
    url.searchParams.delete(DEV_ISSUE_COMMENT_DEEP_LINK_PARAM);
  }
  return url;
}

function updateDevIssueDeepLinkUrl(source: URL, issueId: number | null): URL {
  const url = new URL(source.href);
  url.searchParams.set(DEV_ISSUES_WORKSPACE_PARAM, "1");
  if (issueId === null) url.searchParams.delete(DEV_ISSUE_DEEP_LINK_PARAM);
  else url.searchParams.set(DEV_ISSUE_DEEP_LINK_PARAM, String(issueId));
  url.searchParams.delete(DEV_ISSUE_NUMBER_DEEP_LINK_PARAM);
  url.searchParams.delete(DEV_ISSUE_COMMENT_DEEP_LINK_PARAM);
  return url;
}
function updateDevIssueNumberDeepLinkUrl(source: URL, issueNumber: number): URL {
  const url = new URL(source.href);
  url.searchParams.set(DEV_ISSUES_WORKSPACE_PARAM, "1");
  url.searchParams.delete(DEV_ISSUE_DEEP_LINK_PARAM);
  url.searchParams.set(DEV_ISSUE_NUMBER_DEEP_LINK_PARAM, String(issueNumber));
  url.searchParams.delete(DEV_ISSUE_COMMENT_DEEP_LINK_PARAM);
  return url;
}

function updateDevIssueCommentDeepLinkUrl(source: URL, issueId: number, commentId: number): URL {
  const url = new URL(source.href);
  url.searchParams.set(DEV_ISSUES_WORKSPACE_PARAM, "1");
  url.searchParams.set(DEV_ISSUE_DEEP_LINK_PARAM, String(issueId));
  url.searchParams.delete(DEV_ISSUE_NUMBER_DEEP_LINK_PARAM);
  url.searchParams.set(DEV_ISSUE_COMMENT_DEEP_LINK_PARAM, String(commentId));
  return url;
}

function clearDevIssueCommentDeepLinkUrl(source: URL, commentId: number): URL {
  const url = new URL(source.href);
  if (readDevIssueCommentDeepLinkId(url) === commentId) url.searchParams.delete(DEV_ISSUE_COMMENT_DEEP_LINK_PARAM);
  return url;
}

function createDevIssueHref(issueId: number): string {
  return updateDevIssueDeepLinkUrl(new URL(window.location.href), issueId).href;
}
function createDevIssueNumberHref(issueNumber: number): string {
  return updateDevIssueNumberDeepLinkUrl(new URL(window.location.href), issueNumber).href;
}

function createDevIssueCrossReferenceHref(issueNumber: number, commentId: number | null): string {
  const url = updateDevIssueNumberDeepLinkUrl(new URL(window.location.href), issueNumber);
  if (commentId !== null) url.searchParams.set(DEV_ISSUE_COMMENT_DEEP_LINK_PARAM, String(commentId));
  return url.href;
}

function createDevIssueCommentHref(issueId: number, commentId: number): string {
  return updateDevIssueCommentDeepLinkUrl(new URL(window.location.href), issueId, commentId).href;
}

function isPlainDevIssueLinkClick(event: React.MouseEvent<HTMLAnchorElement>): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

function isDevIssueFocusTargetVisible(element: HTMLElement, boundary: HTMLElement): boolean {
  for (let current: HTMLElement | null = element; current; current = current.parentElement) {
    if (current.hidden || current.getAttribute("aria-hidden") === "true") return false;
    const style = window.getComputedStyle(current);
    if (style.display === "none" || style.visibility === "hidden") return false;
    if (current === boundary) return true;
  }
  return false;
}

async function copyDevIssueUrl(text: string): Promise<void> {
  const legacyCopy = () => {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    const copied = typeof document.execCommand === "function" && document.execCommand("copy");
    textarea.remove();
    return copied;
  };
  if (legacyCopy()) return;
  if (!navigator.clipboard?.writeText) throw new Error("Clipboard write failed");
  await Promise.race([
    navigator.clipboard.writeText(text),
    new Promise<never>((_, reject) => window.setTimeout(() => reject(new Error("Clipboard write timed out")), 500)),
  ]);
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  toolCalls?: ToolCallInfo[];
}

interface ToolCallInfo {
  id: string;
  name: string;
  args: Record<string, unknown>;
  result?: unknown;
  isError?: boolean;
  status: "running" | "completed" | "timeout";
}

type ExecuteFn = (args: Record<string, unknown>) => Promise<unknown>;

interface ToolEntry {
  schema: ToolSchema;
  execute: ExecuteFn;
  isSystem?: boolean;
}

interface PlatformEditSession {
  canSave: boolean;
  canUndo: boolean;
  canRedo: boolean;
  busy?: boolean;
  onSave: () => void | Promise<void>;
  onUndo: () => void | Promise<void>;
  onRedo: () => void | Promise<void>;
}

interface PlatformEditSessionRegistry {
  registerEditSession(session: PlatformEditSession): () => void;
}

export interface DevContext {
  user: { id: string; name: string; displayName?: string | null; avatarUrl?: string | null; role?: string } | null;
  timeMode: "real" | "fixed";
  now: string | null;
  pageName?: string;
  pageOwnerId?: string | null;
  recentUsers?: DevUserBasic[];
}

interface DevUserBasic {
  id: string;
  name?: string;
  displayName?: string | null;
  avatarUrl?: string | null;
  role?: string;
}

interface DevIssueIdentity {
  id: string;
  name?: string;
  displayName: string;
  avatarUrl: string | null;
}

interface DevIssueLabelDefinition {
  id: string;
  name: string;
  color: string;
  description: string;
  built_in: number;
  created_at: string;
  updated_at: string;
}

interface DevIssueCollaborationMetadata {
  labels: DevIssueLabelDefinition[];
  assignee_ids: string[];
  subscriber_ids: string[];
  participant_ids: string[];
}

interface DevRequestDiagnostic {
  method: string;
  path: string;
  status: number;
  durationMs: number;
}

type DevIssueType = "task" | "bug" | "feature";
const DEV_ISSUE_TYPE_LABELS: Record<DevIssueType, string> = { task: "任务", bug: "缺陷", feature: "功能" };

interface DevIssue {
  id: number;
  issue_number: number;
  title: string;
  description?: string;
  status: "open" | "closed";
  state_reason?: "completed" | "not_planned" | null;
  label: DevIssueType;
  issue_type?: DevIssueType;
  reporter_id: string;
  locked_at?: string | null;
  locked_by?: string | null;
  lock_reason?: DevIssueLockReason | null;
  milestone_id?: number | null;
  pinned_at?: string | null;
  pinned_by?: string | null;
  created_at: string;
  updated_at?: string;
  comment_count?: number;
  last_activity_at?: string;
  participant_ids?: string[];
  labels?: DevIssueLabelDefinition[];
  assignee_ids?: string[];
  revision_count?: number;
  is_blocked?: number;
  is_duplicate?: number;
}

type DevIssueSubIssueItem = DevIssue & {
  position: number;
  added_by: string;
  relation_created_at: string;
  assignee_ids: string[];
  child_count?: number;
  completed_child_count?: number;
  child_percent?: number;
};

interface DevIssueSubIssueListResult {
  items: DevIssueSubIssueItem[];
  summary: { total: number; completed: number; percent: number };
}

interface DevIssueMilestoneDefinition { id: number; title: string; description: string; due_on: string | null; state: "open" | "closed"; created_by: string; created_at: string; updated_at: string; open_issues: number; closed_issues: number; }

type DevIssueLockReason = "resolved" | "off_topic" | "too_heated" | "spam";
const DEV_ISSUE_LOCK_REASON_LABELS: Record<DevIssueLockReason, string> = {
  resolved: "已解决",
  off_topic: "偏离主题",
  too_heated: "讨论过热",
  spam: "垃圾信息",
};

type DevIssueListSort = "activity" | "created" | "updated" | "comments";
type DevIssueListDirection = "asc" | "desc";
type DevIssueListView = "all" | "assigned" | "created" | "participating" | "subscribed" | "mentioned" | "recent";

interface DevIssueListQuery {
  q: string;
  searchIn: string;
  status: DevIssue["status"];
  label: string;
  issueType: "" | DevIssueType;
  author: string;
  participant: string;
  assignee: string;
  milestone: string;
  reason: "" | "completed" | "not_planned";
  subscribed: boolean;
  mentioned: boolean;
  locked: "" | "locked" | "unlocked";
  sort: DevIssueListSort;
  direction: DevIssueListDirection;
  limit: number;
  offset: number;
}

type DevIssueSavedViewQuery = Partial<Omit<DevIssueListQuery, "searchIn" | "offset">> & { searchIn?: string[]; offset: 0 };
type DevIssueSavedView = { id: number; user_id: string; name: string; description: string; query: DevIssueSavedViewQuery; created_at: string; updated_at: string };

function devIssueListQueryToSavedView(query: DevIssueListQuery): DevIssueSavedViewQuery {
  return {
    ...(query.q ? { q: query.q.trim() } : {}), ...(query.searchIn ? { searchIn: query.searchIn.split(",") } : {}),
    ...(query.status !== "open" ? { status: query.status } : {}), ...(query.label ? { label: query.label } : {}), ...(query.issueType ? { issueType: query.issueType } : {}),
    ...(query.author ? { author: query.author } : {}), ...(query.participant ? { participant: query.participant } : {}),
    ...(query.assignee ? { assignee: query.assignee } : {}), ...(query.milestone ? { milestone: query.milestone } : {}),
    ...(query.status === "closed" && query.reason ? { reason: query.reason } : {}), ...(query.subscribed ? { subscribed: true } : {}),
    ...(query.mentioned ? { mentioned: true } : {}), ...(query.locked ? { locked: query.locked } : {}),
    ...(query.sort !== "activity" ? { sort: query.sort } : {}), ...(query.direction !== "desc" ? { direction: query.direction } : {}),
    ...(query.limit !== 25 ? { limit: query.limit } : {}), offset: 0,
  };
}

function devIssueListQueryFromSavedView(saved: DevIssueSavedViewQuery): DevIssueListQuery {
  return { ...DEV_ISSUE_LIST_DEFAULT_QUERY, ...saved, searchIn: saved.searchIn?.join(",") ?? "", reason: saved.status === "closed" ? saved.reason ?? "" : "", offset: 0 };
}

function devIssueSavedViewMatchesListQuery(saved: DevIssueSavedViewQuery, query: DevIssueListQuery): boolean {
  return JSON.stringify(devIssueListQueryToSavedView(devIssueListQueryFromSavedView(saved))) === JSON.stringify(devIssueListQueryToSavedView(query));
}

interface DevIssueListMeta {
  total: number;
  open: number;
  closed: number;
  limit: number;
  offset: number;
}

const DEV_ISSUE_LIST_DEFAULT_QUERY: DevIssueListQuery = {
  q: "",
  searchIn: "",
  status: "open",
  label: "",
  issueType: "",
  author: "",
  participant: "",
  assignee: "",
  milestone: "",
  reason: "",
  subscribed: false,
  mentioned: false,
  locked: "",
  sort: "activity",
  direction: "desc",
  limit: 25,
  offset: 0,
};

function activeDevIssueAdvancedFilterCount(query: DevIssueListQuery, currentUserId?: string): number {
  const authorPreset = query.author === currentUserId && !query.participant && !query.assignee && !query.subscribed && !query.mentioned;
  const assigneePreset = query.assignee === currentUserId && !query.author && !query.participant && !query.subscribed && !query.mentioned;
  const author = authorPreset ? "" : query.author;
  const assignee = assigneePreset ? "" : query.assignee;
  return [query.issueType, query.label, author, assignee, query.milestone, query.locked, query.reason].filter(Boolean).length
    + Number(query.sort !== "activity" || query.direction !== "desc");
}

const DEV_ISSUE_LIST_URL_PARAMS = {
  q: "localappIssueQ",
  searchIn: "localappIssueIn",
  status: "localappIssueStatus",
  label: "localappIssueLabel",
  issueType: "localappIssueType",
  author: "localappIssueAuthor",
  participant: "localappIssueParticipant",
  assignee: "localappIssueAssignee",
  milestone: "localappIssueMilestone",
  reason: "localappIssueReason",
  subscribed: "localappIssueSubscribed",
  mentioned: "localappIssueMentioned",
  locked: "localappIssueLocked",
  sort: "localappIssueSort",
  direction: "localappIssueDirection",
  offset: "localappIssueOffset",
} as const;

function readDevIssueListTextParam(url: URL, name: string, maxLength: number): string {
  const value = url.searchParams.get(name)?.trim() ?? "";
  return value.length <= maxLength ? value : "";
}

function readDevIssueListQueryFromUrl(url: URL): DevIssueListQuery {
  const status = url.searchParams.get(DEV_ISSUE_LIST_URL_PARAMS.status);
  const sort = url.searchParams.get(DEV_ISSUE_LIST_URL_PARAMS.sort);
  const direction = url.searchParams.get(DEV_ISSUE_LIST_URL_PARAMS.direction);
  const rawOffset = url.searchParams.get(DEV_ISSUE_LIST_URL_PARAMS.offset);
  const issueType = url.searchParams.get(DEV_ISSUE_LIST_URL_PARAMS.issueType);
  const parsedOffset = rawOffset !== null && /^\d+$/.test(rawOffset) ? Number(rawOffset) : 0;
  return {
    ...DEV_ISSUE_LIST_DEFAULT_QUERY,
    q: readDevIssueListTextParam(url, DEV_ISSUE_LIST_URL_PARAMS.q, 200),
    searchIn: ["title", "body", "comments", "title,body", "title,comments", "body,comments", "title,body,comments"].includes(url.searchParams.get(DEV_ISSUE_LIST_URL_PARAMS.searchIn) ?? "") ? url.searchParams.get(DEV_ISSUE_LIST_URL_PARAMS.searchIn)! : "",
    status: status === "closed" ? "closed" : "open",
    label: readDevIssueListTextParam(url, DEV_ISSUE_LIST_URL_PARAMS.label, 100),
    issueType: issueType === "task" || issueType === "bug" || issueType === "feature" ? issueType : "",
    author: readDevIssueListTextParam(url, DEV_ISSUE_LIST_URL_PARAMS.author, 100),
    participant: readDevIssueListTextParam(url, DEV_ISSUE_LIST_URL_PARAMS.participant, 100),
    assignee: readDevIssueListTextParam(url, DEV_ISSUE_LIST_URL_PARAMS.assignee, 100),
    milestone: readDevIssueListTextParam(url, DEV_ISSUE_LIST_URL_PARAMS.milestone, 100),
    reason: status === "closed" && url.searchParams.get(DEV_ISSUE_LIST_URL_PARAMS.reason) === "not_planned" ? "not_planned" : status === "closed" && url.searchParams.get(DEV_ISSUE_LIST_URL_PARAMS.reason) === "completed" ? "completed" : "",
    subscribed: url.searchParams.get(DEV_ISSUE_LIST_URL_PARAMS.subscribed) === "1",
    mentioned: url.searchParams.get(DEV_ISSUE_LIST_URL_PARAMS.mentioned) === "1",
    locked: url.searchParams.get(DEV_ISSUE_LIST_URL_PARAMS.locked) === "locked" ? "locked" : url.searchParams.get(DEV_ISSUE_LIST_URL_PARAMS.locked) === "unlocked" ? "unlocked" : "",
    sort: ["activity", "created", "updated", "comments"].includes(sort ?? "") ? sort as DevIssueListSort : "activity",
    direction: direction === "asc" ? "asc" : "desc",
    offset: Number.isSafeInteger(parsedOffset) && parsedOffset >= 0 ? parsedOffset : 0,
  };
}

function updateDevIssueListQueryUrl(source: URL, query: DevIssueListQuery): URL {
  const url = new URL(source.href);
  url.searchParams.set(DEV_ISSUES_WORKSPACE_PARAM, "1");
  for (const name of Object.values(DEV_ISSUE_LIST_URL_PARAMS)) url.searchParams.delete(name);
  const values: Array<[string, string | number, string | number]> = [
    [DEV_ISSUE_LIST_URL_PARAMS.q, query.q, DEV_ISSUE_LIST_DEFAULT_QUERY.q],
    [DEV_ISSUE_LIST_URL_PARAMS.searchIn, query.searchIn, DEV_ISSUE_LIST_DEFAULT_QUERY.searchIn],
    [DEV_ISSUE_LIST_URL_PARAMS.status, query.status, DEV_ISSUE_LIST_DEFAULT_QUERY.status],
    [DEV_ISSUE_LIST_URL_PARAMS.label, query.label, DEV_ISSUE_LIST_DEFAULT_QUERY.label],
    [DEV_ISSUE_LIST_URL_PARAMS.issueType, query.issueType, DEV_ISSUE_LIST_DEFAULT_QUERY.issueType],
    [DEV_ISSUE_LIST_URL_PARAMS.author, query.author, DEV_ISSUE_LIST_DEFAULT_QUERY.author],
    [DEV_ISSUE_LIST_URL_PARAMS.participant, query.participant, DEV_ISSUE_LIST_DEFAULT_QUERY.participant],
    [DEV_ISSUE_LIST_URL_PARAMS.assignee, query.assignee, DEV_ISSUE_LIST_DEFAULT_QUERY.assignee],
    [DEV_ISSUE_LIST_URL_PARAMS.milestone, query.milestone, DEV_ISSUE_LIST_DEFAULT_QUERY.milestone],
    [DEV_ISSUE_LIST_URL_PARAMS.reason, query.status === "closed" ? query.reason : "", DEV_ISSUE_LIST_DEFAULT_QUERY.reason],
    [DEV_ISSUE_LIST_URL_PARAMS.subscribed, query.subscribed ? 1 : 0, 0],
    [DEV_ISSUE_LIST_URL_PARAMS.mentioned, query.mentioned ? 1 : 0, 0],
    [DEV_ISSUE_LIST_URL_PARAMS.locked, query.locked, DEV_ISSUE_LIST_DEFAULT_QUERY.locked],
    [DEV_ISSUE_LIST_URL_PARAMS.sort, query.sort, DEV_ISSUE_LIST_DEFAULT_QUERY.sort],
    [DEV_ISSUE_LIST_URL_PARAMS.direction, query.direction, DEV_ISSUE_LIST_DEFAULT_QUERY.direction],
    [DEV_ISSUE_LIST_URL_PARAMS.offset, query.offset, DEV_ISSUE_LIST_DEFAULT_QUERY.offset],
  ];
  for (const [name, value, defaultValue] of values) {
    if (value !== defaultValue && value !== "") url.searchParams.set(name, String(value));
  }
  return url;
}

const DEV_ISSUE_LIST_EMPTY_META: DevIssueListMeta = {
  total: 0,
  open: 0,
  closed: 0,
  limit: DEV_ISSUE_LIST_DEFAULT_QUERY.limit,
  offset: 0,
};

interface DevIssueComment {
  id: number;
  issue_id: number;
  body: string;
  author_id: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  pinned_at?: string | null;
  pinned_by?: string | null;
  minimized_at?: string | null;
  minimized_by?: string | null;
  minimized_reason?: DevIssueCommentMinimizedReason | null;
  revision_count?: number;
}

type DevIssueCommentMinimizedReason = "abuse" | "off-topic" | "outdated" | "resolved" | "duplicate" | "spam";
const DEV_ISSUE_COMMENT_MINIMIZED_REASON_LABELS: Record<DevIssueCommentMinimizedReason, string> = {
  abuse: "滥用内容", "off-topic": "偏离主题", outdated: "内容过时", resolved: "问题已解决", duplicate: "重复内容", spam: "垃圾内容",
};

interface DevIssueRevision {
  id: number;
  issue_id: number;
  target_type: "issue" | "comment";
  target_id: number;
  editor_id: string;
  title: string | null;
  body: string;
  fields_json: string;
  created_at: string;
}

interface DevIssueEvent {
  id: number;
  issue_id: number;
  actor_id: string;
  event_type: string;
  payload_json: string;
  created_at: string;
}

interface DevIssueAttachment {
  id: string;
  issue_id: number | null;
  comment_id: number | null;
  draft_id: string;
  uploader_id: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  created_at: string;
  url?: string;
}

const DEV_ISSUE_REACTION_CONTENTS = ["+1", "-1", "laugh", "hooray", "confused", "heart", "rocket", "eyes"] as const;
type DevIssueReactionContent = (typeof DEV_ISSUE_REACTION_CONTENTS)[number];

interface DevIssueReaction {
  issue_id: number;
  comment_id: number;
  user_id: string;
  content: DevIssueReactionContent;
  created_at: string;
}

interface DevIssueCrossReferenceRecord {
  id: number;
  target_issue_id: number;
  source_issue_id: number;
  source_issue_number: number;
  source_issue_title: string;
  source_issue_status: "open" | "closed";
  source_type: "issue" | "comment";
  source_id: number;
  source_comment_id: number | null;
  actor_id: string;
  excerpt: string;
  created_at: string;
  updated_at: string;
}

type DevIssueTimelineItem =
  | { kind: "comment"; comment: DevIssueComment }
  | { kind: "event"; event: DevIssueEvent }
  | { kind: "cross_reference"; crossReference: DevIssueCrossReferenceRecord };

type DevIssueTimelineDisplayItem = DevIssueTimelineItem | { kind: "event-group"; groupType: "edited" | "history"; key: string; actorId: string | null; events: DevIssueEvent[] };

const DEV_ISSUE_HISTORY_BATCH_THRESHOLD = 4;

type DevIssueTimelineFilter = "all" | "comments" | "history";

function filterDevIssueTimeline(timeline: readonly DevIssueTimelineItem[], filter: DevIssueTimelineFilter): DevIssueTimelineItem[] {
  if (filter === "all") return [...timeline];
  return timeline.filter((item) => filter === "comments" ? item.kind === "comment" : item.kind !== "comment");
}

function groupDevIssueTimeline(timeline: readonly DevIssueTimelineItem[]): DevIssueTimelineDisplayItem[] {
  const grouped: DevIssueTimelineDisplayItem[] = [];
  for (let index = 0; index < timeline.length;) {
    const item = timeline[index];
    if (item.kind !== "event") { grouped.push(item); index += 1; continue; }
    if (item.event.event_type !== "edited") {
      const events = [item.event];
      let cursor = index + 1;
      while (cursor < timeline.length) {
        const next = timeline[cursor];
        if (next.kind !== "event" || next.event.event_type === "edited") break;
        events.push(next.event);
        cursor += 1;
      }
      if (events.length < DEV_ISSUE_HISTORY_BATCH_THRESHOLD) grouped.push(...timeline.slice(index, cursor));
      else grouped.push({ kind: "event-group", groupType: "history", key: `history-${events[0].id}-${events.at(-1)!.id}`, actorId: events.every((event) => event.actor_id === events[0].actor_id) ? events[0].actor_id : null, events });
      index = cursor;
      continue;
    }
    const events = [item.event];
    let cursor = index + 1;
    while (cursor < timeline.length) {
      const next = timeline[cursor];
      if (next.kind !== "event" || next.event.event_type !== "edited" || next.event.actor_id !== item.event.actor_id) break;
      events.push(next.event);
      cursor += 1;
    }
    grouped.push(events.length < 2 ? item : { kind: "event-group", groupType: "edited", key: `edited-${events[0].id}-${events.at(-1)!.id}`, actorId: item.event.actor_id, events });
    index = cursor;
  }
  return grouped;
}

interface DevIssueDetail {
  issue: DevIssue;
  timeline: DevIssueTimelineItem[];
  attachments: DevIssueAttachment[];
  reactions: DevIssueReaction[];
  collaboration?: DevIssueCollaborationMetadata;
  parent?: DevIssue | null;
  subIssues?: DevIssueSubIssueItem[];
  subIssueSummary?: { total: number; completed: number; percent: number };
  blockedBy?: Array<DevIssue & { added_by: string; relation_created_at: string; assignee_ids: string[] }>;
  blocking?: Array<DevIssue & { added_by: string; relation_created_at: string; assignee_ids: string[] }>;
  dependencySummary?: { blockedBy: number; blocking: number; unresolvedBlockers: number; isBlocked: boolean };
  duplicateOf?: DevIssueDuplicateItem | null;
  duplicates?: DevIssueDuplicateItem[];
}

type DevIssueDuplicateItem = DevIssue & { marked_by: string; comment_id: number; relation_created_at: string };

interface DevIssuePotentialDuplicate {
  id: number;
  issue_number: number;
  title: string;
  status: "open" | "closed";
  updated_at: string;
  last_activity_at: string;
  score: number;
  matched_in: "title" | "body" | "title,body";
}

interface DevIssueTemplateConfig {
  id: string;
  name: string;
  description: string;
  titlePrefix: string;
  body: string;
  type: DevIssueType;
  labels: string[];
}

interface DevPendingIssueAttachment {
  clientId: string;
  file?: File;
  fileName: string;
  fileSize: number;
  previewUrl: string | null;
  attachment?: DevIssueAttachment;
  error?: string;
  status: "uploading" | "uploaded" | "error";
}

interface DevIssueComposerSubmit {
  body: string;
  attachmentIds: string[];
  draftId: string;
  statusAction?: "close" | "reopen";
  stateReason?: "completed" | "not_planned";
}

type DevIssueMarkdownCommand = "heading" | "bold" | "italic" | "quote" | "code" | "link" | "bullet-list" | "ordered-list" | "task-list";

interface DevIssueMarkdownSelection {
  value: string;
  selectionStart: number;
  selectionEnd: number;
}

const DEV_ISSUE_BLOCK_COMMANDS = new Set<DevIssueMarkdownCommand>(["heading", "quote", "bullet-list", "ordered-list", "task-list"]);
const DEV_ISSUE_BLOCK_PREFIX = /^\s*(?:#{1,6}\s+|>\s?|[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+)/;

function applyDevIssueMarkdownCommand(value: string, selectionStart: number, selectionEnd: number, command: DevIssueMarkdownCommand): DevIssueMarkdownSelection {
  const start = Math.max(0, Math.min(selectionStart, value.length));
  const end = Math.max(start, Math.min(selectionEnd, value.length));
  if (!DEV_ISSUE_BLOCK_COMMANDS.has(command)) {
    const selected = value.slice(start, end);
    if (command === "link") {
      const label = selected || "链接文字";
      const replacement = `[${label}](url)`;
      const urlStart = start + label.length + 3;
      return { value: value.slice(0, start) + replacement + value.slice(end), selectionStart: urlStart, selectionEnd: urlStart + 3 };
    }
    const config = command === "bold" ? ["**", "**", "粗体文本"] : command === "italic" ? ["_", "_", "斜体文本"] : ["`", "`", "代码"];
    const content = selected || config[2];
    return { value: value.slice(0, start) + config[0] + content + config[1] + value.slice(end), selectionStart: start + config[0].length, selectionEnd: start + config[0].length + content.length };
  }
  const blockStart = value.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
  const lastSelectedOffset = end > start ? end - 1 : end;
  const nextNewline = value.indexOf("\n", lastSelectedOffset);
  const blockEnd = nextNewline === -1 ? value.length : nextNewline;
  const placeholder = command === "heading" ? "标题" : command === "quote" ? "引用" : command === "task-list" ? "任务" : "列表项";
  const lines = (value.slice(blockStart, blockEnd) || placeholder).split("\n").map((line) => line.replace(DEV_ISSUE_BLOCK_PREFIX, ""));
  const transformed = lines.map((line, index) => command === "heading" ? `## ${line}` : command === "quote" ? `> ${line}` : command === "bullet-list" ? `- ${line}` : command === "ordered-list" ? `${index + 1}. ${line}` : `- [ ] ${line}`).join("\n");
  return { value: value.slice(0, blockStart) + transformed + value.slice(blockEnd), selectionStart: blockStart, selectionEnd: blockStart + transformed.length };
}

type DevIssuesView =
  | { kind: "list" }
  | { kind: "templates" }
  | { kind: "labels" }
  | { kind: "milestones" }
  | { kind: "detail"; issue: DevIssue }
  | { kind: "create"; parentIssueId?: number; returnToTemplates?: boolean; reference?: { detail: DevIssueDetail; commentId: number; trigger: HTMLButtonElement | null } };

type ConfirmDialogState = {
  id: string;
  title: string;
  message: string;
  confirmText: string;
  cancelText: string;
  tone: "default" | "danger";
};

type DevBusinessConfig = Record<string, {
  recordAccess?: unknown;
  defaultFields?: unknown;
  transitions?: unknown;
  enums?: unknown;
}>;

const SYSTEM_TOOLS: ToolEntry[] = [
  {
    schema: {
      name: "getCurrentUser",
      description: "Return the current signed-in user id and name, or null when unauthenticated.",
      parameters: { type: "object", properties: {} },
    },
    execute: async () => {
      try {
        const res = await fetch("/api/me", { credentials: "include" });
        if (!res.ok) return null;
        const body = await res.json();
        if (!body.success || !body.data) return null;
        return { id: body.data.id, name: body.data.name };
      } catch { return null; }
    },
    isSystem: true,
  },
];

const DEV_PANEL_CLASS =
  "absolute top-0 bottom-0 z-40 flex flex-col border-localapp-dev-border bg-background shadow-lg transition-transform duration-300 ease-in-out";
const DEV_BUTTON_IDLE =
  "bg-localapp-dev-muted text-localapp-dev-muted-foreground hover:bg-localapp-dev-hover";
const DEV_BUTTON_ACTIVE =
  "bg-localapp-dev-accent text-localapp-dev-accent-foreground";
const DEV_ICON_BUTTON =
  "flex h-6 min-w-6 items-center justify-center whitespace-nowrap rounded text-localapp-dev-muted-foreground hover:bg-localapp-dev-muted hover:text-localapp-dev-muted-foreground";
const DEV_OUTLINE_BUTTON =
  "rounded border border-localapp-dev-border px-2 py-1 hover:bg-localapp-dev-muted disabled:opacity-50";
const DEV_NAV_LABEL = "DEV";
const DEV_NAV_SAVE = "Ctrl+S";
const DEV_NAV_UNDO = "Ctrl+Z";
const DEV_NAV_REDO = "Ctrl+Y";
const DEV_NAV_ONLINE_USERS = "当前在线用户";
const DEV_NAV_ISSUES = "Issue";
const DEV_ISSUE_OWNER_ID = "__localapp_dev_page_owner__";
const DEV_ISSUE_MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const DEV_ISSUE_MAX_DRAFT_ATTACHMENTS = 20;
const DEV_ISSUE_VISIBLE_UPLOADED_ATTACHMENTS = 4;
const DEV_ISSUE_TITLE_MAX_CHARACTERS = 256;
const DEV_ISSUE_FOCUSABLE_SELECTOR = 'button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
const DEV_MENU_TOOLS = "tools";
const DEV_MENU_TOOLKIT = "dev-toolkit";
const PLATFORM_NAV_SHELL_MODEL = {
  rootClass: "flex flex-col bg-background",
  barClass: "flex h-11 min-w-0 items-center gap-1 border-b border-localapp-dev-border px-2 sm:gap-2 sm:px-4",
  leftClass: "localapp-platform-nav-left flex min-w-0 flex-1 items-center gap-1 overflow-x-auto sm:gap-2",
  rightClass: "localapp-platform-nav-right flex shrink-0 items-center gap-1 sm:gap-2",
  appTitleClass: "min-w-0 max-w-20 shrink truncate text-sm font-medium text-localapp-dev-foreground sm:max-w-40 lg:max-w-none",
  userStateClass: "max-w-40 truncate text-xs text-localapp-dev-muted-foreground",
} as const;
const DEV_MENU_BUTTON_CLASS =
  "flex w-full items-center justify-between gap-3 rounded px-2 py-1.5 text-left text-xs text-localapp-dev-foreground hover:bg-localapp-dev-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-localapp-dev-focus";
const DEV_CONTEXT_SETUP_HINT =
  "请使用 npm run dev 或 localapp dev 启动开发环境。当前 Dev Toolkit 未连接到本地 mini-server，裸 vite/npm run dev:vite 会绕过 mini-server。";

function deriveDevShellNavModel() {
  return {
    ...PLATFORM_NAV_SHELL_MODEL,
    devButtonClass:
      "rounded px-2 py-1 text-xs font-semibold tracking-normal transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-localapp-dev-focus",
    devMenuClass:
      "absolute left-0 top-8 z-50 min-w-44 rounded-md border border-localapp-dev-border bg-background p-1 shadow-lg",
    menuItemClass: DEV_MENU_BUTTON_CLASS,
  };
}

function getDevShellAppTitle(context: DevContext | null): string {
  return context?.pageName?.trim() || "App";
}

function getDevIssuePagePath(context: DevContext | null): string {
  const pageName = getDevShellAppTitle(context).replaceAll("/", "-");
  return `${DEV_ISSUE_OWNER_ID}/${pageName}`;
}

function getUserInitial(user: DevContext["user"]): string {
  if (!user) return "?";
  return (user.displayName || user.name || user.id || "?").charAt(0).toUpperCase();
}

function getUserDisplayName(user: DevContext["user"]): string {
  if (!user) return "未登录";
  return user.displayName || user.name || user.id;
}

function resolveDevIssueIdentity(userId: string, users: readonly DevUserBasic[]): DevIssueIdentity {
  const user = new Map(users.map((candidate) => [candidate.id, candidate])).get(userId);
  if (!user) return { id: userId, displayName: userId || "未知用户", avatarUrl: null };
  return {
    id: user.id,
    name: user.name,
    displayName: user.displayName?.trim() || user.name?.trim() || user.id || "未知用户",
    avatarUrl: user.avatarUrl || null,
  };
}

function getDevIssueIdentityInitial(identity: DevIssueIdentity): string {
  if (!identity.id.trim()) return "?";
  return Array.from(identity.displayName.trim() || identity.name?.trim() || identity.id)[0]?.toLocaleUpperCase() || "?";
}

function formatDevIssueRelativeTime(timestamp: string, now = Date.now()): string {
  const milliseconds = new Date(timestamp).getTime();
  if (!Number.isFinite(milliseconds)) return timestamp;
  const minutes = Math.floor(Math.max(0, now - milliseconds) / 60_000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes}分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}小时前`;
  const days = Math.floor(hours / 24);
  return days < 30 ? `${days}天前` : new Date(milliseconds).toLocaleDateString();
}

function DevIssueTime({ timestamp, href, precise = false, className }: { timestamp: string; href?: string; precise?: boolean; className?: string }) {
  const date = new Date(timestamp);
  const exact = Number.isFinite(date.getTime()) ? date.toLocaleString() : timestamp;
  const label = precise ? exact : formatDevIssueRelativeTime(timestamp);
  const time = <time dateTime={timestamp} title={exact} className={href ? undefined : className}>{label}</time>;
  return href ? <a href={href} className={`-my-2 inline-flex h-11 items-center px-1 sm:-my-0 sm:h-6 ${className ?? ""}`}>{time}</a> : time;
}

function DevIssueActor({ identity, timestamp, timestampHref, timestampSuffix, badge, action }: { identity: DevIssueIdentity; timestamp?: string; timestampHref?: string; timestampSuffix?: React.ReactNode; badge?: React.ReactNode; action?: React.ReactNode }) {
  const localizedBadge = badge === "Author" ? "作者" : badge;
  const localizedTimestampSuffix = React.isValidElement<{ children?: React.ReactNode }>(timestampSuffix) && timestampSuffix.props.children === "edited"
    ? React.cloneElement(timestampSuffix, { children: "已编辑" })
    : timestampSuffix;
  return <div className="flex min-w-0 items-center gap-2.5">
    {identity.avatarUrl ? <img src={identity.avatarUrl} alt="" className="h-8 w-8 shrink-0 rounded-full object-cover" /> : <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-localapp-dev-muted text-xs font-semibold text-localapp-dev-muted-foreground">{getDevIssueIdentityInitial(identity)}</span>}
    <div className="min-w-0 flex-1 text-xs leading-5"><div className="flex min-w-0 flex-wrap items-baseline gap-x-2"><strong className="break-words text-sm font-semibold text-localapp-dev-foreground">{identity.displayName}</strong><span className="break-all text-localapp-dev-muted-foreground">@{identity.id || "未知"}</span>{localizedBadge && <span className="shrink-0 rounded-full border border-localapp-dev-border px-1.5 text-[10px] font-medium leading-4 text-localapp-dev-muted-foreground">{localizedBadge}</span>}</div>{timestamp && <div className="flex flex-wrap items-center gap-x-1.5"><DevIssueTime timestamp={timestamp} href={timestampHref} className="text-localapp-dev-muted-foreground hover:underline" />{localizedTimestampSuffix}</div>}</div>
    {action && <div data-localapp-issue-actor-action className="shrink-0 self-start">{action}</div>}
  </div>;
}

function setPlatformEditSessionRegistry(registry: PlatformEditSessionRegistry | null) {
  (globalThis as typeof globalThis & {
    __localapp_platform_edit_session_registry__?: PlatformEditSessionRegistry | null;
  }).__localapp_platform_edit_session_registry__ = registry;
}

function isEditableShortcutTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tagName = target.tagName.toLowerCase();
  return tagName === "input" || tagName === "textarea" || tagName === "select";
}

type DevShellNavModel = ReturnType<typeof deriveDevShellNavModel>;

interface DevShellNavProps {
  navModel: DevShellNavModel;
  devMenuRef: React.RefObject<HTMLDivElement | null>;
  devMenuOpen: boolean;
  toolsOpen: boolean;
  devToolkitOpen: boolean;
  aiOpen: boolean;
  toolCount: number;
  appTitle: string;
  user: DevContext["user"];
  editSession: PlatformEditSession | null;
  presenceSnapshot: {
    count: number;
    anonymousCount: number;
    authenticatedUsers: Array<{ id: string; name: string; displayName?: string | null; avatarUrl?: string | null }>;
  } | null;
  openIssueCount: number | null;
  onToggleDevMenu: () => void;
  onOpenTools: () => void;
  onOpenDevToolkit: () => void;
  onOpenIssues: () => void;
  onToggleAi: () => void;
}

function DevShellNav({
  navModel,
  devMenuRef,
  devMenuOpen,
  toolsOpen,
  devToolkitOpen,
  aiOpen,
  toolCount,
  appTitle,
  user,
  editSession,
  presenceSnapshot,
  openIssueCount,
  onToggleDevMenu,
  onOpenTools,
  onOpenDevToolkit,
  onOpenIssues,
  onToggleAi,
}: DevShellNavProps) {
  const editBusy = editSession?.busy ?? false;
  const onlineCount = presenceSnapshot?.count ?? null;
  const [presenceOpen, setPresenceOpen] = useState(false);

  return (
    <nav className={navModel.rootClass}>
      <div className={navModel.barClass}>
        <div className={navModel.leftClass}>
          <div ref={devMenuRef} className="relative shrink-0">
            <button
              type="button"
              aria-label="打开 DEV 菜单"
              aria-haspopup="menu"
              aria-expanded={devMenuOpen}
              onClick={onToggleDevMenu}
              className={`${navModel.devButtonClass} ${
                devMenuOpen || toolsOpen || devToolkitOpen ? DEV_BUTTON_ACTIVE : DEV_BUTTON_IDLE
              }`}
            >
              {DEV_NAV_LABEL}
            </button>
            {devMenuOpen && (
              <div role="menu" className={navModel.devMenuClass}>
                {toolCount > 0 && (
                  <button
                    type="button"
                    role="menuitem"
                    data-dev-menu-item={DEV_MENU_TOOLS}
                    onClick={onOpenTools}
                    className={navModel.menuItemClass}
                  >
                    <span>工具</span>
                    <span className="rounded bg-localapp-dev-muted px-1.5 py-0.5 text-[10px] text-localapp-dev-muted-foreground">
                      {toolCount}
                    </span>
                  </button>
                )}
                <button
                  type="button"
                  role="menuitem"
                  data-dev-menu-item={DEV_MENU_TOOLKIT}
                  onClick={onOpenDevToolkit}
                  className={navModel.menuItemClass}
                >
                  <span>开发工具</span>
                  <span className="text-[10px] text-localapp-dev-muted-foreground">Toolkit</span>
                </button>
              </div>
            )}
          </div>
          <span className={navModel.appTitleClass}>{appTitle}</span>
          <button
            type="button"
            aria-label={openIssueCount === null ? DEV_NAV_ISSUES : `${DEV_NAV_ISSUES}，${openIssueCount} 个待处理`}
            title={openIssueCount === null ? DEV_NAV_ISSUES : `${DEV_NAV_ISSUES}，${openIssueCount} 个待处理`}
            onClick={onOpenIssues}
            className="flex h-7 shrink-0 items-center gap-1 rounded px-1.5 text-xs font-medium text-localapp-dev-muted-foreground hover:bg-localapp-dev-muted hover:text-localapp-dev-foreground sm:gap-1.5 sm:px-2"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <circle cx="12" cy="12" r="1" />
            </svg>
            <span className="hidden sm:inline">Issue</span>
            {openIssueCount !== null && (
              <span className="min-w-4 text-center text-[10px] font-semibold tabular-nums">{openIssueCount}</span>
            )}
          </button>
          {onlineCount !== null && (
            <div className="relative shrink-0">
            <button
              type="button"
              data-localapp-presence-count
              className="inline-flex h-6 shrink-0 items-center gap-1 rounded px-1 text-xs text-localapp-dev-muted-foreground sm:px-1.5"
              aria-label={`${DEV_NAV_ONLINE_USERS} ${onlineCount} 人`}
              title={`${DEV_NAV_ONLINE_USERS} ${onlineCount} 人`}
              aria-expanded={presenceOpen}
              onClick={() => setPresenceOpen((open) => !open)}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
              <span className="hidden sm:inline">{onlineCount}</span>
            </button>
            {presenceOpen && presenceSnapshot && (
              <div className="absolute left-0 top-7 z-50 w-64 overflow-hidden rounded border border-localapp-dev-border bg-localapp-dev-background shadow-lg">
                <div className="border-b border-localapp-dev-border px-3 py-2 text-xs font-medium">{DEV_NAV_ONLINE_USERS}</div>
                <div className="max-h-64 overflow-y-auto p-1">
                  {presenceSnapshot.authenticatedUsers.map((onlineUser) => (
                    <div key={onlineUser.id} className="flex items-center gap-2 rounded px-2 py-2 text-sm">
                      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-localapp-dev-muted text-[11px] font-semibold">{(onlineUser.displayName || onlineUser.name).charAt(0).toUpperCase()}</span>
                      <span className="min-w-0"><span className="block truncate font-medium">{onlineUser.displayName || onlineUser.name}</span>{onlineUser.displayName && <span className="block truncate text-xs text-localapp-dev-muted-foreground">@{onlineUser.name}</span>}</span>
                    </div>
                  ))}
                  {presenceSnapshot.anonymousCount > 0 && <div className="px-2 py-2 text-sm text-localapp-dev-muted-foreground">匿名访客 {presenceSnapshot.anonymousCount} 人</div>}
                </div>
              </div>
            )}
            </div>
          )}
          {editSession && (
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                aria-label="保存"
                title={`保存 (${DEV_NAV_SAVE})`}
                disabled={editBusy || !editSession.canSave}
                onClick={() => { void editSession.onSave(); }}
                className={`${DEV_ICON_BUTTON} disabled:opacity-40`}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8A2 2 0 0 1 21 8.8V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" />
                  <path d="M17 21v-7H7v7" />
                  <path d="M7 3v5h8" />
                </svg>
              </button>
              <button
                type="button"
                aria-label="撤销"
                title={`撤销 (${DEV_NAV_UNDO})`}
                disabled={editBusy || !editSession.canUndo}
                onClick={() => { void editSession.onUndo(); }}
                className={`${DEV_ICON_BUTTON} disabled:opacity-40`}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 14 4 9l5-5" />
                  <path d="M4 9h10a6 6 0 0 1 0 12h-1" />
                </svg>
              </button>
              <button
                type="button"
                aria-label="重做"
                title={`重做 (${DEV_NAV_REDO})`}
                disabled={editBusy || !editSession.canRedo}
                onClick={() => { void editSession.onRedo(); }}
                className={`${DEV_ICON_BUTTON} disabled:opacity-40`}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m15 14 5-5-5-5" />
                  <path d="M20 9H10a6 6 0 0 0 0 12h1" />
                </svg>
              </button>
            </div>
          )}
        </div>
        <div className={navModel.rightClass}>
          <button
            type="button"
            onClick={onToggleAi}
            className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
              aiOpen ? DEV_BUTTON_ACTIVE : DEV_BUTTON_IDLE
            }`}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z" />
            </svg>
            AI
          </button>
          <DevShellUserEntry user={user} userStateClass={navModel.userStateClass} />
        </div>
      </div>
      <div className="h-[3px] bg-gradient-to-r from-localapp-dev-stripe-from via-localapp-dev-stripe-via to-localapp-dev-stripe-to" />
    </nav>
  );
}

function DevShellUserEntry({
  user,
  userStateClass,
}: {
  user: DevContext["user"];
  userStateClass: string;
}) {
  if (!user) {
    return (
      <div className="flex items-center gap-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-localapp-dev-muted text-[10px] font-bold text-localapp-dev-muted-foreground">
          ?
        </span>
        <span data-localapp-user-label className={`${userStateClass} hidden md:inline`}>未登录</span>
      </div>
    );
  }

  return (
    <div className="flex shrink-0 items-center gap-2">
      {user.avatarUrl ? (
        <img src={user.avatarUrl} alt="" className="h-6 w-6 shrink-0 rounded-full object-cover" />
      ) : (
        <div className="flex h-6 w-6 items-center justify-center rounded-full bg-localapp-dev-accent text-[10px] font-bold text-localapp-dev-accent-foreground">
          {getUserInitial(user)}
        </div>
      )}
      <span data-localapp-user-label className={`${userStateClass} hidden md:inline`}>{getUserDisplayName(user)}</span>
    </div>
  );
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function toDateInputValue(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function toTimeInputValue(date: Date): string {
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function toDevIsoDateTime(dateValue: string, timeValue: string): string {
  const localDate = new Date(`${dateValue}T${timeValue || "00:00"}`);
  if (Number.isNaN(localDate.getTime())) {
    throw new Error("请选择有效的日期和时间");
  }
  return localDate.toISOString();
}

function formatDevDateTime(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${toDateInputValue(date)} ${toTimeInputValue(date)}`;
}

async function readDevContextError(res: Response) {
  let serverError = "";
  try {
    const body = await res.clone().json();
    if (typeof body?.error === "string") serverError = ` ${body.error}`;
  } catch {}
  return `Dev context request failed: ${res.status}.${serverError} ${DEV_CONTEXT_SETUP_HINT}`;
}

async function readDevJson<T = any>(res: Response, label: string): Promise<T> {
  try {
    return await res.json();
  } catch {
    throw new Error(`${label} did not return JSON. Expected JSON from the local mini-server. ${DEV_CONTEXT_SETUP_HINT}`);
  }
}

export async function requestDevContext(timeoutMs = 8_000): Promise<DevContext> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | null = null;
  const deadline = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      reject(new Error(`Dev context request timed out after ${timeoutMs}ms. ${DEV_CONTEXT_SETUP_HINT}`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([
      fetch("/api/dev/context", { signal: controller.signal }).then(async (res) => {
        if (!res.ok) throw new Error(await readDevContextError(res));
        const body = await readDevJson<{ success?: boolean; data?: DevContext; error?: string }>(res, "Dev context request");
        if (!body.success || !body.data) throw new Error(body.error || `Dev context request failed. ${DEV_CONTEXT_SETUP_HINT}`);
        return body.data;
      }),
      deadline,
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

type DevIssueResponseBody<T> = {
  success?: boolean;
  data?: T;
  pinned?: DevIssue[];
  meta?: { open?: unknown };
  error?: string;
  code?: string;
};

async function readDevIssueResponseBody<T>(response: Response): Promise<DevIssueResponseBody<T>> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new Error("Issue 服务暂不可用");
  }
  let body: DevIssueResponseBody<T>;
  try {
    body = await response.json();
  } catch {
    throw new Error("Issue 服务暂不可用");
  }
  if (!response.ok || !body.success) {
    if (response.status === 409 && body.code === "issue_content_conflict") throw new Error("内容已被其他用户更新，当前草稿已保留");
    throw new Error(body.error || "Issue 服务暂不可用");
  }
  return body;
}

async function requestDevIssueBody<T>(input: RequestInfo | URL, init: RequestInit = {}, timeoutMs = DEV_ISSUE_REQUEST_TIMEOUT_MS): Promise<DevIssueResponseBody<T>> {
  const controller = new AbortController();
  let timedOut = false;
  const forwardAbort = () => controller.abort(init.signal?.reason);
  if (init.signal?.aborted) forwardAbort();
  else init.signal?.addEventListener("abort", forwardAbort, { once: true });
  const timeout = window.setTimeout(() => {
    timedOut = true;
    controller.abort(new DOMException("Issue request timed out", "TimeoutError"));
  }, timeoutMs);
  try {
    return await readDevIssueResponseBody<T>(await fetch(input, { ...init, signal: controller.signal }));
  } catch (error) {
    if (timedOut) throw new Error("Issue 服务暂不可用");
    throw error;
  } finally {
    window.clearTimeout(timeout);
    init.signal?.removeEventListener("abort", forwardAbort);
  }
}

async function requestDevIssue<T>(input: RequestInfo | URL, init: RequestInit = {}, timeoutMs = DEV_ISSUE_REQUEST_TIMEOUT_MS): Promise<T> {
  return (await requestDevIssueBody<T>(input, init, timeoutMs)).data as T;
}

const DEV_ISSUE_CATALOG_RETRY_DELAY_MS = 300;
function waitForDevIssueCatalogRetry(signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(finish, DEV_ISSUE_CATALOG_RETRY_DELAY_MS);
    function finish() { signal?.removeEventListener("abort", abort); resolve(); }
    function abort() { window.clearTimeout(timer); reject(signal?.reason ?? new DOMException("Aborted", "AbortError")); }
    signal?.addEventListener("abort", abort, { once: true });
  });
}
async function requestDevIssueCatalogWithRetry<T>(request: (signal?: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T> {
  try { return await request(signal); }
  catch (error) {
    if (signal?.aborted || (error instanceof Error && error.name === "AbortError")) throw error;
    await waitForDevIssueCatalogRetry(signal);
    return request(signal);
  }
}

function normalizeDevIssueListQuery(current: DevIssueListQuery, updates: Partial<DevIssueListQuery>): DevIssueListQuery {
  const next = { ...current, ...updates };
  for (const key of ["q", "searchIn", "author", "participant", "assignee", "milestone"] as const) {
    next[key] = next[key].trim();
  }
  if (next.status === "open") next.reason = "";
  const changesQuery = Object.keys(updates).some((key) => (
    key !== "offset"
    && current[key as keyof DevIssueListQuery] !== next[key as keyof DevIssueListQuery]
  ));
  if (changesQuery) next.offset = 0;
  return next;
}

function parseDevIssueSearchInput(
  input: string,
  context: { currentUserId?: string; labels: readonly Pick<DevIssueLabelDefinition, "id" | "name">[]; milestones?: readonly Pick<DevIssueMilestoneDefinition, "id" | "title">[] },
): Partial<DevIssueListQuery> & { q: string; offset: 0 } {
  const tokens: Array<{ value: string; quotesClosed: boolean }> = [];
  let value = "";
  let quoted = false;
  const flush = () => {
    if (value) tokens.push({ value, quotesClosed: !quoted });
    value = "";
    quoted = false;
  };
  for (const character of input.trim()) {
    if (/\s/.test(character) && !quoted) flush();
    else {
      value += character;
      if (character === '"') quoted = !quoted;
    }
  }
  flush();

  const updates: Partial<DevIssueListQuery> & { q: string; offset: 0 } = { q: "", offset: 0 };
  const freeText: string[] = [];
  const searchScopes = new Set<"title" | "body" | "comments">();
  for (const token of tokens) {
    const separator = token.value.indexOf(":");
    if (separator <= 0 || !token.quotesClosed) {
      freeText.push(token.value);
      continue;
    }
    const key = token.value.slice(0, separator).toLowerCase();
    const encodedValue = token.value.slice(separator + 1);
    const rawValue = encodedValue.startsWith('"') || encodedValue.endsWith('"')
      ? encodedValue.startsWith('"') && encodedValue.endsWith('"') && encodedValue.length >= 2 ? encodedValue.slice(1, -1) : null
      : encodedValue || null;
    let handled = false;
    if (rawValue !== null && key === "in") {
      const requested = rawValue.toLowerCase().split(",");
      if (requested.length > 0 && requested.every((scope) => ["title", "body", "comments"].includes(scope))) {
        for (const scope of requested) searchScopes.add(scope as "title" | "body" | "comments");
        handled = true;
      }
    } else if (rawValue !== null && key === "is" && /^(open|closed)$/i.test(rawValue)) {
      updates.status = rawValue.toLowerCase() as DevIssueListQuery["status"];
      handled = true;
    } else if (rawValue !== null && key === "is" && /^(locked|unlocked)$/i.test(rawValue)) {
      updates.locked = rawValue.toLowerCase() as DevIssueListQuery["locked"];
      handled = true;
    } else if (rawValue !== null && key === "is" && rawValue.toLowerCase() === "subscribed" && context.currentUserId) {
      updates.subscribed = true;
      handled = true;
    } else if (rawValue !== null && key === "label") {
      const label = context.labels.find((candidate) => candidate.id.toLowerCase() === rawValue.toLowerCase() || candidate.name.toLowerCase() === rawValue.toLowerCase());
      if (label) {
        updates.label = label.id;
        handled = true;
      }
    } else if (rawValue !== null && key === "type" && /^(task|bug|feature)$/i.test(rawValue)) {
      updates.issueType = rawValue.toLowerCase() as DevIssueType;
      handled = true;
    } else if (rawValue !== null && key === "milestone") {
      const milestone = (context.milestones ?? []).find((candidate) => String(candidate.id) === rawValue || candidate.title.toLowerCase() === rawValue.toLowerCase());
      if (milestone) {
        updates.milestone = String(milestone.id);
        handled = true;
      }
    } else if (rawValue !== null && key === "reason" && /^(completed|not[ _]planned)$/i.test(rawValue)) {
      updates.status = "closed";
      updates.reason = rawValue.toLowerCase() === "completed" ? "completed" : "not_planned";
      handled = true;
    } else if (rawValue !== null && key === "mentions" && rawValue.toLowerCase() === "@me" && context.currentUserId) {
      updates.mentioned = true;
      handled = true;
    } else if (rawValue !== null && key === "no" && /^(assignee|label|milestone)$/i.test(rawValue)) {
      updates[rawValue.toLowerCase() as "assignee" | "label" | "milestone"] = "none";
      handled = true;
    } else if (rawValue !== null && (key === "author" || key === "involves" || key === "assignee")) {
      const identity = rawValue.toLowerCase() === "@me" ? context.currentUserId : rawValue.replace(/^@/, "");
      if (identity) {
        updates[key === "author" ? "author" : key === "assignee" ? "assignee" : "participant"] = identity;
        handled = true;
      }
    } else if (rawValue !== null && key === "sort") {
      const match = /^(activity|created|updated|comments)-(asc|desc)$/i.exec(rawValue);
      if (match) {
        updates.sort = match[1].toLowerCase() as DevIssueListQuery["sort"];
        updates.direction = match[2].toLowerCase() as DevIssueListQuery["direction"];
        handled = true;
      }
    }
    if (!handled) freeText.push(token.value);
  }
  updates.q = freeText.join(" ");
  if (updates.q && searchScopes.size > 0) updates.searchIn = ["title", "body", "comments"].filter((scope) => searchScopes.has(scope as "title" | "body" | "comments")).join(",");
  return updates;
}

function formatDevIssueSearchInput(q: string, searchIn: string): string {
  return [q, q && searchIn ? `in:${searchIn}` : ""].filter(Boolean).join(" ");
}

interface DevIssueSearchSuggestion {
  id: string;
  value: string;
  label: string;
  description: string;
}

interface DevIssueSearchSuggestionResult {
  start: number;
  end: number;
  items: DevIssueSearchSuggestion[];
}

export function getDevIssueSearchSuggestions(
  input: string,
  cursor: number,
  context: { currentUserId?: string; labels: readonly Pick<DevIssueLabelDefinition, "id" | "name">[]; milestones?: readonly Pick<DevIssueMilestoneDefinition, "id" | "title">[]; users: readonly DevUserBasic[] },
): DevIssueSearchSuggestionResult {
  const end = Math.max(0, Math.min(cursor, input.length));
  let start = 0;
  let quoted = false;
  for (let index = 0; index < end; index += 1) {
    if (input[index] === '"') quoted = !quoted;
    else if (/\s/.test(input[index]) && !quoted) start = index + 1;
  }
  const token = input.slice(start, end);
  const separator = token.indexOf(":");
  const keys = [
    ["is:", "状态", "筛选 Open、Closed、Locked 或 Unlocked Issue"],
    ["in:", "范围", "限定搜索标题、正文或评论"],
    ["label:", "标签", "筛选带指定标签的 Issue"],
    ["type:", "类型", "筛选任务、缺陷或功能 Issue"],
    ["author:", "作者", "筛选指定用户创建的 Issue"],
    ["assignee:", "负责人", "筛选分配给指定用户的 Issue"],
    ["involves:", "参与者", "筛选指定用户参与的 Issue"],
    ["milestone:", "里程碑", "筛选指定里程碑内的 Issue"],
    ["reason:", "关闭原因", "筛选已完成或不计划处理的 Closed Issue"],
    ["mentions:", "提及", "筛选提及当前用户的 Issue"],
    ["no:", "缺失项", "筛选缺少元数据的 Issue"],
    ["sort:", "排序", "按活动、创建、更新或评论排序"],
  ] as const;
  if (separator < 0) {
    return { start, end, items: keys.filter(([value]) => value.startsWith(token.toLowerCase()) && (value !== "mentions:" || Boolean(context.currentUserId))).map(([value, label, description]) => ({ id: `dev-key-${value.slice(0, -1)}`, value, label, description })) };
  }

  const key = token.slice(0, separator).toLowerCase();
  const partial = token.slice(separator + 1).replace(/^"/, "").toLowerCase();
  const items: DevIssueSearchSuggestion[] = [];
  const add = (value: string, label: string, description: string) => {
    if (!value.toLowerCase().startsWith(partial) && (key === "is" || !label.toLowerCase().includes(partial))) return;
    const encoded = /\s/.test(value) ? `"${value.replaceAll('"', '\\"')}"` : value;
    items.push({ id: `dev-${key}-${encodeURIComponent(value.toLowerCase())}`, value: `${key}:${encoded}`, label, description });
  };
  if (key === "is") {
    add("open", "Open", "仅显示待处理 Issue");
    add("closed", "Closed", "仅显示已关闭 Issue");
    add("locked", "Locked", "仅显示已锁定对话");
    add("unlocked", "Unlocked", "仅显示未锁定对话");
    if (context.currentUserId) add("subscribed", "Subscribed", "仅显示当前用户关注的 Issue");
  } else if (key === "in") {
    add("title", "标题", "仅搜索 Issue 标题");
    add("body", "正文", "仅搜索 Issue 首帖正文");
    add("comments", "评论", "仅搜索未删除评论");
  } else if (key === "label") {
    for (const label of context.labels) add(label.name, label.name, label.id);
  } else if (key === "type") {
    add("task", "任务", "Task Issue");
    add("bug", "缺陷", "Bug Issue");
    add("feature", "功能", "Feature Issue");
  } else if (key === "milestone") {
    for (const milestone of context.milestones ?? []) add(milestone.title, milestone.title, `#${milestone.id}`);
  } else if (key === "reason") {
    add("completed", "已完成", "仅显示以已完成关闭的 Issue");
    add("not planned", "不计划处理", "仅显示以不计划处理关闭的 Issue");
  } else if (key === "mentions") {
    if (context.currentUserId) add("@me", "@me", "提及当前用户");
  } else if (key === "no") {
    add("assignee", "无负责人", "仅显示尚未分配负责人的 Issue");
    add("label", "无标签", "仅显示尚未添加标签的 Issue");
    add("milestone", "无里程碑", "仅显示尚未设置里程碑的 Issue");
  } else if (key === "author" || key === "involves" || key === "assignee") {
    if (context.currentUserId) add("@me", "@me", "当前用户");
    const users = new Map(context.users.map((candidate) => [candidate.id.toLowerCase(), candidate]));
    for (const candidate of users.values()) add(candidate.id, candidate.displayName || candidate.name || candidate.id, `@${candidate.id}`);
  } else if (key === "sort") {
    for (const [value, label] of [["activity-desc", "最近活动"], ["activity-asc", "最早活动"], ["created-desc", "最新创建"], ["created-asc", "最早创建"], ["updated-desc", "最近更新"], ["updated-asc", "最早更新"], ["comments-desc", "评论最多"], ["comments-asc", "评论最少"]] as const) add(value, label, value.endsWith("-desc") ? "降序" : "升序");
  }
  return { start, end, items: items.slice(0, 8) };
}

export function applyDevIssueSearchSuggestion(
  input: string,
  range: Pick<DevIssueSearchSuggestionResult, "start" | "end">,
  suggestion: string,
): { value: string; cursor: number } {
  const suffix = input.slice(range.end);
  const completesValue = !suggestion.endsWith(":");
  const needsSpace = completesValue && (suffix.length === 0 || !/^\s/.test(suffix));
  const value = input.slice(0, range.start) + suggestion + (needsSpace ? " " : "") + suffix;
  const cursor = range.start + suggestion.length + (completesValue && (needsSpace || /^\s/.test(suffix)) ? 1 : 0);
  return { value, cursor: Math.min(cursor, value.length) };
}

function readDevIssueListMeta(value: unknown, query: DevIssueListQuery): DevIssueListMeta {
  const meta = value && typeof value === "object" ? value as Partial<DevIssueListMeta> : {};
  const count = (key: "total" | "open" | "closed") => (
    typeof meta[key] === "number" && Number.isFinite(meta[key]) && meta[key]! >= 0 ? meta[key]! : 0
  );
  return {
    total: count("total"),
    open: count("open"),
    closed: count("closed"),
    limit: typeof meta.limit === "number" && meta.limit > 0 ? meta.limit : query.limit,
    offset: typeof meta.offset === "number" && meta.offset >= 0 ? meta.offset : query.offset,
  };
}

function isDevIssueListAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function createDevIssueDraftId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `issue-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function createDevIssueDraftPrefix(pagePath: string, userId: string): string {
  return `localapp:issues:draft:v1:${encodeURIComponent(pagePath)}:${encodeURIComponent(userId)}`;
}

function readDevIssueSessionDraft(key?: string): string {
  if (!key) return "";
  try { return sessionStorage.getItem(key) ?? ""; } catch { return ""; }
}

function writeDevIssueSessionDraft(key: string | undefined, value: string) {
  if (!key) return;
  try {
    if (value) sessionStorage.setItem(key, value);
    else sessionStorage.removeItem(key);
  } catch {}
}

interface DevPersistedIssueAttachmentDraft { draftId: string; attachments: DevIssueAttachment[]; }
function devIssueAttachmentDraftKey(persistenceKey?: string): string | undefined { return persistenceKey ? `${persistenceKey}:attachments` : undefined; }

function clearDevIssueAttachmentDraft(persistenceKey?: string) {
  const key = devIssueAttachmentDraftKey(persistenceKey);
  if (!key || typeof window === "undefined") return;
  try { window.sessionStorage.removeItem(key); } catch { /* Ignore unavailable storage. */ }
}
function isPersistedDevIssueAttachment(value: unknown, pagePath: string): value is DevIssueAttachment {
  if (!value || typeof value !== "object") return false;
  const attachment = value as Partial<DevIssueAttachment>;
  const validUrl = typeof attachment.url === "string" && attachment.url.startsWith("/api/issues/attachments/")
    && new URL(attachment.url, window.location.origin).searchParams.get("pagePath") === pagePath;
  return typeof attachment.id === "string" && attachment.id.length > 0 && validUrl
    && attachment.issue_id === null && attachment.comment_id === null
    && typeof attachment.draft_id === "string" && attachment.draft_id.length > 0
    && typeof attachment.uploader_id === "string"
    && typeof attachment.file_name === "string" && attachment.file_name.length > 0
    && typeof attachment.mime_type === "string"
    && typeof attachment.size_bytes === "number" && Number.isFinite(attachment.size_bytes) && attachment.size_bytes > 0 && attachment.size_bytes <= DEV_ISSUE_MAX_ATTACHMENT_BYTES
    && typeof attachment.created_at === "string";
}
function readDevIssueAttachmentDraft(persistenceKey: string | undefined, pagePath: string): DevPersistedIssueAttachmentDraft | null {
  const key = devIssueAttachmentDraftKey(persistenceKey);
  if (!key) return null;
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<DevPersistedIssueAttachmentDraft>;
    if (typeof parsed.draftId !== "string" || !parsed.draftId || !Array.isArray(parsed.attachments) || parsed.attachments.length > 20 || parsed.attachments.some((attachment) => !isPersistedDevIssueAttachment(attachment, pagePath) || attachment.draft_id !== parsed.draftId)) {
      sessionStorage.removeItem(key);
      return null;
    }
    return { draftId: parsed.draftId, attachments: parsed.attachments };
  } catch {
    try { sessionStorage.removeItem(key); } catch {}
    return null;
  }
}
function releaseDevIssueAttachment(pagePath: string, attachment: DevIssueAttachment) {
  const query = new URLSearchParams({ pagePath, draftId: attachment.draft_id });
  void requestDevIssue(`/api/issues/attachments/${encodeURIComponent(attachment.id)}?${query}`, {
    method: "DELETE",
    credentials: "include",
    keepalive: true,
  }).catch(() => undefined);
}
function discardDevIssueAttachmentDraft(pagePath: string, persistenceKey?: string) {
  const persisted = readDevIssueAttachmentDraft(persistenceKey, pagePath);
  clearDevIssueAttachmentDraft(persistenceKey);
  persisted?.attachments.forEach((attachment) => releaseDevIssueAttachment(pagePath, attachment));
}
function writeDevIssueAttachmentDraft(persistenceKey: string | undefined, draftId: string, attachments: DevPendingIssueAttachment[]) {
  const key = devIssueAttachmentDraftKey(persistenceKey);
  if (!key) return;
  const uploaded = attachments.flatMap((item) => item.status === "uploaded" && item.attachment ? [item.attachment] : []);
  try {
    if (uploaded.length > 0) sessionStorage.setItem(key, JSON.stringify({ draftId, attachments: uploaded } satisfies DevPersistedIssueAttachmentDraft));
    else sessionStorage.removeItem(key);
  } catch {}
}

function readDevIssueEditMeta(key: string): { title: string; issueType: DevIssueType; expectedUpdatedAt: string } | null {
  try {
    const value = JSON.parse(window.sessionStorage.getItem(key) ?? "null") as { title?: unknown; issueType?: unknown; label?: unknown; expectedUpdatedAt?: unknown } | null;
    const issueType = value?.issueType ?? value?.label;
    return value && typeof value.title === "string" && (issueType === "task" || issueType === "bug" || issueType === "feature") && typeof value.expectedUpdatedAt === "string" ? { title: value.title, issueType, expectedUpdatedAt: value.expectedUpdatedAt } : null;
  } catch { return null; }
}

function writeDevIssueEditMeta(key: string, value: { title: string; issueType: DevIssueType; expectedUpdatedAt: string } | null) {
  try { value ? window.sessionStorage.setItem(key, JSON.stringify(value)) : window.sessionStorage.removeItem(key); } catch { /* Editing remains usable without session storage. */ }
}

function readDevIssueCreateDraft(key: string): { title: string; issueType: DevIssueType; labelIds: string[]; assigneeIds: string[]; milestoneId: number | null } {
  try {
    const value = JSON.parse(sessionStorage.getItem(key) ?? "null") as { title?: unknown; issueType?: unknown; label?: unknown; labelIds?: unknown; assigneeIds?: unknown; milestoneId?: unknown } | null;
    const legacyType = value?.issueType ?? value?.label;
    const issueType = legacyType === "bug" || legacyType === "feature" || legacyType === "task" ? legacyType : "task";
    return { title: typeof value?.title === "string" ? value.title : "", issueType, labelIds: Array.isArray(value?.labelIds) ? value.labelIds.filter((id): id is string => typeof id === "string" && id !== "bug" && id !== "feature") : [], assigneeIds: Array.isArray(value?.assigneeIds) ? value.assigneeIds.filter((id): id is string => typeof id === "string") : [], milestoneId: typeof value?.milestoneId === "number" && Number.isSafeInteger(value?.milestoneId) && value.milestoneId > 0 ? value.milestoneId : null };
  } catch { return { title: "", issueType: "task", labelIds: [], assigneeIds: [], milestoneId: null }; }
}

function writeDevIssueCreateDraft(key: string, title: string, issueType: DevIssueType, labelIds: string[] = [], assigneeIds: string[] = [], milestoneId: number | null = null) {
  try {
    if (title || issueType !== "task" || labelIds.length > 0 || assigneeIds.length > 0 || milestoneId !== null) sessionStorage.setItem(key, JSON.stringify({ title, issueType, labelIds, assigneeIds, milestoneId }));
    else sessionStorage.removeItem(key);
  } catch {}
}

function hasPersistedDevIssueCreateContent(key: string): boolean {
  const draft = readDevIssueCreateDraft(key);
  try { return Boolean(draft.title || draft.issueType !== "task" || draft.labelIds.length || draft.assigneeIds.length || draft.milestoneId !== null || sessionStorage.getItem(`${key}:body`) || sessionStorage.getItem(`${key}:body:attachments`)); }
  catch { return false; }
}

function devCatalogFailureMessage(labelError: boolean, userError: boolean, milestoneError: boolean): string {
  const count = Number(labelError) + Number(userError) + Number(milestoneError);
  if (count > 1) return "元数据目录加载失败，正在显示可用的本地信息";
  if (labelError) return "标签目录暂不可用";
  if (userError) return "负责人目录加载失败，正在显示已知用户";
  return "里程碑目录加载失败，正在显示已知里程碑";
}

function devCatalogRetryLabel(labelError: boolean, userError: boolean, milestoneError: boolean): string {
  const count = Number(labelError) + Number(userError) + Number(milestoneError);
  if (count > 1) return "重试元数据目录";
  if (labelError) return "重试标签目录";
  if (userError) return "重试负责人目录";
  return "重试里程碑目录";
}

function isDevIssueSafeImage(mimeType: string): boolean {
  return ["image/png", "image/jpeg", "image/gif", "image/webp"].includes(mimeType.toLowerCase());
}

function formatDevIssueFileSize(sizeBytes: number): string {
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  if (sizeBytes < 1024 * 1024) return `${Math.ceil(sizeBytes / 1024)} KB`;
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

function payloadObject(payload: unknown): Record<string, unknown> {
  return payload && typeof payload === "object" && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : {};
}

function downloadFromDevShell(payload: unknown) {
  const body = payloadObject(payload);
  const filename = typeof body.filename === "string" && body.filename.trim() ? body.filename : "download";
  const mimeType = typeof body.mimeType === "string" ? body.mimeType : "application/octet-stream";
  const data = body.data;
  const blob = data instanceof Blob
    ? data
    : data instanceof ArrayBuffer
      ? new Blob([data], { type: mimeType })
      : new Blob([typeof data === "string" ? data : JSON.stringify(data ?? "")], { type: mimeType });
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.rel = "noopener";
    document.body.appendChild(link);
    link.click();
    link.remove();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

function focusBusyDevIssueAttachmentQueue(): boolean {
  const queue = document.querySelector<HTMLElement>('[data-localapp-issues-workspace] [data-localapp-issue-attachment-queue][aria-busy="true"]');
  if (!queue) return false;
  queue.focus();
  queue.scrollIntoView?.({ block: "nearest" });
  return true;
}

function restoreDevIssueWorkspaceHistoryUrl(source: URL, issueId: number | null, issueNumber: number | null): URL {
  const workspaceUrl = updateDevIssuesWorkspaceUrl(source, true);
  if (issueId !== null) return updateDevIssueDeepLinkUrl(workspaceUrl, issueId);
  if (issueNumber !== null) return updateDevIssueNumberDeepLinkUrl(workspaceUrl, issueNumber);
  return workspaceUrl;
}

export function DevShell({ children }: { children: React.ReactNode }) {
  const [aiOpen, setAiOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const toolsRef = useRef(new Map<string, ToolEntry>());
  const systemHintRef = useRef("");
  const pendingToolCalls = useRef(new Map<string, { resolve: (result: unknown, isError?: boolean) => void; timeout: ReturnType<typeof setTimeout> }>());
  const devMenuRef = useRef<HTMLDivElement | null>(null);
  const [toolCount, setToolCount] = useState(SYSTEM_TOOLS.length);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [devMenuOpen, setDevMenuOpen] = useState(false);
  const [devToolkitOpen, setDevToolkitOpen] = useState(false);
  const [devContext, setDevContext] = useState<DevContext | null>(null);
  const [devContextError, setDevContextError] = useState<string | null>(null);
  const [devContextRetryKey, setDevContextRetryKey] = useState(0);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(null);
  const [editSession, setEditSession] = useState<PlatformEditSession | null>(null);
  const [presenceSnapshot, setPresenceSnapshot] = useState<DevShellNavProps["presenceSnapshot"]>(null);
  const [selectedIssueId, setSelectedIssueId] = useState<number | null>(() => typeof window === "undefined" ? null : readDevIssueDeepLinkId(new URL(window.location.href)));
  const [selectedIssueNumber, setSelectedIssueNumber] = useState<number | null>(() => typeof window === "undefined" ? null : readDevIssueDeepLinkNumber(new URL(window.location.href)));
  const [issuesOpen, setIssuesOpen] = useState(() => readDevIssuesWorkspaceOpen(new URL(window.location.href)));
  const selectedIssueIdRef = useRef(selectedIssueId);
  const selectedIssueNumberRef = useRef(selectedIssueNumber);
  selectedIssueIdRef.current = selectedIssueId;
  selectedIssueNumberRef.current = selectedIssueNumber;
  const [openIssueCount, setOpenIssueCount] = useState<number | null>(null);
  const [issuesRevision, setIssuesRevision] = useState(0);
  const [platformUsers, setPlatformUsers] = useState<DevUserBasic[]>([]);
  const editSessionRef = useRef<PlatformEditSession | null>(null);
  const navModel = deriveDevShellNavModel();

  const navigateToIssue = useCallback((issueId: number | null, mode: "push" | "replace" = "push") => {
    const url = updateDevIssueDeepLinkUrl(new URL(window.location.href), issueId);
    if (mode === "replace") window.history.replaceState(window.history.state, "", url);
    else window.history.pushState(window.history.state, "", url);
    setSelectedIssueId(issueId);
    setSelectedIssueNumber(null);
    setIssuesOpen((current) => issueId !== null || current);
  }, []);

  const navigateToIssueNumber = useCallback((issueNumber: number) => {
    const url = updateDevIssueNumberDeepLinkUrl(new URL(window.location.href), issueNumber);
    window.history.pushState(window.history.state, "", url);
    setSelectedIssueId(null);
    setSelectedIssueNumber(issueNumber);
    setIssuesOpen(true);
  }, []);

  const closeIssues = useCallback(() => {
    if (focusBusyDevIssueAttachmentQueue()) return;
    const url = updateDevIssuesWorkspaceUrl(new URL(window.location.href), false);
    window.history.replaceState(window.history.state, "", url);
    setSelectedIssueId(null);
    setSelectedIssueNumber(null);
    setIssuesOpen(false);
  }, []);

  const openIssues = useCallback(() => {
    const url = updateDevIssuesWorkspaceUrl(new URL(window.location.href), true);
    window.history.pushState(window.history.state, "", url);
    setIssuesOpen(true);
  }, []);

  useEffect(() => {
    const syncIssueNavigation = () => {
      const targetUrl = new URL(window.location.href);
      const nextOpen = readDevIssuesWorkspaceOpen(targetUrl);
      if (!nextOpen && focusBusyDevIssueAttachmentQueue()) {
        const restoredUrl = restoreDevIssueWorkspaceHistoryUrl(targetUrl, selectedIssueIdRef.current, selectedIssueNumberRef.current);
        window.history.pushState(window.history.state, "", restoredUrl);
        return;
      }
      const issueId = readDevIssueDeepLinkId(targetUrl);
      const issueNumber = readDevIssueDeepLinkNumber(targetUrl);
      setSelectedIssueId(issueId);
      setSelectedIssueNumber(issueNumber);
      setIssuesOpen(nextOpen);
    };
    window.addEventListener("popstate", syncIssueNavigation);
    return () => window.removeEventListener("popstate", syncIssueNavigation);
  }, []);

  // Register system tools on first render
  if (toolsRef.current.size === 0) {
    for (const t of SYSTEM_TOOLS) {
      toolsRef.current.set(t.schema.name, t);
    }
  }

  useLayoutEffect(() => {
    const registerDevTools = (schemas: ToolSchema[], executeFns: Record<string, ExecuteFn>, systemHint?: string) => {
      // Clear only user tools, keep system tools.
      for (const key of Array.from(toolsRef.current.keys())) {
        if (!toolsRef.current.get(key)?.isSystem) toolsRef.current.delete(key);
      }
      for (const schema of schemas) {
        toolsRef.current.set(schema.name, { schema, execute: executeFns[schema.name] });
      }
      systemHintRef.current = systemHint || "";
      setToolCount(toolsRef.current.size);
    };
    setDevRegistry({ registerTools: registerDevTools });
    setPlatformToolRegistry({ registerTools: registerDevTools });
    setPlatformEditSessionRegistry({
      registerEditSession: (session) => {
        editSessionRef.current = session;
        setEditSession(session);

        return () => {
          if (editSessionRef.current !== session) return;
          editSessionRef.current = null;
          setEditSession(null);
        };
      },
    });

    return () => {
      setPlatformEditSessionRegistry(null);
      editSessionRef.current = null;
      setEditSession(null);
    };
  }, []);

  useEffect(() => {
    let active = true;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    const loadContext = () => requestDevContext()
      .then((context) => {
        if (active) {
          setDevContext(context);
          setDevContextError(null);
        }
      })
      .catch((e) => {
        if (!active) return;
        setDevContextError(e instanceof Error ? e.message : String(e));
        retryTimer = setTimeout(loadContext, 1_000);
      });
    void loadContext();
    return () => { active = false; if (retryTimer) clearTimeout(retryTimer); };
  }, [devContextRetryKey]);

  useEffect(() => {
    if (typeof EventSource === "undefined") return;
    let events: EventSource | null = null;
    let windowActive = true;
    const clientId = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const leaseBody = JSON.stringify({ clientId });
    const heartbeat = () => fetch("/api/presence/heartbeat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: leaseBody,
      credentials: "include",
      keepalive: true,
    }).catch(() => undefined);
    const leave = () => {
      const body = new Blob([leaseBody], { type: "application/json" });
      if (typeof navigator.sendBeacon === "function" && navigator.sendBeacon("/api/presence/leave", body)) return;
      void fetch("/api/presence/leave", { method: "POST", headers: { "content-type": "application/json" }, body: leaseBody, credentials: "include", keepalive: true }).catch(() => undefined);
    };
    function handlePresenceSnapshot(event: MessageEvent) {
      try {
        const parsed = JSON.parse(event.data);
        const snapshot = parsed?.data;
        if (Number.isFinite(snapshot?.count) && Number.isFinite(snapshot?.anonymousCount) && Array.isArray(snapshot?.authenticatedUsers)) {
          setPresenceSnapshot({ count: Math.max(0, Number(snapshot.count)), anonymousCount: Math.max(0, Number(snapshot.anonymousCount)), authenticatedUsers: snapshot.authenticatedUsers });
        }
      } catch {
        // Ignore malformed local presence events.
      }
    }
    const disconnect = () => { events?.close(); events = null; };
    const connect = () => {
      if (document.visibilityState === "hidden" || !windowActive) return;
      if (events) return;
      events = new EventSource(`/api/presence/events?clientId=${encodeURIComponent(clientId)}`);
      events.addEventListener("presence:snapshot", handlePresenceSnapshot);
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") { void heartbeat(); disconnect(); }
      else { void heartbeat(); connect(); }
    };
    const handleWindowBlur = () => { windowActive = false; void heartbeat(); disconnect(); };
    const handleWindowFocus = () => { windowActive = true; void heartbeat(); connect(); };
    const handlePageHide = () => { disconnect(); leave(); };
    void heartbeat();
    connect();
    const heartbeatTimer = window.setInterval(() => { void heartbeat(); }, 30_000);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("blur", handleWindowBlur);
    window.addEventListener("focus", handleWindowFocus);
    window.addEventListener("pagehide", handlePageHide);
    window.addEventListener("pageshow", handleWindowFocus);
    return () => {
      window.clearInterval(heartbeatTimer);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("blur", handleWindowBlur);
      window.removeEventListener("focus", handleWindowFocus);
      window.removeEventListener("pagehide", handlePageHide);
      window.removeEventListener("pageshow", handleWindowFocus);
      disconnect();
      leave();
    };
  }, []);

  useEffect(() => {
    if (!devContext) {
      setOpenIssueCount(null);
      return;
    }
    let active = true;
    const controller = new AbortController();
    const query = new URLSearchParams({ pagePath: getDevIssuePagePath(devContext), status: "open" });
    requestDevIssueBody<DevIssue[]>(`/api/issues?${query.toString()}`, { credentials: "include", signal: controller.signal })
      .then((body) => {
        const open = body.meta?.open;
        if (typeof open === "number" && Number.isFinite(open) && open >= 0) {
          if (active) setOpenIssueCount(open);
          return;
        }
        if (active) setOpenIssueCount(Array.isArray(body.data) ? body.data.length : 0);
      })
      .catch(() => undefined);
    return () => { active = false; controller.abort(); };
  }, [devContext, issuesRevision]);

  const respondToPlatformRequest = useCallback((id: string, ok: boolean, result?: unknown, error?: string) => {
    window.dispatchEvent(new MessageEvent("message", {
      data: { type: "localapp:platform_response", id, ok, ...(ok ? { result } : { error }) },
    }));
  }, []);

  const handlePlatformRequest = useCallback(async (message: PlatformRequestMessage) => {
    try {
      switch (message.capability) {
        case "getCurrentUser":
          respondToPlatformRequest(message.id, true, devContext?.user ?? null);
          break;
        case "getServerTime": {
          const res = await fetch("/api/time", { credentials: "include" });
          const body = await readDevJson(res, "Server time request");
          if (!res.ok || !body.success) throw new Error(body.error || `Server time request failed: ${res.status}`);
          respondToPlatformRequest(message.id, true, body.data);
          break;
        }
        case "copyText": {
          const payload = payloadObject(message.payload);
          const text = typeof payload.text === "string" ? payload.text : "";
          await navigator.clipboard.writeText(text);
          respondToPlatformRequest(message.id, true, { success: true });
          break;
        }
        case "downloadFile":
          downloadFromDevShell(message.payload);
          respondToPlatformRequest(message.id, true, { success: true });
          break;
        case "confirm": {
          const payload = payloadObject(message.payload);
          setConfirmDialog({
            id: message.id,
            title: typeof payload.title === "string" && payload.title.trim() ? payload.title : "确认操作",
            message: typeof payload.message === "string" ? payload.message : "",
            confirmText: typeof payload.confirmText === "string" && payload.confirmText.trim() ? payload.confirmText : "确认",
            cancelText: typeof payload.cancelText === "string" && payload.cancelText.trim() ? payload.cancelText : "取消",
            tone: payload.tone === "danger" ? "danger" : "default",
          });
          break;
        }
        case "openRoute": {
          const payload = payloadObject(message.payload);
          const href = typeof payload.href === "string" ? payload.href : "";
          if (!href) throw new Error("openRoute requires href");
          window.location.assign(href);
          respondToPlatformRequest(message.id, true, { success: true });
          break;
        }
        case "auth.login":
          setDevMenuOpen(false);
          setToolsOpen(false);
          setDevToolkitOpen(true);
          respondToPlatformRequest(message.id, true, { success: true });
          break;
        case "ai.open":
          setAiOpen(true);
          respondToPlatformRequest(message.id, true, { success: true });
          break;
        case "ai.close":
          setAiOpen(false);
          respondToPlatformRequest(message.id, true, { success: true });
          break;
        case "ai.toggle":
          setAiOpen((prev) => !prev);
          respondToPlatformRequest(message.id, true, { success: true });
          break;
        default:
          throw new Error(`Unknown platform capability: ${message.capability}`);
      }
    } catch (e) {
      respondToPlatformRequest(message.id, false, undefined, e instanceof Error ? e.message : String(e));
    }
  }, [devContext?.user, respondToPlatformRequest]);

  useEffect(() => {
    const onPlatformRequest = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (!isPlatformRequestMessage(detail)) return;
      event.preventDefault();
      void handlePlatformRequest(detail);
    };

    window.addEventListener("localapp:platform_request", onPlatformRequest);
    return () => window.removeEventListener("localapp:platform_request", onPlatformRequest);
  }, [handlePlatformRequest]);

  useEffect(() => {
    const onEditShortcut = (event: KeyboardEvent) => {
      const session = editSessionRef.current;
      if (!session || session.busy) return;
      const key = event.key.toLowerCase();
      const mod = event.ctrlKey || event.metaKey;
      if (!mod) return;

      if (key === "s" && session.canSave) {
        event.preventDefault();
        void session.onSave();
        return;
      }

      if (isEditableShortcutTarget(event.target)) return;

      if (key === "z" && event.shiftKey && session.canRedo) {
        event.preventDefault();
        void session.onRedo();
        return;
      }
      if (key === "z" && !event.shiftKey && session.canUndo) {
        event.preventDefault();
        void session.onUndo();
        return;
      }
      if (key === "y" && session.canRedo) {
        event.preventDefault();
        void session.onRedo();
      }
    };

    document.addEventListener("keydown", onEditShortcut);
    return () => document.removeEventListener("keydown", onEditShortcut);
  }, []);

  useEffect(() => {
    if (!devMenuOpen) return;

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDevMenuOpen(false);
    };
    const closeOnOutsideClick = (event: MouseEvent) => {
      const target = event.target;
      if (target instanceof Node && !devMenuRef.current?.contains(target)) {
        setDevMenuOpen(false);
      }
    };

    document.addEventListener("keydown", closeOnEscape);
    document.addEventListener("mousedown", closeOnOutsideClick);
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      document.removeEventListener("mousedown", closeOnOutsideClick);
    };
  }, [devMenuOpen]);

  const updateDevContext = useCallback(async (patch: Partial<DevContext>) => {
    setDevContextError(null);
    const res = await fetch("/api/dev/context", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const body = await readDevJson(res, "Dev context update");
    if (!res.ok) {
      throw new Error(body.error || await readDevContextError(res));
    }
    if (!body.success) {
      throw new Error(body.error || `Dev context update failed. ${DEV_CONTEXT_SETUP_HINT}`);
    }
    setDevContext(body.data);
    window.dispatchEvent(new CustomEvent("localapp:dev-context-changed", { detail: body.data }));
  }, []);

  const openToolsFromDevMenu = useCallback(() => {
    setDevMenuOpen(false);
    setToolsOpen(true);
    setDevToolkitOpen(false);
  }, []);

  const openDevToolkitFromDevMenu = useCallback(() => {
    setDevMenuOpen(false);
    setDevToolkitOpen(true);
    setToolsOpen(false);
  }, []);

  const agentSend = useCallback(async (text: string) => {
    setChatMessages((prev) => [...prev, { role: "user", content: text }]);
    setIsRunning(true);
    setAiError(null);

    const tools = Array.from(toolsRef.current.values()).map((t) => ({
      type: "function" as const,
      function: { name: t.schema.name, description: t.schema.description, parameters: t.schema.parameters },
    }));

    const systemPrompt = [
      "你是一个运行在 LocalApp 应用中的 AI 助手。",
      "当前运行在本地开发模式。",
      systemHintRef.current,
      "当用户的需求可以映射到工具操作时，必须调用工具执行。",
      "请用中文回复用户。",
    ].filter(Boolean).join("\n");

    const messages: Array<Record<string, unknown>> = [{ role: "user", content: text }];

    try {
      const res = await fetch("/api/llm/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "system", content: systemPrompt }, ...messages],
          ...(tools.length > 0 ? { tools } : {}),
        }),
      });

      if (!res.ok) throw new Error(`LLM 请求失败: ${res.status}`);

      const reader = res.body?.getReader();
      if (!reader) throw new Error("无响应体");

      const decoder = new TextDecoder();
      let assistantContent = "";
      let currentToolCalls: Array<{ id: string; name: string; args: string }> = [];
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6).trim();
          if (data === "[DONE]") continue;
          try {
            const parsed = JSON.parse(data);
            const delta = parsed.choices?.[0]?.delta;
            if (!delta) continue;
            if (delta.content) {
              assistantContent += delta.content;
              setChatMessages((prev) => {
                const last = prev[prev.length - 1];
                if (last?.role === "assistant") return [...prev.slice(0, -1), { ...last, content: assistantContent }];
                return [...prev, { role: "assistant", content: assistantContent, toolCalls: [] }];
              });
            }
            if (delta.tool_calls) {
              for (const tc of delta.tool_calls) {
                if (tc.id) {
                  currentToolCalls.push({ id: tc.id, name: tc.function?.name || "", args: tc.function?.arguments || "" });
                } else if (currentToolCalls.length > 0) {
                  const last = currentToolCalls[currentToolCalls.length - 1];
                  if (tc.function?.arguments) last.args += tc.function.arguments;
                  if (tc.function?.name) last.name = tc.function.name;
                }
              }
            }
          } catch {}
        }
      }

      // Ensure assistant message with tool calls
      const parsedToolCalls = currentToolCalls.map((tc) => {
        let args: Record<string, unknown> = {};
        try { args = JSON.parse(tc.args); } catch {}
        return { id: tc.id, name: tc.name, args, status: "running" as const };
      });
      setChatMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last?.role === "assistant") return [...prev.slice(0, -1), { ...last, toolCalls: parsedToolCalls }];
        return [...prev, { role: "assistant", content: assistantContent, toolCalls: parsedToolCalls }];
      });

      // Execute tool calls directly through the same-page registry.
      if (currentToolCalls.length > 0) {
        const results = await Promise.all(
          currentToolCalls.map(async (tc) => {
            let args: Record<string, unknown> = {};
            try { args = JSON.parse(tc.args); } catch {};
            const entry = toolsRef.current.get(tc.name);
            let result: unknown;
            let isError = false;
            try {
              if (entry) {
                result = await entry.execute(args);
              } else {
                result = `未知工具: ${tc.name}`;
                isError = true;
              }
            } catch (e) {
              result = e instanceof Error ? e.message : String(e);
              isError = true;
            }
            // Update tool call status
            setChatMessages((prev) =>
              prev.map((msg) => {
                if (msg.role !== "assistant" || !msg.toolCalls) return msg;
                return { ...msg, toolCalls: msg.toolCalls.map((t) => t.id === tc.id ? { ...t, result, isError, status: "completed" as const } : t) };
              })
            );
            return { id: tc.id, name: tc.name, result: String(result), isError };
          })
        );

        // Follow-up LLM call with tool results
        messages.push({ role: "assistant", content: assistantContent || "", tool_calls: currentToolCalls.map((tc) => ({ id: tc.id, type: "function", function: { name: tc.name, arguments: tc.args } })) });
        for (const r of results) messages.push({ role: "tool", content: JSON.stringify(r), tool_call_id: r.id });

        const followRes = await fetch("/api/llm/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: [{ role: "system", content: systemPrompt }, ...messages], tools }),
        });

        if (followRes.ok) {
          const followReader = followRes.body?.getReader();
          if (followReader) {
            let followContent = "";
            const followDecoder = new TextDecoder();
            let followBuffer = "";
            while (true) {
              const { done, value } = await followReader.read();
              if (done) break;
              followBuffer += followDecoder.decode(value, { stream: true });
              const lines = followBuffer.split("\n");
              followBuffer = lines.pop() || "";
              for (const line of lines) {
                if (!line.startsWith("data: ")) continue;
                const data = line.slice(6).trim();
                if (data === "[DONE]") continue;
                try {
                  const parsed = JSON.parse(data);
                  const delta = parsed.choices?.[0]?.delta;
                  if (delta?.content) {
                    followContent += delta.content;
                    setChatMessages((prev) => [...prev, { role: "assistant", content: followContent, toolCalls: [] }]);
                  }
                } catch {}
              }
            }
            if (!followContent) {
              setChatMessages((prev) => [...prev, { role: "assistant", content: "工具执行完成。", toolCalls: [] }]);
            }
          }
        }
      }
    } catch (e) {
      setAiError(e instanceof Error ? e.message : "未知错误");
    } finally {
      setIsRunning(false);
    }
  }, []);

  const resolveConfirmDialog = useCallback((confirmed: boolean) => {
    if (!confirmDialog) return;
    respondToPlatformRequest(confirmDialog.id, true, confirmed);
    setConfirmDialog(null);
  }, [confirmDialog, respondToPlatformRequest]);

  return (
    <div className="flex h-screen flex-col bg-background">
      {/* Dev navbar */}
      <div data-localapp-shell-nav-background inert={issuesOpen ? ("true" as unknown as boolean) : undefined} aria-hidden={issuesOpen ? true : undefined} className="shrink-0">
        <DevShellNav
          navModel={navModel}
          devMenuRef={devMenuRef}
          devMenuOpen={devMenuOpen}
          toolsOpen={toolsOpen}
          devToolkitOpen={devToolkitOpen}
          aiOpen={aiOpen}
          toolCount={toolCount}
          appTitle={getDevShellAppTitle(devContext)}
          user={devContext?.user ?? null}
          editSession={editSession}
          presenceSnapshot={presenceSnapshot}
          openIssueCount={openIssueCount}
          onToggleDevMenu={() => setDevMenuOpen((p) => !p)}
          onOpenTools={openToolsFromDevMenu}
          onOpenDevToolkit={openDevToolkitFromDevMenu}
          onOpenIssues={() => {
            setDevMenuOpen(false);
            openIssues();
          }}
          onToggleAi={() => {
            setDevMenuOpen(false);
            setAiOpen((p) => !p);
          }}
        />
      </div>

      {/* Content area */}
      <div className="relative flex-1 overflow-hidden">
        <div data-localapp-app-background inert={issuesOpen ? ("true" as unknown as boolean) : undefined} aria-hidden={issuesOpen ? true : undefined} className="absolute inset-0">
          <div className="h-full overflow-auto">{children}</div>
          <ToolsSidebar
            tools={toolsRef.current}
            open={toolsOpen}
            onClose={() => setToolsOpen(false)}
          />
          <DevToolkitSidebar
            context={devContext}
            error={devContextError}
            open={devToolkitOpen}
            platformUsers={platformUsers}
            onClose={() => setDevToolkitOpen(false)}
            onPlatformUsersChange={setPlatformUsers}
            onUpdateContext={updateDevContext}
          />
          <DevSidebar
            messages={chatMessages}
            isRunning={isRunning}
            error={aiError}
            onSend={agentSend}
            open={aiOpen}
            onClose={() => setAiOpen(false)}
          />
        </div>
        {devContext ? <DevIssuesWorkspace
          open={issuesOpen}
          pagePath={getDevIssuePagePath(devContext)}
          pageName={getDevShellAppTitle(devContext)}
          pageOwnerId={devContext.pageOwnerId ?? null}
          user={devContext?.user ?? null}
          recentUsers={devContext?.recentUsers ?? []}
          platformUsers={platformUsers}
          selectedIssueId={selectedIssueId}
          selectedIssueNumber={selectedIssueNumber}
          onIssueNavigate={navigateToIssue}
          onIssueNumberNavigate={navigateToIssueNumber}
          onClose={closeIssues}
          onIssuesChanged={() => setIssuesRevision((revision) => revision + 1)}
        /> : issuesOpen ? <div data-localapp-issues-layer className="absolute inset-0 z-50 flex bg-background">{devContextError
          ? <DevIssueContextError message={devContextError} onRetry={() => setDevContextRetryKey((key) => key + 1)} onClose={closeIssues} />
          : <DevIssueDetailSkeleton />}</div> : null}
        {confirmDialog && (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
            <div className="w-full max-w-sm rounded-lg border border-localapp-dev-border bg-background p-5 shadow-lg">
              <h2 className="text-base font-semibold text-localapp-dev-foreground">{confirmDialog.title}</h2>
              {confirmDialog.message && (
                <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-localapp-dev-muted-foreground">{confirmDialog.message}</p>
              )}
              <div className="mt-5 flex justify-end gap-2">
                <button type="button" onClick={() => resolveConfirmDialog(false)} className={DEV_OUTLINE_BUTTON}>
                  {confirmDialog.cancelText}
                </button>
                <button
                  type="button"
                  onClick={() => resolveConfirmDialog(true)}
                  className={
                    confirmDialog.tone === "danger"
                      ? "rounded border border-localapp-dev-danger px-2 py-1 font-medium text-localapp-dev-danger hover:bg-localapp-dev-danger-muted"
                      : `rounded px-2 py-1 font-medium ${DEV_BUTTON_ACTIVE}`
                  }
                >
                  {confirmDialog.confirmText}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function DevIssueStatusIcon({ status, className = "h-4 w-4" }: { status: DevIssue["status"]; className?: string }) {
  return status === "open" ? (
    <svg className={`${className} text-localapp-dev-success`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="1" />
    </svg>
  ) : (
    <svg className={`${className} text-localapp-dev-muted-foreground`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" /><path d="m9 12 2 2 4-4" />
    </svg>
  );
}

function DevIssueListStatusIcon({ issue, className = "h-4 w-4" }: { issue: DevIssue; className?: string }) {
  if (issue.status === "open" && Boolean(issue.is_blocked)) return <span aria-label="已阻塞：存在未解决依赖" title="已阻塞：存在未解决依赖" className={className}><CircleAlert className="h-full w-full text-localapp-dev-danger" aria-hidden="true" /></span>;
  if (issue.status === "open") return <span aria-label="开启" title="开启" className={className}><CircleDot className="h-full w-full text-localapp-dev-success" aria-hidden="true" /></span>;
  const notPlanned = issue.state_reason === "not_planned";
  const label = notPlanned ? "已关闭：不计划处理" : "已关闭：已完成";
  return <span aria-label={label} title={label} className={className}>{notPlanned ? <CircleSlash2 className="h-full w-full text-localapp-dev-muted-foreground" aria-hidden="true" /> : <CircleCheck className="h-full w-full text-localapp-dev-accent" aria-hidden="true" />}</span>;
}

function DevIssueListActivityTime({ issue }: { issue: DevIssue }) {
  const timestamp = issue.last_activity_at ?? issue.updated_at ?? issue.created_at;
  const created = timestamp === issue.created_at;
  return <span data-localapp-issue-activity data-kind={created ? "created" : "activity"} className="inline-flex min-w-0 flex-wrap items-center gap-1"><span>{created ? "创建于" : "活动于"}</span><DevIssueTime timestamp={timestamp} /></span>;
}

function DevIssueListAssignees({ ids, identities, onSelect }: { ids: readonly string[]; identities: readonly DevUserBasic[]; onSelect: (userId: string) => void }) {
  const uniqueIds = Array.from(new Set(ids));
  if (uniqueIds.length === 0) return null;
  const resolved = uniqueIds.map((id) => resolveDevIssueIdentity(id, identities));
  const visible = resolved.slice(0, 3);
  const overflow = resolved.length - visible.length;
  return <div role="group" aria-label={`负责人：${resolved.map((identity) => identity.displayName).join("、")}`} className="hidden shrink-0 self-center -space-x-1.5 sm:flex">{visible.map((identity) => <button type="button" key={identity.id} aria-label={`按负责人筛选 ${identity.displayName}`} title={`${identity.displayName} @${identity.id}`} onClick={() => onSelect(identity.id)} className="flex h-7 w-7 items-center justify-center overflow-hidden rounded-full border-2 border-background bg-localapp-dev-muted text-[10px] font-semibold text-localapp-dev-muted-foreground hover:z-10 hover:ring-2 hover:ring-localapp-dev-focus focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-localapp-dev-focus">{identity.avatarUrl ? <img src={identity.avatarUrl} alt="" className="h-full w-full object-cover" /> : getDevIssueIdentityInitial(identity)}</button>)}{overflow > 0 && <span aria-label={`另外 ${overflow} 位负责人`} className="flex h-7 min-w-7 items-center justify-center rounded-full border-2 border-background bg-localapp-dev-muted px-1 text-[10px] font-semibold text-localapp-dev-muted-foreground">+{overflow}</span>}</div>;
}

function DevIssueDetailSkeleton() {
  return <div role="status" aria-label="正在加载 Issue 详情" className="min-h-0 flex-1 overflow-hidden px-5 py-5 sm:px-6"><span className="sr-only">正在加载 Issue 详情</span><div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(240px,1fr)]"><div className="space-y-3 border-b border-localapp-dev-border pb-5 lg:col-span-2"><div className="h-9 w-2/3 rounded bg-localapp-dev-muted motion-safe:animate-pulse" /><div className="h-7 w-56 rounded bg-localapp-dev-muted motion-safe:animate-pulse" /></div><main className="space-y-5"><div className="overflow-hidden rounded-[6px] border border-localapp-dev-border"><div className="h-14 border-b border-localapp-dev-border bg-localapp-dev-muted motion-safe:animate-pulse" /><div className="space-y-3 p-4"><div className="h-4 w-full rounded bg-localapp-dev-muted motion-safe:animate-pulse" /><div className="h-4 w-5/6 rounded bg-localapp-dev-muted motion-safe:animate-pulse" /><div className="h-4 w-1/2 rounded bg-localapp-dev-muted motion-safe:animate-pulse" /></div></div>{Array.from({ length: 2 }, (_, index) => <div key={index} className="h-20 rounded-[6px] border border-localapp-dev-border bg-localapp-dev-muted motion-safe:animate-pulse" />)}</main><aside className="hidden space-y-6 border-l border-localapp-dev-border pl-6 lg:block">{Array.from({ length: 4 }, (_, index) => <div key={index} className="space-y-2"><div className="h-3 w-20 rounded bg-localapp-dev-muted" /><div className="h-7 w-32 rounded bg-localapp-dev-muted motion-safe:animate-pulse" /></div>)}</aside></div></div>;
}

function DevIssueContextError({ message, onRetry, onClose }: { message: string; onRetry: () => void; onClose: () => void }) {
  return <div role="alert" className="flex min-h-0 flex-1 flex-col items-center justify-center px-6 text-center"><CircleAlert className="h-10 w-10 text-localapp-dev-danger" aria-hidden="true" /><h2 className="mt-3 text-base font-semibold">无法打开 Issue 工作台</h2><p className="mt-1 max-w-lg text-sm text-localapp-dev-muted-foreground">{message}</p><div className="mt-4 flex gap-2"><button type="button" className={`${DEV_OUTLINE_BUTTON} h-11 sm:h-8`} onClick={onClose}>关闭</button><button type="button" className={`${DEV_OUTLINE_BUTTON} h-11 sm:h-8`} onClick={onRetry}>重试</button></div></div>;
}

function DevIssueDetailError({ message, onRetry, onBack }: { message: string; onRetry: () => void; onBack: () => void }) {
  const detailErrorHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const headingId = React.useId();
  const descriptionId = React.useId();
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => detailErrorHeadingRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, []);
  return <div role="alert" aria-labelledby={headingId} aria-describedby={descriptionId} className="flex min-h-0 flex-1 flex-col items-center justify-center px-6 text-center"><CircleAlert className="h-10 w-10 text-localapp-dev-danger" aria-hidden="true" /><h3 ref={detailErrorHeadingRef} id={headingId} tabIndex={-1} className="mt-3 text-base font-semibold outline-none">无法加载 Issue 详情</h3><p id={descriptionId} className="mt-1 max-w-md text-sm text-localapp-dev-muted-foreground">{message}</p><div className="mt-4 flex gap-2"><button type="button" aria-label="从错误页返回 Issue 列表" className={`${DEV_OUTLINE_BUTTON} h-11 sm:h-8`} onClick={onBack}>返回列表</button><button type="button" aria-label="重试加载 Issue 详情" className={`${DEV_OUTLINE_BUTTON} h-11 sm:h-8`} onClick={onRetry}>重试</button></div></div>;
}

function DevIssueTypeBadge({ issue, onSelect }: { issue: DevIssue; onSelect?: (issueType: DevIssueType) => void }) {
  const issueType = issue.issue_type ?? issue.label;
  return (
    <button type="button" disabled={!onSelect} onClick={() => onSelect?.(issueType)} className="inline-flex min-h-6 shrink-0 items-center rounded border border-localapp-dev-border px-2 py-0.5 text-[10px] font-medium text-localapp-dev-foreground enabled:hover:bg-localapp-dev-muted">
      {DEV_ISSUE_TYPE_LABELS[issueType]}
    </button>
  );
}

function DevIssueLabelBadge({ label, onSelect }: { label: DevIssueLabelDefinition; onSelect?: (labelId: string) => void }) {
  const content = <><span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ backgroundColor: `#${label.color}` }} />{label.name}</>;
  if (onSelect) {
    return <button type="button" aria-label={`按标签筛选 ${label.name}`} onClick={() => onSelect(label.id)} className="inline-flex min-h-6 shrink-0 items-center gap-1 rounded-full border border-localapp-dev-border px-2 py-0.5 text-[10px] font-medium hover:bg-localapp-dev-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-localapp-dev-focus">{content}</button>;
  }
  return <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-localapp-dev-border px-2 py-0.5 text-[10px] font-medium">{content}</span>;
}

function DevIssueLabelManager({ labels, saving, error, onCreate, onUpdate, onDelete }: {
  labels: DevIssueLabelDefinition[];
  saving: boolean;
  error: string | null;
  onCreate: (draft: { name: string; color: string; description: string }) => Promise<void>;
  onUpdate: (id: string, draft: { name: string; color: string; description: string }) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [editingId, setEditingId] = useState<string | "new" | null>(null);
  const [draft, setDraft] = useState({ name: "", color: "1f6feb", description: "" });
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  const deleteLabelTriggerRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!confirmingDelete) return;
    deleteLabelTriggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = window.requestAnimationFrame(() => document.querySelector<HTMLElement>('[role="alertdialog"] button:not([disabled])')?.focus());
    const handleKeyDown = (event: KeyboardEvent) => {
      const dialog = document.querySelector<HTMLElement>('[role="alertdialog"]');
      if (!dialog) return;
      const buttons = Array.from(dialog.querySelectorAll<HTMLButtonElement>('button:not([disabled])'));
      if (event.key === "Escape" && !saving) { event.preventDefault(); setConfirmingDelete(null); return; }
      if (event.key !== "Tab" || buttons.length < 2) return;
      const first = buttons[0]; const last = buttons[buttons.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => { window.cancelAnimationFrame(frame); document.removeEventListener("keydown", handleKeyDown); const trigger = deleteLabelTriggerRef.current; window.requestAnimationFrame(() => { if (trigger?.isConnected) trigger.focus(); }); };
  }, [confirmingDelete, saving]);
  const begin = (label?: DevIssueLabelDefinition) => { setConfirmingDelete(null); setEditingId(label?.id ?? "new"); setDraft(label ? { name: label.name, color: label.color, description: label.description } : { name: "", color: "1f6feb", description: "" }); };
  const submit = async () => { if (!draft.name.trim() || !/^[0-9a-fA-F]{6}$/.test(draft.color)) return; const value = { name: draft.name.trim(), color: draft.color.toLowerCase(), description: draft.description.trim() }; if (editingId === "new") await onCreate(value); else if (editingId) await onUpdate(editingId, value); setEditingId(null); };
  return <section aria-labelledby="dev-issue-label-manager-title" className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6"><div className="mx-auto max-w-4xl"><div className="flex items-center justify-between gap-3 border-b border-localapp-dev-border pb-4"><div><h3 id="dev-issue-label-manager-title" className="text-lg font-semibold">标签</h3><p className="mt-1 text-sm text-localapp-dev-muted-foreground">使用标签对 Issue 进行分类和筛选。</p></div><button type="button" className={`${DEV_BUTTON_ACTIVE} flex h-11 items-center gap-1.5 rounded px-3 text-xs font-medium sm:h-8`} onClick={() => begin()}><Plus className="h-4 w-4" />新建标签</button></div>{error && <p role="alert" className="mt-4 rounded border border-localapp-dev-danger bg-localapp-dev-danger-muted px-3 py-2 text-sm text-localapp-dev-danger">{error}</p>}{editingId && <div className="mt-4 rounded border border-localapp-dev-border bg-localapp-dev-muted p-4"><div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_140px]"><label className="text-sm font-medium">名称<input autoFocus aria-label="标签名称" maxLength={50} className="mt-1 block h-11 w-full rounded border border-localapp-dev-border bg-background px-3 font-normal outline-none focus:ring-2 focus:ring-localapp-dev-focus sm:h-9" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label><label className="text-sm font-medium">颜色<span className="mt-1 flex h-11 items-center gap-2 rounded border border-localapp-dev-border bg-background px-2 sm:h-9"><input aria-label="标签颜色选择器" type="color" className="h-7 w-8" value={`#${/^[0-9a-fA-F]{6}$/.test(draft.color) ? draft.color : "000000"}`} onChange={(event) => setDraft({ ...draft, color: event.target.value.slice(1) })} /><input aria-label="标签颜色" maxLength={6} className="min-w-0 flex-1 bg-transparent font-mono text-xs outline-none" value={draft.color} onChange={(event) => setDraft({ ...draft, color: event.target.value.replace(/^#/, "") })} /></span></label></div><label className="mt-4 block text-sm font-medium">描述<input aria-label="标签描述" maxLength={200} className="mt-1 block h-11 w-full rounded border border-localapp-dev-border bg-background px-3 font-normal outline-none focus:ring-2 focus:ring-localapp-dev-focus sm:h-9" value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></label><div className="mt-4 flex justify-end gap-2"><button type="button" disabled={saving} className={`${DEV_OUTLINE_BUTTON} h-11 sm:h-8`} onClick={() => setEditingId(null)}>取消</button><button type="button" disabled={saving || !draft.name.trim() || !/^[0-9a-fA-F]{6}$/.test(draft.color)} className={`${DEV_BUTTON_ACTIVE} h-11 rounded px-3 text-xs font-medium sm:h-8`} onClick={() => void submit()}>{saving ? "正在保存..." : editingId === "new" ? "创建标签" : "保存更改"}</button></div></div>}<ul aria-label="Issue 标签" className="relative mt-4 divide-y divide-localapp-dev-border rounded border border-localapp-dev-border">{labels.map((label) => <li key={label.id} className="flex min-w-0 items-center gap-3 px-4 py-3"><span aria-hidden="true" className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: `#${label.color}` }} /><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><strong className="truncate text-sm">{label.name}</strong>{Boolean(label.built_in) && <span className="text-xs text-localapp-dev-muted-foreground">内置</span>}</div><p className="mt-0.5 truncate text-xs text-localapp-dev-muted-foreground">{label.description || "无描述"}</p></div>{!label.built_in && <><button type="button" aria-label={`编辑标签 ${label.name}`} className={`${DEV_ICON_BUTTON} h-11 w-11 sm:h-8 sm:w-8`} onClick={() => begin(label)}><Pencil className="h-4 w-4" /></button><button type="button" aria-label={`删除标签 ${label.name}`} className={`${DEV_ICON_BUTTON} h-11 w-11 text-localapp-dev-danger sm:h-8 sm:w-8`} onClick={() => setConfirmingDelete(label.id)}><Trash2 className="h-4 w-4" /></button></>}{confirmingDelete === label.id && <div role="alertdialog" aria-label={`删除标签 ${label.name} 确认`} className="absolute left-1/2 z-10 w-[min(420px,calc(100%-2rem))] -translate-x-1/2 rounded border border-localapp-dev-danger bg-background p-4 shadow-xl"><p className="text-sm font-medium">删除“{label.name}”？</p><p className="mt-1 text-xs text-localapp-dev-muted-foreground">该标签会从所有 Issue 中移除，此操作无法撤销。</p><div className="mt-3 flex justify-end gap-2"><button type="button" disabled={saving} className={`${DEV_OUTLINE_BUTTON} h-11 sm:h-8`} onClick={() => setConfirmingDelete(null)}>取消</button><button type="button" disabled={saving} className="h-11 rounded bg-localapp-dev-danger px-3 text-xs font-medium text-white sm:h-8" onClick={() => void onDelete(label.id).then(() => setConfirmingDelete(null))}>确认删除标签</button></div></div>}</li>)}</ul></div></section>;
}

function DevIssueMilestoneManager({ milestones, saving, error, onCreate, onUpdate, onDelete }: { milestones: DevIssueMilestoneDefinition[]; saving: boolean; error: string | null; onCreate: (draft: { title: string; description: string; dueOn: string | null }) => Promise<void>; onUpdate: (id: number, draft: { title: string; description: string; dueOn: string | null; state: "open" | "closed" }) => Promise<void>; onDelete: (id: number) => Promise<void> }) {
  const [editingId, setEditingId] = useState<number | "new" | null>(null);
  const [draft, setDraft] = useState({ title: "", description: "", dueOn: "" as string, state: "open" as "open" | "closed" });
  const [confirmingDelete, setConfirmingDelete] = useState<number | null>(null);
  const deleteTriggerRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (confirmingDelete === null) return;
    deleteTriggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = window.requestAnimationFrame(() => document.querySelector<HTMLElement>('[role="alertdialog"] button:not([disabled])')?.focus());
    const handleKeyDown = (event: KeyboardEvent) => { const dialog = document.querySelector<HTMLElement>('[role="alertdialog"]'); if (!dialog) return; const buttons = Array.from(dialog.querySelectorAll<HTMLButtonElement>('button:not([disabled])')); if (event.key === "Escape" && !saving) { event.preventDefault(); setConfirmingDelete(null); return; } if (event.key !== "Tab" || buttons.length < 2) return; const first = buttons[0]; const last = buttons[buttons.length - 1]; if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); } };
    document.addEventListener("keydown", handleKeyDown);
    return () => { window.cancelAnimationFrame(frame); document.removeEventListener("keydown", handleKeyDown); const trigger = deleteTriggerRef.current; window.requestAnimationFrame(() => { if (trigger?.isConnected) trigger.focus(); }); };
  }, [confirmingDelete, saving]);
  const begin = (item?: DevIssueMilestoneDefinition) => { setEditingId(item?.id ?? "new"); setDraft(item ? { title: item.title, description: item.description, dueOn: item.due_on ?? "", state: item.state } : { title: "", description: "", dueOn: "", state: "open" }); };
  const submit = async () => { if (!draft.title.trim()) return; if (editingId === "new") await onCreate({ title: draft.title.trim(), description: draft.description.trim(), dueOn: draft.dueOn || null }); else if (editingId !== null) await onUpdate(editingId, { title: draft.title.trim(), description: draft.description.trim(), dueOn: draft.dueOn || null, state: draft.state }); setEditingId(null); };
  return <section aria-labelledby="dev-issue-milestone-manager-title" className="relative min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6"><div className="mx-auto max-w-5xl"><div className="flex items-center justify-between gap-3 border-b border-localapp-dev-border pb-4"><div><h3 id="dev-issue-milestone-manager-title" className="text-lg font-semibold">里程碑</h3><p className="mt-1 text-sm text-localapp-dev-muted-foreground">按版本或阶段组织 Issue，并跟踪完成进度。</p></div><button type="button" className={`${DEV_BUTTON_ACTIVE} flex h-11 items-center gap-1.5 rounded px-3 text-xs font-medium sm:h-8`} onClick={() => begin()}><Plus className="h-4 w-4" />新建里程碑</button></div>{error && <p role="alert" className="mt-4 rounded border border-localapp-dev-danger bg-localapp-dev-danger-muted px-3 py-2 text-sm text-localapp-dev-danger">{error}</p>}{editingId !== null && <div className="mt-4 rounded border border-localapp-dev-border bg-localapp-dev-muted p-4"><div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_180px]"><label className="text-sm font-medium">标题<input autoFocus aria-label="标题" maxLength={100} value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} className="mt-1 block h-11 w-full rounded border border-localapp-dev-border bg-background px-3 font-normal sm:h-9" /></label><label className="text-sm font-medium">截止日期<input aria-label="截止日期" type="date" value={draft.dueOn} onChange={(event) => setDraft({ ...draft, dueOn: event.target.value })} className="mt-1 block h-11 w-full rounded border border-localapp-dev-border bg-background px-3 font-normal sm:h-9" /></label></div><label className="mt-4 block text-sm font-medium">描述<input aria-label="描述" maxLength={1000} value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} className="mt-1 block h-11 w-full rounded border border-localapp-dev-border bg-background px-3 font-normal sm:h-9" /></label><div className="mt-4 flex justify-end gap-2"><button type="button" disabled={saving} className={`${DEV_OUTLINE_BUTTON} h-11 sm:h-8`} onClick={() => setEditingId(null)}>取消</button><button type="button" disabled={saving || !draft.title.trim()} className={`${DEV_BUTTON_ACTIVE} h-11 sm:h-8`} onClick={() => void submit()}>{editingId === "new" ? "创建里程碑" : "保存更改"}</button></div></div>}<ul aria-label="Issue 里程碑" className="mt-4 divide-y divide-localapp-dev-border rounded border border-localapp-dev-border">{milestones.map((item) => { const total = item.open_issues + item.closed_issues; const percent = total ? Math.round(item.closed_issues / total * 100) : 0; return <li key={item.id} className="relative px-4 py-4"><div className="flex items-start gap-3"><div className="min-w-0 flex-1"><strong className="text-sm">{item.title}</strong><p className="mt-1 text-xs text-localapp-dev-muted-foreground">{percent}% 已完成 · {item.open_issues} 个开启 · {item.closed_issues} 个已关闭</p><div className="mt-2 h-2 overflow-hidden rounded-full bg-localapp-dev-muted"><div className="h-full bg-localapp-dev-accent" style={{ width: `${percent}%` }} /></div></div><button type="button" aria-label={`编辑里程碑 ${item.title}`} className={`${DEV_ICON_BUTTON} h-11 w-11 sm:h-8 sm:w-8`} onClick={() => begin(item)}><Pencil className="h-4 w-4" /></button><button type="button" aria-label={`${item.state === "open" ? "关闭" : "重开"}里程碑 ${item.title}`} className={`${DEV_ICON_BUTTON} h-11 w-11 sm:h-8 sm:w-8`} onClick={() => void onUpdate(item.id, { title: item.title, description: item.description, dueOn: item.due_on, state: item.state === "open" ? "closed" : "open" })}>{item.state === "open" ? <CircleCheck className="h-4 w-4" /> : <CircleDot className="h-4 w-4" />}</button><button type="button" aria-label={`删除里程碑 ${item.title}`} className={`${DEV_ICON_BUTTON} h-11 w-11 text-localapp-dev-danger sm:h-8 sm:w-8`} onClick={() => setConfirmingDelete(item.id)}><Trash2 className="h-4 w-4" /></button></div>{confirmingDelete === item.id && <div role="alertdialog" aria-label={`删除里程碑 ${item.title} 确认`} onKeyDown={(event) => { if (event.key === "Escape" && !saving) { event.preventDefault(); event.stopPropagation(); setConfirmingDelete(null); } }} className="absolute inset-x-4 top-3 z-10 rounded border border-localapp-dev-danger bg-background p-4 shadow-xl"><p className="text-sm font-medium">删除“{item.title}”？</p><p className="mt-1 text-xs text-localapp-dev-muted-foreground">关联的 Issue 会变为无里程碑，不会删除 Issue。此操作无法撤销。</p><div className="mt-3 flex justify-end gap-2"><button type="button" className={`${DEV_OUTLINE_BUTTON} h-11 sm:h-8`} onClick={() => setConfirmingDelete(null)}>取消</button><button type="button" className="h-11 rounded bg-localapp-dev-danger px-3 text-xs font-medium text-white sm:h-8" onClick={() => void onDelete(item.id).then(() => setConfirmingDelete(null))}>确认删除里程碑</button></div></div>}</li>; })}</ul></div></section>;
}

function DevIssuesWorkspace({
  open,
  pagePath,
  pageName,
  pageOwnerId,
  user,
  recentUsers,
  platformUsers,
  selectedIssueId,
  selectedIssueNumber,
  onIssueNavigate,
  onIssueNumberNavigate,
  onClose,
  onIssuesChanged,
}: {
  open: boolean;
  pagePath: string;
  pageName: string;
  pageOwnerId: string | null;
  user: DevContext["user"];
  recentUsers: DevUserBasic[];
  platformUsers: DevUserBasic[];
  selectedIssueId: number | null;
  selectedIssueNumber: number | null;
  onIssueNavigate: (issueId: number | null, mode?: "push" | "replace") => void;
  onIssueNumberNavigate: (issueNumber: number) => void;
  onClose: () => void;
  onIssuesChanged: () => void;
}) {
  const [view, setView] = useState<DevIssuesView>({ kind: "list" });
  const [query, setQuery] = useState<DevIssueListQuery>(() => readDevIssueListQueryFromUrl(new URL(window.location.href)));
  const [advancedIssueFiltersOpen, setAdvancedIssueFiltersOpen] = useState(() => activeDevIssueAdvancedFilterCount(readDevIssueListQueryFromUrl(new URL(window.location.href)), user?.id) > 0);
  const [searchInput, setSearchInput] = useState(() => {
    const restored = readDevIssueListQueryFromUrl(new URL(window.location.href));
    return formatDevIssueSearchInput(restored.q, restored.searchIn);
  });
  const [activeView, setActiveView] = useState<DevIssueListView>("all");
  const [issueType, setIssueType] = useState<DevIssueType>("task");
  const [createLabelIds, setCreateLabelIds] = useState<string[]>([]);
  const [createAssigneeIds, setCreateAssigneeIds] = useState<string[]>([]);
  const [createMilestoneId, setCreateMilestoneId] = useState<number | null>(null);
  const [availableLabels, setAvailableLabels] = useState<DevIssueLabelDefinition[]>([]);
  const [availableMilestones, setAvailableMilestones] = useState<DevIssueMilestoneDefinition[]>([]);
  const [milestoneCatalogLoaded, setMilestoneCatalogLoaded] = useState(false);
  const [milestoneCatalogError, setMilestoneCatalogError] = useState(false);
  const [milestoneCatalogLoading, setMilestoneCatalogLoading] = useState(false);
  const [milestoneCatalogRevision, setMilestoneCatalogRevision] = useState(0);
  const [labelCatalogError, setLabelCatalogError] = useState(false);
  const [labelCatalogLoading, setLabelCatalogLoading] = useState(false);
  const [labelCatalogRevision, setLabelCatalogRevision] = useState(0);
  const [labelSaving, setLabelSaving] = useState(false);
  const [labelManagerError, setLabelManagerError] = useState<string | null>(null);
  const [milestoneSaving, setMilestoneSaving] = useState(false);
  const [milestoneManagerError, setMilestoneManagerError] = useState<string | null>(null);
  const [userCatalog, setUserCatalog] = useState<DevUserBasic[]>(platformUsers);
  const [userCatalogError, setUserCatalogError] = useState(false);
  const [userCatalogLoading, setUserCatalogLoading] = useState(false);
  const [userCatalogRevision, setUserCatalogRevision] = useState(0);
  const [issues, setIssues] = useState<DevIssue[]>([]);
  const [pinnedIssues, setPinnedIssues] = useState<DevIssue[]>([]);
  const [meta, setMeta] = useState<DevIssueListMeta>(DEV_ISSUE_LIST_EMPTY_META);
  const [detail, setDetail] = useState<DevIssueDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailSyncFailed, setDetailSyncFailed] = useState(false);
  const [detailSyncing, setDetailSyncing] = useState(false);
  const [detailUpdateNotice, setDetailUpdateNotice] = useState(false);
  const [createTitle, setCreateTitle] = useState("");
  const [createBody, setCreateBody] = useState("");
  const [createInitialBody, setCreateInitialBody] = useState("");
  const [createWasRestoredDraft, setCreateWasRestoredDraft] = useState(false);
  const [issueTemplates, setIssueTemplates] = useState<DevIssueTemplateConfig[]>([]);
  const [issueTemplatesLoaded, setIssueTemplatesLoaded] = useState(false);
  const [issueTemplatesLoading, setIssueTemplatesLoading] = useState(true);
  const [issueTemplatesError, setIssueTemplatesError] = useState<string | null>(null);
  const [issueTemplatesRevision, setIssueTemplatesRevision] = useState(0);
  const [issueTemplateNotice, setIssueTemplateNotice] = useState<string | null>(null);
  const [savedViews, setSavedViews] = useState<DevIssueSavedView[]>([]);
  const [savedViewsLoading, setSavedViewsLoading] = useState(false);
  const [savedViewsError, setSavedViewsError] = useState<string | null>(null);
  const [savedViewsSaving, setSavedViewsSaving] = useState(false);
  const [savedViewsRevision, setSavedViewsRevision] = useState(0);
  const [activeSavedViewId, setActiveSavedViewId] = useState<number | null>(null);
  const [savedViewEditor, setSavedViewEditor] = useState<{ mode: "create" | "save-as" | "edit"; view?: DevIssueSavedView } | null>(null);
  const [savedViewName, setSavedViewName] = useState("");
  const [savedViewDescription, setSavedViewDescription] = useState("");
  const [savedViewActionError, setSavedViewActionError] = useState<string | null>(null);
  const [deletingSavedView, setDeletingSavedView] = useState<DevIssueSavedView | null>(null);
  const [potentialDuplicates, setPotentialDuplicates] = useState<DevIssuePotentialDuplicate[]>([]);
  const [potentialDuplicatesLoading, setPotentialDuplicatesLoading] = useState(false);
  const [potentialDuplicatesError, setPotentialDuplicatesError] = useState<string | null>(null);
  const [potentialDuplicatesRevision, setPotentialDuplicatesRevision] = useState(0);
  const [createDraftId, setCreateDraftId] = useState(createDevIssueDraftId);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedIssueIds, setSelectedIssueIds] = useState<Set<number>>(new Set());
  const [bulkSaving, setBulkSaving] = useState(false);
  const [bulkMessage, setBulkMessage] = useState("");
  const [bulkIssueTypeAction, setBulkIssueTypeAction] = useState("");
  const [bulkLabelAction, setBulkLabelAction] = useState("");
  const [bulkAssigneeAction, setBulkAssigneeAction] = useState("");
  const [bulkMilestoneAction, setBulkMilestoneAction] = useState("");
  const selectionAnchorIssueIdRef = useRef<number | null>(null);
  const focusedSelectionIdRef = useRef<number | null>(null);
  const bulkToolbarFocusedRef = useRef(false);
  const selectionReconciliationFocusRef = useRef(false);
  const [searchSuggestionsOpen, setSearchSuggestionsOpen] = useState(false);
  const [searchSuggestionCursor, setSearchSuggestionCursor] = useState(searchInput.length);
  const [activeSearchSuggestion, setActiveSearchSuggestion] = useState(-1);
  const issueDraftPrefix = createDevIssueDraftPrefix(pagePath, user?.id ?? "anonymous");
  const createPersistenceKey = `${issueDraftPrefix}:${view.kind === "create" && view.reference ? `reference-comment:${view.reference.detail.issue.id}:${view.reference.commentId}` : "create"}`;
  const advancedIssueFilterCount = activeDevIssueAdvancedFilterCount(query, user?.id);
  const issueMentionCandidates: DevUserBasic[] = Array.from(new Map([...(user ? [{ id: user.id, name: user.name, displayName: user.displayName, avatarUrl: user.avatarUrl, role: user.role }] : []), ...recentUsers, ...platformUsers, ...userCatalog].map((candidate) => [candidate.id, candidate])).values());
  const issueFilterUserLabel = (userId: string) => {
    const identity = issueMentionCandidates.find((candidate) => candidate.id === userId);
    return identity?.displayName || identity?.name || userId;
  };
  const appliedIssueFilters = [
    ...(query.issueType ? [{ key: "issueType" as const, kind: "类型", value: DEV_ISSUE_TYPE_LABELS[query.issueType] }] : []),
    ...(query.label ? [{ key: "label" as const, kind: "标签", value: query.label === "none" ? "未添加" : availableLabels.find((label) => label.id === query.label)?.name ?? query.label }] : []),
    ...(query.author ? [{ key: "author" as const, kind: "作者", value: issueFilterUserLabel(query.author) }] : []),
    ...(query.participant ? [{ key: "participant" as const, kind: "参与者", value: issueFilterUserLabel(query.participant) }] : []),
    ...(query.assignee ? [{ key: "assignee" as const, kind: "负责人", value: query.assignee === "none" ? "未分配" : issueFilterUserLabel(query.assignee) }] : []),
    ...(query.milestone ? [{ key: "milestone" as const, kind: "里程碑", value: query.milestone === "none" ? "无里程碑" : availableMilestones.find((item) => String(item.id) === query.milestone)?.title ?? `#${query.milestone}` }] : []),
    ...(query.reason ? [{ key: "reason" as const, kind: "关闭原因", value: query.reason === "not_planned" ? "不计划处理" : "已完成" }] : []),
    ...(query.subscribed ? [{ key: "subscribed" as const, kind: "关注", value: "我" }] : []),
    ...(query.mentioned ? [{ key: "mentioned" as const, kind: "提及", value: "我" }] : []),
    ...(query.locked ? [{ key: "locked" as const, kind: "对话", value: query.locked === "locked" ? "已锁定" : "未锁定" }] : []),
  ];
  const focusIssueSearchAfterFilterChange = () => window.requestAnimationFrame(() => issueSearchInputRef.current?.focus());
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const focusDevIssueCommentComposer = () => {
    const textarea = dialogRef.current?.querySelector<HTMLTextAreaElement>('[data-localapp-issue-comment-composer] textarea');
    textarea?.scrollIntoView?.({ block: "center", behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    window.requestAnimationFrame(() => textarea?.focus());
  };
  const issueSearchInputRef = useRef<HTMLInputElement | null>(null);
  const onCloseRef = useRef(onClose);
  const listRequestGenerationRef = useRef(0);
  const listAbortRef = useRef<AbortController | null>(null);
  const detailRequestGenerationRef = useRef(0);
  const detailLookupByNumberRef = useRef(false);
  const pendingReferenceCommentIdRef = useRef<number | null>(null);
  const pendingIssueFocusIdRef = useRef<number | null>(null);
  const pendingTaskReferenceFocusRef = useRef<number | null>(null);
  const deepLinkAttemptKeyRef = useRef<string | null>(null);
  const selectAllIssuesRef = useRef<HTMLInputElement | null>(null);
  const insertedSearchSuggestionCursorRef = useRef<number | null>(null);
  const focusedDetailIdRef = useRef<number | null>(null);
  const createIssueTriggerRef = useRef<HTMLButtonElement | null>(null);
  const pendingCreateIssueFocusRef = useRef(false);
  const pendingListRetryFocusRef = useRef(false);
  const paginationFocusPendingRef = useRef(false);
  const paginationFocusOffsetRef = useRef<number | null>(null);
  const issueResultsRef = useRef<HTMLDivElement | null>(null);
  const returnFirstPageRef = useRef<HTMLButtonElement | null>(null);
  const pendingCatalogRetryFocusRef = useRef(false);
  useEffect(() => {
    if (!open || view.kind === "list" || view.kind === "create" || view.kind === "detail-loading") { focusedDetailIdRef.current = null; return; }
    if (view.kind !== "detail" || !detail || focusedDetailIdRef.current === detail.issue.id) return;
    focusedDetailIdRef.current = detail.issue.id;
    if (readDevIssueCommentDeepLinkId(new URL(window.location.href))) return;
    const frame = window.requestAnimationFrame(() => document.querySelector<HTMLElement>("[data-localapp-issue-title]")?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [detail?.issue.id, open, view.kind]);
  useEffect(() => {
    if (!open || view.kind !== "detail" || detailLoading || pendingTaskReferenceFocusRef.current === null) return;
    const issueNumber = pendingTaskReferenceFocusRef.current;
    let attempts = 0;
    let timer = 0;
    const focusReference = () => {
      if (dialogRef.current?.querySelector('[role="alertdialog"]')) { if (attempts++ < 20) timer = window.setTimeout(focusReference, 30); return; }
      const reference = dialogRef.current?.querySelector<HTMLElement>(`[data-localapp-issue-reference="${issueNumber}"]`);
      reference?.focus();
      if (reference && document.activeElement === reference) { pendingTaskReferenceFocusRef.current = null; return; }
      if (attempts++ < 20) timer = window.setTimeout(focusReference, 30);
    };
    timer = window.setTimeout(focusReference, 0);
    return () => window.clearTimeout(timer);
  }, [detail?.issue.description, detailLoading, open, view.kind]);
  const issueEventRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingIssueChangedIdsRef = useRef(new Set<number | null>());
  const issueViewRef = useRef(view);
  const issueDetailRef = useRef(detail);
  const issueQueryRef = useRef(query);
  const issueSearchSuggestionListId = "localapp-dev-issue-search-suggestions";
  const issueSearchSuggestionResult = getDevIssueSearchSuggestions(searchInput, insertedSearchSuggestionCursorRef.current ?? searchSuggestionCursor, { currentUserId: user?.id, labels: availableLabels, milestones: availableMilestones, users: issueMentionCandidates });
  const visibleSearchSuggestions = searchSuggestionsOpen ? issueSearchSuggestionResult.items : [];
  onCloseRef.current = onClose;
  issueViewRef.current = view;
  issueDetailRef.current = detail;
  issueQueryRef.current = query;

  const fetchIssues = useCallback(async (nextQuery: DevIssueListQuery) => {
    const generation = ++listRequestGenerationRef.current;
    listAbortRef.current?.abort();
    const controller = new AbortController();
    listAbortRef.current = controller;
    const requestTimeout = window.setTimeout(() => {
      controller.abort(new DOMException("Issue list request timed out", "TimeoutError"));
    }, DEV_ISSUE_LIST_REQUEST_TIMEOUT_MS);
    setLoading(true);
    setListError(null);
    const requestQuery = new URLSearchParams({ pagePath });
    requestQuery.set("status", nextQuery.status);
    requestQuery.set("sort", nextQuery.sort);
    requestQuery.set("direction", nextQuery.direction);
    requestQuery.set("limit", String(nextQuery.limit));
    requestQuery.set("offset", String(nextQuery.offset));
    if (nextQuery.q) requestQuery.set("q", nextQuery.q);
    if (nextQuery.q && nextQuery.searchIn) requestQuery.set("in", nextQuery.searchIn);
    if (nextQuery.label) requestQuery.set("label", nextQuery.label);
    if (nextQuery.issueType) requestQuery.set("type", nextQuery.issueType);
    if (nextQuery.author) requestQuery.set("author", nextQuery.author);
    if (nextQuery.participant) requestQuery.set("participant", nextQuery.participant);
    if (nextQuery.assignee) requestQuery.set("assignee", nextQuery.assignee);
    if (nextQuery.milestone) requestQuery.set("milestone", nextQuery.milestone);
    if (nextQuery.reason) requestQuery.set("reason", nextQuery.reason);
    if (nextQuery.subscribed) requestQuery.set("subscribed", "true");
    if (nextQuery.mentioned) requestQuery.set("mentioned", "true");
    if (nextQuery.locked) requestQuery.set("locked", nextQuery.locked === "locked" ? "true" : "false");
    try {
      const response = await fetch(`/api/issues?${requestQuery.toString()}`, { credentials: "include", signal: controller.signal });
      const body = await readDevIssueResponseBody<DevIssue[]>(response);
      if (listRequestGenerationRef.current !== generation) return;
      setIssues(Array.isArray(body.data) ? body.data : []);
      setPinnedIssues(Array.isArray(body.pinned) ? body.pinned : []);
      setMeta(readDevIssueListMeta(body.meta, nextQuery));
    } catch (requestError) {
      if (listRequestGenerationRef.current !== generation || isDevIssueListAbortError(requestError)) return;
      setListError(requestError instanceof DOMException && requestError.name === "TimeoutError" ? "Issue 服务暂不可用" : requestError instanceof Error ? requestError.message : "Issue 服务暂不可用");
    } finally {
      window.clearTimeout(requestTimeout);
      if (listRequestGenerationRef.current === generation) setLoading(false);
    }
  }, [pagePath]);

  useEffect(() => {
    if (!open) return;
    void fetchIssues(query);
    return () => listAbortRef.current?.abort();
  }, [fetchIssues, open, query]);

  useEffect(() => { selectionAnchorIssueIdRef.current = null; setSelectedIssueIds(new Set()); setBulkMessage(""); }, [query.q, query.searchIn, query.status, query.issueType, query.label, query.author, query.participant, query.assignee, query.milestone, query.subscribed, query.mentioned, query.locked, query.sort, query.direction, query.limit, query.offset]);
  const visibleIssueIdsKey = issues.map((issue) => issue.id).join(",");
  useEffect(() => { selectionAnchorIssueIdRef.current = null; }, [visibleIssueIdsKey]);
  useEffect(() => {
    if (selectedIssueIds.size === 0) return;
    const visibleIds = new Set(issues.map((issue) => issue.id));
    const retainedIds = new Set(Array.from(selectedIssueIds).filter((id) => visibleIds.has(id)));
    const removedCount = selectedIssueIds.size - retainedIds.size;
    if (removedCount === 0) return;
    selectionReconciliationFocusRef.current = bulkToolbarFocusedRef.current || (focusedSelectionIdRef.current !== null && !visibleIds.has(focusedSelectionIdRef.current));
    setSelectedIssueIds(retainedIds);
    setBulkMessage(`${removedCount} 条已选 Issue 已不在当前列表，选择已更新`);
    if (selectionReconciliationFocusRef.current) window.requestAnimationFrame(() => {
      selectAllIssuesRef.current?.focus();
      selectionReconciliationFocusRef.current = false;
      focusedSelectionIdRef.current = null;
      bulkToolbarFocusedRef.current = false;
    });
  }, [issues, selectedIssueIds]);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    let active = true;
    setLabelCatalogError(false);
    setLabelCatalogLoading(true);
    const params = new URLSearchParams({ pagePath });
    void requestDevIssueCatalogWithRetry((signal) => requestDevIssue<DevIssueLabelDefinition[]>(`/api/issues/labels?${params.toString()}`, { credentials: "include", signal }), controller.signal).then((labels) => {
      if (active) {
        if (Array.isArray(labels)) setAvailableLabels(labels);
        setLabelCatalogError(false);
      }
    }).catch((requestError) => { if (active && !(requestError instanceof Error && requestError.name === "AbortError")) setLabelCatalogError(true); }).finally(() => { if (active) setLabelCatalogLoading(false); });
    return () => { active = false; controller.abort(new DOMException("Superseded", "AbortError")); };
  }, [labelCatalogRevision, open, pagePath]);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    let active = true;
    setMilestoneCatalogError(false);
    setMilestoneCatalogLoading(true);
    const params = new URLSearchParams({ pagePath });
    void requestDevIssueCatalogWithRetry((signal) => requestDevIssue<DevIssueMilestoneDefinition[]>(`/api/issues/milestones?${params.toString()}`, { credentials: "include", signal }), controller.signal).then((items) => { if (active) { setAvailableMilestones(items); setMilestoneCatalogLoaded(true); setMilestoneCatalogError(false); } }).catch((requestError) => { if (active && !(requestError instanceof Error && requestError.name === "AbortError")) setMilestoneCatalogError(true); }).finally(() => { if (active) setMilestoneCatalogLoading(false); });
    return () => { active = false; controller.abort(new DOMException("Superseded", "AbortError")); };
  }, [milestoneCatalogRevision, open, pagePath]);

  useEffect(() => {
    setUserCatalog((current) => Array.from(new Map([...current, ...platformUsers].map((candidate) => [candidate.id, candidate])).values()));
  }, [platformUsers]);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    let active = true;
    setUserCatalogError(false);
    setUserCatalogLoading(true);
    void requestDevIssueCatalogWithRetry((signal) => requestDevIssue<{ users?: DevUserBasic[]; source?: string }>("/api/dev/users", { credentials: "include", signal }), controller.signal).then((body) => {
      if (!Array.isArray(body.users)) throw new Error("负责人目录加载失败");
      if (active) {
        setUserCatalog((current) => Array.from(new Map([...current, ...body.users!].map((candidate: DevUserBasic) => [candidate.id, candidate])).values()));
        setUserCatalogError(false);
      }
    }).catch((requestError) => {
      if (active && !(requestError instanceof Error && requestError.name === "AbortError")) setUserCatalogError(true);
    }).finally(() => { if (active) setUserCatalogLoading(false); });
    return () => { active = false; controller.abort(new DOMException("Superseded", "AbortError")); };
  }, [open, userCatalogRevision]);

  useEffect(() => {
    if (!open || !user) { setSavedViews([]); setSavedViewsLoading(false); setSavedViewsError(null); setActiveSavedViewId(null); return; }
    const controller = new AbortController();
    setSavedViewsLoading(true);
    setSavedViewsError(null);
    const params = new URLSearchParams({ pagePath });
    void requestDevIssue<DevIssueSavedView[]>(`/api/issues/views?${params.toString()}`, { credentials: "include", signal: controller.signal })
      .then((items) => setSavedViews(items.filter((saved) => Number.isSafeInteger(saved.id) && typeof saved.name === "string" && Boolean(saved.name.trim()) && saved.query?.offset === 0)))
      .catch((requestError) => { if (!controller.signal.aborted) setSavedViewsError(requestError instanceof Error ? requestError.message : "保存视图加载失败"); })
      .finally(() => { if (!controller.signal.aborted) setSavedViewsLoading(false); });
    return () => controller.abort();
  }, [open, pagePath, savedViewsRevision, user?.id]);

  useEffect(() => {
    if (activeSavedViewId !== null && savedViews.some((saved) => saved.id === activeSavedViewId)) return;
    setActiveSavedViewId(savedViews.find((saved) => devIssueSavedViewMatchesListQuery(saved.query, query))?.id ?? null);
  }, [activeSavedViewId, query, savedViews]);

  const updateIssueQuery = useCallback((updates: Partial<DevIssueListQuery>, historyMode: "push" | "replace" = "push") => {
    setQuery((current) => {
      const next = normalizeDevIssueListQuery(current, updates);
      const url = updateDevIssueListQueryUrl(new URL(window.location.href), next);
      if (url.href !== window.location.href) window.history[historyMode === "push" ? "pushState" : "replaceState"](null, "", url);
      return next;
    });
  }, []);

  useEffect(() => {
    if (!open || searchInput.trim() === formatDevIssueSearchInput(query.q, query.searchIn) || issueSearchSuggestionResult.items.length > 0) return;
    const timer = window.setTimeout(() => {
      updateIssueQuery(parseDevIssueSearchInput(searchInput, { currentUserId: user?.id, labels: availableLabels, milestones: availableMilestones }), "replace");
    }, 250);
    return () => window.clearTimeout(timer);
  }, [availableLabels, availableMilestones, issueSearchSuggestionResult.items.length, open, query.q, query.searchIn, searchInput, updateIssueQuery, user?.id]);

  useEffect(() => {
    if (!open || view.kind !== "list" || loading || pendingIssueFocusIdRef.current === null) return;
    const issueId = pendingIssueFocusIdRef.current;
    const frame = window.requestAnimationFrame(() => {
      const link = document.querySelector<HTMLElement>(`[data-testid="issue-row-${issueId}"] a`);
      (link ?? issueSearchInputRef.current)?.focus();
      pendingIssueFocusIdRef.current = null;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [issues, loading, open, view.kind]);
  useEffect(() => {
    if (!open || view.kind !== "list" || !pendingCreateIssueFocusRef.current) return;
    pendingCreateIssueFocusRef.current = false;
    const frame = window.requestAnimationFrame(() => createIssueTriggerRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [open, view.kind]);
  useEffect(() => {
    if (!open || view.kind !== "list" || loading || listError || !pendingListRetryFocusRef.current) return;
    pendingListRetryFocusRef.current = false;
    const frame = window.requestAnimationFrame(() => issueSearchInputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [listError, loading, open, view.kind]);

  useEffect(() => {
    const restoreIssueListQuery = () => {
      const restored = readDevIssueListQueryFromUrl(new URL(window.location.href));
      setQuery(restored);
      setSearchInput(formatDevIssueSearchInput(restored.q, restored.searchIn));
    };
    window.addEventListener("popstate", restoreIssueListQuery);
    return () => window.removeEventListener("popstate", restoreIssueListQuery);
  }, []);

  useEffect(() => {
    if (user && query.mentioned && !query.author && !query.participant && !query.assignee && !query.subscribed) setActiveView("mentioned");
    else if (user && query.subscribed && !query.author && !query.participant && !query.assignee && !query.mentioned) setActiveView("subscribed");
    else if (user && query.assignee === user.id && !query.author && !query.participant && !query.subscribed && !query.mentioned) setActiveView("assigned");
    else if (user && query.author === user.id && !query.participant && !query.assignee && !query.subscribed && !query.mentioned) setActiveView("created");
    else if (user && query.participant === user.id && !query.author && !query.assignee && !query.subscribed && !query.mentioned) setActiveView("participating");
    else if (query.author || query.participant || query.assignee || query.subscribed || query.mentioned || activeView === "assigned" || activeView === "created" || activeView === "participating" || activeView === "subscribed" || activeView === "mentioned") setActiveView("all");
  }, [activeView, query.assignee, query.author, query.participant, query.subscribed, query.mentioned, user]);

  const submitSearch = () => {
    const updates = parseDevIssueSearchInput(searchInput, { currentUserId: user?.id, labels: availableLabels, milestones: availableMilestones });
    setSearchInput(formatDevIssueSearchInput(updates.q, updates.searchIn ?? ""));
    updateIssueQuery(updates);
  };
  const retryIssueList = () => {
    pendingListRetryFocusRef.current = true;
    void fetchIssues(query);
  };
  const catalogRetrying = labelCatalogLoading || userCatalogLoading || milestoneCatalogLoading;
  const focusAfterCatalogRetry = () => {
    const current = issueViewRef.current;
    const selector = current.kind === "list" ? null : current.kind === "create" ? "[data-localapp-issue-create-title]" : "[data-localapp-issue-title]";
    window.requestAnimationFrame(() => (selector ? document.querySelector<HTMLElement>(selector) : issueSearchInputRef.current)?.focus());
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

  const resetIssueList = () => {
    setActiveView("all");
    setSearchInput("");
    updateIssueQuery(DEV_ISSUE_LIST_DEFAULT_QUERY);
  };
  const clearIssueListFiltersAndFocus = () => {
    setActiveView("all");
    setSearchInput("");
    updateIssueQuery({ q: "", searchIn: "", issueType: "", label: "", author: "", participant: "", assignee: "", milestone: "", reason: "", subscribed: false, mentioned: false, locked: "", offset: 0 });
    focusIssueSearchAfterFilterChange();
  };

  const activeSavedView = savedViews.find((saved) => saved.id === activeSavedViewId) ?? null;
  const savedViewDirty = Boolean(activeSavedView && !devIssueSavedViewMatchesListQuery(activeSavedView.query, query));
  const openSavedViewEditor = (mode: "create" | "save-as" | "edit", saved?: DevIssueSavedView) => {
    setSavedViewEditor({ mode, view: saved });
    setSavedViewName(mode === "edit" ? saved?.name ?? "" : mode === "save-as" && activeSavedView ? `${activeSavedView.name} copy` : "");
    setSavedViewDescription(mode === "edit" ? saved?.description ?? "" : mode === "save-as" ? activeSavedView?.description ?? "" : "");
    setSavedViewActionError(null);
  };
  const applySavedView = (saved: DevIssueSavedView) => {
    const restored = devIssueListQueryFromSavedView(saved.query);
    setActiveSavedViewId(saved.id);
    setSearchInput(formatDevIssueSearchInput(restored.q, restored.searchIn));
    updateIssueQuery(restored);
  };
  const submitSavedViewEditor = async () => {
    if (!savedViewEditor || !savedViewName.trim() || savedViewsSaving) return;
    setSavedViewsSaving(true); setSavedViewActionError(null);
    try {
      if (savedViewEditor.mode === "edit" && savedViewEditor.view) {
        const updated = await requestDevIssue<DevIssueSavedView>(`/api/issues/views/${savedViewEditor.view.id}`, { method: "PATCH", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pagePath, name: savedViewName.trim(), description: savedViewDescription.trim() }) });
        setSavedViews((current) => current.map((saved) => saved.id === updated.id ? updated : saved));
      } else {
        const created = await requestDevIssue<DevIssueSavedView>("/api/issues/views", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pagePath, name: savedViewName.trim(), description: savedViewDescription.trim(), query: devIssueListQueryToSavedView(query) }) });
        setSavedViews((current) => [...current, created]); setActiveSavedViewId(created.id);
      }
      setSavedViewEditor(null);
    } catch (requestError) { setSavedViewActionError(requestError instanceof Error ? requestError.message : "保存视图失败"); }
    finally { setSavedViewsSaving(false); }
  };
  const saveSavedViewChanges = async () => {
    if (!activeSavedView || savedViewsSaving) return;
    setSavedViewsSaving(true); setSavedViewActionError(null);
    try {
      const updated = await requestDevIssue<DevIssueSavedView>(`/api/issues/views/${activeSavedView.id}`, { method: "PATCH", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pagePath, query: devIssueListQueryToSavedView(query) }) });
      setSavedViews((current) => current.map((saved) => saved.id === updated.id ? updated : saved));
    } catch (requestError) { setSavedViewActionError(requestError instanceof Error ? requestError.message : "保存视图失败"); }
    finally { setSavedViewsSaving(false); }
  };
  const copySavedView = async (viewId: number) => {
    setSavedViewsSaving(true); setSavedViewActionError(null);
    try { const copied = await requestDevIssue<DevIssueSavedView>(`/api/issues/views/${viewId}/copy`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pagePath }) }); setSavedViews((current) => [...current, copied]); }
    catch (requestError) { setSavedViewActionError(requestError instanceof Error ? requestError.message : "复制视图失败"); }
    finally { setSavedViewsSaving(false); }
  };
  const deleteSavedView = async () => {
    if (!deletingSavedView || savedViewsSaving) return;
    setSavedViewsSaving(true); setSavedViewActionError(null);
    try { await requestDevIssue<unknown>(`/api/issues/views/${deletingSavedView.id}`, { method: "DELETE", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pagePath }) }); setSavedViews((current) => current.filter((saved) => saved.id !== deletingSavedView.id)); if (activeSavedViewId === deletingSavedView.id) setActiveSavedViewId(null); setDeletingSavedView(null); }
    catch (requestError) { setSavedViewActionError(requestError instanceof Error ? requestError.message : "删除视图失败"); }
    finally { setSavedViewsSaving(false); }
  };

  const selectIssueView = (nextView: DevIssueListView) => {
    setActiveSavedViewId(null);
    setActiveView(nextView);
    if (nextView === "assigned" && user) {
      updateIssueQuery({ author: "", participant: "", assignee: user.id, subscribed: false, mentioned: false });
      return;
    }
    if (nextView === "created" && user) {
      updateIssueQuery({ author: user.id, participant: "", assignee: "", subscribed: false, mentioned: false });
      return;
    }
    if (nextView === "participating" && user) {
      updateIssueQuery({ author: "", participant: user.id, assignee: "", subscribed: false, mentioned: false });
      return;
    }
    if (nextView === "subscribed" && user) {
      updateIssueQuery({ author: "", participant: "", assignee: "", subscribed: true, mentioned: false });
      return;
    }
    if (nextView === "mentioned" && user) {
      updateIssueQuery({ author: "", participant: "", assignee: "", subscribed: false, mentioned: true });
      return;
    }
    if (nextView === "recent") {
      updateIssueQuery({ author: "", participant: "", assignee: "", subscribed: false, mentioned: false, sort: "activity", direction: "desc" });
      return;
    }
    updateIssueQuery({ author: "", participant: "", assignee: "", subscribed: false, mentioned: false });
  };

  const showCreateIssue = useCallback((parentIssueId?: number, template?: DevIssueTemplateConfig, returnToTemplates = false) => {
    setError(null);
    setIssueTemplateNotice(null);
    const createKey = `${issueDraftPrefix}:create`;
    const restored = readDevIssueCreateDraft(createKey);
    const hasDraft = hasPersistedDevIssueCreateContent(createKey);
    setCreateWasRestoredDraft(hasDraft);
    const validLabels = template && !hasDraft ? template.labels.filter((id) => id !== "bug" && id !== "feature" && availableLabels.some((label) => label.id === id)) : [];
    const missingLabels = template && !hasDraft ? template.labels.filter((id) => !availableLabels.some((label) => label.id === id)) : [];
    const initialBody = hasDraft ? "" : template?.body ?? "";
    setCreateTitle(hasDraft ? restored.title : template?.titlePrefix ?? "");
    setCreateInitialBody(initialBody);
    setCreateBody(initialBody);
    setIssueType(hasDraft ? restored.issueType : template?.type ?? "task");
    setCreateLabelIds(hasDraft ? restored.labelIds : validLabels);
    setCreateAssigneeIds(restored.assigneeIds);
    setCreateMilestoneId(restored.milestoneId);
    if (missingLabels.length > 0) setIssueTemplateNotice(`模板中的标签已不可用：${missingLabels.join("、")}`);
    setCreateDraftId(createDevIssueDraftId());
    setView({ kind: "create", ...(parentIssueId === undefined ? {} : { parentIssueId }), ...(returnToTemplates ? { returnToTemplates: true } : {}) });
  }, [availableLabels, issueDraftPrefix]);
  const showReferenceCommentIssue = useCallback((source: DevIssueDetail, commentId: number, body: string, authorId: string, trigger: HTMLButtonElement | null) => {
    const key = `${issueDraftPrefix}:reference-comment:${source.issue.id}:${commentId}`;
    const restored = readDevIssueCreateDraft(key);
    const hasDraft = hasPersistedDevIssueCreateContent(key);
    const initialBody = hasDraft ? "" : referenceDevIssueComment(body, authorId, source.issue.issue_number, createDevIssueCommentHref(source.issue.id, commentId));
    setError(null); setIssueTemplateNotice(null); setCreateWasRestoredDraft(hasDraft);
    setCreateTitle(hasDraft ? restored.title : ""); setCreateInitialBody(initialBody); setCreateBody(initialBody);
    setIssueType(hasDraft ? restored.issueType : "task"); setCreateLabelIds(hasDraft ? restored.labelIds : []);
    setCreateAssigneeIds(hasDraft ? restored.assigneeIds : []); setCreateMilestoneId(hasDraft ? restored.milestoneId : null);
    setCreateDraftId(createDevIssueDraftId()); setView({ kind: "create", reference: { detail: source, commentId, trigger } });
  }, [issueDraftPrefix]);
  const beginCreateIssue = useCallback(() => {
    if (hasPersistedDevIssueCreateContent(`${issueDraftPrefix}:create`)) return showCreateIssue();
    if (!issueTemplatesLoaded || issueTemplatesLoading || issueTemplatesError || issueTemplates.length > 0) return setView({ kind: "templates" });
    showCreateIssue();
  }, [issueDraftPrefix, issueTemplates.length, issueTemplatesError, issueTemplatesLoaded, issueTemplatesLoading, showCreateIssue]);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const params = new URLSearchParams({ pagePath });
    setIssueTemplatesLoading(true); setIssueTemplatesError(null);
    void requestDevIssue<{ templates?: DevIssueTemplateConfig[] }>(`/api/issues/config?${params.toString()}`, { credentials: "include", signal: controller.signal })
      .then((config) => { setIssueTemplates(Array.isArray(config.templates) ? config.templates : []); setIssueTemplatesLoaded(true); })
      .catch((requestError) => { if (!controller.signal.aborted) { setIssueTemplatesError(requestError instanceof Error ? requestError.message : "Issue 模板暂不可用"); setIssueTemplatesLoaded(true); } })
      .finally(() => { if (!controller.signal.aborted) setIssueTemplatesLoading(false); });
    return () => controller.abort();
  }, [issueTemplatesRevision, open, pagePath]);
  const showIssueList = () => {
    if (view.kind === "create") pendingCreateIssueFocusRef.current = true;
    if (view.kind === "detail" && pendingIssueFocusIdRef.current === null) pendingIssueFocusIdRef.current = view.issue.id;
    ++detailRequestGenerationRef.current;
    setDetailLoading(false);
    setError(null);
    setDetailUpdateNotice(false);
    setView({ kind: "list" });
    onIssueNavigate(null);
  };
  const cancelCreateIssue = () => {
    if (view.kind === "create" && view.reference) {
      const { detail: source, commentId, trigger } = view.reference;
      setDetail(source); setView({ kind: "detail", issue: source.issue }); onIssueNavigate(source.issue.id, "replace");
      const url = new URL(createDevIssueCommentHref(source.issue.id, commentId), window.location.href);
      window.history.replaceState(null, "", url);
      const focusCommentMenu = () => (trigger?.isConnected ? trigger : document.querySelector<HTMLButtonElement>(`[data-localapp-issue-comment-id="${commentId}"] button[aria-label="评论操作"]`))?.focus();
      window.requestAnimationFrame(focusCommentMenu);
      window.setTimeout(focusCommentMenu, 50);
      window.setTimeout(focusCommentMenu, 150);
      return;
    }
    if (view.kind === "create" && view.returnToTemplates) setView({ kind: "templates" });
    else showIssueList();
  };

  useEffect(() => {
    if (view.kind === "create") writeDevIssueCreateDraft(createPersistenceKey, createTitle, issueType, createLabelIds, createAssigneeIds, createMilestoneId);
  }, [createAssigneeIds, createLabelIds, createMilestoneId, createTitle, issueDraftPrefix, issueType, view.kind]);

  useEffect(() => {
    if (view.kind !== "create" || !createTitle.trim() || Array.from(createBody).length < 100) {
      setPotentialDuplicates([]); setPotentialDuplicatesLoading(false); setPotentialDuplicatesError(null);
      return;
    }
    const controller = new AbortController();
    setPotentialDuplicates([]); setPotentialDuplicatesError(null); setPotentialDuplicatesLoading(true);
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams({ pagePath, title: createTitle.trim(), body: createBody });
      void requestDevIssue<DevIssuePotentialDuplicate[]>(`/api/issues/potential-duplicates?${params.toString()}`, { credentials: "include", signal: controller.signal })
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
    if (view.kind === "create" && milestoneCatalogLoaded && createMilestoneId !== null && !availableMilestones.some((item) => item.id === createMilestoneId)) setCreateMilestoneId(null);
  }, [availableMilestones, createMilestoneId, milestoneCatalogLoaded, view.kind]);

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    dialog?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      const nestedDialog = target instanceof Element && target.closest('[role="dialog"]') !== dialog;
      if (nestedDialog) return;
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      const editable = target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
      if (event.key === "/" && (event.metaKey || event.ctrlKey) && view.kind === "list" && !editable) {
        event.preventDefault();
        issueSearchInputRef.current?.focus();
        return;
      }
      if (event.key === "/" && view.kind === "list" && !editable) {
        event.preventDefault();
        issueSearchInputRef.current?.focus();
        return;
      }
      if (event.key.toLowerCase() === "c" && view.kind === "list" && user && !editable && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        beginCreateIssue();
        return;
      }
      if (event.key.toLowerCase() === "r" && view.kind === "detail" && user && dialog?.querySelector("[data-localapp-issue-comment-composer]") && !editable && !nestedDialog && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        focusDevIssueCommentComposer();
        return;
      }
      const issueFilterShortcutLabels: Record<string, string> = { u: "按创建者筛选", l: "按标签筛选", m: "按里程碑筛选", a: "按负责人筛选" };
      const issueFilterLabel = issueFilterShortcutLabels[event.key.toLowerCase()];
      if (issueFilterLabel && view.kind === "list" && !editable && !nestedDialog && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey && dialog) {
        const filter = dialog.querySelector<HTMLSelectElement>(`select[aria-label="${issueFilterLabel}"]`);
        if (filter) {
          event.preventDefault();
          const container = filter.closest<HTMLElement>("#localapp-dev-issue-advanced-filters");
          if (container?.classList.contains("hidden")) dialog.querySelector<HTMLButtonElement>('[aria-controls="localapp-dev-issue-advanced-filters"]')?.click();
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
      if (issueNavigationDirection !== 0 && view.kind === "list" && !editable && !nestedDialog && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey && dialog) {
        const links = Array.from(dialog.querySelectorAll<HTMLAnchorElement>("[data-localapp-issue-link]"));
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
        showIssueList();
        return;
      }
      if (event.key === "Tab" && dialog) {
        const focusableElements = Array.from(dialog.querySelectorAll<HTMLElement>(DEV_ISSUE_FOCUSABLE_SELECTOR))
          .filter((element) => isDevIssueFocusTargetVisible(element, dialog));
        const firstFocusable = focusableElements[0];
        const lastFocusable = focusableElements[focusableElements.length - 1];
        if (!firstFocusable || !lastFocusable) {
          event.preventDefault();
          dialog.focus();
        } else if (event.shiftKey && (document.activeElement === firstFocusable || document.activeElement === dialog)) {
          event.preventDefault();
          lastFocusable.focus();
        } else if (!event.shiftKey && (document.activeElement === lastFocusable || document.activeElement === dialog)) {
          event.preventDefault();
          firstFocusable.focus();
        }
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, [beginCreateIssue, open, user, view.kind]);

  const loadIssueDetail = useCallback(async (issueId: number, lookupByNumber = false) => {
    const generation = ++detailRequestGenerationRef.current;
    detailLookupByNumberRef.current = lookupByNumber;
    setDetailLoading(true);
    setError(null);
    setDetailUpdateNotice(false);
    try {
      const query = new URLSearchParams({ pagePath });
      const endpoint = lookupByNumber ? `/api/issues/by-number/${issueId}` : `/api/issues/${issueId}`;
      const nextDetail = await requestDevIssue<DevIssueDetail>(`${endpoint}?${query.toString()}`, { credentials: "include" });
      if (detailRequestGenerationRef.current !== generation) return;
      if (lookupByNumber) {
        onIssueNavigate(nextDetail.issue.id, "replace");
        const commentId = pendingReferenceCommentIdRef.current;
        pendingReferenceCommentIdRef.current = null;
        if (commentId !== null) {
          const url = updateDevIssueCommentDeepLinkUrl(new URL(window.location.href), nextDetail.issue.id, commentId);
          window.history.replaceState(window.history.state, "", url);
        }
      }
      setDetail(nextDetail);
      setView({ kind: "detail", issue: nextDetail.issue });
      setIssues((current) => current.map((issue) => issue.id === nextDetail.issue.id ? nextDetail.issue : issue));
    } catch (requestError) {
      if (detailRequestGenerationRef.current !== generation) return;
      const message = requestError instanceof Error ? requestError.message : "Issue 服务暂不可用";
      setError(message);
    } finally {
      if (detailRequestGenerationRef.current === generation) setDetailLoading(false);
    }
  }, [onIssueNavigate, pagePath]);
  const loadIssueDetailByNumber = useCallback((issueNumber: number) => loadIssueDetail(issueNumber, true), [loadIssueDetail]);
  const openIssueByNumber = useCallback((issueNumber: number, commentId: number | null = null) => {
    pendingReferenceCommentIdRef.current = commentId;
    onIssueNumberNavigate(issueNumber);
    setDetail(null);
    setView({ kind: "detail", issue: { id: issueNumber, issue_number: issueNumber } as DevIssue });
    void loadIssueDetailByNumber(issueNumber);
  }, [loadIssueDetailByNumber, onIssueNumberNavigate]);

  const refreshIssueDetailSilently = useCallback(async (issueId: number) => {
    const params = new URLSearchParams({ pagePath });
    const nextDetail = await requestDevIssue<DevIssueDetail>(`/api/issues/${issueId}?${params.toString()}`, { credentials: "include" });
    const currentDetail = issueDetailRef.current;
    const changed = currentDetail?.issue.id === issueId && (nextDetail.issue.updated_at !== currentDetail.issue.updated_at || nextDetail.timeline.length !== currentDetail.timeline.length);
    setDetail((current) => current?.issue.id === issueId ? nextDetail : current);
    setView((current) => current.kind === "detail" && current.issue.id === issueId
      ? { kind: "detail", issue: nextDetail.issue }
      : current);
    setIssues((current) => current.map((issue) => issue.id === issueId ? nextDetail.issue : issue));
    if (changed) setDetailUpdateNotice(true);
    setDetailSyncFailed(false);
  }, [pagePath]);

  const retryIssueDetailSync = async () => {
    const currentDetail = issueDetailRef.current;
    if (detailSyncing || !currentDetail) return;
    setDetailSyncing(true);
    try {
      await refreshIssueDetailSilently(currentDetail.issue.id);
      setError(null);
    } catch {
      setDetailSyncFailed(true);
      setError("无法同步最新 Issue，当前内容可能已过期");
    } finally {
      setDetailSyncing(false);
    }
  };

  useEffect(() => {
    if (!open || typeof EventSource === "undefined") return;
    const params = new URLSearchParams({ pagePath });
    let events: EventSource | null = null;
    let windowActive = true;
    const handleIssueChanged = (event: Event) => {
      let envelope: { data?: { pagePath?: string; issueId?: number | null } };
      try {
        envelope = JSON.parse((event as MessageEvent<string>).data) as { data?: { pagePath?: string; issueId?: number | null } };
      } catch {
        return;
      }
      const changed = envelope.data;
      if (!changed) return;
      if (changed.pagePath !== pagePath) return;
      pendingIssueChangedIdsRef.current.add(changed.issueId ?? null);
      if (issueEventRefreshTimerRef.current !== null) window.clearTimeout(issueEventRefreshTimerRef.current);
      issueEventRefreshTimerRef.current = window.setTimeout(() => {
        issueEventRefreshTimerRef.current = null;
        const changedIssueIds = new Set(pendingIssueChangedIdsRef.current);
        pendingIssueChangedIdsRef.current.clear();
        void fetchIssues(issueQueryRef.current);
        const currentView = issueViewRef.current;
        const currentDetail = issueDetailRef.current;
        if (currentView.kind !== "detail" || !currentDetail) return;
        if (!changedIssueIds.has(null) && !changedIssueIds.has(currentDetail.issue.id)) return;
        void refreshIssueDetailSilently(currentDetail.issue.id).catch(() => {
          setDetailSyncFailed(true);
          setError("无法同步最新 Issue，当前内容可能已过期");
        });
      }, 120);
    };
    const disconnect = () => { events?.close(); events = null; };
    const connect = (refresh: boolean) => {
      if (document.visibilityState === "hidden" || !windowActive) return;
      if (events) return;
      events = new EventSource(`/api/issues/events?${params.toString()}`);
      events.addEventListener("issue:changed", handleIssueChanged);
      if (!refresh) return;
      void fetchIssues(issueQueryRef.current);
      const currentView = issueViewRef.current;
      const currentDetail = issueDetailRef.current;
      if (currentView.kind === "detail" && currentDetail) {
        void refreshIssueDetailSilently(currentDetail.issue.id).catch(() => setDetailSyncFailed(true));
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
      events?.removeEventListener("issue:changed", handleIssueChanged);
      disconnect();
      if (issueEventRefreshTimerRef.current !== null) window.clearTimeout(issueEventRefreshTimerRef.current);
      issueEventRefreshTimerRef.current = null;
      pendingIssueChangedIdsRef.current.clear();
    };
  }, [fetchIssues, open, pagePath, refreshIssueDetailSilently]);

  const openIssue = (issue: DevIssue) => {
    pendingIssueFocusIdRef.current = issue.id;
    deepLinkAttemptKeyRef.current = `${pagePath}:${issue.id}`;
    onIssueNavigate(issue.id);
    setDetail(null);
    setView({ kind: "detail", issue });
    void loadIssueDetail(issue.id);
  };

  useEffect(() => {
    if (!open) return;
    if (selectedIssueId === null) {
      if (selectedIssueNumber !== null) return;
      ++detailRequestGenerationRef.current; setDetailLoading(false);
      deepLinkAttemptKeyRef.current = null;
      setView((current) => current.kind === "detail" ? { kind: "list" } : current);
      return;
    }
    const attemptKey = `${pagePath}:${selectedIssueId}`;
    if (deepLinkAttemptKeyRef.current === attemptKey) return;
    const currentIssueId = view.kind === "detail" ? view.issue.id : null;
    if (currentIssueId === selectedIssueId && detail) return;
    deepLinkAttemptKeyRef.current = attemptKey;
    setDetail(null);
    setView({ kind: "detail", issue: { id: selectedIssueId, issue_number: selectedIssueId } as DevIssue });
    void loadIssueDetail(selectedIssueId);
  }, [detail, loadIssueDetail, open, pagePath, selectedIssueId, selectedIssueNumber, view]);

  useEffect(() => {
    if (!open || selectedIssueNumber === null) return;
    const currentIssueNumber = view.kind === "detail" ? view.issue.issue_number : null;
    if (currentIssueNumber === selectedIssueNumber) return;
    deepLinkAttemptKeyRef.current = `${pagePath}:number:${selectedIssueNumber}`;
    setDetail(null);
    setView({ kind: "detail", issue: { id: selectedIssueNumber, issue_number: selectedIssueNumber } as DevIssue });
    void loadIssueDetailByNumber(selectedIssueNumber);
  }, [detail, loadIssueDetailByNumber, open, pagePath, selectedIssueNumber, view]);

  const syncIssueStatusAcrossViews = useCallback((updatedIssue: DevIssue) => {
    setDetail((current) => current?.issue.id === updatedIssue.id ? { ...current, issue: updatedIssue } : current);
    setView((current) => current.kind === "detail" && current.issue.id === updatedIssue.id
      ? { kind: "detail", issue: updatedIssue }
      : current);
    setIssues((current) => current.map((issue) => issue.id === updatedIssue.id ? updatedIssue : issue));
    onIssuesChanged();
  }, [onIssuesChanged]);

  const syncIssueDetailAcrossViews = useCallback((updatedDetail: DevIssueDetail) => {
    setDetail(updatedDetail);
    syncIssueStatusAcrossViews(updatedDetail.issue);
  }, [syncIssueStatusAcrossViews]);

  const refreshingIssues = loading && issues.length > 0;
  const issuePageOutOfRange = query.offset > 0 && issues.length === 0;
  useEffect(() => {
    if (!paginationFocusPendingRef.current) return;
    if (paginationFocusOffsetRef.current !== query.offset) { paginationFocusPendingRef.current = false; paginationFocusOffsetRef.current = null; return; }
    if (loading || listError || meta.offset !== query.offset) return;
    paginationFocusPendingRef.current = false;
    paginationFocusOffsetRef.current = null;
    const frame = window.requestAnimationFrame(() => {
      if (issues.length > 0) issueResultsRef.current?.querySelector<HTMLElement>("[data-localapp-issue-link]")?.focus();
      else if (issuePageOutOfRange) returnFirstPageRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [issuePageOutOfRange, issues, listError, loading, meta.offset, query.offset]);
  const changeIssuePage = (offset: number) => { paginationFocusPendingRef.current = true; paginationFocusOffsetRef.current = offset; updateIssueQuery({ offset }); };
  const hasActiveIssueFilters = Boolean(query.q || query.searchIn || query.issueType || query.label || query.author || query.participant || query.assignee || query.milestone || query.reason || query.subscribed || query.mentioned || query.locked);
  const showPinnedIssues = activeView === "all" && query.status === "open" && query.offset === 0 && !hasActiveIssueFilters && query.sort === "activity" && query.direction === "desc" && pinnedIssues.length > 0;
  const canBulkManage = Boolean(user && (user.id === pageOwnerId || user.role === "owner"));
  const issueViewLabels: Record<DevIssueListView, string> = { all: "全部 Issue", assigned: "分配给我的", created: "我创建的", participating: "我参与的", subscribed: "我关注的", mentioned: "提及我的", recent: "最近活动" };
  const issueViewOptions = (["all", "assigned", "created", "participating", "subscribed", "mentioned", "recent"] as const).filter((nextView) => user || (nextView !== "assigned" && nextView !== "created" && nextView !== "participating" && nextView !== "subscribed" && nextView !== "mentioned"));
  const selectedIssueCount = selectedIssueIds.size;
  const allIssuesSelected = issues.length > 0 && issues.every((issue) => selectedIssueIds.has(issue.id));
  const someIssuesSelected = selectedIssueCount > 0 && !allIssuesSelected;
  useEffect(() => { if (selectAllIssuesRef.current) selectAllIssuesRef.current.indeterminate = someIssuesSelected; }, [someIssuesSelected]);
  if (!open) return null;
  const focusSelectAllAfterBulkSave = () => {
    let attempts = 0;
    let stableChecks = 0;
    const focusWhenReady = () => {
      const control = document.querySelector<HTMLInputElement>('[data-localapp-issues-workspace] input[aria-label="选择当前页全部 Issue"]');
      if (!control || control.disabled) {
        stableChecks = 0;
      } else if (document.activeElement !== control) {
        control.focus();
        stableChecks = 0;
      } else {
        stableChecks += 1;
      }
      if (stableChecks < 3 && attempts++ < 20) window.setTimeout(focusWhenReady, 50);
    };
    window.setTimeout(focusWhenReady, 50);
  };
  const toggleIssueSelectionRange = (issueId: number, selected: boolean, range: boolean) => {
    const anchorId = selectionAnchorIssueIdRef.current;
    const anchorIndex = range && anchorId !== null ? issues.findIndex((issue) => issue.id === anchorId) : -1;
    const targetIndex = issues.findIndex((issue) => issue.id === issueId);
    setSelectedIssueIds((current) => {
      const next = new Set(current);
      const rangeIds = anchorIndex >= 0 && targetIndex >= 0
        ? issues.slice(Math.min(anchorIndex, targetIndex), Math.max(anchorIndex, targetIndex) + 1).map((issue) => issue.id)
        : [issueId];
      for (const id of rangeIds) { if (selected) next.add(id); else next.delete(id); }
      return next;
    });
    selectionAnchorIssueIdRef.current = issueId;
  };
  const selectSearchSuggestion = (suggestion: DevIssueSearchSuggestion) => {
    const next = applyDevIssueSearchSuggestion(searchInput, issueSearchSuggestionResult, suggestion.value);
    insertedSearchSuggestionCursorRef.current = next.cursor;
    setSearchInput(next.value);
    setSearchSuggestionCursor(next.cursor);
    setActiveSearchSuggestion(-1);
    setSearchSuggestionsOpen(true);
    issueSearchInputRef.current?.focus();
    window.requestAnimationFrame(() => issueSearchInputRef.current?.setSelectionRange(next.cursor, next.cursor));
  };
  const clearIssueSearch = () => {
    setSearchInput("");
    updateIssueQuery({ q: "", searchIn: "", offset: 0 });
    setSearchSuggestionsOpen(false);
    setActiveSearchSuggestion(-1);
    setSearchSuggestionCursor(0);
    window.requestAnimationFrame(() => issueSearchInputRef.current?.focus());
  };
  const applyBulkIssueStatus = async () => {
    if (!canBulkManage || selectedIssueCount === 0 || bulkSaving) return;
    setBulkSaving(true);
    setBulkMessage("");
    const targetStatus: DevIssue["status"] = query.status === "open" ? "closed" : "open";
    const ids = Array.from(selectedIssueIds);
    const results = await Promise.allSettled(ids.map(async (issueId) => {
      await requestDevIssue<DevIssue>(`/api/issues/${issueId}`, { method: "PATCH", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pagePath, status: targetStatus }) });
    }));
    const failedIds = ids.filter((_, index) => results[index].status === "rejected");
    const succeeded = ids.length - failedIds.length;
    selectionAnchorIssueIdRef.current = null;
    setSelectedIssueIds(new Set(failedIds));
    setBulkMessage(failedIds.length ? `${succeeded} 条成功，${failedIds.length} 条失败，可重试失败项` : `${succeeded} 条 Issue 已更新`);
    await fetchIssues(query);
    if (succeeded > 0) onIssuesChanged();
    setBulkSaving(false);
    if (failedIds.length === 0) focusSelectAllAfterBulkSave();
  };
  const applyBulkIssueType = async (value: string) => {
    if (!canBulkManage || selectedIssueCount === 0 || bulkSaving || !value) return;
    const issueType = value as DevIssueType;
    setBulkSaving(true);
    setBulkMessage("");
    const ids = Array.from(selectedIssueIds);
    const results = await Promise.allSettled(ids.map(async (issueId) => {
      await requestDevIssue<DevIssue>(`/api/issues/${issueId}`, { method: "PATCH", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pagePath, issueType }) });
    }));
    const failedIds = ids.filter((_, index) => results[index].status === "rejected");
    const succeeded = ids.length - failedIds.length;
    selectionAnchorIssueIdRef.current = null;
    setSelectedIssueIds(new Set(failedIds));
    setBulkMessage(failedIds.length ? `${succeeded} 条成功，${failedIds.length} 条失败，可重试失败项` : `${succeeded} 条 Issue 已更新`);
    await fetchIssues(query);
    if (succeeded > 0) onIssuesChanged();
    setBulkSaving(false);
    if (failedIds.length === 0) focusSelectAllAfterBulkSave();
    setBulkIssueTypeAction("");
  };
  const applyBulkIssueLabel = async (value: string) => {
    if (!canBulkManage || selectedIssueCount === 0 || bulkSaving || !value) return;
    const [operation, labelId] = value.split(":", 2);
    if (!labelId || (operation !== "add" && operation !== "remove")) return;
    setBulkSaving(true);
    setBulkMessage("");
    const ids = Array.from(selectedIssueIds);
    const results = await Promise.allSettled(ids.map(async (issueId) => {
      const issue = issues.find((candidate) => candidate.id === issueId);
      const current = issue?.labels?.map((label) => label.id) ?? [];
      const labelIds = operation === "add" ? Array.from(new Set([...current, labelId])) : current.filter((id) => id !== labelId);
      await requestDevIssue<DevIssueDetail>(`/api/issues/${issueId}/labels`, { method: "PUT", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pagePath, labelIds }) });
    }));
    const failedIds = ids.filter((_, index) => results[index].status === "rejected");
    const succeeded = ids.length - failedIds.length;
    selectionAnchorIssueIdRef.current = null;
    setSelectedIssueIds(new Set(failedIds));
    setBulkMessage(failedIds.length ? `${succeeded} 条成功，${failedIds.length} 条失败，可重试失败项` : `${succeeded} 条 Issue 已更新`);
    await fetchIssues(query);
    if (succeeded > 0) onIssuesChanged();
    setBulkSaving(false);
    if (failedIds.length === 0) focusSelectAllAfterBulkSave();
    setBulkLabelAction("");
  };
  const applyBulkIssueAssignee = async (value: string) => {
    if (!canBulkManage || selectedIssueCount === 0 || bulkSaving || !value) return;
    const [operation, userId] = value.split(":", 2);
    if (!userId || (operation !== "add" && operation !== "remove")) return;
    setBulkSaving(true);
    setBulkMessage("");
    const ids = Array.from(selectedIssueIds);
    const results = await Promise.allSettled(ids.map(async (issueId) => {
      const issue = issues.find((candidate) => candidate.id === issueId);
      const current = issue?.assignee_ids ?? [];
      const userIds = operation === "add" ? Array.from(new Set([...current, userId])) : current.filter((id) => id !== userId);
      await requestDevIssue<DevIssueDetail>(`/api/issues/${issueId}/assignees`, { method: "PUT", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pagePath, userIds }) });
    }));
    const failedIds = ids.filter((_, index) => results[index].status === "rejected");
    const succeeded = ids.length - failedIds.length;
    selectionAnchorIssueIdRef.current = null;
    setSelectedIssueIds(new Set(failedIds));
    setBulkMessage(failedIds.length ? `${succeeded} 条成功，${failedIds.length} 条失败，可重试失败项` : `${succeeded} 条 Issue 已更新`);
    await fetchIssues(query);
    if (succeeded > 0) onIssuesChanged();
    setBulkSaving(false);
    if (failedIds.length === 0) focusSelectAllAfterBulkSave();
    setBulkAssigneeAction("");
  };
  const applyBulkIssueMilestone = async (value: string) => {
    if (!canBulkManage || selectedIssueCount === 0 || bulkSaving || !value) return;
    const milestoneId = value === "none" ? null : Number(value);
    if (milestoneId !== null && (!Number.isInteger(milestoneId) || milestoneId <= 0)) return;
    setBulkSaving(true);
    setBulkMessage("");
    const ids = Array.from(selectedIssueIds);
    const results = await Promise.allSettled(ids.map(async (issueId) => {
      await requestDevIssue<DevIssueDetail>(`/api/issues/${issueId}/milestone`, { method: "PUT", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pagePath, milestoneId }) });
    }));
    const failedIds = ids.filter((_, index) => results[index].status === "rejected");
    const succeeded = ids.length - failedIds.length;
    selectionAnchorIssueIdRef.current = null;
    setSelectedIssueIds(new Set(failedIds));
    setBulkMessage(failedIds.length ? `${succeeded} 条成功，${failedIds.length} 条失败，可重试失败项` : `${succeeded} 条 Issue 已更新`);
    await fetchIssues(query);
    if (succeeded > 0) onIssuesChanged();
    setBulkSaving(false);
    if (failedIds.length === 0) focusSelectAllAfterBulkSave();
    setBulkMilestoneAction("");
  };

  const createTitleCharacterCount = Array.from(createTitle.trim()).length;
  const createTitleTooLong = createTitleCharacterCount > DEV_ISSUE_TITLE_MAX_CHARACTERS;
  const submitIssue = async ({ body, attachmentIds, draftId }: DevIssueComposerSubmit) => {
    const title = createTitle.trim();
    if (!title) {
      const titleError = "Issue 标题是必填项";
      setError(titleError);
      throw new Error(titleError);
    }
    if (createTitleTooLong) {
      const titleError = "Issue 标题不能超过 256 个字符";
      setError(titleError);
      throw new Error(titleError);
    }
    setSubmitting(true);
    setError(null);
    try {
      const created = await requestDevIssue<DevIssue>("/api/issues", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pagePath, title, description: body, issueType, draftId, attachmentIds, ...(canBulkManage ? { labelIds: createLabelIds, assigneeIds: createAssigneeIds, ...(createMilestoneId === null ? {} : { milestoneId: createMilestoneId }), ...(view.kind === "create" && view.parentIssueId !== undefined ? { parentIssueId: view.parentIssueId } : {}) } : {}) }),
      });
      resetIssueList();
      setCreateTitle("");
      setCreateInitialBody("");
      setCreateBody("");
      setCreateWasRestoredDraft(false);
      setCreateLabelIds([]);
      setCreateAssigneeIds([]);
      setCreateMilestoneId(null);
      writeDevIssueCreateDraft(createPersistenceKey, "", "bug", [], [], null);
      setCreateDraftId(createDevIssueDraftId());
      onIssuesChanged();
      onIssueNavigate(created.id);
      await loadIssueDetail(created.id);
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : "Issue 服务暂不可用";
      throw requestError instanceof Error ? requestError : new Error(message);
    } finally {
      setSubmitting(false);
    }
  };

  const toggleIssueStatus = async (issue: DevIssue, stateReason: "completed" | "not_planned" = "completed") => {
    const nextStatus: DevIssue["status"] = issue.status === "open" ? "closed" : "open";
    setSubmitting(true);
    setError(null);
    try {
      const updatedIssue = await requestDevIssue<DevIssue>(`/api/issues/${issue.id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pagePath, status: nextStatus, stateReason: nextStatus === "closed" ? stateReason : null }),
      });
      syncIssueStatusAcrossViews(updatedIssue);
      if (view.kind === "detail") {
        await Promise.all([loadIssueDetail(issue.id), fetchIssues(query)]);
      } else {
        await fetchIssues(query);
      }
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : "Issue 服务暂不可用";
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  const updateIssueDetail = async (updates: Partial<Pick<DevIssue, "title" | "description" | "status">> & { issueType?: DevIssueType; expectedUpdatedAt?: string; draftId?: string; attachmentIds?: string[]; removedAttachmentIds?: string[] }) => {
    if (!detail) return;
    setSubmitting(true);
    setError(null);
    try {
      const updatedIssue = await requestDevIssue<DevIssue>(`/api/issues/${detail.issue.id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pagePath, ...updates }),
      });
      syncIssueStatusAcrossViews(updatedIssue);
      await Promise.all([loadIssueDetail(detail.issue.id), fetchIssues(query)]);
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : "Issue 服务暂不可用";
      if (!updates.draftId) setError(message);
      throw requestError instanceof Error ? requestError : new Error(message);
    } finally {
      setSubmitting(false);
    }
  };

  const updateIssueCollaboration = async (kind: "labels" | "assignees" | "subscription" | "milestone" | "lock" | "pin", payload: Record<string, unknown>) => {
    if (!detail) return;
    setSubmitting(true);
    setError(null);
    try {
      const updatedDetail = await requestDevIssue<DevIssueDetail>(`/api/issues/${detail.issue.id}/${kind}`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pagePath, ...payload }),
      });
      syncIssueDetailAcrossViews(updatedDetail);
      await fetchIssues(query);
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : "Issue 服务暂不可用";
      setError(message);
      throw requestError instanceof Error ? requestError : new Error(message);
    } finally {
      setSubmitting(false);
    }
  };

  const toggleIssueReaction = async (content: DevIssueReactionContent, reacted: boolean, commentId?: number) => {
    if (!detail) return;
    setSubmitting(true);
    setError(null);
    try {
      const updatedDetail = await requestDevIssue<DevIssueDetail>(`/api/issues/${detail.issue.id}/reactions`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pagePath, content, reacted, ...(commentId === undefined ? {} : { commentId }) }),
      });
      syncIssueDetailAcrossViews(updatedDetail);
      await fetchIssues(query);
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : "Issue 表态更新失败";
      setError(message);
      throw requestError instanceof Error ? requestError : new Error(message);
    } finally {
      setSubmitting(false);
    }
  };

  const createComment = async (input: DevIssueComposerSubmit) => {
    if (!detail) return;
    setError(null);
    try {
      const commentDetail = await requestDevIssue<DevIssueDetail>(`/api/issues/${detail.issue.id}/comments`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pagePath, ...input, draftId: input.draftId }),
      });
      const previousCommentIds = new Set(detail.timeline.flatMap((item) => item.kind === "comment" ? [item.comment.id] : []));
      const createdComment = commentDetail.timeline.find((item) => item.kind === "comment" && !previousCommentIds.has(item.comment.id));
      if (createdComment?.kind === "comment") {
        const url = new URL(createDevIssueCommentHref(detail.issue.id, createdComment.comment.id), window.location.href);
        window.history.replaceState(window.history.state, "", url);
      }
      syncIssueDetailAcrossViews(commentDetail);
      await fetchIssues(query);
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : "Issue 服务暂不可用";
      throw requestError instanceof Error ? requestError : new Error(message);
    }
  };

  const updateComment = async (commentId: number, body: string, expectedUpdatedAt?: string, draftId?: string, attachmentIds?: string[], removedAttachmentIds?: string[]) => {
    if (!detail) return;
    setError(null);
    try {
      const updatedDetail = await requestDevIssue<DevIssueDetail>(`/api/issues/${detail.issue.id}/comments/${commentId}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pagePath, body, ...(expectedUpdatedAt ? { expectedUpdatedAt } : {}), ...(draftId ? { draftId, attachmentIds: attachmentIds ?? [], removedAttachmentIds: removedAttachmentIds ?? [] } : {}) }),
      });
      syncIssueDetailAcrossViews(updatedDetail);
      await fetchIssues(query);
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : "Issue 服务暂不可用";
      await loadIssueDetail(detail.issue.id).catch(() => undefined);
      throw requestError instanceof Error ? requestError : new Error(message);
    }
  };

  const deleteComment = async (commentId: number) => {
    if (!detail) return;
    setError(null);
    try {
      const requestQuery = new URLSearchParams({ pagePath });
      await requestDevIssue(`/api/issues/${detail.issue.id}/comments/${commentId}?${requestQuery.toString()}`, {
        method: "DELETE",
        credentials: "include",
      });
      await Promise.all([loadIssueDetail(detail.issue.id), fetchIssues(query)]);
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : "Issue 服务暂不可用";
      setError(message);
      throw requestError instanceof Error ? requestError : new Error(message);
    }
  };

  const deleteCurrentIssue = async () => {
    if (!detail) return;
    const requestQuery = new URLSearchParams({ pagePath });
    await requestDevIssue(`/api/issues/${detail.issue.id}?${requestQuery.toString()}`, { method: "DELETE", credentials: "include" });
    setDetail(null);
    setView({ kind: "list" });
    onIssueNavigate(null);
    await fetchIssues(query);
  };

  const toggleCommentPin = async (commentId: number, pinned: boolean) => {
    if (!detail) return;
    setError(null);
    try {
      const updatedDetail = await requestDevIssue<DevIssueDetail>(`/api/issues/${detail.issue.id}/comments/${commentId}/pin`, {
        method: pinned ? "PUT" : "DELETE",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pagePath }),
      });
      syncIssueDetailAcrossViews(updatedDetail);
      await fetchIssues(query);
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : "无法更新置顶评论";
      setError(message);
      throw requestError instanceof Error ? requestError : new Error(message);
    }
  };

  const toggleCommentMinimized = async (commentId: number, reason: DevIssueCommentMinimizedReason | null) => {
    if (!detail) return;
    setError(null);
    try {
      const updatedDetail = await requestDevIssue<DevIssueDetail>(`/api/issues/${detail.issue.id}/comments/${commentId}/minimize`, {
        method: reason === null ? "DELETE" : "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pagePath, ...(reason === null ? {} : { reason }) }),
      });
      syncIssueDetailAcrossViews(updatedDetail);
      await fetchIssues(query);
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : "无法更新评论最小化状态";
      setError(message);
      throw requestError instanceof Error ? requestError : new Error(message);
    }
  };

  const detailTitle = view.kind === "detail" ? detail?.issue.title ?? view.issue.title : undefined;
  const detailHeaderTitle = view.kind === "detail" ? detailTitle ? `Issue #${view.issue.issue_number} · ${detailTitle}` : `Issue #${view.issue.issue_number}` : undefined;
  const workspaceTitle = view.kind === "templates" ? "新建 Issue" : view.kind === "create" ? view.parentIssueId === undefined ? "新建 Issue" : "新建 Sub-issue" : view.kind === "labels" ? "标签" : view.kind === "milestones" ? "里程碑" : detailHeaderTitle ?? "Issues";

  return (
    <div data-localapp-issues-layer className="absolute inset-0 z-[70] flex items-center justify-center p-0 sm:p-2">
      <div className="pointer-events-none absolute inset-0 bg-black/45" aria-hidden="true" />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="dev-issues-title"
        tabIndex={-1}
        data-localapp-issues-workspace
        className="relative flex h-full w-full flex-col overflow-hidden bg-background text-localapp-dev-foreground shadow-lg outline-none sm:rounded-lg sm:border sm:border-localapp-dev-border"
      >
        <header className="flex min-h-14 items-center gap-3 border-b border-localapp-dev-border px-4 py-3 sm:px-5">
          {view.kind !== "list" && (
            <button
              type="button"
              aria-label={view.kind === "create" && view.parentIssueId !== undefined ? "返回父 Issue" : view.kind === "create" && view.returnToTemplates ? "返回模板选择" : "返回 Issue 列表"}
              aria-keyshortcuts="Alt+ArrowLeft"
              onClick={() => { if (view.kind === "create" && view.reference) cancelCreateIssue(); else if (view.kind === "create" && view.parentIssueId !== undefined) { setDetail(null); setView({ kind: "detail", issue: { id: view.parentIssueId, issue_number: view.parentIssueId } as DevIssue }); onIssueNavigate(view.parentIssueId); void loadIssueDetail(view.parentIssueId); } else if (view.kind === "create" && view.returnToTemplates) setView({ kind: "templates" }); else showIssueList(); }}
              className={`${DEV_ICON_BUTTON} h-11 w-11 shrink-0 sm:h-8 sm:w-8`}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg>
            </button>
          )}
          <div className="min-w-0 flex-1">
            <h2 id="dev-issues-title" title={detailHeaderTitle} className="min-w-0 truncate text-sm font-semibold">
              {workspaceTitle}
            </h2>
            <p className="truncate text-xs text-localapp-dev-muted-foreground">{pageName}</p>
          </div>
          {view.kind === "list" && user && (user.id === pageOwnerId || user.role === "owner") && <button type="button" aria-label="管理 Issue 里程碑" className={`${DEV_OUTLINE_BUTTON} flex h-11 shrink-0 items-center gap-1.5 sm:h-8`} onClick={() => { setMilestoneManagerError(null); setView({ kind: "milestones" }); const params = new URLSearchParams({ pagePath }); void requestDevIssue<DevIssueMilestoneDefinition[]>(`/api/issues/milestones?${params.toString()}`, { credentials: "include" }).then(setAvailableMilestones).catch((requestError) => setMilestoneManagerError(requestError instanceof Error ? requestError.message : "里程碑加载失败")); }}><CalendarDays className="h-4 w-4" /><span className="hidden md:inline">里程碑</span></button>}
          {view.kind === "list" && user && (user.id === pageOwnerId || user.role === "owner") && <button type="button" aria-label="管理 Issue 标签" className={`${DEV_OUTLINE_BUTTON} flex h-11 shrink-0 items-center gap-1.5 sm:h-8`} onClick={() => { setLabelManagerError(null); setView({ kind: "labels" }); }}><Tag className="h-4 w-4" /><span className="hidden sm:inline">标签</span></button>}
          {view.kind === "list" && user && (
            <button
              ref={createIssueTriggerRef}
              type="button"
              aria-label="新建 Issue"
              aria-keyshortcuts="C"
              onClick={beginCreateIssue}
              className={`flex h-11 shrink-0 items-center gap-1.5 rounded px-3 text-xs font-medium sm:h-8 sm:px-2.5 ${DEV_BUTTON_ACTIVE}`}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M5 12h14M12 5v14" /></svg>
              <span className="hidden sm:inline">新建 Issue</span>
            </button>
          )}
          <button type="button" aria-label="关闭 Issue 面板" aria-keyshortcuts="Escape" onClick={onClose} className={`${DEV_ICON_BUTTON} h-11 w-11 shrink-0 sm:h-8 sm:w-8`}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </header>

        {(labelCatalogError || userCatalogError || milestoneCatalogError) && <div role="alert" className="flex flex-wrap items-center justify-between gap-3 border-b border-localapp-dev-warning bg-localapp-dev-warning-muted px-5 py-2.5 text-sm"><span>{devCatalogFailureMessage(labelCatalogError, userCatalogError, milestoneCatalogError)}</span><button type="button" disabled={catalogRetrying} className={`${DEV_OUTLINE_BUTTON} h-11 shrink-0 sm:h-7`} aria-label={devCatalogRetryLabel(labelCatalogError, userCatalogError, milestoneCatalogError)} onClick={retryCatalogs}>{catalogRetrying ? "正在重试..." : "重试"}</button></div>}
        {error && view.kind !== "list" && detail && (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-3 border-b border-localapp-dev-danger bg-localapp-dev-danger-muted px-5 py-2.5 text-sm text-localapp-dev-danger">
            <span>{error}</span>
            {detailSyncFailed && <button type="button" disabled={detailSyncing} className={`${DEV_OUTLINE_BUTTON} h-11 shrink-0 sm:h-7`} onClick={() => { void retryIssueDetailSync(); }}>{detailSyncing ? "正在同步..." : "重新同步"}</button>}
          </div>
        )}
        {detailUpdateNotice && view.kind === "detail" && detail && <div role="status" aria-label="Issue 协作更新" className="flex min-h-11 items-center gap-3 border-b border-localapp-dev-border bg-localapp-dev-muted px-5 py-2 text-sm"><span className="min-w-0 flex-1">已同步最新协作活动</span><button type="button" aria-label="关闭协作更新提示" className={`${DEV_ICON_BUTTON} h-11 w-11 shrink-0 sm:h-7 sm:w-7`} onClick={() => setDetailUpdateNotice(false)}><X className="h-4 w-4" /></button></div>}

        {view.kind === "list" && (
          <section data-localapp-issue-list data-testid="issue-list-workspace" className="grid min-h-0 max-w-full flex-1 grid-rows-[auto_minmax(0,1fr)] overflow-x-hidden [&_[data-localapp-issue-bulk-toolbar]_label:focus-within]:ring-2 [&_[data-localapp-issue-bulk-toolbar]_label:focus-within]:ring-localapp-dev-focus lg:grid-cols-[240px_minmax(0,1fr)] lg:grid-rows-1">
            <aside data-localapp-issue-view-rail data-testid="issue-view-rail" aria-label="Issue 视图" className="min-w-0 border-b border-localapp-dev-border bg-localapp-dev-muted px-3 py-2 lg:border-b-0 lg:border-r lg:px-3 lg:py-4">
              <div className="flex min-w-0 items-center gap-2 lg:hidden"><label className="flex h-11 min-w-0 flex-1 items-center rounded border border-localapp-dev-border bg-background px-3 text-sm font-medium text-localapp-dev-foreground focus-within:ring-2 focus-within:ring-localapp-dev-focus"><span className="sr-only">Issue 视图</span><select aria-label="Issue 视图" value={activeSavedViewId ? `saved:${activeSavedViewId}` : activeView} onChange={(event) => { const value = event.target.value; if (value.startsWith("saved:")) { const saved = savedViews.find((item) => item.id === Number(value.slice(6))); if (saved) applySavedView(saved); } else selectIssueView(value as DevIssueListView); }} className="h-full min-w-0 w-full cursor-pointer bg-transparent outline-none"><optgroup label="内置视图">{issueViewOptions.map((nextView) => <option key={nextView} value={nextView}>{issueViewLabels[nextView]}</option>)}</optgroup>{savedViews.length > 0 && <optgroup label="保存的视图">{savedViews.map((saved) => <option key={saved.id} value={`saved:${saved.id}`}>{saved.name}{activeSavedViewId === saved.id && savedViewDirty ? " *" : ""}</option>)}</optgroup>}</select></label>{activeSavedView && savedViewDirty && <><button type="button" aria-label="保存视图更改" className={`${DEV_ICON_BUTTON} h-11 w-11`} disabled={savedViewsSaving} onClick={() => void saveSavedViewChanges()}><Check className="h-4 w-4" /></button><button type="button" aria-label="将当前查询另存为视图" className={`${DEV_ICON_BUTTON} h-11 w-11`} disabled={savedViewsSaving} onClick={() => openSavedViewEditor("save-as")}><Copy className="h-4 w-4" /></button></>}<button type="button" aria-label="保存当前 Issue 视图" className={`${DEV_ICON_BUTTON} h-11 w-11`} onClick={() => openSavedViewEditor("create")}><Plus className="h-4 w-4" /></button></div>
              <nav className="hidden max-w-full gap-1 lg:flex lg:flex-col" aria-label="Issue 视图导航">
                {issueViewOptions.map((nextView) => <button key={nextView} type="button" aria-pressed={activeView === nextView} onClick={() => selectIssueView(nextView)} className={`h-11 shrink-0 rounded px-3 text-left text-sm font-medium outline-none focus:ring-2 focus:ring-localapp-dev-focus sm:h-8 sm:px-2.5 ${activeView === nextView ? "bg-background text-localapp-dev-foreground" : "text-localapp-dev-muted-foreground hover:bg-background hover:text-localapp-dev-foreground"}`}>{issueViewLabels[nextView]}</button>)}
              </nav>
              <section aria-labelledby="dev-saved-views-title" className="mt-4 hidden min-w-0 border-t border-localapp-dev-border pt-3 lg:block"><div className="mb-1 flex min-h-8 items-center gap-2 px-2"><h3 id="dev-saved-views-title" className="min-w-0 flex-1 text-xs font-semibold uppercase text-localapp-dev-muted-foreground">保存的视图</h3>{activeSavedView && savedViewDirty && <><button type="button" aria-label="保存视图更改" title="保存更改" className={`${DEV_ICON_BUTTON} h-8 w-8`} disabled={savedViewsSaving} onClick={() => void saveSavedViewChanges()}><Check className="h-4 w-4" /></button><button type="button" aria-label="将当前查询另存为视图" title="另存为" className={`${DEV_ICON_BUTTON} h-8 w-8`} disabled={savedViewsSaving} onClick={() => openSavedViewEditor("save-as")}><Copy className="h-4 w-4" /></button></>}<button type="button" aria-label="保存当前 Issue 视图" title="保存当前视图" className={`${DEV_ICON_BUTTON} h-8 w-8`} onClick={() => openSavedViewEditor("create")}><Plus className="h-4 w-4" /></button></div>{savedViewsLoading ? <p role="status" className="flex min-h-11 items-center gap-2 px-2 text-xs text-localapp-dev-muted-foreground"><LoaderCircle className="h-3.5 w-3.5 animate-spin" />正在加载保存视图...</p> : savedViewsError ? <div role="alert" className="space-y-2 px-2 py-2 text-xs text-localapp-dev-danger"><p>{savedViewsError}</p><button type="button" aria-label="重试保存视图" className={`${DEV_OUTLINE_BUTTON} h-8`} onClick={() => setSavedViewsRevision((revision) => revision + 1)}>重试</button></div> : savedViews.length === 0 ? <p className="px-2 py-2 text-xs text-localapp-dev-muted-foreground">尚未保存视图</p> : <div className="space-y-1">{savedViews.map((saved) => <div key={saved.id} className="flex min-w-0 items-center gap-1"><button type="button" aria-label={`打开保存视图 ${saved.name}`} aria-pressed={activeSavedViewId === saved.id} title={saved.description || saved.name} onClick={() => applySavedView(saved)} className={`h-8 min-w-0 flex-1 truncate rounded px-2.5 text-left text-sm font-medium outline-none focus:ring-2 focus:ring-localapp-dev-focus ${activeSavedViewId === saved.id ? "bg-background text-localapp-dev-foreground" : "text-localapp-dev-muted-foreground hover:bg-background hover:text-localapp-dev-foreground"}`}>{saved.name}{activeSavedViewId === saved.id && savedViewDirty ? " *" : ""}</button><DevIssueActionMenu label={`管理保存视图 ${saved.name}`} items={[{ label: "编辑视图", restoreFocus: false, onSelect: () => openSavedViewEditor("edit", saved) }, { label: "复制视图", onSelect: () => void copySavedView(saved.id) }, { label: "删除视图", destructive: true, restoreFocus: false, onSelect: () => { setDeletingSavedView(saved); setSavedViewActionError(null); } }]} /></div>)}</div>}{activeSavedView && savedViewDirty && <p role="status" className="mt-2 rounded border border-localapp-dev-border bg-background p-2 text-xs font-medium">有未保存更改</p>}{savedViewActionError && !savedViewEditor && !deletingSavedView && <p role="alert" className="mt-2 px-2 text-xs text-localapp-dev-danger">{savedViewActionError}</p>}</section>
            </aside>

            <div className="flex min-w-0 max-w-full flex-col overflow-x-hidden">
              <div data-localapp-issue-toolbar data-testid="issue-toolbar" className="flex min-w-0 flex-col gap-2 border-b border-localapp-dev-border bg-localapp-dev-muted px-4 py-2.5 [&_label:focus-within]:ring-2 [&_label:focus-within]:ring-localapp-dev-focus sm:flex-row sm:flex-wrap sm:items-center sm:px-5">
                <div className="relative min-w-0 flex-1">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-localapp-dev-muted-foreground" aria-hidden="true" />
                  <input
                    ref={issueSearchInputRef}
                    type="search"
                    aria-label="搜索 Issue"
                    aria-keyshortcuts="Meta+/ Control+/"
                    aria-autocomplete="list"
                    aria-expanded={visibleSearchSuggestions.length > 0}
                    aria-controls={visibleSearchSuggestions.length > 0 ? issueSearchSuggestionListId : undefined}
                    aria-activedescendant={activeSearchSuggestion >= 0 ? visibleSearchSuggestions[activeSearchSuggestion]?.id : undefined}
                    value={searchInput}
                    onFocus={(event) => { if (insertedSearchSuggestionCursorRef.current === null) setSearchSuggestionCursor(event.currentTarget.selectionStart ?? searchInput.length); setSearchSuggestionsOpen(true); }}
                    onBlur={() => window.setTimeout(() => setSearchSuggestionsOpen(false), 0)}
                    onChange={(event) => { insertedSearchSuggestionCursorRef.current = null; setSearchInput(event.target.value); setSearchSuggestionCursor(event.target.selectionStart ?? event.target.value.length); setActiveSearchSuggestion(-1); setSearchSuggestionsOpen(true); }}
                    onKeyDown={(event) => {
                      if (event.key === "ArrowDown" && visibleSearchSuggestions.length > 0) { event.preventDefault(); setActiveSearchSuggestion((current) => (current + 1) % visibleSearchSuggestions.length); return; }
                      if (event.key === "ArrowUp" && visibleSearchSuggestions.length > 0) { event.preventDefault(); setActiveSearchSuggestion((current) => current <= 0 ? visibleSearchSuggestions.length - 1 : current - 1); return; }
                      if ((event.key === "Enter" || event.key === "Tab") && activeSearchSuggestion >= 0 && visibleSearchSuggestions[activeSearchSuggestion]) { event.preventDefault(); selectSearchSuggestion(visibleSearchSuggestions[activeSearchSuggestion]); return; }
                      if (event.key === "Escape" && visibleSearchSuggestions.length > 0) { event.preventDefault(); event.stopPropagation(); setSearchSuggestionsOpen(false); setActiveSearchSuggestion(-1); return; }
                      if (event.key === "Escape" && searchInput) { event.preventDefault(); event.stopPropagation(); clearIssueSearch(); return; }
                      if (event.key === "Enter") { event.preventDefault(); setSearchSuggestionsOpen(false); submitSearch(); }
                    }}
                    placeholder="搜索 Issues"
                    className="block h-11 min-w-0 w-full rounded border border-localapp-dev-border bg-background pl-8 pr-11 text-xs outline-none focus:ring-2 focus:ring-localapp-dev-focus [&::-webkit-search-cancel-button]:appearance-none [&::-webkit-search-decoration]:appearance-none sm:h-8 sm:pr-9"
                  />
                  {searchInput && <button type="button" aria-label="清除 Issue 搜索" className={`${DEV_ICON_BUTTON} absolute right-0 top-0 h-11 w-11 sm:h-8 sm:w-8`} onMouseDown={(event) => event.preventDefault()} onClick={clearIssueSearch}><X className="h-3.5 w-3.5" aria-hidden="true" /></button>}
                  {visibleSearchSuggestions.length > 0 && <div id={issueSearchSuggestionListId} role="listbox" aria-label="搜索限定词建议" className="absolute left-0 right-0 top-[calc(100%+4px)] z-[65] max-h-72 overflow-y-auto rounded border border-localapp-dev-border bg-background p-1 shadow-lg">{visibleSearchSuggestions.map((suggestion, index) => <button id={suggestion.id} key={suggestion.id} type="button" role="option" aria-selected={activeSearchSuggestion === index} aria-label={`${suggestion.label} ${suggestion.description}`} onMouseDown={(event) => event.preventDefault()} onClick={() => selectSearchSuggestion(suggestion)} className={`flex min-h-11 w-full min-w-0 items-center gap-3 rounded px-3 py-1.5 text-left sm:min-h-10 sm:px-2.5 ${activeSearchSuggestion === index ? "bg-localapp-dev-muted text-localapp-dev-foreground" : "hover:bg-localapp-dev-muted"}`}><code className="shrink-0 text-xs font-semibold">{suggestion.value}</code><span className="min-w-0 truncate text-xs text-localapp-dev-muted-foreground">{suggestion.description}</span></button>)}</div>}
                </div>
                <button type="button" aria-label={advancedIssueFilterCount > 0 ? `筛选，已启用 ${advancedIssueFilterCount} 项` : "筛选"} aria-expanded={advancedIssueFiltersOpen} aria-controls="localapp-dev-issue-advanced-filters" onClick={() => setAdvancedIssueFiltersOpen((open) => !open)} className="flex h-11 w-full items-center justify-between rounded border border-localapp-dev-border bg-background px-3 text-xs font-medium text-localapp-dev-foreground outline-none focus:ring-2 focus:ring-localapp-dev-focus sm:hidden"><span className="inline-flex items-center gap-2"><ListFilter className="h-3.5 w-3.5" aria-hidden="true" />筛选</span>{advancedIssueFilterCount > 0 && <span className="rounded-full bg-localapp-dev-muted px-2 py-0.5 text-[11px] text-localapp-dev-muted-foreground">{advancedIssueFilterCount}</span>}</button>
                <div id="localapp-dev-issue-advanced-filters" data-testid="issue-advanced-filters" className={`${advancedIssueFiltersOpen ? "grid" : "hidden"} min-w-0 grid-cols-1 gap-2 min-[360px]:grid-cols-2 sm:contents [&>label]:min-w-0`}>
                <label className="flex h-11 shrink-0 items-center gap-1.5 rounded border border-localapp-dev-border bg-background px-3 text-xs text-localapp-dev-muted-foreground sm:h-8 sm:px-2">
                  <ListFilter className="h-3.5 w-3.5" aria-hidden="true" /><span className="sr-only">按类型筛选</span>
                  <select aria-label="按类型筛选" value={query.issueType} onChange={(event) => updateIssueQuery({ issueType: event.target.value as DevIssueListQuery["issueType"] })} className="h-full min-w-0 cursor-pointer bg-transparent outline-none"><option value="">全部类型</option><option value="task">任务</option><option value="bug">缺陷</option><option value="feature">功能</option></select>
                </label>
                <label className="flex h-11 shrink-0 items-center gap-1.5 rounded border border-localapp-dev-border bg-background px-3 text-xs text-localapp-dev-muted-foreground sm:h-8 sm:px-2">
                  <ListFilter className="h-3.5 w-3.5" aria-hidden="true" /><span className="sr-only">按标签筛选</span>
                  <select aria-label="按标签筛选" aria-keyshortcuts="L" value={query.label} onChange={(event) => updateIssueQuery({ label: event.target.value })} className="h-full min-w-0 cursor-pointer bg-transparent outline-none"><option value="">全部标签</option><option value="none">无标签</option>{availableLabels.map((label) => <option key={label.id} value={label.id}>{label.name}</option>)}</select>
                </label>
                <label className="flex h-11 shrink-0 items-center gap-1.5 rounded border border-localapp-dev-border bg-background px-3 text-xs text-localapp-dev-muted-foreground sm:h-8 sm:px-2">
                  <UserRound className="h-3.5 w-3.5" aria-hidden="true" /><span className="sr-only">按创建者筛选</span>
                  <select aria-label="按创建者筛选" aria-keyshortcuts="U" value={query.author} onChange={(event) => updateIssueQuery({ author: event.target.value })} className="h-full min-w-0 cursor-pointer bg-transparent outline-none"><option value="">全部创建者</option>{query.author && !issueMentionCandidates.some((candidate) => candidate.id === query.author) && <option value={query.author}>{query.author}</option>}{issueMentionCandidates.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.displayName || candidate.name || candidate.id}</option>)}</select>
                </label>
                <label className="flex h-11 shrink-0 items-center gap-1.5 rounded border border-localapp-dev-border bg-background px-3 text-xs text-localapp-dev-muted-foreground sm:h-8 sm:px-2">
                  <UserRound className="h-3.5 w-3.5" aria-hidden="true" /><span className="sr-only">按负责人筛选</span>
                  <select aria-label="按负责人筛选" aria-keyshortcuts="A" value={query.assignee} onChange={(event) => updateIssueQuery({ assignee: event.target.value })} className="h-full min-w-0 cursor-pointer bg-transparent outline-none"><option value="">全部负责人</option><option value="none">未分配</option>{issueMentionCandidates.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.displayName || candidate.name || candidate.id}</option>)}</select>
                </label>
                <label className="flex h-11 shrink-0 items-center gap-1.5 rounded border border-localapp-dev-border bg-background px-3 text-xs text-localapp-dev-muted-foreground sm:h-8 sm:px-2"><CalendarDays className="h-3.5 w-3.5" /><span className="sr-only">按里程碑筛选</span><select aria-label="按里程碑筛选" aria-keyshortcuts="M" value={query.milestone} onChange={(event) => updateIssueQuery({ milestone: event.target.value })} className="h-full min-w-0 cursor-pointer bg-transparent outline-none"><option value="">全部里程碑</option><option value="none">无里程碑</option>{availableMilestones.map((item) => <option key={item.id} value={item.id}>{item.title}{item.state === "closed" ? "（已关闭）" : ""}</option>)}</select></label>
                {query.status === "closed" && <label className="flex h-11 shrink-0 items-center gap-1.5 rounded border border-localapp-dev-border bg-background px-3 text-xs text-localapp-dev-muted-foreground sm:h-8 sm:px-2"><CircleSlash2 className="h-3.5 w-3.5" aria-hidden="true" /><span className="sr-only">按关闭原因筛选</span><select aria-label="按关闭原因筛选" value={query.reason} onChange={(event) => updateIssueQuery({ reason: event.target.value as DevIssueListQuery["reason"] })} className="h-full min-w-0 cursor-pointer bg-transparent outline-none"><option value="">全部关闭原因</option><option value="completed">已完成</option><option value="not_planned">不计划处理</option></select></label>}
                <label className="flex h-11 shrink-0 items-center gap-1.5 rounded border border-localapp-dev-border bg-background px-3 text-xs text-localapp-dev-muted-foreground sm:h-8 sm:px-2">
                  <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" /><span className="sr-only">排序 Issue</span>
                  <select aria-label="排序 Issue" value={`${query.sort}:${query.direction}`} onChange={(event) => { const [sort, direction] = event.target.value.split(":") as [DevIssueListSort, DevIssueListDirection]; updateIssueQuery({ sort, direction }); }} className="h-full min-w-0 cursor-pointer bg-transparent outline-none"><option value="activity:desc">最近活动</option><option value="created:desc">最新创建</option><option value="created:asc">最早创建</option><option value="updated:desc">最近更新</option><option value="comments:desc">评论最多</option></select>
                </label>
                </div>
              </div>
              {appliedIssueFilters.length > 0 && <div role="region" aria-label="已应用筛选" className="flex min-w-0 flex-wrap items-center gap-1.5 border-b border-localapp-dev-border bg-localapp-dev-muted px-4 py-2 sm:px-5">{appliedIssueFilters.map((filter) => <button key={filter.key} type="button" aria-label={`移除${filter.kind}筛选 ${filter.value}`} onClick={() => { updateIssueQuery(filter.key === "subscribed" ? { subscribed: false } : filter.key === "mentioned" ? { mentioned: false } : { [filter.key]: "" }); focusIssueSearchAfterFilterChange(); }} className="inline-flex h-11 max-w-full min-w-0 shrink-0 items-center gap-1.5 rounded border border-localapp-dev-border bg-background px-3 text-xs text-localapp-dev-muted-foreground hover:text-localapp-dev-foreground focus:outline-none focus:ring-2 focus:ring-localapp-dev-focus sm:h-7 sm:px-2"><span className="truncate"><strong className="font-medium text-localapp-dev-foreground">{filter.kind}:</strong> {filter.value}</span><X className="h-3 w-3 shrink-0" aria-hidden="true" /></button>)}<button type="button" onClick={clearIssueListFiltersAndFocus} aria-label="清除全部筛选" className="h-11 shrink-0 rounded px-3 text-xs font-medium text-localapp-dev-muted-foreground hover:bg-background hover:text-localapp-dev-foreground focus:outline-none focus:ring-2 focus:ring-localapp-dev-focus sm:h-7 sm:px-2">清除全部</button></div>}

              {showPinnedIssues && <section data-localapp-pinned-issues aria-labelledby="localapp-dev-pinned-issues-title" className="border-b border-localapp-dev-border bg-localapp-dev-muted px-4 py-3 sm:px-5"><h3 id="localapp-dev-pinned-issues-title" className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-localapp-dev-muted-foreground"><Pin className="h-3.5 w-3.5" aria-hidden="true" />置顶 Issues</h3><div className="grid min-w-0 gap-2 sm:grid-cols-2 xl:grid-cols-3">{pinnedIssues.map((issue) => <article key={issue.id} className="min-w-0 rounded-[6px] border border-localapp-dev-border bg-background px-3 py-3"><div className="flex min-w-0 items-start gap-2"><DevIssueListStatusIcon issue={issue} className="mt-1 h-4 w-4 shrink-0" /><a href={createDevIssueHref(issue.id)} aria-label={`#${issue.issue_number} ${issue.title}`} onClick={(event) => { if (!isPlainDevIssueLinkClick(event)) return; event.preventDefault(); openIssue(issue); }} className="min-h-6 min-w-0 flex-1 break-words font-semibold leading-6 hover:text-localapp-dev-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-localapp-dev-focus">{issue.title}</a></div><div className="mt-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-localapp-dev-muted-foreground"><span>#{issue.issue_number}</span><DevIssueTypeBadge issue={issue} onSelect={(issueType) => updateIssueQuery({ issueType, offset: 0 })} />{issue.labels?.map((label) => <DevIssueLabelBadge key={label.id} label={label} />)}{Boolean(issue.is_duplicate) && <span className="inline-flex items-center gap-1"><Copy className="h-3.5 w-3.5" aria-hidden="true" />重复</span>}{(issue.comment_count ?? 0) > 0 && <span>{issue.comment_count} 条评论</span>}<DevIssueListActivityTime issue={issue} /></div></article>)}</div></section>}

              <div className="flex min-h-11 flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-localapp-dev-border px-4 py-2 sm:px-5">
                <div className="inline-flex min-w-0 items-center gap-1">
                  {canBulkManage && <label className="-my-2 -ml-2 inline-flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded focus-within:ring-2 focus-within:ring-localapp-dev-focus sm:-my-0 sm:-ml-1 sm:h-6 sm:w-6"><input ref={selectAllIssuesRef} type="checkbox" aria-label="选择当前页全部 Issue" checked={allIssuesSelected} disabled={loading || bulkSaving || issues.length === 0} onChange={(event) => { selectionAnchorIssueIdRef.current = null; setSelectedIssueIds(event.target.checked ? new Set(issues.map((issue) => issue.id)) : new Set()); }} className="h-4 w-4" /></label>}
                  <button type="button" aria-label={`开启 ${meta.open}`} aria-pressed={query.status === "open"} onClick={() => updateIssueQuery({ status: "open" })} className={`inline-flex h-11 items-center gap-1.5 rounded px-3 text-sm font-semibold outline-none focus:ring-2 focus:ring-localapp-dev-focus sm:h-8 sm:px-2 ${query.status === "open" ? "text-localapp-dev-foreground" : "text-localapp-dev-muted-foreground"}`}><CircleDot className="h-4 w-4" aria-hidden="true" />开启 {meta.open}</button>
                  <button type="button" aria-label={`已关闭 ${meta.closed}`} aria-pressed={query.status === "closed"} onClick={() => updateIssueQuery({ status: "closed" })} className={`inline-flex h-11 items-center gap-1.5 rounded px-3 text-sm font-semibold outline-none focus:ring-2 focus:ring-localapp-dev-focus sm:h-8 sm:px-2 ${query.status === "closed" ? "text-localapp-dev-foreground" : "text-localapp-dev-muted-foreground"}`}><CircleCheck className="h-4 w-4" aria-hidden="true" />已关闭 {meta.closed}</button>
                </div>
                <span role="status" aria-live="polite" className="inline-flex min-h-5 items-center gap-1.5 text-sm text-localapp-dev-muted-foreground">{refreshingIssues ? <><LoaderCircle className="h-3.5 w-3.5 motion-safe:animate-spin" aria-hidden="true" />正在更新结果</> : `${meta.total} 个结果`}</span>
              </div>

              {canBulkManage && <span role="status" aria-live="polite" aria-atomic="true" aria-label="Issue 选择状态" className="sr-only">{selectedIssueCount > 0 ? `已选择 ${selectedIssueCount} 条 Issue` : "未选择 Issue"}</span>}

               {canBulkManage && selectedIssueCount > 0 && <div data-localapp-issue-bulk-toolbar role="toolbar" aria-label="批量 Issue 操作" onFocusCapture={() => { bulkToolbarFocusedRef.current = true; }} onBlurCapture={(event) => { const toolbar = event.currentTarget; window.requestAnimationFrame(() => { if (toolbar.isConnected && !toolbar.contains(document.activeElement)) bulkToolbarFocusedRef.current = false; }); }} className="flex min-h-11 flex-wrap items-center gap-2 border-b border-localapp-dev-border bg-localapp-dev-muted px-4 py-2 sm:px-5"><strong className="mr-auto text-sm">已选择 {selectedIssueCount} 条</strong><label className="inline-flex h-11 items-center rounded border border-localapp-dev-border bg-background px-2 text-xs sm:h-7"><span className="sr-only">批量类型操作</span><select aria-label="批量类型操作" value={bulkIssueTypeAction} disabled={bulkSaving} onChange={(event) => { const value = event.target.value; setBulkIssueTypeAction(value); void applyBulkIssueType(value); }} className="h-full bg-transparent outline-none"><option value="" disabled>类型</option><option value="task">任务</option><option value="bug">缺陷</option><option value="feature">功能</option></select></label><label className="inline-flex h-11 items-center rounded border border-localapp-dev-border bg-background px-2 text-xs sm:h-7"><span className="sr-only">批量标签操作</span><select aria-label="批量标签操作" value={bulkLabelAction} disabled={bulkSaving} onChange={(event) => { const value = event.target.value; setBulkLabelAction(value); void applyBulkIssueLabel(value); }} className="h-full bg-transparent outline-none"><option value="" disabled>标签</option><optgroup label="添加标签">{availableLabels.map((label) => <option key={`add-${label.id}`} value={`add:${label.id}`}>添加：{label.name}</option>)}</optgroup><optgroup label="移除标签">{availableLabels.map((label) => <option key={`remove-${label.id}`} value={`remove:${label.id}`}>移除：{label.name}</option>)}</optgroup></select></label><label className="inline-flex h-11 items-center rounded border border-localapp-dev-border bg-background px-2 text-xs sm:h-7"><span className="sr-only">批量负责人操作</span><select aria-label="批量负责人操作" value={bulkAssigneeAction} disabled={bulkSaving} onChange={(event) => { const value = event.target.value; setBulkAssigneeAction(value); void applyBulkIssueAssignee(value); }} className="h-full bg-transparent outline-none"><option value="" disabled>负责人</option><optgroup label="添加负责人">{issueMentionCandidates.map((candidate) => <option key={`add-${candidate.id}`} value={`add:${candidate.id}`}>添加：{candidate.displayName || candidate.name || candidate.id}</option>)}</optgroup><optgroup label="移除负责人">{issueMentionCandidates.map((candidate) => <option key={`remove-${candidate.id}`} value={`remove:${candidate.id}`}>移除：{candidate.displayName || candidate.name || candidate.id}</option>)}</optgroup></select></label><label className="inline-flex h-11 items-center rounded border border-localapp-dev-border bg-background px-2 text-xs sm:h-7"><span className="sr-only">批量里程碑操作</span><select aria-label="批量里程碑操作" value={bulkMilestoneAction} disabled={bulkSaving} onChange={(event) => { const value = event.target.value; setBulkMilestoneAction(value); void applyBulkIssueMilestone(value); }} className="h-full bg-transparent outline-none"><option value="" disabled>里程碑</option><option value="none">清除里程碑</option>{availableMilestones.map((milestone) => <option key={milestone.id} value={milestone.id}>{milestone.title}{milestone.state === "closed" ? "（已关闭）" : ""}</option>)}</select></label><button type="button" className={`${DEV_OUTLINE_BUTTON} h-11 sm:h-7`} disabled={bulkSaving} onClick={() => { void applyBulkIssueStatus(); }}>{query.status === "open" ? "关闭所选" : "重新打开所选"}</button><button type="button" className={`${DEV_ICON_BUTTON} h-11 px-3 sm:h-7 sm:px-2`} disabled={bulkSaving} onClick={() => { selectionAnchorIssueIdRef.current = null; setSelectedIssueIds(new Set()); setBulkMessage(""); window.requestAnimationFrame(() => selectAllIssuesRef.current?.focus()); }}>清除选择</button></div>}
              <span aria-live="polite" className="sr-only">{bulkSaving ? `正在更新 ${selectedIssueCount} 条 Issue` : bulkMessage}</span>
              {bulkMessage && <div role={selectedIssueCount > 0 ? "alert" : "status"} className="border-b border-localapp-dev-border bg-localapp-dev-muted px-4 py-2 text-xs text-localapp-dev-muted-foreground sm:px-5">{bulkMessage}</div>}

              {listError && issues.length > 0 && <div role="alert" className="flex items-center justify-between gap-3 border-b border-localapp-dev-danger bg-localapp-dev-danger-muted px-4 py-2.5 text-sm text-localapp-dev-danger sm:px-5"><span>显示上次结果：{listError}</span><button type="button" className={`${DEV_OUTLINE_BUTTON} h-11 sm:h-7`} onClick={retryIssueList}>重试</button></div>}

              <div className="min-h-0 flex-1 overflow-y-auto" aria-busy={loading}>
                {loading && issues.length === 0 ? <div aria-label="正在加载 Issue" role="status" className="space-y-0"><span className="sr-only">正在加载 Issue 列表</span>{Array.from({ length: 6 }, (_, item) => <div key={item} className="flex h-[76px] items-start gap-3 border-b border-localapp-dev-border px-4 py-3 motion-safe:animate-pulse sm:px-5"><span className="mt-1 h-4 w-4 rounded-full bg-localapp-dev-muted" /><span className="min-w-0 flex-1"><span className="block h-4 w-2/3 rounded bg-localapp-dev-muted" /><span className="mt-3 block h-3 w-1/2 rounded bg-localapp-dev-muted" /></span><span className="h-4 w-8 rounded bg-localapp-dev-muted" /></div>)}</div>
                  : listError && issues.length === 0 ? <div role="alert" className="flex min-h-[280px] flex-col items-center justify-center px-6 text-center"><CircleAlert className="h-9 w-9 text-localapp-dev-danger" aria-hidden="true" /><p className="mt-3 text-sm font-semibold">无法加载 Issues</p><p className="mt-1 max-w-md text-sm text-localapp-dev-muted-foreground">{listError}</p><button type="button" className={`${DEV_OUTLINE_BUTTON} mt-4 h-11 sm:h-8`} onClick={retryIssueList}>重试</button></div>
                  : issues.length === 0 ? <div className="flex min-h-[260px] flex-col items-center justify-center px-6 text-center"><DevIssueStatusIcon status={query.status} className="h-8 w-8" /><p className="mt-3 text-sm font-medium">{issuePageOutOfRange ? "当前页已无 Issue" : hasActiveIssueFilters ? "当前筛选没有匹配的 Issue" : `此应用还没有${query.status === "open" ? "开启" : "已关闭"}的 Issue`}</p>{issuePageOutOfRange ? <button ref={returnFirstPageRef} type="button" className={`mt-4 h-11 sm:h-8 ${DEV_OUTLINE_BUTTON}`} onClick={() => updateIssueQuery({ offset: 0 })}>返回第一页</button> : hasActiveIssueFilters && <button type="button" className={`mt-4 h-11 sm:h-8 ${DEV_OUTLINE_BUTTON}`} onClick={clearIssueListFiltersAndFocus}>重置筛选</button>}</div>
              : <div ref={issueResultsRef} id="localapp-dev-issue-results" role="list" aria-label={`${query.status === "open" ? "开启" : "已关闭"}的 Issues`} aria-busy={refreshingIssues} data-stale={refreshingIssues ? "true" : undefined}>{issues.map((issue, index) => { const issueMilestone = availableMilestones.find((milestone) => milestone.id === issue.milestone_id); const issueReporter = resolveDevIssueIdentity(issue.reporter_id, issueMentionCandidates); return <article key={issue.id} data-localapp-issue-row data-testid={`issue-row-${issue.id}`} role="listitem" aria-posinset={meta.offset + index + 1} aria-setsize={meta.total} className="flex min-w-0 gap-3 border-b border-localapp-dev-border px-4 py-3 last:border-b-0 hover:bg-localapp-dev-muted focus-within:bg-localapp-dev-muted sm:px-5">{canBulkManage && <label className="-my-2 -ml-2 inline-flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded focus-within:ring-2 focus-within:ring-localapp-dev-focus sm:-my-0 sm:-ml-1 sm:h-6 sm:w-6"><input type="checkbox" aria-label={`选择 Issue #${issue.issue_number}`} checked={selectedIssueIds.has(issue.id)} disabled={bulkSaving} onFocus={() => { focusedSelectionIdRef.current = issue.id; }} onBlur={(event) => { if (event.currentTarget.isConnected) focusedSelectionIdRef.current = null; }} readOnly onKeyDown={(event) => { if (event.key === " ") { event.preventDefault(); toggleIssueSelectionRange(issue.id, !selectedIssueIds.has(issue.id), false); } }} onClick={(event) => toggleIssueSelectionRange(issue.id, event.currentTarget.checked, event.shiftKey && event.detail > 0)} className="h-4 w-4" /></label>}<DevIssueListStatusIcon issue={issue} className="mt-1 h-4 w-4 shrink-0" /><div className="min-w-0 flex-1"><a href={createDevIssueHref(issue.id)} data-localapp-issue-link aria-label={`#${issue.issue_number} ${issue.title}`} aria-keyshortcuts="J K ArrowDown ArrowUp O Enter" onClick={(event) => { if (!isPlainDevIssueLinkClick(event)) return; event.preventDefault(); openIssue(issue); }} className="flex min-h-11 max-w-full items-center rounded-sm break-words text-left text-base font-semibold leading-6 hover:text-localapp-dev-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-localapp-dev-focus sm:min-h-6">{issue.title}</a><div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-sm leading-5 text-localapp-dev-muted-foreground">{<DevIssueTypeBadge issue={issue} onSelect={(issueType) => updateIssueQuery({ issueType, offset: 0 })} />}{(issue.labels ?? []).map((label) => <DevIssueLabelBadge key={label.id} label={label} onSelect={(labelId) => updateIssueQuery({ label: labelId, offset: 0 })} />)}{Boolean(issue.is_duplicate) && <span className="inline-flex items-center gap-1"><Copy className="h-3.5 w-3.5" aria-hidden="true" />重复</span>}{issue.locked_at && <span aria-label="对话已锁定" title="对话已锁定"><LockKeyhole className="h-3.5 w-3.5" /></span>}{issueMilestone && <button type="button" aria-label={`按里程碑筛选 ${issueMilestone.title}`} onClick={() => updateIssueQuery({ milestone: String(issueMilestone.id), offset: 0 })} className="inline-flex min-h-6 max-w-full items-center gap-1 rounded-sm text-left hover:text-localapp-dev-foreground hover:underline focus:outline-none focus:ring-2 focus:ring-localapp-dev-focus"><CalendarDays className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /><span className="break-words">{issueMilestone.title}</span></button>}<span>#{issue.issue_number}</span><button type="button" aria-label={`按创建者筛选 ${issueReporter.displayName}`} title={`${issueReporter.displayName} @${issueReporter.id}`} onClick={() => updateIssueQuery({ author: issueReporter.id, offset: 0 })} className="min-h-6 max-w-full rounded-sm break-words text-left hover:text-localapp-dev-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-localapp-dev-focus">{issueReporter.displayName}</button><DevIssueListActivityTime issue={issue} />{issue.participant_ids?.length ? <span className="hidden sm:inline">{issue.participant_ids.length} 位参与者</span> : null}</div></div><DevIssueListAssignees ids={issue.assignee_ids ?? []} identities={issueMentionCandidates} onSelect={(userId) => updateIssueQuery({ assignee: userId, offset: 0 })} />{(issue.comment_count ?? 0) > 0 ? <a href={createDevIssueHref(issue.id)} aria-label={`${issue.issue_number} 的评论数 ${issue.comment_count}`} onClick={(event) => { if (!isPlainDevIssueLinkClick(event)) return; event.preventDefault(); openIssue(issue); }} className="-my-2 inline-flex h-11 w-11 shrink-0 items-center justify-center gap-1 rounded-sm text-sm leading-5 text-localapp-dev-muted-foreground hover:text-localapp-dev-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-localapp-dev-focus sm:-my-0 sm:h-6 sm:w-10"><MessageSquare className="h-4 w-4" aria-hidden="true" />{issue.comment_count}</a> : <span aria-hidden="true" className="h-11 w-11 shrink-0 sm:h-6 sm:w-10" />}</article>; })}</div>}
              </div>

              <div className="flex min-h-11 items-center justify-between border-t border-localapp-dev-border px-4 text-xs text-localapp-dev-muted-foreground sm:px-5"><span role="status" aria-live="polite" aria-atomic="true" aria-label={issues.length === 0 ? `当前没有可显示的 Issue，共 ${meta.total} 条 Issue` : `当前显示第 ${meta.offset + 1} 至 ${Math.min(meta.offset + issues.length, meta.total)} 条，共 ${meta.total} 条 Issue`}>{issues.length === 0 ? `0 / ${meta.total}` : `${meta.offset + 1}-${Math.min(meta.offset + issues.length, meta.total)} / ${meta.total}`}</span><div className="flex items-center gap-1"><button type="button" className={`${DEV_ICON_BUTTON} h-11 w-11 disabled:opacity-50 sm:h-8 sm:w-8`} aria-label="上一页" aria-controls="localapp-dev-issue-results" disabled={query.offset === 0} onClick={() => changeIssuePage(Math.max(0, query.offset - query.limit))}><ChevronLeft className="h-4 w-4" /></button><button type="button" className={`${DEV_ICON_BUTTON} h-11 w-11 disabled:opacity-50 sm:h-8 sm:w-8`} aria-label="下一页" aria-controls="localapp-dev-issue-results" disabled={query.offset + query.limit >= meta.total} onClick={() => changeIssuePage(query.offset + query.limit)}><ChevronRight className="h-4 w-4" /></button></div></div>
            </div>
          </section>
        )}

        {view.kind === "labels" && <DevIssueLabelManager labels={availableLabels} saving={labelSaving} error={labelManagerError} onCreate={async (draft) => { setLabelSaving(true); setLabelManagerError(null); try { const created = await requestDevIssue<DevIssueLabelDefinition>("/api/issues/labels", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pagePath, ...draft }) }); setAvailableLabels((current) => [...current, created]); } catch (requestError) { setLabelManagerError(requestError instanceof Error ? requestError.message : "标签保存失败"); throw requestError; } finally { setLabelSaving(false); } }} onUpdate={async (id, draft) => { setLabelSaving(true); setLabelManagerError(null); try { const updated = await requestDevIssue<DevIssueLabelDefinition>(`/api/issues/labels/${encodeURIComponent(id)}`, { method: "PATCH", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pagePath, ...draft }) }); setAvailableLabels((current) => current.map((label) => label.id === id ? updated : label)); } catch (requestError) { setLabelManagerError(requestError instanceof Error ? requestError.message : "标签保存失败"); throw requestError; } finally { setLabelSaving(false); } }} onDelete={async (id) => { setLabelSaving(true); setLabelManagerError(null); try { const params = new URLSearchParams({ pagePath }); await requestDevIssue(`/api/issues/labels/${encodeURIComponent(id)}?${params.toString()}`, { method: "DELETE", credentials: "include" }); setAvailableLabels((current) => current.filter((label) => label.id !== id)); await fetchIssues(query); } catch (requestError) { setLabelManagerError(requestError instanceof Error ? requestError.message : "标签删除失败"); throw requestError; } finally { setLabelSaving(false); } }} />}

        {view.kind === "milestones" && <DevIssueMilestoneManager milestones={availableMilestones} saving={milestoneSaving} error={milestoneManagerError} onCreate={async (draft) => { setMilestoneSaving(true); try { const created = await requestDevIssue<DevIssueMilestoneDefinition>("/api/issues/milestones", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pagePath, ...draft }) }); setAvailableMilestones((current) => [...current, created]); } catch (requestError) { setMilestoneManagerError(requestError instanceof Error ? requestError.message : "里程碑保存失败"); throw requestError; } finally { setMilestoneSaving(false); } }} onUpdate={async (id, draft) => { setMilestoneSaving(true); try { const updated = await requestDevIssue<DevIssueMilestoneDefinition>(`/api/issues/milestones/${id}`, { method: "PATCH", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pagePath, ...draft }) }); setAvailableMilestones((current) => current.map((item) => item.id === id ? updated : item)); } catch (requestError) { setMilestoneManagerError(requestError instanceof Error ? requestError.message : "里程碑保存失败"); throw requestError; } finally { setMilestoneSaving(false); } }} onDelete={async (id) => { setMilestoneSaving(true); try { const params = new URLSearchParams({ pagePath }); await requestDevIssue(`/api/issues/milestones/${id}?${params.toString()}`, { method: "DELETE", credentials: "include" }); setAvailableMilestones((current) => current.filter((item) => item.id !== id)); if (query.milestone === String(id)) updateIssueQuery({ milestone: "none" }); await fetchIssues(query.milestone === String(id) ? { ...query, milestone: "none", offset: 0 } : query); } catch (requestError) { setMilestoneManagerError(requestError instanceof Error ? requestError.message : "里程碑删除失败"); throw requestError; } finally { setMilestoneSaving(false); } }} />}

        {view.kind === "detail" && (
          detailLoading ? (
            <DevIssueDetailSkeleton />
          ) : !detail ? (
            <DevIssueDetailError message={error ?? "Issue 服务暂不可用"} onRetry={() => { void loadIssueDetail(view.issue.id, detailLookupByNumberRef.current); }} onBack={() => { ++detailRequestGenerationRef.current; setDetailLoading(false); setView({ kind: "list" }); onIssueNavigate(null); }} />
          ) : (
            <DevIssueDetailPanel
              key={detail.issue.id}
              detail={detail}
              pagePath={pagePath}
              pageOwnerId={pageOwnerId}
              user={user}
              recentUsers={recentUsers}
              platformUsers={issueMentionCandidates}
              availableLabels={availableLabels}
              availableMilestones={availableMilestones}
              submitting={submitting}
              onUpdateIssue={updateIssueDetail}
               onToggleStatus={async (stateReason) => {
                 await toggleIssueStatus(detail.issue, stateReason);
                 window.requestAnimationFrame(() => Array.from(dialogRef.current?.querySelectorAll<HTMLButtonElement>("button") ?? []).find((button) => ["关闭 Issue", "重新打开 Issue"].includes(button.textContent?.trim() ?? ""))?.focus());
               }}
              onCreateComment={createComment}
              onUpdateComment={updateComment}
              onDeleteComment={deleteComment}
              onToggleCommentPin={toggleCommentPin}
              onToggleCommentMinimized={toggleCommentMinimized}
              onReferenceComment={(commentId, body, authorId, trigger) => showReferenceCommentIssue(detail, commentId, body, authorId, trigger)}
              onDeleteIssue={deleteCurrentIssue}
              onToggleLabel={async (labelId, selected) => {
                const current = detail.collaboration?.labels.map((label) => label.id) ?? [];
                await updateIssueCollaboration("labels", { labelIds: selected ? Array.from(new Set([...current, labelId])) : current.filter((id) => id !== labelId) });
              }}
              onToggleAssignee={async (userId, selected) => {
                const current = detail.collaboration?.assignee_ids ?? [];
                await updateIssueCollaboration("assignees", { userIds: selected ? Array.from(new Set([...current, userId])) : current.filter((id) => id !== userId) });
              }}
              onSetMilestone={async (milestoneId) => updateIssueCollaboration("milestone", { milestoneId })}
              onToggleSubscription={async (subscribed) => updateIssueCollaboration("subscription", { subscribed })}
              onToggleLock={async (locked, reason) => updateIssueCollaboration("lock", { locked, ...(locked && reason ? { reason } : {}) })}
              onTogglePin={async (pinned) => updateIssueCollaboration("pin", { pinned })}
              onCreateSubIssue={() => showCreateIssue(detail.issue.id)}
              onLinkSubIssue={async (issueNumber) => {
                const params = new URLSearchParams({ pagePath });
                const child = await requestDevIssue<DevIssueDetail>(`/api/issues/by-number/${issueNumber}?${params.toString()}`, { credentials: "include" });
                const updated = await requestDevIssue<DevIssueDetail>(`/api/issues/${detail.issue.id}/sub-issues/${child.issue.id}`, { method: "PUT", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pagePath }) });
                syncIssueDetailAcrossViews(updated);
                await fetchIssues(query);
              }}
              onRemoveSubIssue={async (childIssueId) => {
                const updated = await requestDevIssue<DevIssueDetail>(`/api/issues/${detail.issue.id}/sub-issues/${childIssueId}`, { method: "DELETE", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pagePath }) });
                syncIssueDetailAcrossViews(updated);
                await fetchIssues(query);
              }}
              onReprioritizeSubIssue={async (childIssueId, afterIssueId) => {
                const updated = await requestDevIssue<DevIssueDetail>(`/api/issues/${detail.issue.id}/sub-issues/priority`, { method: "PATCH", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pagePath, childIssueId, afterIssueId }) });
                syncIssueDetailAcrossViews(updated);
                await fetchIssues(query);
              }}
              onConvertIssueTask={async (taskIndex, title, expectedUpdatedAt) => {
                const existingChildIds = new Set((detail.subIssues ?? []).map((item) => item.id));
                const updated = await requestDevIssue<DevIssueDetail>(`/api/issues/${detail.issue.id}/tasks/${taskIndex}/convert`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pagePath, expectedUpdatedAt, title }) });
                syncIssueDetailAcrossViews(updated);
                await fetchIssues(query);
                const child = (updated.subIssues ?? []).find((item) => !existingChildIds.has(item.id));
                if (!child) throw new Error("Sub-issue 已创建，但无法定位新引用");
                pendingTaskReferenceFocusRef.current = child.issue_number;
                for (const delay of [100, 300, 600]) window.setTimeout(() => document.querySelector<HTMLElement>(`[data-localapp-issue-reference="${child.issue_number}"]`)?.focus(), delay);
                return child.issue_number;
              }}
              onAddDependency={async (direction, issueNumber) => {
                const params = new URLSearchParams({ pagePath });
                const related = await requestDevIssue<DevIssueDetail>(`/api/issues/by-number/${issueNumber}?${params.toString()}`, { credentials: "include" });
                const blockedIssueId = direction === "blockedBy" ? detail.issue.id : related.issue.id;
                const blockingIssueId = direction === "blockedBy" ? related.issue.id : detail.issue.id;
                const updated = await requestDevIssue<DevIssueDetail>(`/api/issues/${blockedIssueId}/dependencies/blocked-by/${blockingIssueId}`, { method: "PUT", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pagePath }) });
                if (blockedIssueId === detail.issue.id) syncIssueDetailAcrossViews(updated); else await loadIssueDetail(detail.issue.id);
                await fetchIssues(query);
              }}
              onRemoveDependency={async (direction, issueId) => {
                const blockedIssueId = direction === "blockedBy" ? detail.issue.id : issueId;
                const blockingIssueId = direction === "blockedBy" ? issueId : detail.issue.id;
                const updated = await requestDevIssue<DevIssueDetail>(`/api/issues/${blockedIssueId}/dependencies/blocked-by/${blockingIssueId}`, { method: "DELETE", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pagePath }) });
                if (blockedIssueId === detail.issue.id) syncIssueDetailAcrossViews(updated); else await loadIssueDetail(detail.issue.id);
                await fetchIssues(query);
              }}
              onUnmarkDuplicate={async (canonicalIssueId) => {
                const updated = await requestDevIssue<DevIssueDetail>(`/api/issues/${detail.issue.id}/duplicate/${canonicalIssueId}`, { method: "DELETE", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pagePath }) });
                syncIssueDetailAcrossViews(updated);
                await fetchIssues(query);
              }}
               onToggleReaction={toggleIssueReaction}
               onOpenIssueReference={openIssueByNumber}
             />
          )
        )}

        {savedViewEditor && <div className="absolute inset-0 z-[80] flex items-center justify-center bg-black/45 p-4"><div role="dialog" aria-modal="true" aria-labelledby="dev-saved-view-editor-title" className="w-full max-w-lg overflow-hidden rounded border border-localapp-dev-border bg-background shadow-2xl"><header className="flex min-h-14 items-center gap-3 border-b border-localapp-dev-border px-4"><h3 id="dev-saved-view-editor-title" className="min-w-0 flex-1 text-sm font-semibold">{savedViewEditor.mode === "edit" ? "编辑保存视图" : savedViewEditor.mode === "save-as" ? "另存当前视图" : "保存当前视图"}</h3><button type="button" aria-label="关闭保存视图编辑器" className={`${DEV_ICON_BUTTON} h-11 w-11`} disabled={savedViewsSaving} onClick={() => setSavedViewEditor(null)}><X className="h-4 w-4" /></button></header><div className="space-y-4 p-4"><label className="block space-y-1.5 text-sm font-medium">视图名称<input autoFocus aria-label="视图名称" value={savedViewName} maxLength={50} onChange={(event) => setSavedViewName(event.target.value)} className="block h-11 w-full rounded border border-localapp-dev-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-localapp-dev-focus" /></label><label className="block space-y-1.5 text-sm font-medium">视图说明<input aria-label="视图说明" value={savedViewDescription} maxLength={200} onChange={(event) => setSavedViewDescription(event.target.value)} className="block h-11 w-full rounded border border-localapp-dev-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-localapp-dev-focus" /></label>{savedViewActionError && <p role="alert" className="text-sm text-localapp-dev-danger">{savedViewActionError}</p>}</div><footer className="flex justify-end gap-2 border-t border-localapp-dev-border px-4 py-3"><button type="button" className={`${DEV_OUTLINE_BUTTON} h-11 sm:h-8`} disabled={savedViewsSaving} onClick={() => setSavedViewEditor(null)}>取消</button><button type="button" className={`${DEV_BUTTON_ACTIVE} h-11 sm:h-8`} disabled={savedViewsSaving || !savedViewName.trim()} onClick={() => void submitSavedViewEditor()}>{savedViewsSaving ? "保存中..." : "保存视图"}</button></footer></div></div>}

        {deletingSavedView && <div className="absolute inset-0 z-[80] flex items-center justify-center bg-black/45 p-4"><div role="alertdialog" aria-modal="true" aria-labelledby="dev-saved-view-delete-title" aria-describedby="dev-saved-view-delete-description" className="w-full max-w-md overflow-hidden rounded border border-localapp-dev-border bg-background shadow-2xl"><div className="space-y-2 p-4"><h3 id="dev-saved-view-delete-title" className="text-sm font-semibold">删除保存视图</h3><p id="dev-saved-view-delete-description" className="text-sm text-localapp-dev-muted-foreground">“{deletingSavedView.name}”将从你的个人视图中删除，不会修改任何 Issue。</p>{savedViewActionError && <p role="alert" className="text-sm text-localapp-dev-danger">{savedViewActionError}</p>}</div><footer className="flex justify-end gap-2 border-t border-localapp-dev-border px-4 py-3"><button type="button" autoFocus className={`${DEV_OUTLINE_BUTTON} h-11 sm:h-8`} disabled={savedViewsSaving} onClick={() => setDeletingSavedView(null)}>取消删除</button><button type="button" aria-label="确认删除视图" className="h-11 rounded bg-localapp-dev-danger px-3 text-sm font-medium text-white disabled:opacity-50 sm:h-8" disabled={savedViewsSaving} onClick={() => void deleteSavedView()}>{savedViewsSaving ? "删除中..." : "确认删除"}</button></footer></div></div>}

        {view.kind === "templates" && <DevIssueTemplateChooser templates={issueTemplates} loading={issueTemplatesLoading} error={issueTemplatesError} onSelect={(template) => showCreateIssue(undefined, template, true)} onBlank={() => showCreateIssue(undefined, undefined, true)} onRetry={() => setIssueTemplatesRevision((revision) => revision + 1)} />}

        {view.kind === "create" && (
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">
            <div data-localapp-issue-create-workspace className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(240px,1fr)] lg:gap-6">
              <div data-localapp-issue-create-main className="min-w-0 space-y-4">
                {view.reference && <div role="status" className="rounded border border-localapp-dev-border bg-localapp-dev-muted px-3 py-2 text-sm"><strong>引用自 #{view.reference.detail.issue.issue_number} 评论</strong><p className="mt-1 text-localapp-dev-muted-foreground">原评论保持不变，提交后将创建独立 Issue。</p></div>}
                <DevIssuePotentialDuplicates candidates={potentialDuplicates} loading={potentialDuplicatesLoading} error={potentialDuplicatesError} onOpenIssue={openIssueByNumber} onRetry={() => setPotentialDuplicatesRevision((revision) => revision + 1)} />
                <label className="block space-y-1.5 text-sm font-medium"><span className="flex items-center justify-between gap-3"><span>标题</span><span className={`text-xs font-normal ${createTitleTooLong ? "text-localapp-dev-danger" : "text-localapp-dev-muted-foreground"}`}>{createTitleCharacterCount} / {DEV_ISSUE_TITLE_MAX_CHARACTERS}</span></span><input data-localapp-issue-create-title aria-label="标题" aria-invalid={createTitleTooLong || undefined} aria-describedby={createTitleTooLong ? "dev-issue-create-title-error" : undefined} value={createTitle} onChange={(event) => setCreateTitle(event.target.value)} autoFocus required placeholder="简要描述问题或需求" className="block h-11 w-full rounded border border-localapp-dev-border bg-background px-3 text-sm font-normal outline-none focus:ring-2 focus:ring-localapp-dev-focus sm:h-9" />{createTitleTooLong && <span id="dev-issue-create-title-error" role="alert" className="block text-sm font-normal text-localapp-dev-danger">Issue 标题不能超过 256 个字符</span>}</label>
                {issueTemplateNotice && <p role="status" aria-label="Issue 模板提示" className="rounded border border-localapp-dev-warning bg-localapp-dev-warning-muted px-3 py-2 text-sm">{issueTemplateNotice}</p>}
                <DevIssueComposer pagePath={pagePath} draftId={createDraftId} initialBody={createInitialBody} persistenceKey={`${createPersistenceKey}:body`} showRestoredDraftNotice restoredDraft={createWasRestoredDraft} onBodyChange={setCreateBody} onDiscardRestoredDraft={() => { setCreateTitle(""); setCreateInitialBody(""); setCreateBody(""); setCreateWasRestoredDraft(false); setIssueType("task"); setCreateLabelIds([]); setCreateAssigneeIds([]); setCreateMilestoneId(null); setIssueTemplateNotice(null); writeDevIssueCreateDraft(createPersistenceKey, "", "task", [], [], null); }} textareaLabel="Issue 描述" placeholder="详细描述问题、复现步骤或期望结果" submitLabel="提交 Issue" mentionCandidates={issueMentionCandidates} allowEmpty submitDisabled={!createTitle.trim() || createTitleTooLong} onSubmit={submitIssue} />
              </div>
              <aside data-localapp-issue-create-triage aria-label="Issue 分诊" className="min-w-0 space-y-4 border-t border-localapp-dev-border pt-4 lg:border-l lg:border-t-0 lg:pl-5 lg:pt-0">
                <fieldset className="space-y-1.5"><legend className="text-sm font-medium">类型</legend><div className="inline-flex rounded border border-localapp-dev-border bg-background p-0.5">{(["task", "bug", "feature"] as const).map((value) => <button key={value} type="button" aria-pressed={issueType === value} onClick={() => setIssueType(value)} className={`h-11 rounded px-3 text-xs font-medium sm:h-8 ${issueType === value ? DEV_BUTTON_ACTIVE : "text-localapp-dev-muted-foreground hover:text-localapp-dev-foreground"}`}>{DEV_ISSUE_TYPE_LABELS[value]}</button>)}</div></fieldset>
                {canBulkManage && <div data-localapp-create-metadata className="space-y-4 border-t border-localapp-dev-border pt-4">
              <section><div className="mb-2 flex min-h-7 items-center justify-between"><h3 className="text-sm font-medium">附加标签</h3><DevIssueMetadataPicker label="Labels" items={availableLabels.map((label) => ({ id: label.id, label: label.name, description: label.description || label.id, leading: <span aria-hidden="true" className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: `#${label.color}` }} /> }))} selectedIds={createLabelIds} disabled={submitting} onToggle={async (labelId, selected) => setCreateLabelIds((current) => selected ? Array.from(new Set([...current, labelId])) : current.filter((id) => id !== labelId))} /></div>{createLabelIds.length > 0 ? <div className="flex flex-wrap gap-1.5">{createLabelIds.map((id) => availableLabels.find((label) => label.id === id)).filter((label): label is DevIssueLabelDefinition => Boolean(label)).map((label) => <DevIssueLabelBadge key={label.id} label={label} />)}</div> : <p className="text-xs text-localapp-dev-muted-foreground">未添加附加标签</p>}</section>
              <section><div className="mb-2 flex min-h-7 items-center justify-between"><h3 className="text-sm font-medium">负责人</h3><DevIssueMetadataPicker label="Assignees" items={issueMentionCandidates.map((identity) => ({ id: identity.id, label: identity.displayName || identity.name || identity.id, description: `@${identity.id}` }))} selectedIds={createAssigneeIds} disabled={submitting} onToggle={async (userId, selected) => setCreateAssigneeIds((current) => selected ? Array.from(new Set([...current, userId])) : current.filter((id) => id !== userId))} /></div>{createAssigneeIds.length > 0 ? <div className="space-y-2">{createAssigneeIds.map((id) => <DevIssueActor key={id} identity={resolveDevIssueIdentity(id, issueMentionCandidates)} />)}</div> : <p className="text-xs text-localapp-dev-muted-foreground">尚未分配</p>}</section>
              <section><label className="mb-2 block text-sm font-medium">里程碑<select aria-label="里程碑" value={createMilestoneId ?? ""} onChange={(event) => setCreateMilestoneId(event.target.value ? Number(event.target.value) : null)} className="mt-1 block h-11 w-full rounded border border-localapp-dev-border bg-background px-3 text-sm sm:h-9"><option value="">无里程碑</option>{availableMilestones.map((item) => <option key={item.id} value={item.id}>{item.title}{item.state === "closed" ? "（已关闭）" : ""}</option>)}</select></label></section>
                </div>}
              </aside>
              <div className="flex justify-end border-t border-localapp-dev-border pt-4 lg:col-span-2"><button type="button" onClick={cancelCreateIssue} className={`${DEV_OUTLINE_BUTTON} h-11 sm:h-8`}>取消</button></div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

interface DevIssueTaskNode { type?: string; checked?: boolean | null; children?: DevIssueTaskNode[]; position?: { start?: { offset?: number }; end?: { offset?: number } }; }
interface DevIssueTask { index: number; checked: boolean; markerOffset: number; title: string; convertible: boolean; }
const DEV_ISSUE_TASK_MARKER = /^(?:[ \t]*(?:[-+*]|\d+[.)])[ \t]+)\[([ xX])\]/;
function devIssueTaskTitle(markdown: string): string {
  return markdown.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/<[^>]+>/g, "").replace(/[`*_~]+/g, "").replace(/\s+/g, " ").trim();
}
function collectDevIssueTasks(markdown: string): DevIssueTask[] {
  if (!markdown.includes("[")) return [];
  const root = unified().use(remarkParse).use(remarkGfm).parse(markdown) as DevIssueTaskNode;
  const tasks: DevIssueTask[] = [];
  const visit = (node: DevIssueTaskNode) => {
    if (node.type === "listItem" && typeof node.checked === "boolean") {
      const start = node.position?.start?.offset;
      const end = node.position?.end?.offset;
      if (typeof start === "number" && typeof end === "number") {
        const marker = DEV_ISSUE_TASK_MARKER.exec(markdown.slice(start, end));
        if (marker) {
          const title = devIssueTaskTitle(markdown.slice(start + marker[0].length, end).split(/\r?\n/, 1)[0].trimEnd());
          tasks.push({ index: tasks.length, checked: node.checked, markerOffset: start + marker[0].length - 2, title, convertible: !node.checked && Boolean(title) && !/^#\d+$/.test(title) });
        }
      }
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(root);
  return tasks;
}
function toggleDevIssueTask(markdown: string, taskIndex: number, checked: boolean): string {
  const task = collectDevIssueTasks(markdown)[taskIndex];
  if (!task) throw new Error("Task not found");
  if (task.checked === checked) throw new Error("Task state changed");
  return `${markdown.slice(0, task.markerOffset)}${checked ? "x" : " "}${markdown.slice(task.markerOffset + 1)}`;
}

interface DevIssueTaskHastNode { type?: string; tagName?: string; properties?: Record<string, unknown>; children?: DevIssueTaskHastNode[]; }
function rehypeDevIssueTaskIndexes() {
  return (tree: DevIssueTaskHastNode) => {
    let index = 0;
    const visit = (node: DevIssueTaskHastNode) => {
      if (node.type === "element" && node.tagName === "input" && node.properties?.type === "checkbox") node.properties.dataIssueTaskIndex = index++;
      for (const child of node.children ?? []) visit(child);
    };
    visit(tree);
  };
}

function DevIssueMarkdown({ children, tasksDisabled = false, onToggleTask, onConvertTask, getIssueReferenceHref, onOpenIssueReference }: { children: string; tasksDisabled?: boolean; onToggleTask?: (taskIndex: number, checked: boolean) => void; onConvertTask?: (taskIndex: number, title: string, trigger: HTMLButtonElement) => void; getIssueReferenceHref?: (issueNumber: number) => string; onOpenIssueReference?: (issueNumber: number) => void }) {
  const tasks = collectDevIssueTasks(children);
  const completed = tasks.filter((task) => task.checked).length;
  return <div className="min-w-0">{tasks.length > 0 && <div role="progressbar" aria-label="任务进度" aria-valuenow={completed} aria-valuemin={0} aria-valuemax={tasks.length} aria-valuetext={`已完成 ${completed} / ${tasks.length} 个任务`} className="mb-3 flex items-center gap-3 text-xs text-localapp-dev-muted-foreground"><span className="shrink-0 font-medium">任务 {completed} / {tasks.length}</span><span className="h-2 min-w-20 flex-1 overflow-hidden rounded-full bg-localapp-dev-muted"><span className="block h-full bg-localapp-dev-success transition-[width] motion-reduce:transition-none" style={{ width: `${Math.round((completed / tasks.length) * 100)}%` }} /></span></div>}<div className="min-w-0 max-w-none overflow-hidden break-words text-sm leading-6 text-localapp-dev-foreground [overflow-wrap:anywhere]"><ReactMarkdown remarkPlugins={[remarkGfm, remarkDevIssueReferences]} rehypePlugins={[rehypeDevIssueTaskIndexes]} components={{
    pre: ({ children: content, ...props }) => <pre {...props} className="max-w-full overflow-x-auto">{content}</pre>,
    code: ({ children: content, ...props }) => <code {...props} className="break-normal [overflow-wrap:normal]">{content}</code>,
    a: ({ children: content, href, ...props }) => { const issueNumber = readDevIssueReference(href); const resolvedHref = issueNumber !== null && getIssueReferenceHref ? getIssueReferenceHref(issueNumber) : href; return <a {...props} href={resolvedHref} tabIndex={issueNumber !== null ? -1 : undefined} data-localapp-issue-reference={issueNumber ?? undefined} className="break-all" onClick={issueNumber !== null && onOpenIssueReference ? (event) => { if (!isPlainDevIssueLinkClick(event)) return; event.preventDefault(); onOpenIssueReference(issueNumber); } : undefined}>{content}</a>; },
    img: (props) => <img {...props} className="h-auto max-w-full" />,
    input: ({ type, checked, ...props }) => { if (type !== "checkbox") return <input type={type} {...props} />; const rawIndex = (props as Record<string, unknown>)["data-issue-task-index"]; const index = typeof rawIndex === "number" && Number.isSafeInteger(rawIndex) && rawIndex >= 0 ? rawIndex : null; const task = index === null ? null : tasks[index]; return <><label className="-my-2 mr-1 inline-flex h-11 w-11 cursor-pointer items-center justify-center align-middle sm:-my-0 sm:h-6 sm:w-6"><input {...props} type="checkbox" className="h-4 w-4" checked={Boolean(checked)} disabled={index === null || !onToggleTask || tasksDisabled} aria-label={index === null ? `任务，${checked ? "已完成" : "未完成"}` : `任务 ${index + 1}，${checked ? "已完成" : "未完成"}`} onChange={(event) => { if (index !== null) onToggleTask?.(index, event.currentTarget.checked); }} /></label>{task?.convertible && onConvertTask && <button type="button" title="转换为 Sub-issue" aria-label={`将任务 ${index! + 1} 转换为 Sub-issue`} disabled={tasksDisabled} className={`${DEV_ICON_BUTTON} -my-2 mr-1 h-11 w-11 align-middle sm:-my-0 sm:h-6 sm:w-6`} onClick={(event) => onConvertTask(index!, task.title, event.currentTarget)}><ListPlus className="h-4 w-4" /></button>}</>; },
  }}>{children}</ReactMarkdown></div></div>;
}

function DevIssueAttachmentLinks({ attachments, onRemove }: { attachments: DevIssueAttachment[]; onRemove?: (attachmentId: string) => void }) {
  if (!attachments.length) return null;
  return <div className="mt-3 grid min-w-0 gap-2 sm:grid-cols-2">{attachments.map((attachment) => {
    const url = attachment.url;
    if (!url) return null;
    return <div key={attachment.id} className="flex min-w-0 items-center gap-1">{isDevIssueSafeImage(attachment.mime_type) ? (
      <a href={url} target="_blank" rel="noreferrer" aria-label={`在新标签页打开附件 ${attachment.file_name}`} className="block min-w-0 flex-1 overflow-hidden rounded-[6px] border border-localapp-dev-border">
        <img src={url} alt={attachment.file_name} loading="lazy" decoding="async" className="max-h-64 max-w-full object-contain" />
      </a>
    ) : (
      <a href={url} target="_blank" rel="noreferrer" aria-label={`在新标签页打开附件 ${attachment.file_name}`} className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-[6px] border border-localapp-dev-border px-3 py-2 text-xs text-localapp-dev-accent hover:underline">
        <span className="min-w-0 flex-1 truncate">{attachment.file_name}</span><span className="shrink-0 text-localapp-dev-muted-foreground">{formatDevIssueFileSize(attachment.size_bytes)}</span>
      </a>
    )}{onRemove && <button type="button" aria-label={`移除现有附件 ${attachment.file_name}`} className={`${DEV_ICON_BUTTON} h-11 w-11 shrink-0 sm:h-8 sm:w-8`} onClick={() => onRemove(attachment.id)}><Trash2 className="h-4 w-4" /></button>}</div>;
  })}</div>;
}

interface DevIssueAttachmentReferenceNode { type?: string; url?: string; children?: DevIssueAttachmentReferenceNode[]; }
function collectReferencedDevIssueAttachmentIds(markdown: string): Set<string> {
  if (!markdown.includes("/api/issues/attachments/")) return new Set();
  const root = unified().use(remarkParse).use(remarkGfm).parse(markdown) as DevIssueAttachmentReferenceNode;
  const referenced = new Set<string>();
  const visit = (node: DevIssueAttachmentReferenceNode) => {
    if ((node.type === "image" || node.type === "link") && typeof node.url === "string") {
      try {
        const url = new URL(node.url, "https://localapp.local");
        const match = /^\/api\/issues\/attachments\/([^/]+)$/.exec(url.pathname);
        if (match) referenced.add(decodeURIComponent(match[1]));
      } catch { /* Invalid URLs remain available through the attachment fallback. */ }
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(root);
  return referenced;
}
function filterUnreferencedDevIssueAttachments(markdown: string, attachments: readonly DevIssueAttachment[]): DevIssueAttachment[] {
  const referenced = collectReferencedDevIssueAttachmentIds(markdown);
  return referenced.size === 0 ? [...attachments] : attachments.filter((attachment) => !referenced.has(attachment.id));
}

function devIssueEventUserChanges(payloadJson: string): { added: string[]; removed: string[] } {
  try {
    const payload = JSON.parse(payloadJson) as { from?: unknown; to?: unknown };
    const from = Array.isArray(payload.from) ? payload.from.filter((value): value is string => typeof value === "string").slice(0, 20) : [];
    const to = Array.isArray(payload.to) ? payload.to.filter((value): value is string => typeof value === "string").slice(0, 20) : [];
    return { added: to.filter((value) => !from.includes(value)), removed: from.filter((value) => !to.includes(value)) };
  } catch {
    return { added: [], removed: [] };
  }
}

function devIssueEventNumber(payloadJson: string, key: string): number | null {
  try { const value = (JSON.parse(payloadJson) as Record<string, unknown>)[key]; return typeof value === "number" && Number.isSafeInteger(value) ? value : null; }
  catch { return null; }
}

function devIssueEventText(event: DevIssueEvent, identities: readonly DevUserBasic[]): string {
  if (event.event_type === "opened") return "打开了此 Issue";
  if (event.event_type === "closed") {
    try { return JSON.parse(event.payload_json)?.stateReason === "not_planned" ? "以不计划处理关闭了此 Issue" : "以已完成关闭了此 Issue"; }
    catch { return "以已完成关闭了此 Issue"; }
  }
  if (event.event_type === "reopened") return "重新打开了此 Issue";
  if (event.event_type === "edited") return "编辑了此 Issue";
  if (event.event_type === "labels_changed") return "更新了标签";
  if (event.event_type === "assignees_changed") {
    const { added, removed } = devIssueEventUserChanges(event.payload_json);
    const addedName = added.length === 1 ? resolveDevIssueIdentity(added[0], identities).displayName : "";
    const removedName = removed.length === 1 ? resolveDevIssueIdentity(removed[0], identities).displayName : "";
    if (addedName && removed.length === 0) return `将 ${addedName} 设为负责人`;
    if (removedName && added.length === 0) return `取消了 ${removedName} 的负责人`;
    return "更新了负责人";
  }
  if (event.event_type === "subscribed") return "订阅了此 Issue";
  if (event.event_type === "unsubscribed") return "取消订阅了此 Issue";
  if (event.event_type === "locked") {
    try {
      const reason = JSON.parse(event.payload_json)?.reason as DevIssueLockReason | undefined;
      return reason && DEV_ISSUE_LOCK_REASON_LABELS[reason] ? `锁定了对话（${DEV_ISSUE_LOCK_REASON_LABELS[reason]}）` : "锁定了对话";
    } catch { return "锁定了对话"; }
  }
  if (event.event_type === "unlocked") return "解锁了对话";
  if (event.event_type === "pinned") return "置顶了此 Issue";
  if (event.event_type === "unpinned") return "取消置顶了此 Issue";
  if (event.event_type === "comment_pinned") return `置顶了评论 #${devIssueEventNumber(event.payload_json, "commentId") ?? "?"}`;
  if (event.event_type === "comment_unpinned") return `取消置顶了评论 #${devIssueEventNumber(event.payload_json, "commentId") ?? "?"}`;
  if (event.event_type === "comment_minimized") return `最小化了评论 #${devIssueEventNumber(event.payload_json, "commentId") ?? "?"}`;
  if (event.event_type === "comment_unminimized") return `恢复了评论 #${devIssueEventNumber(event.payload_json, "commentId") ?? "?"}`;
  if (event.event_type === "sub_issue_added") return `添加了 Sub-issue #${devIssueEventNumber(event.payload_json, "childIssueNumber") ?? "?"}`;
  if (event.event_type === "sub_issue_removed") return `移除了 Sub-issue #${devIssueEventNumber(event.payload_json, "childIssueNumber") ?? "?"}`;
  if (event.event_type === "parent_added") return `设置了父 Issue #${devIssueEventNumber(event.payload_json, "parentIssueNumber") ?? "?"}`;
  if (event.event_type === "parent_removed") return `移除了父 Issue #${devIssueEventNumber(event.payload_json, "parentIssueNumber") ?? "?"}`;
  if (event.event_type === "task_converted_to_sub_issue") return `将任务转换为 Sub-issue #${devIssueEventNumber(event.payload_json, "childIssueNumber") ?? "?"}`;
  if (event.event_type === "marked_as_duplicate") return `将此 Issue 标记为 #${devIssueEventNumber(event.payload_json, "canonicalIssueNumber") ?? "?"} 的重复项`;
  if (event.event_type === "unmarked_as_duplicate") return `撤销了与 #${devIssueEventNumber(event.payload_json, "canonicalIssueNumber") ?? "?"} 的重复关系`;
  return "更新了此 Issue";
}

function DevIssueEventIcon({ type }: { type: string }) {
  if (type === "closed") return <DevIssueStatusIcon status="closed" className="h-4 w-4" />;
  if (type === "labels_changed") return <Tag className="h-4 w-4" aria-hidden="true" />;
  if (type === "assignees_changed") return <UserRound className="h-4 w-4" aria-hidden="true" />;
  if (type === "subscribed" || type === "unsubscribed") return <Bell className="h-4 w-4" aria-hidden="true" />;
  if (type === "locked") return <LockKeyhole className="h-4 w-4" aria-hidden="true" />;
  if (type === "unlocked") return <LockOpen className="h-4 w-4" aria-hidden="true" />;
  if (type === "pinned" || type === "unpinned" || type === "comment_pinned" || type === "comment_unpinned") return <Pin className="h-4 w-4" aria-hidden="true" />;
  return <DevIssueStatusIcon status="open" className="h-4 w-4" />;
}

interface DevIssueActionMenuItem {
  label: string;
  onSelect: (trigger: HTMLButtonElement | null) => void;
  destructive?: boolean;
  disabled?: boolean;
  restoreFocus?: boolean;
}

function DevIssueActionMenu({ label, items }: { label: string; items: readonly DevIssueActionMenuItem[] }) {
  const menuId = React.useId();
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
    <button ref={triggerRef} type="button" aria-label={label} aria-haspopup="menu" aria-controls={menuId} aria-expanded={open} onKeyDown={(event) => { if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return; event.preventDefault(); event.stopPropagation(); initialFocusRef.current = event.key === "ArrowUp" ? "last" : "first"; setOpen(true); }} onClick={() => { initialFocusRef.current = "first"; setOpen((value) => !value); }} className={`${DEV_ICON_BUTTON} h-11 w-11 sm:h-8 sm:w-8`}><Ellipsis className="h-4 w-4" /></button>
    {open && <div id={menuId} role="menu" aria-label={label} className="absolute right-0 top-12 z-30 min-w-40 overflow-hidden rounded-[6px] border border-localapp-dev-border bg-background p-1 shadow-lg sm:top-9">{items.map((item, index) => <button ref={(element) => { itemRefs.current[index] = element; }} key={item.label} type="button" role="menuitem" disabled={item.disabled} className={`flex min-h-11 w-full items-center rounded px-3 text-left text-sm outline-none hover:bg-localapp-dev-muted focus:bg-localapp-dev-muted disabled:opacity-50 sm:min-h-8 sm:px-2.5 ${item.destructive ? "text-localapp-dev-danger" : "text-localapp-dev-foreground"}`} onClick={() => { close(item.restoreFocus !== false); item.onSelect(triggerRef.current); }}>{item.label}</button>)}</div>}
  </div>;
}

const DEV_ISSUE_REACTION_EMOJI: Record<DevIssueReactionContent, string> = {
  "+1": "👍",
  "-1": "👎",
  laugh: "😄",
  hooray: "🎉",
  confused: "😕",
  heart: "❤️",
  rocket: "🚀",
  eyes: "👀",
};

function DevIssueReactions({ reactions, commentId = 0, currentUserId, additionsDisabled = false, onToggleReaction }: {
  reactions: DevIssueReaction[];
  commentId?: number;
  currentUserId?: string;
  additionsDisabled?: boolean;
  onToggleReaction: (content: DevIssueReactionContent, reacted: boolean, commentId?: number) => Promise<void>;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pendingContent, setPendingContent] = useState<DevIssueReactionContent | null>(null);
  const [reactionError, setReactionError] = useState("");
  const reactionRootRef = useRef<HTMLDivElement | null>(null);
  const reactionTriggerRef = useRef<HTMLButtonElement | null>(null);
  const reactionItemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const targetReactions = reactions.filter((reaction) => reaction.comment_id === commentId);
  const summaries = DEV_ISSUE_REACTION_CONTENTS.map((content) => {
    const matching = targetReactions.filter((reaction) => reaction.content === content);
    return { content, count: matching.length, selected: Boolean(currentUserId && matching.some((reaction) => reaction.user_id === currentUserId)) };
  }).filter((summary) => summary.count > 0);
  const toggle = async (content: DevIssueReactionContent, reacted: boolean) => {
    setPendingContent(content);
    setReactionError("");
    try {
      await onToggleReaction(content, reacted, commentId === 0 ? undefined : commentId);
      closeReactionPicker(true);
    } catch (error) {
      setReactionError(error instanceof Error ? error.message : "表态更新失败");
    } finally {
      setPendingContent(null);
    }
  };
  const closeReactionPicker = (restoreFocus: boolean) => {
    setPickerOpen(false);
    setReactionError("");
    if (restoreFocus) window.requestAnimationFrame(() => reactionTriggerRef.current?.focus());
  };
  useEffect(() => {
    if (additionsDisabled || !currentUserId) setPickerOpen(false);
    if (additionsDisabled || !currentUserId) setReactionError("");
  }, [additionsDisabled, currentUserId]);
  useEffect(() => {
    if (!pickerOpen) return;
    const frame = window.requestAnimationFrame(() => reactionItemRefs.current[0]?.focus());
    const closeOnOutside = (event: MouseEvent) => { if (event.target instanceof Node && !reactionRootRef.current?.contains(event.target)) closeReactionPicker(true); };
    document.addEventListener("mousedown", closeOnOutside);
    return () => { window.cancelAnimationFrame(frame); document.removeEventListener("mousedown", closeOnOutside); };
  }, [pickerOpen]);
  const handleReactionPickerKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closeReactionPicker(true); return; }
    if (!["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const items = reactionItemRefs.current.filter((item): item is HTMLButtonElement => Boolean(item && !item.disabled));
    if (!items.length) return;
    const current = Math.max(0, items.indexOf(document.activeElement as HTMLButtonElement));
    const delta = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : event.key === "ArrowDown" ? 4 : event.key === "ArrowUp" ? -4 : 0;
    const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (current + delta + items.length) % items.length;
    event.preventDefault(); event.stopPropagation(); items[next]?.focus();
  };

  if (summaries.length === 0 && !currentUserId) return null;
  return <div ref={reactionRootRef} data-localapp-issue-reactions className="relative mt-3 flex flex-wrap items-center gap-1.5">
    {reactionError && <p role="alert" className="w-full text-xs text-localapp-dev-danger">{reactionError}</p>}
    {summaries.map(({ content, count, selected }) => {
      const label = `${DEV_ISSUE_REACTION_EMOJI[content]} ${count} 个表态`;
      return currentUserId
        ? <button key={content} type="button" aria-label={label} aria-pressed={selected} disabled={pendingContent !== null || (additionsDisabled && !selected)} onClick={() => { void toggle(content, !selected); }} className={`inline-flex h-11 min-w-11 items-center justify-center gap-1 rounded-full border px-3 text-xs outline-none focus:ring-2 focus:ring-localapp-dev-focus disabled:cursor-default sm:h-7 sm:min-w-10 sm:px-2 ${selected ? "border-localapp-dev-accent bg-localapp-dev-accent-muted text-localapp-dev-accent" : "border-localapp-dev-border bg-background text-localapp-dev-muted-foreground hover:bg-localapp-dev-muted"}`}><span aria-hidden="true">{DEV_ISSUE_REACTION_EMOJI[content]}</span><span>{count}</span></button>
        : <span key={content} aria-label={label} className="inline-flex h-11 min-w-11 items-center justify-center gap-1 rounded-full border border-localapp-dev-border bg-background px-3 text-xs text-localapp-dev-muted-foreground sm:h-7 sm:min-w-10 sm:px-2"><span aria-hidden="true">{DEV_ISSUE_REACTION_EMOJI[content]}</span><span>{count}</span></span>;
    })}
    {currentUserId && !additionsDisabled && <><button ref={reactionTriggerRef} type="button" aria-label="添加表态" aria-haspopup="menu" aria-expanded={pickerOpen} disabled={pendingContent !== null} onClick={() => setPickerOpen((open) => !open)} className={`${DEV_ICON_BUTTON} h-11 w-11 rounded-full border border-localapp-dev-border sm:h-7 sm:w-7`}><SmilePlus aria-hidden="true" className="h-4 w-4" /></button>{pickerOpen && <div role="menu" aria-label="选择表态" onKeyDown={handleReactionPickerKeyDown} className="absolute bottom-12 left-0 z-20 grid grid-cols-4 gap-1 rounded-[6px] border border-localapp-dev-border bg-background p-1.5 shadow-lg sm:bottom-9">{DEV_ISSUE_REACTION_CONTENTS.map((content, index) => { const selected = summaries.some((summary) => summary.content === content && summary.selected); return <button ref={(element) => { reactionItemRefs.current[index] = element; }} key={content} type="button" role="menuitemcheckbox" aria-checked={selected} aria-label={`${selected ? "取消" : "添加"} ${DEV_ISSUE_REACTION_EMOJI[content]} 表态`} disabled={pendingContent !== null} onClick={() => { void toggle(content, !selected); }} className={`${DEV_ICON_BUTTON} h-11 w-11 text-base sm:h-8 sm:w-8 ${selected ? "bg-localapp-dev-muted" : ""}`}>{DEV_ISSUE_REACTION_EMOJI[content]}</button>; })}</div>}</>}
  </div>;
}

function quoteDevIssueComment(body: string, authorId: string): string {
  const quoted = body.trim().split(/\r?\n/).map((line) => `> ${line}`).join("\n");
  return `${quoted}\n\n@${authorId} `;
}

function referenceDevIssueComment(body: string, authorId: string, issueNumber: number, commentHref: string): string {
  const cleaned = body.replace(/!?\[[^\]]*\]\((?:https?:\/\/[^)]+)?\/api\/issues\/attachments\/[^)]+\)/gi, "").replace(/[ \t]+$/gm, "").trim();
  const characters = Array.from(cleaned);
  const excerpt = characters.length > 500 ? `${characters.slice(0, 499).join("")}…` : cleaned;
  const quote = (excerpt || `@${authorId} 的附件评论`).split(/\r?\n/).map((line) => `> ${line}`).join("\n");
  return `${quote}\n\n来源：#${issueNumber}\n\n[查看 @${authorId} 的原评论](${commentHref})`;
}

interface DevIssueMentionQuery { start: number; end: number; query: string }
function findDevIssueMentionQuery(value: string, caret: number): DevIssueMentionQuery | null {
  const beforeCaret = value.slice(0, Math.max(0, caret));
  const match = beforeCaret.match(/(?:^|[^A-Za-z0-9_.+@/-])@([A-Za-z0-9_-]{0,64})$/);
  if (!match) return null;
  const start = beforeCaret.length - match[1].length - 1;
  return { start, end: caret, query: match[1] };
}
function applyDevIssueMention(value: string, mention: DevIssueMentionQuery, userId: string): { value: string; caret: number } {
  const inserted = `@${userId} `;
  return { value: value.slice(0, mention.start) + inserted + value.slice(mention.end), caret: mention.start + inserted.length };
}

function DevIssueEditEventGroup({ item, identities }: { item: Extract<DevIssueTimelineDisplayItem, { kind: "event-group" }>; identities: readonly DevUserBasic[] }) {
  const [expanded, setExpanded] = useState(false);
  const actor = resolveDevIssueIdentity(item.actorId!, identities).displayName;
  return <li data-localapp-issue-event-group className="relative min-w-0 py-2 pl-3 text-xs text-localapp-dev-muted-foreground before:absolute before:bottom-0 before:left-[19px] before:top-0 before:w-px before:bg-localapp-dev-border"><div className="flex min-w-0 items-center gap-2"><span className="relative z-10 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-background"><CircleDot className="h-4 w-4" /></span><button type="button" aria-expanded={expanded} aria-controls={`${item.key}-events`} className="flex min-w-0 items-center gap-1 rounded text-left outline-none hover:text-localapp-dev-foreground focus:ring-2 focus:ring-localapp-dev-focus" onClick={() => setExpanded((value) => !value)}><strong className="font-semibold text-localapp-dev-foreground">{actor}</strong><span>编辑了此 Issue {item.events.length} 次</span><ChevronDown className={`h-3.5 w-3.5 transition-transform motion-reduce:transition-none ${expanded ? "rotate-180" : ""}`} /></button></div>{expanded && <ol id={`${item.key}-events`} aria-label={`${actor} 的编辑事件`} className="ml-6 mt-2 space-y-1 border-l border-localapp-dev-border pl-3">{item.events.map((event) => <li key={event.id}><DevIssueTime timestamp={event.created_at} precise /></li>)}</ol>}</li>;
}

function DevIssueHistoryEventGroup({ item, identities }: { item: Extract<DevIssueTimelineDisplayItem, { kind: "event-group" }>; identities: readonly DevUserBasic[] }) {
  const [expanded, setExpanded] = useState(false);
  const actor = item.actorId ? resolveDevIssueIdentity(item.actorId, identities).displayName : null;
  return <li data-localapp-issue-history-group className="relative min-w-0 py-2 pl-3 text-xs text-localapp-dev-muted-foreground before:absolute before:bottom-0 before:left-[19px] before:top-0 before:w-px before:bg-localapp-dev-border"><div className="flex min-w-0 items-center gap-2"><span className="relative z-10 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-background"><CircleDot className="h-4 w-4" /></span><button type="button" aria-expanded={expanded} aria-controls={`${item.key}-events`} className="flex min-w-0 items-center gap-1 rounded text-left outline-none hover:text-localapp-dev-foreground focus:ring-2 focus:ring-localapp-dev-focus" onClick={() => setExpanded((value) => !value)}>{actor && <><strong className="font-semibold text-localapp-dev-foreground">{actor}</strong><span>进行了</span></>}<span>{item.events.length} 项历史更新</span><ChevronDown className={`h-3.5 w-3.5 shrink-0 transition-transform motion-reduce:transition-none ${expanded ? "rotate-180" : ""}`} /></button></div>{expanded && <ol id={`${item.key}-events`} aria-label={`历史更新明细，共 ${item.events.length} 项`} className="ml-6 mt-2 space-y-2 border-l border-localapp-dev-border pl-3">{item.events.map((event) => <li key={event.id} className="flex min-w-0 items-start gap-2"><span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center"><DevIssueEventIcon type={event.event_type} /></span><span className="min-w-0 break-words"><strong className="font-semibold text-localapp-dev-foreground">{resolveDevIssueIdentity(event.actor_id, identities).displayName}</strong> {devIssueEventText(event, identities)} <DevIssueTime timestamp={event.created_at} precise /></span></li>)}</ol>}</li>;
}

function DevIssueCrossReference({ reference, identities, onOpenIssue }: { reference: DevIssueCrossReferenceRecord; identities: readonly DevUserBasic[]; onOpenIssue?: (issueNumber: number, commentId?: number | null) => void }) {
  const actor = resolveDevIssueIdentity(reference.actor_id, identities).displayName;
  const accessibleName = `来源 Issue #${reference.source_issue_number} ${reference.source_issue_title}${reference.source_comment_id === null ? "" : `，评论 ${reference.source_comment_id}`}`;
  return <li data-localapp-issue-cross-reference className="relative min-w-0 py-2 pl-3 text-xs text-localapp-dev-muted-foreground before:absolute before:bottom-0 before:left-[19px] before:top-0 before:w-px before:bg-localapp-dev-border"><div className="flex min-w-0 items-start gap-2"><span className="relative z-10 mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-background"><GitBranch className="h-4 w-4" aria-hidden="true" /></span><div className="min-w-0 flex-1"><p className="break-words"><strong className="font-semibold text-localapp-dev-foreground">{actor}</strong> 在 <a href={createDevIssueCrossReferenceHref(reference.source_issue_number, reference.source_comment_id)} aria-label={accessibleName} className="font-semibold text-localapp-dev-foreground hover:underline focus:outline-none focus:ring-2 focus:ring-localapp-dev-focus" onClick={(event) => { if (!onOpenIssue || !isPlainDevIssueLinkClick(event)) return; event.preventDefault(); onOpenIssue(reference.source_issue_number, reference.source_comment_id); }}>#{reference.source_issue_number} {reference.source_issue_title}</a> 中提到了此 Issue <DevIssueTime timestamp={reference.created_at} /></p>{reference.excerpt && <p className="mt-1 line-clamp-2 break-words border-l-2 border-localapp-dev-border pl-2">{reference.excerpt}</p>}</div></div></li>;
}

function DevIssueTimeline({
  issueId,
  reporterId,
  pagePath,
  timeline,
  attachments,
  reactions,
  identities,
  currentUserId,
  onUpdateComment,
  onDeleteComment,
  canManageCommentPins,
  onToggleCommentPin,
  canManageCommentMinimization,
  onToggleCommentMinimized,
  onToggleReaction,
  onQuoteComment,
  onReferenceComment,
  selectedCommentId,
  getCommentHref,
  onCopyCommentLink,
  getIssueReferenceHref,
  onOpenIssueReference,
  onViewHistory,
  savingTaskTarget,
  onToggleCommentTask,
  interactionsLocked = false,
  issueDraftPrefix,
}: {
  issueId: number;
  reporterId: string;
  pagePath: string;
  timeline: DevIssueTimelineItem[];
  attachments: DevIssueAttachment[];
  reactions: DevIssueReaction[];
  identities: readonly DevUserBasic[];
  currentUserId?: string;
  onUpdateComment: (commentId: number, body: string, expectedUpdatedAt?: string, draftId?: string, attachmentIds?: string[], removedAttachmentIds?: string[]) => Promise<void>;
  onDeleteComment: (commentId: number) => Promise<void>;
  canManageCommentPins: boolean;
  onToggleCommentPin: (commentId: number, pinned: boolean) => Promise<void>;
  canManageCommentMinimization: boolean;
  onToggleCommentMinimized: (commentId: number, reason: DevIssueCommentMinimizedReason | null) => Promise<void>;
  onToggleReaction: (content: DevIssueReactionContent, reacted: boolean, commentId?: number) => Promise<void>;
  onQuoteComment: (body: string, authorId: string) => void;
  onReferenceComment: (commentId: number, body: string, authorId: string, trigger: HTMLButtonElement | null) => void;
  selectedCommentId?: number | null;
  getCommentHref: (commentId: number) => string;
  onCopyCommentLink: (commentId: number) => Promise<void>;
  getIssueReferenceHref?: (issueNumber: number) => string;
  onOpenIssueReference?: (issueNumber: number, commentId?: number | null) => void;
  onViewHistory: (commentId: number, trigger: HTMLButtonElement) => void;
  savingTaskTarget?: number | null;
  onToggleCommentTask?: (commentId: number, taskIndex: number, checked: boolean) => Promise<void>;
  interactionsLocked?: boolean;
  issueDraftPrefix: string;
}) {
  const timelineRef = useRef<HTMLOListElement | null>(null);
  const revealEarlierRef = useRef<HTMLButtonElement | null>(null);
  const [editingCommentId, setEditingCommentId] = useState<number | null>(null);
  const previousEditingCommentIdRef = useRef<number | null>(null);
  const [editingCommentVersion, setEditingCommentVersion] = useState<string | null>(null);
  const [removedCommentAttachmentIds, setRemovedCommentAttachmentIds] = useState<string[]>([]);
  const [restoredCommentDraft, setRestoredCommentDraft] = useState(false);
  const [deletingCommentId, setDeletingCommentId] = useState<number | null>(null);
  const [confirmingDeleteCommentId, setConfirmingDeleteCommentId] = useState<number | null>(null);
  const deleteCommentTriggerRef = useRef<HTMLButtonElement | null>(null);
  const deleteCommentCancelRef = useRef<HTMLButtonElement | null>(null);
  const deleteCommentConfirmRef = useRef<HTMLButtonElement | null>(null);
  const [copyAnnouncement, setCopyAnnouncement] = useState("");
  const [pinningCommentId, setPinningCommentId] = useState<number | null>(null);
  const [expandedMinimizedComments, setExpandedMinimizedComments] = useState<Set<number>>(() => new Set());
  const [minimizingCommentId, setMinimizingCommentId] = useState<number | null>(null);
  const [minimizedReason, setMinimizedReason] = useState<DevIssueCommentMinimizedReason>("off-topic");
  const [minimizationSaving, setMinimizationSaving] = useState(false);
  const [minimizationError, setMinimizationError] = useState<string | null>(null);
  const [activityFilter, setActivityFilter] = useState<DevIssueTimelineFilter>("all");
  const [visibleActivityCount, setVisibleActivityCount] = useState(DEV_ISSUE_TIMELINE_PAGE_SIZE);
  const filteredTimeline = filterDevIssueTimeline(timeline, activityFilter);
  const pinnedComment = filteredTimeline.find((item): item is Extract<DevIssueTimelineItem, { kind: "comment" }> => item.kind === "comment" && Boolean(item.comment.pinned_at) && !item.comment.deleted_at);
  if (pinnedComment) {
    filteredTimeline.splice(filteredTimeline.indexOf(pinnedComment), 1);
    filteredTimeline.unshift(pinnedComment);
  }
  const displayTimeline = groupDevIssueTimeline(filteredTimeline);
  const selectedDisplayIndex = selectedCommentId ? displayTimeline.findIndex((item) => item.kind === "comment" && item.comment.id === selectedCommentId) : -1;
  const defaultVisibleStart = Math.max(0, displayTimeline.length - visibleActivityCount);
  const visibleStart = selectedDisplayIndex >= 0 ? Math.min(defaultVisibleStart, selectedDisplayIndex) : defaultVisibleStart;
  const visibleDisplayTimeline = displayTimeline.slice(visibleStart);
  const hiddenTimelineCount = visibleStart;
  const activityCounts = { all: timeline.length, comments: timeline.filter((item) => item.kind === "comment").length, history: timeline.filter((item) => item.kind !== "comment").length };
  const activityOptions: Array<{ value: DevIssueTimelineFilter; label: string }> = [{ value: "all", label: "全部" }, { value: "comments", label: "评论" }, { value: "history", label: "历史" }];
  const selectedCommentVisible = Boolean(selectedCommentId && timeline.some((item) => item.kind === "comment" && item.comment.id === selectedCommentId && !item.comment.deleted_at));
  const commentDraftKey = (commentId: number, part: "body" | "version") => `${issueDraftPrefix}:edit-comment:${commentId}:${part}`;
  const clearCommentDraft = (commentId: number, discardAttachments = false) => {
    writeDevIssueSessionDraft(commentDraftKey(commentId, "body"), "");
    writeDevIssueSessionDraft(commentDraftKey(commentId, "version"), "");
    const bodyKey = commentDraftKey(commentId, "body");
    if (discardAttachments) discardDevIssueAttachmentDraft(pagePath, bodyKey);
    else clearDevIssueAttachmentDraft(bodyKey);
    setRestoredCommentDraft(false);
  };

  useEffect(() => {
    setActivityFilter("all");
    setVisibleActivityCount(DEV_ISSUE_TIMELINE_PAGE_SIZE);
    setExpandedMinimizedComments(new Set());
    setMinimizingCommentId(null);
  }, [issueId]);

  useEffect(() => {
    setVisibleActivityCount(DEV_ISSUE_TIMELINE_PAGE_SIZE);
  }, [activityFilter]);

  useEffect(() => {
    if (selectedCommentVisible) setActivityFilter("comments");
  }, [selectedCommentId, selectedCommentVisible]);
  useEffect(() => {
    const previousEditingCommentId = previousEditingCommentIdRef.current;
    previousEditingCommentIdRef.current = editingCommentId;
    if (previousEditingCommentId === null || editingCommentId !== null) return;
    const frame = window.requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-localapp-issue-comment-id="${previousEditingCommentId}"]`)?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [editingCommentId]);

  useEffect(() => {
    if (editingCommentId === null) return;
    const editedComment = timeline.find((item): item is Extract<DevIssueTimelineItem, { kind: "comment" }> => item.kind === "comment" && item.comment.id === editingCommentId);
    if (editedComment && !editedComment.comment.deleted_at) return;
    setEditingCommentId(null);
    setEditingCommentVersion(null);
    setCopyAnnouncement("评论已被删除，编辑已结束");
  }, [editingCommentId, timeline]);

  useEffect(() => {
    if (!selectedCommentVisible || activityFilter !== "comments") return;
    const frame = window.requestAnimationFrame(() => {
      const item = document.querySelector<HTMLElement>(`[data-localapp-issue-comment-id="${selectedCommentId}"]:not([data-deleted="true"])`);
      if (!item) return;
      item.scrollIntoView?.({ block: "center" });
      item.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activityFilter, selectedCommentId, selectedCommentVisible, timeline]);

  useEffect(() => {
    if (confirmingDeleteCommentId === null) return;
    const frame = window.requestAnimationFrame(() => deleteCommentCancelRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [confirmingDeleteCommentId]);

  useEffect(() => {
    if (confirmingDeleteCommentId === null) return;
    const confirmedComment = timeline.find((item): item is Extract<DevIssueTimelineItem, { kind: "comment" }> => item.kind === "comment" && item.comment.id === confirmingDeleteCommentId);
    if (confirmedComment && !confirmedComment.comment.deleted_at) return;
    const commentId = confirmingDeleteCommentId;
    setConfirmingDeleteCommentId(null);
    window.requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-localapp-issue-comment-id="${commentId}"]`)?.focus());
  }, [confirmingDeleteCommentId, timeline]);

  const restoreDeleteCommentTriggerFocus = () => {
    setConfirmingDeleteCommentId(null);
    window.requestAnimationFrame(() => deleteCommentTriggerRef.current?.focus());
  };

  const removeComment = async (commentId: number) => {
    setDeletingCommentId(commentId);
    try {
      await onDeleteComment(commentId);
      setConfirmingDeleteCommentId(null);
      setCopyAnnouncement("评论已删除");
      const url = clearDevIssueCommentDeepLinkUrl(new URL(window.location.href), commentId);
      if (url.href !== window.location.href) window.history.replaceState(window.history.state, "", url);
      window.requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-localapp-issue-comment-id="${commentId}"]`)?.focus());
    } catch {
      // Keep the confirmation visible so the user can retry.
    } finally {
      setDeletingCommentId(null);
    }
  };
  const handleDeleteConfirmationKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); restoreDeleteCommentTriggerFocus(); return; }
    if (event.key !== "Tab") return;
    if (event.shiftKey && document.activeElement === deleteCommentCancelRef.current) { event.preventDefault(); deleteCommentConfirmRef.current?.focus(); }
    else if (!event.shiftKey && document.activeElement === deleteCommentConfirmRef.current) { event.preventDefault(); deleteCommentCancelRef.current?.focus(); }
  };

  return (
    <><span role="status" aria-live="polite" aria-atomic="true" aria-label="时间线操作状态" className="sr-only">{copyAnnouncement}</span><div className="mb-3 flex min-w-0 flex-col items-stretch gap-2 border-y border-localapp-dev-border py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3"><span className="shrink-0 whitespace-nowrap text-xs font-medium text-localapp-dev-muted-foreground">活动</span><div role="radiogroup" aria-label="筛选时间线活动" className="grid w-full grid-cols-3 rounded border border-localapp-dev-border bg-localapp-dev-muted p-0.5 sm:w-auto">{activityOptions.map((option, index) => <button key={option.value} type="button" role="radio" aria-checked={activityFilter === option.value} tabIndex={activityFilter === option.value ? 0 : -1} onClick={() => setActivityFilter(option.value)} onKeyDown={(event) => { let nextIndex: number; if (event.key === "Home") nextIndex = 0; else if (event.key === "End") nextIndex = activityOptions.length - 1; else if (["ArrowLeft", "ArrowUp"].includes(event.key)) nextIndex = (index - 1 + activityOptions.length) % activityOptions.length; else if (["ArrowRight", "ArrowDown"].includes(event.key)) nextIndex = (index + 1) % activityOptions.length; else return; event.preventDefault(); const next = activityOptions[nextIndex]; setActivityFilter(next.value); window.requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(`[data-dev-issue-activity-filter="${next.value}"]`)?.focus()); }} data-dev-issue-activity-filter={option.value} className={`h-11 rounded px-2.5 text-xs font-medium outline-none focus:ring-2 focus:ring-localapp-dev-focus sm:h-7 ${activityFilter === option.value ? "bg-background text-localapp-dev-foreground shadow-sm" : "text-localapp-dev-muted-foreground hover:text-localapp-dev-foreground"}`}>{option.label} {activityCounts[option.value]}</button>)}</div></div>{displayTimeline.length === 0 ? <div role="status" className="rounded border border-dashed border-localapp-dev-border px-4 py-8 text-center text-sm text-localapp-dev-muted-foreground">{activityFilter === "comments" ? "还没有评论" : activityFilter === "history" ? "还没有历史活动" : "还没有活动"}</div> : <ol ref={timelineRef} tabIndex={-1} aria-label="Issue 时间线" className="space-y-3 outline-none focus:ring-2 focus:ring-localapp-dev-focus">
      {hiddenTimelineCount > 0 && <li className="relative z-10 flex justify-center bg-background py-1"><button ref={revealEarlierRef} type="button" aria-label={`显示更早的 ${hiddenTimelineCount} 条活动`} className={`${DEV_OUTLINE_BUTTON} h-11 text-xs text-localapp-dev-muted-foreground sm:h-8`} onClick={() => { const revealingLastPage = hiddenTimelineCount <= DEV_ISSUE_TIMELINE_PAGE_SIZE; setVisibleActivityCount((count) => count + DEV_ISSUE_TIMELINE_PAGE_SIZE); window.requestAnimationFrame(() => { if (revealingLastPage) timelineRef.current?.focus(); else revealEarlierRef.current?.focus(); }); }}>显示更早活动 · {hiddenTimelineCount}</button></li>}
      {visibleDisplayTimeline.map((item) => item.kind === "event-group" ? item.groupType === "edited" ? <DevIssueEditEventGroup key={item.key} item={item} identities={identities} /> : <DevIssueHistoryEventGroup key={item.key} item={item} identities={identities} /> : item.kind === "event" ? (
        <li key={`event-${item.event.id}`} data-localapp-issue-event className="relative flex min-w-0 items-center gap-2 py-2 pl-3 text-xs text-localapp-dev-muted-foreground before:absolute before:bottom-0 before:left-[19px] before:top-0 before:w-px before:bg-localapp-dev-border"><span className="relative z-10 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-background"><DevIssueEventIcon type={item.event.event_type} /></span><span className="min-w-0 break-words"><strong className="font-semibold text-localapp-dev-foreground">{resolveDevIssueIdentity(item.event.actor_id, identities).displayName}</strong> {devIssueEventText(item.event, identities)} <DevIssueTime timestamp={item.event.created_at} /></span></li>
      ) : item.kind === "cross_reference" ? <DevIssueCrossReference key={`cross-reference-${item.crossReference.id}`} reference={item.crossReference} identities={identities} onOpenIssue={onOpenIssueReference} /> : (() => {
        const comment = item.comment;
        const commentAttachments = attachments.filter((attachment) => attachment.comment_id === comment.id);
        const unreferencedCommentAttachments = filterUnreferencedDevIssueAttachments(comment.body, commentAttachments);
        const visibleCommentAttachments = commentAttachments.filter((attachment) => !removedCommentAttachmentIds.includes(attachment.id));
        return (
          <li id={`issuecomment-${comment.id}`} key={`comment-${comment.id}`} data-localapp-issue-comment-card data-localapp-issue-comment-pinned={comment.pinned_at ? "true" : undefined} data-localapp-issue-comment-id={comment.id} data-deleted={comment.deleted_at ? "true" : undefined} tabIndex={-1} aria-current={selectedCommentId === comment.id && !comment.deleted_at ? "location" : undefined} className={`min-w-0 overflow-hidden rounded-[6px] border ${comment.pinned_at ? "border-localapp-dev-focus" : "border-localapp-dev-border"} bg-background outline-none ${selectedCommentId === comment.id && !comment.deleted_at ? "ring-2 ring-localapp-dev-focus ring-offset-2" : ""}`}>
            {comment.pinned_at && <div className="flex min-h-9 items-center gap-2 border-b border-localapp-dev-border bg-localapp-dev-accent-muted px-4 py-2 text-xs"><Pin className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /><span className="min-w-0 flex-1 text-localapp-dev-muted-foreground">置顶评论 · 由 {resolveDevIssueIdentity(comment.pinned_by ?? "", identities).displayName} 置顶 <DevIssueTime timestamp={comment.pinned_at} /></span></div>}
            <div className="border-b border-localapp-dev-border bg-localapp-dev-muted px-4 py-3 text-xs text-localapp-dev-muted-foreground">
              <DevIssueActor identity={resolveDevIssueIdentity(comment.author_id, identities)} timestamp={comment.created_at} timestampHref={comment.deleted_at ? undefined : getCommentHref(comment.id)} timestampSuffix={!comment.deleted_at && comment.revision_count ? <button type="button" aria-label={`查看评论编辑历史，${comment.revision_count} 次修改`} className="-my-2 inline-flex h-11 items-center px-1 text-localapp-dev-muted-foreground hover:underline sm:-my-0 sm:h-6" onClick={(event) => onViewHistory(comment.id, event.currentTarget)}>edited</button> : undefined} badge={comment.author_id === reporterId ? "Author" : undefined} action={!comment.deleted_at ? <DevIssueActionMenu label="评论操作" items={[{ label: "复制评论链接", onSelect: () => { setCopyAnnouncement(""); void onCopyCommentLink(comment.id).then(() => setCopyAnnouncement("评论链接已复制")).catch(() => setCopyAnnouncement("无法复制评论链接")); } }, ...(canManageCommentPins ? [{ label: comment.pinned_at ? "取消置顶评论" : "置顶评论", disabled: pinningCommentId !== null, restoreFocus: false, onSelect: async () => { setPinningCommentId(comment.id); try { await onToggleCommentPin(comment.id, !comment.pinned_at); window.requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-localapp-issue-comment-id="${comment.id}"]`)?.focus()); } catch (error) { setCopyAnnouncement(error instanceof Error ? error.message : "无法更新置顶评论"); } finally { setPinningCommentId(null); } } }] : []), ...(canManageCommentMinimization ? [{ label: comment.minimized_at ? "取消最小化评论" : "最小化评论", restoreFocus: false, disabled: minimizationSaving, onSelect: () => { if (comment.minimized_at) { setMinimizationSaving(true); void onToggleCommentMinimized(comment.id, null).catch((error) => setCopyAnnouncement(error instanceof Error ? error.message : "无法恢复评论")).finally(() => setMinimizationSaving(false)); } else { setMinimizedReason("off-topic"); setMinimizationError(null); setMinimizingCommentId(comment.id); } } }] : []), ...(currentUserId ? [{ label: "引用到新 Issue", restoreFocus: false, onSelect: (trigger: HTMLButtonElement | null) => onReferenceComment(comment.id, comment.body, comment.author_id, trigger) }] : []), ...(currentUserId && !interactionsLocked ? [{ label: "引用回复", restoreFocus: false, onSelect: () => onQuoteComment(comment.body, comment.author_id) }] : []), ...(comment.author_id === currentUserId ? [{ label: "编辑评论", restoreFocus: false, disabled: deletingCommentId === comment.id || confirmingDeleteCommentId === comment.id, onSelect: () => { const storedVersion = readDevIssueSessionDraft(commentDraftKey(comment.id, "version")); const restoredBody = readDevIssueSessionDraft(commentDraftKey(comment.id, "body")); const expectedUpdatedAt = storedVersion || comment.updated_at; setRestoredCommentDraft(Boolean(storedVersion || restoredBody)); writeDevIssueSessionDraft(commentDraftKey(comment.id, "version"), expectedUpdatedAt); setRemovedCommentAttachmentIds([]); setEditingCommentId(comment.id); setEditingCommentVersion(expectedUpdatedAt); } }, { label: "删除评论", restoreFocus: false, destructive: true, disabled: deletingCommentId === comment.id, onSelect: (trigger: HTMLButtonElement | null) => { deleteCommentTriggerRef.current = trigger; setConfirmingDeleteCommentId(comment.id); } }] : [])]} /> : undefined} />
            </div>
            <div className="px-3 py-3">
              {comment.minimized_at && !expandedMinimizedComments.has(comment.id) ? <div data-localapp-issue-comment-minimized className="flex min-h-11 flex-wrap items-center gap-2 text-sm text-localapp-dev-muted-foreground"><span>此评论已最小化 · {DEV_ISSUE_COMMENT_MINIMIZED_REASON_LABELS[comment.minimized_reason ?? "off-topic"]}</span><button type="button" className={`${DEV_OUTLINE_BUTTON} h-11 sm:h-8`} onClick={() => setExpandedMinimizedComments((current) => new Set(current).add(comment.id))}>显示评论</button></div> : <>
              {minimizingCommentId === comment.id && <div role="alertdialog" aria-label="最小化评论" className="mb-3 rounded border border-localapp-dev-border bg-localapp-dev-muted p-3"><p className="text-sm font-medium">选择最小化原因</p><div className="mt-3 grid gap-2 sm:grid-cols-2">{Object.entries(DEV_ISSUE_COMMENT_MINIMIZED_REASON_LABELS).map(([value, label]) => <label key={value} className="flex min-h-11 items-center gap-2 rounded border border-localapp-dev-border px-3 py-2 text-sm"><input type="radio" name={`dev-minimize-reason-${comment.id}`} checked={minimizedReason === value} onChange={() => setMinimizedReason(value as DevIssueCommentMinimizedReason)} />{label}</label>)}</div>{minimizationError && <p role="alert" className="mt-3 text-sm text-localapp-dev-danger">{minimizationError}</p>}<div className="mt-3 flex justify-end gap-2"><button type="button" className={`${DEV_OUTLINE_BUTTON} h-11 sm:h-8`} disabled={minimizationSaving} onClick={() => setMinimizingCommentId(null)}>取消</button><button type="button" className={`${DEV_BUTTON_ACTIVE} h-11 rounded px-3 text-xs font-medium sm:h-8`} disabled={minimizationSaving} onClick={() => { setMinimizationSaving(true); setMinimizationError(null); void onToggleCommentMinimized(comment.id, minimizedReason).then(() => setMinimizingCommentId(null)).catch((error) => setMinimizationError(error instanceof Error ? error.message : "无法最小化评论")).finally(() => setMinimizationSaving(false)); }}>最小化评论</button></div></div>}
              {confirmingDeleteCommentId === comment.id && <div role="alertdialog" aria-label="删除评论确认" aria-describedby={`delete-comment-${comment.id}-description`} onKeyDown={handleDeleteConfirmationKeyDown} className="mb-3 rounded border border-localapp-dev-danger bg-localapp-dev-danger-muted p-3"><p className="text-sm font-medium">确定删除这条评论吗？</p><p id={`delete-comment-${comment.id}-description`} className="mt-1 text-xs text-localapp-dev-muted-foreground">删除后评论内容将不再显示。</p><div className="mt-3 flex flex-wrap justify-end gap-2"><button ref={deleteCommentCancelRef} type="button" disabled={deletingCommentId === comment.id} className={`${DEV_OUTLINE_BUTTON} h-11 sm:h-8`} onClick={restoreDeleteCommentTriggerFocus}>取消删除</button><button ref={deleteCommentConfirmRef} type="button" disabled={deletingCommentId === comment.id} className="h-11 rounded bg-localapp-dev-danger px-3 py-1 text-xs font-medium text-white disabled:opacity-50 sm:h-8" onClick={() => { void removeComment(comment.id); }}>确认删除评论</button></div></div>}
              {comment.deleted_at ? <p className="text-sm italic text-localapp-dev-muted-foreground">此评论已删除。</p> : editingCommentId === comment.id ? <>{editingCommentVersion !== null && editingCommentVersion !== comment.updated_at && <div role="status" className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded border border-localapp-dev-border bg-localapp-dev-muted px-3 py-2 text-xs"><span>此评论有新变更，当前草稿尚未被覆盖。</span><button type="button" className={`${DEV_OUTLINE_BUTTON} h-11 shrink-0 sm:h-8`} onClick={() => { clearCommentDraft(comment.id, true); setEditingCommentId(null); setEditingCommentVersion(null); setRemovedCommentAttachmentIds([]); }}>加载最新内容</button></div>}{restoredCommentDraft && <div role="status" className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded border border-localapp-dev-border bg-localapp-dev-muted px-3 py-2 text-xs"><span>已恢复上次未完成的编辑</span><DevIssueDiscardDraftControl triggerLabel="丢弃已恢复草稿" onConfirm={() => { clearCommentDraft(comment.id, true); setEditingCommentId(null); setEditingCommentVersion(null); setRemovedCommentAttachmentIds([]); }} focusAfterConfirm={() => document.getElementById(`issuecomment-${comment.id}`)?.focus()} /></div>}<DevIssueComposer key={`edit-comment-${comment.id}-${editingCommentVersion}`} pagePath={pagePath} draftId={`edit-comment-${comment.id}`} persistenceKey={commentDraftKey(comment.id, "body")} preferPersistedDraft initialBody={comment.body} textareaLabel="编辑评论内容" placeholder="更新评论" submitLabel="保存评论" allowEmpty={visibleCommentAttachments.length > 0} mentionCandidates={identities} onCancel={() => { clearCommentDraft(comment.id, true); setEditingCommentId(null); setEditingCommentVersion(null); setRemovedCommentAttachmentIds([]); }} onSubmit={async ({ body, attachmentIds, draftId }) => { await onUpdateComment(comment.id, body, editingCommentVersion ?? comment.updated_at, draftId, attachmentIds, removedCommentAttachmentIds); clearCommentDraft(comment.id); setEditingCommentId(null); setEditingCommentVersion(null); setRemovedCommentAttachmentIds([]); }} /><DevIssueAttachmentLinks attachments={visibleCommentAttachments} onRemove={(attachmentId) => setRemovedCommentAttachmentIds((current) => current.includes(attachmentId) ? current : [...current, attachmentId])} /></> : <><DevIssueMarkdown tasksDisabled={interactionsLocked || savingTaskTarget === comment.id} onToggleTask={comment.author_id === currentUserId && onToggleCommentTask ? (taskIndex, checked) => { void onToggleCommentTask(comment.id, taskIndex, checked).catch(() => undefined); } : undefined} getIssueReferenceHref={getIssueReferenceHref} onOpenIssueReference={onOpenIssueReference}>{comment.body}</DevIssueMarkdown><DevIssueAttachmentLinks attachments={unreferencedCommentAttachments} /><DevIssueReactions reactions={reactions} commentId={comment.id} currentUserId={currentUserId} additionsDisabled={interactionsLocked} onToggleReaction={onToggleReaction} /></>}
              </>}
            </div>
          </li>
        );
      })())}
    </ol>}</>
  );
}

function revokeDevIssueAttachmentPreview(attachment: DevPendingIssueAttachment) {
  if (attachment.previewUrl?.startsWith("blob:")) URL.revokeObjectURL(attachment.previewUrl);
}

function releaseDevIssueAttachments(attachments: DevPendingIssueAttachment[]) {
  attachments.forEach(revokeDevIssueAttachmentPreview);
}

function devIssueAttachmentMarkdown(attachment?: DevIssueAttachment): string {
  if (!attachment?.url) return "";
  const displayName = Array.from(attachment.file_name, (character) => (
    DEV_ISSUE_MARKDOWN_PUNCTUATION.has(character) ? `\\${character}` : character
  )).join("");
  return isDevIssueSafeImage(attachment.mime_type)
    ? `![${displayName}](${attachment.url})`
    : `[${displayName}](${attachment.url})`;
}

function removeDevIssueAttachmentMarkdown(body: string, attachment?: DevIssueAttachment): string {
  if (!attachment?.url) return body;
  const escapedUrl = attachment.url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return body.replace(new RegExp(`!?\\[[^\\]]*\\]\\(${escapedUrl}\\)`, "g"), "").replace(/\n{3,}/g, "\n\n").trim();
}

function DevIssueDiscardDraftControl({ triggerLabel, onConfirm, focusAfterConfirm }: { triggerLabel: string; onConfirm: () => void; focusAfterConfirm?: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const discardDraftTriggerRef = useRef<HTMLButtonElement | null>(null);
  const discardDraftCancelRef = useRef<HTMLButtonElement | null>(null);
  const discardDraftConfirmRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (confirming) discardDraftCancelRef.current?.focus();
  }, [confirming]);

  const keepDraft = () => {
    setConfirming(false);
    window.requestAnimationFrame(() => discardDraftTriggerRef.current?.focus());
  };
  const discardDraft = () => {
    setConfirming(false);
    onConfirm();
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => focusAfterConfirm?.()));
  };

  return <><button ref={discardDraftTriggerRef} type="button" aria-expanded={confirming} className={`${DEV_OUTLINE_BUTTON} h-11 shrink-0 sm:h-8`} onClick={() => setConfirming(true)}>{triggerLabel}</button>{confirming && <div role="alertdialog" aria-label="丢弃草稿确认" aria-describedby="dev-discard-draft-description" onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); keepDraft(); return; } if (event.key !== "Tab") return; if (event.shiftKey && document.activeElement === discardDraftCancelRef.current) { event.preventDefault(); discardDraftConfirmRef.current?.focus(); } else if (!event.shiftKey && document.activeElement === discardDraftConfirmRef.current) { event.preventDefault(); discardDraftCancelRef.current?.focus(); } }} className="basis-full rounded border border-localapp-dev-danger bg-localapp-dev-danger-muted p-3"><p className="font-medium">丢弃草稿？</p><p id="dev-discard-draft-description" className="mt-1 text-sm text-localapp-dev-muted-foreground">未提交内容和已上传附件将被清除且无法恢复。</p><div className="mt-3 flex flex-wrap justify-end gap-2"><button ref={discardDraftCancelRef} type="button" className={`${DEV_OUTLINE_BUTTON} h-11 sm:h-8`} onClick={keepDraft}>保留草稿</button><button ref={discardDraftConfirmRef} type="button" className="h-11 rounded bg-localapp-dev-danger px-3 text-xs font-medium text-white sm:h-8" onClick={discardDraft}>确认丢弃</button></div></div>}</>;
}

interface DevIssueSavedReply {
  id: number;
  title: string;
  body: string;
}

function DevIssueSavedRepliesPicker({ buttonRef, tabIndex, onFocus, onKeyDown, onInsert }: {
  buttonRef: (element: HTMLButtonElement | null) => void;
  tabIndex: number;
  onFocus: () => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>) => void;
  onInsert: (reply: DevIssueSavedReply) => void;
}) {
  const [open, setOpen] = useState(false);
  const [replies, setReplies] = useState<DevIssueSavedReply[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<DevIssueSavedReply | "new" | null>(null);
  const [deleting, setDeleting] = useState<DevIssueSavedReply | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const filtered = replies.filter((reply) => reply.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const assignTrigger = (element: HTMLButtonElement | null) => { triggerRef.current = element; buttonRef(element); };
  const load = async () => {
    setLoading(true); setError(null);
    try { setReplies(await requestDevIssue<DevIssueSavedReply[]>("/api/issues/saved-replies")); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "加载保存回复失败"); }
    finally { setLoading(false); }
  };
  const close = () => {
    setOpen(false); setEditing(null); setDeleting(null); setError(null);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  };
  const openPicker = () => {
    setOpen(true); setQuery(""); setEditing(null); setDeleting(null);
    void load(); window.requestAnimationFrame(() => searchRef.current?.focus());
  };
  const beginEdit = (reply: DevIssueSavedReply | "new") => {
    setEditing(reply); setDeleting(null); setError(null);
    setTitle(reply === "new" ? "" : reply.title); setBody(reply === "new" ? "" : reply.body);
  };
  const save = async () => {
    setSaving(true); setError(null);
    try {
      const saved = await requestDevIssue<DevIssueSavedReply>(editing === "new" ? "/api/issues/saved-replies" : `/api/issues/saved-replies/${editing?.id}`, {
        method: editing === "new" ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, body }),
      });
      setReplies((current) => editing === "new" ? [saved, ...current] : current.map((reply) => reply.id === saved.id ? saved : reply));
      setEditing(null);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "保存回复失败"); }
    finally { setSaving(false); }
  };
  const remove = async () => {
    if (!deleting) return;
    setSaving(true); setError(null);
    try {
      await requestDevIssue(`/api/issues/saved-replies/${deleting.id}`, { method: "DELETE" });
      setReplies((current) => current.filter((reply) => reply.id !== deleting.id)); setDeleting(null);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "删除保存回复失败"); }
    finally { setSaving(false); }
  };
  useEffect(() => setActiveIndex(0), [query]);

  return <div className="relative shrink-0">
    <button ref={assignTrigger} type="button" tabIndex={tabIndex} aria-label="保存回复" aria-keyshortcuts="Control+." title="保存回复" className={`${DEV_ICON_BUTTON} h-11 w-11 sm:h-8 sm:w-8`} onFocus={onFocus} onKeyDown={onKeyDown} onMouseDown={(event) => event.preventDefault()} onClick={() => open ? close() : openPicker()}><MessageSquareReply className="h-4 w-4" /></button>
    {open && <div role="dialog" aria-label="保存回复" onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); close(); } }} className="absolute right-0 top-full z-50 mt-1 w-[min(24rem,calc(100vw-2rem))] overflow-hidden rounded border border-localapp-dev-border bg-background shadow-xl">
      <header className="flex min-h-12 items-center gap-2 border-b border-localapp-dev-border px-3"><strong className="min-w-0 flex-1 text-sm">保存回复</strong><button type="button" aria-label="关闭保存回复" className={`${DEV_ICON_BUTTON} h-11 w-11 sm:h-8 sm:w-8`} onClick={close}><X className="h-4 w-4" /></button></header>
      {editing ? <div className="space-y-3 p-3">
        <input autoFocus aria-label="回复标题" maxLength={80} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="回复标题" className="h-11 w-full rounded border border-localapp-dev-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-localapp-dev-focus" />
        <textarea aria-label="回复正文" maxLength={20000} rows={7} value={body} onChange={(event) => setBody(event.target.value)} placeholder="Markdown 回复正文；使用 %cursor% 指定插入后光标" className="w-full resize-y rounded border border-localapp-dev-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-localapp-dev-focus" />
        {error && <p role="alert" className="text-sm text-localapp-dev-danger">{error}</p>}
        <div className="flex justify-end gap-2"><button type="button" className={`${DEV_OUTLINE_BUTTON} h-11 sm:h-8`} disabled={saving} onClick={() => { setEditing(null); setError(null); }}>取消</button><button type="button" className={`${DEV_BUTTON_ACTIVE} h-11 rounded px-3 text-sm sm:h-8`} disabled={saving || !title.trim() || !body.trim()} onClick={() => void save()}>{saving ? "保存中..." : "保存回复"}</button></div>
      </div> : deleting ? <div className="space-y-3 p-3">
        <p className="text-sm">删除“{deleting.title}”？此操作无法撤销。</p>{error && <p role="alert" className="text-sm text-localapp-dev-danger">{error}</p>}
        <div className="flex justify-end gap-2"><button autoFocus type="button" className={`${DEV_OUTLINE_BUTTON} h-11 sm:h-8`} disabled={saving} onClick={() => setDeleting(null)}>取消删除</button><button type="button" className="h-11 rounded bg-localapp-dev-danger px-3 text-sm text-white sm:h-8" disabled={saving} onClick={() => void remove()}>{saving ? "删除中..." : "确认删除"}</button></div>
      </div> : <><div className="flex gap-2 border-b border-localapp-dev-border p-2">
        <input ref={searchRef} type="search" role="searchbox" aria-label="搜索保存回复" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (!filtered.length) return; if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) { event.preventDefault(); setActiveIndex(event.key === "Home" ? 0 : event.key === "End" ? filtered.length - 1 : (activeIndex + (event.key === "ArrowDown" ? 1 : -1) + filtered.length) % filtered.length); } else if (event.key === "Enter") { event.preventDefault(); onInsert(filtered[activeIndex] ?? filtered[0]); close(); } }} placeholder="搜索标题" className="h-11 min-w-0 flex-1 rounded border border-localapp-dev-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-localapp-dev-focus" />
        <button type="button" aria-label="新建保存回复" className={`${DEV_OUTLINE_BUTTON} h-11 w-11 px-0`} onClick={() => beginEdit("new")}><Plus className="h-4 w-4" /></button>
      </div><div role="listbox" aria-label="保存回复列表" className="max-h-72 overflow-y-auto p-1">{loading ? <p role="status" className="px-3 py-4 text-sm text-localapp-dev-muted-foreground">正在加载保存回复...</p> : error ? <div className="space-y-2 p-3"><p role="alert" className="text-sm text-localapp-dev-danger">{error}</p><button type="button" className={`${DEV_OUTLINE_BUTTON} h-11 sm:h-8`} onClick={() => void load()}>重试</button></div> : filtered.length === 0 ? <div className="space-y-2 px-3 py-4"><p className="text-sm text-localapp-dev-muted-foreground">{replies.length ? "没有匹配的保存回复" : "尚未创建保存回复"}</p><button type="button" className={`${DEV_OUTLINE_BUTTON} h-11 sm:h-8`} onClick={() => beginEdit("new")}>新建保存回复</button></div> : filtered.map((reply, index) => <div key={reply.id} className={`flex min-h-11 items-center gap-1 rounded ${index === activeIndex ? "bg-localapp-dev-muted" : "hover:bg-localapp-dev-muted"}`}><button type="button" role="option" aria-label={reply.title} aria-selected={index === activeIndex} className="min-h-11 min-w-0 flex-1 truncate px-3 text-left text-sm font-medium" onMouseEnter={() => setActiveIndex(index)} onClick={() => { onInsert(reply); close(); }}>{reply.title}</button><button type="button" aria-label={`编辑 ${reply.title}`} className={`${DEV_ICON_BUTTON} h-11 w-11 sm:h-8 sm:w-8`} onClick={() => beginEdit(reply)}><Pencil className="h-3.5 w-3.5" /></button><button type="button" aria-label={`删除 ${reply.title}`} className={`${DEV_ICON_BUTTON} h-11 w-11 text-localapp-dev-danger sm:h-8 sm:w-8`} onClick={() => { setDeleting(reply); setError(null); }}><Trash2 className="h-3.5 w-3.5" /></button></div>)}</div></>}
    </div>}
  </div>;
}

function DevIssueComposer({
  pagePath,
  draftId,
  textareaLabel,
  placeholder,
  submitLabel,
  status,
  closeReason = "completed",
  canChangeStatus = false,
  initialBody = "",
  persistenceKey,
  preferPersistedDraft = false,
  showRestoredDraftNotice = false,
  restoredDraft: restoredDraftSignal = false,
  autoFocus = submitLabel.startsWith("保存"),
  allowEmpty = false,
  submitDisabled = false,
  attachmentsEnabled = true,
  insertRequest,
  removeTextRequest,
  mentionCandidates = [],
  savedReplies = textareaLabel === "添加评论",
  onInsertRequestApplied,
  onDiscardRestoredDraft,
  onBodyChange,
  onCancel,
  onSubmit,
}: {
  pagePath: string;
  draftId: string;
  textareaLabel: string;
  placeholder?: string;
  submitLabel: string;
  status?: DevIssue["status"];
  closeReason?: "completed" | "not_planned";
  canChangeStatus?: boolean;
  initialBody?: string;
  persistenceKey?: string;
  preferPersistedDraft?: boolean;
  showRestoredDraftNotice?: boolean;
  restoredDraft?: boolean;
  autoFocus?: boolean;
  allowEmpty?: boolean;
  submitDisabled?: boolean;
  attachmentsEnabled?: boolean;
  insertRequest?: { id: number; text: string } | null;
  removeTextRequest?: { id: string; attachment?: DevIssueAttachment } | null;
  mentionCandidates?: readonly DevUserBasic[];
  savedReplies?: boolean;
  onInsertRequestApplied?: (id: number) => void;
  onDiscardRestoredDraft?: () => void;
  onBodyChange?: (body: string) => void;
  onCancel?: () => void;
  onSubmit: (input: DevIssueComposerSubmit) => Promise<void>;
}) {
  const resolvedPlaceholder = placeholder ?? (textareaLabel.includes("评论") ? "留下评论" : "详细描述问题、复现步骤或期望结果");
  const [initialAttachmentDraft] = useState(() => readDevIssueAttachmentDraft(persistenceKey, pagePath));
  const [body, setBody] = useState(() => {
    const persisted = readDevIssueSessionDraft(persistenceKey);
    return preferPersistedDraft && persisted ? persisted : initialBody || persisted;
  });
  const [restoredDraft, setRestoredDraft] = useState(() => showRestoredDraftNotice && Boolean(restoredDraftSignal || readDevIssueSessionDraft(persistenceKey) || initialAttachmentDraft?.attachments.length));
  const [mode, setMode] = useState<"edit" | "preview">("edit");
  const [activeDraftId, setActiveDraftId] = useState(initialAttachmentDraft?.draftId ?? draftId);
  const [attachments, setAttachments] = useState<DevPendingIssueAttachment[]>(() => initialAttachmentDraft?.attachments.map((attachment) => ({ clientId: attachment.id, fileName: attachment.file_name, fileSize: attachment.size_bytes, previewUrl: isDevIssueSafeImage(attachment.mime_type) ? attachment.url : null, attachment, status: "uploaded" as const })) ?? []);
  const [dragActive, setDragActive] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submittingAction, setSubmittingAction] = useState<"submit" | "close" | "reopen" | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitAnnouncement, setSubmitAnnouncement] = useState("");
  const [attachmentLimitError, setAttachmentLimitError] = useState<string | null>(null);
  const [attachmentsExpanded, setAttachmentsExpanded] = useState(false);
  const [caret, setCaret] = useState(body.length);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [activeMentionIndex, setActiveMentionIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const addAttachmentButtonRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => { onBodyChange?.(body); }, [body, onBodyChange]);
  const attachmentRemoveButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const toolbarButtonRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [toolbarFocusIndex, setToolbarFocusIndex] = useState(0);
  const editButtonRef = useRef<HTMLButtonElement | null>(null);
  const previewButtonRef = useRef<HTMLButtonElement | null>(null);
  const selectionRef = useRef({ start: body.length, end: body.length });
  const selectionRestorePendingRef = useRef(false);
  const attachmentsRef = useRef<DevPendingIssueAttachment[]>([]);
  const issueAttachmentUploadGenerationsRef = useRef(new Map<string, number>());
  const dragDepthRef = useRef(0);
  const appliedInsertRequestRef = useRef<number | null>(null);
  const appliedRemoveTextRequestRef = useRef<string | null>(null);
  const composerId = `dev-issue-composer-${draftId.replace(/[^A-Za-z0-9_-]/g, "")}`;
  const mentionListId = `${composerId}-mentions`;
  const editTabId = `${composerId}-edit-tab`;
  const previewTabId = `${composerId}-preview-tab`;
  const panelId = `${composerId}-panel`;
  const attachmentListId = `${composerId}-attachments`;
  const mentionQuery = mentionOpen ? findDevIssueMentionQuery(body, caret) : null;
  const normalizedMentionQuery = mentionQuery?.query.toLocaleLowerCase() ?? "";

  useEffect(() => {
    if (!autoFocus) return;
    const frame = window.requestAnimationFrame(() => textareaRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [autoFocus]);
  const mentionOptions = mentionQuery ? Array.from(new Map(mentionCandidates.map((candidate) => [candidate.id, candidate])).values()).filter((candidate) => {
    const displayName = candidate.displayName?.trim() || candidate.name?.trim() || candidate.id;
    return candidate.id.toLocaleLowerCase().includes(normalizedMentionQuery) || displayName.toLocaleLowerCase().includes(normalizedMentionQuery);
  }).slice(0, 8) : [];
  const hasUploadingIssueAttachments = attachments.some((attachment) => attachment.status === "uploading");
  const hasErrorIssueAttachments = attachments.some((attachment) => attachment.status === "error");
  const hasBlockingIssueAttachments = hasUploadingIssueAttachments || hasErrorIssueAttachments;
  const contentMissing = !allowEmpty && !body.trim() && !attachments.some((attachment) => attachment.status === "uploaded");
  const attachmentSubmitError = hasErrorIssueAttachments ? "请移除或重试上传失败的附件" : null;
  const attachmentStatus = attachments.length === 0 ? "没有附件" : `${attachments.filter((attachment) => attachment.status === "uploading").length} 个上传中，${attachments.filter((attachment) => attachment.status === "uploaded").length} 个已就绪，${attachments.filter((attachment) => attachment.status === "error").length} 个失败`;
  const uploadedAttachmentCount = attachments.filter((attachment) => attachment.status === "uploaded").length;
  const hiddenUploadedAttachmentCount = Math.max(0, uploadedAttachmentCount - DEV_ISSUE_VISIBLE_UPLOADED_ATTACHMENTS);
  let visibleUploadedAttachmentCount = 0;
  const visibleAttachments = attachments.filter((attachment) => {
    if (attachmentsExpanded || attachment.status !== "uploaded") return true;
    visibleUploadedAttachmentCount += 1;
    return visibleUploadedAttachmentCount <= DEV_ISSUE_VISIBLE_UPLOADED_ATTACHMENTS;
  });

  useEffect(() => { attachmentsRef.current = attachments; }, [attachments]);
  useEffect(() => {
    if (submitAnnouncement && (body || attachments.length > 0)) setSubmitAnnouncement("");
  }, [attachments.length, body, submitAnnouncement]);
  useEffect(() => { writeDevIssueSessionDraft(persistenceKey, body); }, [body, persistenceKey]);
  useEffect(() => {
    writeDevIssueAttachmentDraft(persistenceKey, activeDraftId, attachments);
    if (attachments.length === 0) setActiveDraftId(draftId);
  }, [activeDraftId, attachments, draftId, persistenceKey]);
  useEffect(() => {
    if (!insertRequest || appliedInsertRequestRef.current === insertRequest.id) return;
    appliedInsertRequestRef.current = insertRequest.id;
    setBody((current) => {
      const next = current.trim() ? `${current}\n\n${insertRequest.text}` : insertRequest.text;
      selectionRef.current = { start: next.length, end: next.length };
      return next;
    });
    setMode("edit");
    selectionRestorePendingRef.current = true;
    onInsertRequestApplied?.(insertRequest.id);
  }, [insertRequest, onInsertRequestApplied]);
  useEffect(() => {
    if (!removeTextRequest || appliedRemoveTextRequestRef.current === removeTextRequest.id) return;
    appliedRemoveTextRequestRef.current = removeTextRequest.id;
    setBody((current) => removeDevIssueAttachmentMarkdown(current, removeTextRequest.attachment));
  }, [removeTextRequest]);
  useEffect(() => () => {
    issueAttachmentUploadGenerationsRef.current.clear();
    releaseDevIssueAttachments(attachmentsRef.current);
  }, []);
  useEffect(() => {
    if (mode !== "edit" || !selectionRestorePendingRef.current) return;
    const frame = requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      selectionRestorePendingRef.current = false;
      textarea.focus();
      textarea.setSelectionRange(selectionRef.current.start, selectionRef.current.end);
    });
    return () => cancelAnimationFrame(frame);
  }, [body, mode]);
  useEffect(() => { setActiveMentionIndex(0); }, [mentionQuery?.start, normalizedMentionQuery]);

  const rememberDevIssueSelection = () => {
    if (selectionRestorePendingRef.current) return;
    const textarea = textareaRef.current;
    if (!textarea) return;
    selectionRef.current = { start: textarea.selectionStart, end: textarea.selectionEnd };
  };
  const restoreDevIssueSelection = () => { selectionRestorePendingRef.current = true; };
  const runDevIssueMarkdownCommand = (command: DevIssueMarkdownCommand) => {
    const textarea = textareaRef.current;
    const result = applyDevIssueMarkdownCommand(body, textarea?.selectionStart ?? selectionRef.current.start, textarea?.selectionEnd ?? selectionRef.current.end, command);
    selectionRef.current = { start: result.selectionStart, end: result.selectionEnd };
    setBody(result.value);
    setMode("edit");
    restoreDevIssueSelection();
  };
  const insertDevIssueSavedReply = (reply: DevIssueSavedReply) => {
    const textarea = textareaRef.current;
    const start = textarea?.selectionStart ?? selectionRef.current.start;
    const end = textarea?.selectionEnd ?? selectionRef.current.end;
    const markerIndex = reply.body.indexOf("%cursor%");
    const inserted = markerIndex < 0 ? reply.body : `${reply.body.slice(0, markerIndex)}${reply.body.slice(markerIndex + 8)}`;
    const nextCaret = start + (markerIndex < 0 ? inserted.length : markerIndex);
    setBody(`${body.slice(0, start)}${inserted}${body.slice(end)}`);
    selectionRef.current = { start: nextCaret, end: nextCaret };
    setMode("edit");
    restoreDevIssueSelection();
  };
  const handleDevIssueEditorKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (mentionQuery && mentionOptions.length > 0 && ["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"].includes(event.key)) {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setMentionOpen(false); return; }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setActiveMentionIndex((index) => (index + (event.key === "ArrowDown" ? 1 : -1) + mentionOptions.length) % mentionOptions.length); return; }
      event.preventDefault();
      selectDevIssueMention(mentionOptions[activeMentionIndex] ?? mentionOptions[0]);
      return;
    }
    if (savedReplies && event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && event.key === ".") {
      event.preventDefault();
      toolbarButtonRefs.current[devIssueToolbar.length]?.click();
      return;
    }
    if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
    const command = event.key.toLowerCase() === "b" ? "bold" : event.key.toLowerCase() === "i" ? "italic" : event.key.toLowerCase() === "k" ? "link" : null;
    if (!command) return;
    event.preventDefault();
    runDevIssueMarkdownCommand(command);
  };
  const handleDevIssueComposerKeyDown = (event: React.KeyboardEvent<HTMLFormElement>) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    const submitShortcut = event.key === "Enter" && !event.shiftKey && (event.metaKey || event.ctrlKey) && !event.altKey;
    if (submitShortcut) {
      if (event.defaultPrevented || submitting || hasBlockingIssueAttachments || contentMissing || submitDisabled) return;
      event.preventDefault();
      event.currentTarget.requestSubmit();
      return;
    }
    const previewShortcut = event.key.toLowerCase() === "p" && event.shiftKey && (event.metaKey || event.ctrlKey) && !event.altKey;
    if (!previewShortcut) return;
    event.preventDefault();
    if (mode === "edit") {
      rememberDevIssueSelection();
      setMode("preview");
      window.requestAnimationFrame(() => previewButtonRef.current?.focus());
    } else {
      setMode("edit");
      restoreDevIssueSelection();
    }
  };
  const handleDevIssueModeTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const nextMode = event.key === "ArrowLeft" || event.key === "Home" ? "edit" : "preview";
    if (nextMode === "preview" && mode === "edit") rememberDevIssueSelection();
    setMode(nextMode);
    window.requestAnimationFrame(() => (nextMode === "edit" ? editButtonRef.current : previewButtonRef.current)?.focus());
  };
  const selectDevIssueMention = (candidate: DevUserBasic) => {
    if (!mentionQuery) return;
    const result = applyDevIssueMention(body, mentionQuery, candidate.id);
    setBody(result.value);
    setCaret(result.caret);
    selectionRef.current = { start: result.caret, end: result.caret };
    selectionRestorePendingRef.current = true;
    setMentionOpen(false);
  };
  const handleDevIssueBodyChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    setSubmitError(null);
    setBody(event.target.value);
    setCaret(event.target.selectionStart);
    selectionRef.current = { start: event.target.selectionStart, end: event.target.selectionEnd };
    setMentionOpen(true);
  };
  const devIssueToolbar: Array<{ command: DevIssueMarkdownCommand; label: string; icon: typeof Bold }> = [
    { command: "heading", label: "标题格式", icon: Heading2 },
    { command: "bold", label: "粗体", icon: Bold },
    { command: "italic", label: "斜体", icon: Italic },
    { command: "quote", label: "引用", icon: Quote },
    { command: "code", label: "行内代码", icon: Code },
    { command: "link", label: "链接", icon: Link },
    { command: "bullet-list", label: "无序列表", icon: List },
    { command: "ordered-list", label: "有序列表", icon: ListOrdered },
    { command: "task-list", label: "任务列表", icon: ListTodo },
  ];

  const handleDevIssueToolbarKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    const toolbarLength = devIssueToolbar.length + (savedReplies ? 1 : 0);
    let nextIndex: number;
    if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = toolbarLength - 1;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") nextIndex = (index - 1 + toolbarLength) % toolbarLength;
    else if (event.key === "ArrowRight" || event.key === "ArrowDown") nextIndex = (index + 1) % toolbarLength;
    else return;
    event.preventDefault();
    setToolbarFocusIndex(nextIndex);
    toolbarButtonRefs.current[nextIndex]?.focus();
  };

  const insertAttachmentMarkdown = (attachment: DevPendingIssueAttachment) => {
    const markdown = devIssueAttachmentMarkdown(attachment.attachment);
    if (!markdown) return;
    setBody((current) => current.trim() ? `${current}\n\n${markdown}` : markdown);
  };

  const nextIssueAttachmentUploadGeneration = (clientId: string): number => {
    const generation = (issueAttachmentUploadGenerationsRef.current.get(clientId) ?? 0) + 1;
    issueAttachmentUploadGenerationsRef.current.set(clientId, generation);
    return generation;
  };

  const uploadIssueAttachment = async (pending: DevPendingIssueAttachment, generation: number) => {
    if (!pending.file) return;
    try {
      const form = new FormData();
      form.set("pagePath", pagePath);
      form.set("draftId", activeDraftId);
      form.set("file", pending.file);
      const attachment = await requestDevIssue<DevIssueAttachment>("/api/issues/attachments", { method: "POST", credentials: "include", body: form });
      if (issueAttachmentUploadGenerationsRef.current.get(pending.clientId) !== generation) {
        releaseDevIssueAttachment(pagePath, attachment);
        return;
      }
      const uploaded = { ...pending, attachment, status: "uploaded" as const, error: undefined };
      setAttachments((current) => current.map((item) => item.clientId === pending.clientId ? uploaded : item));
      setSubmitError(null);
      if (issueAttachmentUploadGenerationsRef.current.get(pending.clientId) !== generation) return;
      insertAttachmentMarkdown(uploaded);
    } catch (uploadError) {
      if (issueAttachmentUploadGenerationsRef.current.get(pending.clientId) !== generation) return;
      setAttachments((current) => current.map((item) => item.clientId === pending.clientId ? {
        ...item,
        status: "error" as const,
        error: uploadError instanceof Error ? uploadError.message : "附件上传失败",
      } : item));
    }
  };

  const addIssueFiles = (files: File[]) => {
    const remainingCapacity = Math.max(0, DEV_ISSUE_MAX_DRAFT_ATTACHMENTS - attachments.length);
    const acceptedFiles = files.slice(0, remainingCapacity);
    const ignoredCount = files.length - acceptedFiles.length;
    setAttachmentLimitError(ignoredCount > 0 ? `每个草稿最多添加 20 个附件；已忽略 ${ignoredCount} 个文件` : null);
    acceptedFiles.forEach((file) => {
      const canUpload = file.size > 0 && file.size <= DEV_ISSUE_MAX_ATTACHMENT_BYTES;
      const pending: DevPendingIssueAttachment = {
        clientId: createDevIssueDraftId(),
        file,
        fileName: file.name,
        fileSize: file.size,
        previewUrl: isDevIssueSafeImage(file.type) && URL.createObjectURL ? URL.createObjectURL(file) : null,
        status: canUpload ? "uploading" : "error",
        error: file.size === 0 ? "不能上传空文件" : file.size > DEV_ISSUE_MAX_ATTACHMENT_BYTES ? "单个附件不能超过 25 MiB" : undefined,
      };
      setAttachments((current) => [...current, pending]);
      if (pending.status === "uploading") void uploadIssueAttachment(pending, nextIssueAttachmentUploadGeneration(pending.clientId));
    });
  };

  const handleIssueFiles = (event: React.ChangeEvent<HTMLInputElement>) => {
    addIssueFiles(Array.from(event.target.files ?? []));
    event.target.value = "";
  };
  const handleIssueDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    dragDepthRef.current = 0;
    setDragActive(false);
    addIssueFiles(Array.from(event.dataTransfer.files));
  };
  const handleIssueDragEnter = (event: React.DragEvent<HTMLDivElement>) => {
    if (!Array.from(event.dataTransfer.types).includes("Files")) return;
    event.preventDefault();
    dragDepthRef.current += 1;
    setDragActive(true);
  };
  const handleIssueDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
    if (!dragActive) return;
    event.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setDragActive(false);
  };
  const handleIssuePaste = (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(event.clipboardData.files);
    if (!files.length) return;
    event.preventDefault();
    addIssueFiles(files);
  };
  const removeAttachment = (attachment: DevPendingIssueAttachment) => {
    const visibleIndex = visibleAttachments.findIndex((item) => item.clientId === attachment.clientId);
    const nextAttachmentId = visibleAttachments[visibleIndex + 1]?.clientId;
    const previousAttachmentId = visibleAttachments[visibleIndex - 1]?.clientId;
    setAttachmentLimitError(null);
    nextIssueAttachmentUploadGeneration(attachment.clientId);
    revokeDevIssueAttachmentPreview(attachment);
    setAttachments((current) => current.filter((item) => item.clientId !== attachment.clientId));
    setBody((current) => removeDevIssueAttachmentMarkdown(current, attachment.attachment));
    if (attachment.attachment) releaseDevIssueAttachment(pagePath, attachment.attachment);
    setSubmitError(null);
    window.requestAnimationFrame(() => {
      const target = (nextAttachmentId && attachmentRemoveButtonRefs.current.get(nextAttachmentId))
        || (previousAttachmentId && attachmentRemoveButtonRefs.current.get(previousAttachmentId))
        || addAttachmentButtonRef.current;
      target?.focus();
    });
  };
  const retryAttachment = (attachment: DevPendingIssueAttachment) => {
    const retrying = { ...attachment, status: "uploading" as const, error: undefined };
    setAttachments((current) => current.map((item) => item.clientId === attachment.clientId ? retrying : item));
    void uploadIssueAttachment(retrying, nextIssueAttachmentUploadGeneration(attachment.clientId));
  };
  const submit = async (event: React.FormEvent<HTMLFormElement>, statusAction?: "close" | "reopen") => {
    event.preventDefault();
    if (hasBlockingIssueAttachments) return;
    const attachmentIds = attachments.flatMap((attachment) => attachment.status === "uploaded" && attachment.attachment ? [attachment.attachment.id] : []);
    if (!allowEmpty && !body.trim() && attachmentIds.length === 0) return;
    setSubmitting(true);
    setSubmittingAction(statusAction ?? "submit");
    setSubmitError(null);
    setSubmitAnnouncement("");
    try {
      await onSubmit({ body: body.trim(), attachmentIds, draftId: activeDraftId, statusAction, stateReason: statusAction === "close" ? closeReason : undefined });
      setSubmitAnnouncement(statusAction === "close" ? "评论并关闭成功" : statusAction === "reopen" ? "重新打开并评论成功" : `${submitLabel}成功`);
      setBody("");
      setRestoredDraft(false);
      writeDevIssueSessionDraft(persistenceKey, "");
      writeDevIssueAttachmentDraft(persistenceKey, activeDraftId, []);
      issueAttachmentUploadGenerationsRef.current.clear();
      releaseDevIssueAttachments(attachments);
      setAttachments([]);
      setAttachmentLimitError(null);
      setAttachmentsExpanded(false);
      selectionRef.current = { start: 0, end: 0 };
      setCaret(0);
      setMentionOpen(false);
      setActiveMentionIndex(0);
      setMode("edit");
      if (!statusAction) window.requestAnimationFrame(() => textareaRef.current?.focus());
    } catch (submitFailure) {
      setSubmitError(submitFailure instanceof Error ? submitFailure.message : "提交失败");
    } finally {
      setSubmitting(false);
      setSubmittingAction(null);
    }
  };

  const discardRestoredDraft = () => {
    attachmentsRef.current.forEach((attachment) => { if (attachment.attachment) releaseDevIssueAttachment(pagePath, attachment.attachment); });
    setBody(initialBody);
    writeDevIssueSessionDraft(persistenceKey, "");
    writeDevIssueAttachmentDraft(persistenceKey, activeDraftId, []);
    setAttachments([]);
    setAttachmentLimitError(null);
    setAttachmentsExpanded(false);
    setRestoredDraft(false);
    setMode("edit");
    onDiscardRestoredDraft?.();
  };

  return (
    <form onSubmit={(event) => { void submit(event); }} onKeyDown={handleDevIssueComposerKeyDown} className="space-y-3">
      <span role="status" aria-live="polite" aria-atomic="true" aria-label="提交状态" className="sr-only">{submitAnnouncement}</span>
      {restoredDraft && <div role="status" className="flex flex-wrap items-center justify-between gap-2 rounded border border-localapp-dev-border bg-localapp-dev-muted px-3 py-2 text-sm"><span>已恢复未提交的草稿</span><DevIssueDiscardDraftControl triggerLabel="丢弃草稿" onConfirm={discardRestoredDraft} focusAfterConfirm={() => textareaRef.current?.focus()} /></div>}
      {savedReplies && <div role="toolbar" aria-label="保存回复工具" className="flex justify-end"><DevIssueSavedRepliesPicker buttonRef={(element) => { toolbarButtonRefs.current[devIssueToolbar.length] = element; }} tabIndex={0} onFocus={() => setToolbarFocusIndex(devIssueToolbar.length)} onKeyDown={(event) => handleDevIssueToolbarKeyDown(event, devIssueToolbar.length)} onInsert={insertDevIssueSavedReply} /></div>}
      <div data-localapp-issue-editor className="overflow-visible rounded border border-localapp-dev-border bg-background">
        <div role="tablist" aria-label="Markdown 模式" className="flex items-center gap-1 border-b border-localapp-dev-border bg-localapp-dev-muted px-2 py-1.5">
          <button ref={editButtonRef} id={editTabId} type="button" role="tab" aria-selected={mode === "edit"} aria-controls={panelId} tabIndex={mode === "edit" ? 0 : -1} onKeyDown={handleDevIssueModeTabKeyDown} onClick={() => { setMode("edit"); restoreDevIssueSelection(); }} className={`h-11 rounded px-3 text-xs font-medium sm:h-7 sm:px-2 ${mode === "edit" ? DEV_BUTTON_ACTIVE : "text-localapp-dev-muted-foreground hover:text-localapp-dev-foreground"}`}>编辑</button>
          <button ref={previewButtonRef} id={previewTabId} type="button" role="tab" aria-selected={mode === "preview"} aria-controls={panelId} tabIndex={mode === "preview" ? 0 : -1} aria-keyshortcuts="Meta+Shift+P Control+Shift+P" onKeyDown={handleDevIssueModeTabKeyDown} onClick={() => { rememberDevIssueSelection(); setMode("preview"); }} className={`h-11 rounded px-3 text-xs font-medium sm:h-7 sm:px-2 ${mode === "preview" ? DEV_BUTTON_ACTIVE : "text-localapp-dev-muted-foreground hover:text-localapp-dev-foreground"}`}>预览</button>
        </div>
        {mode === "edit" ? <div id={panelId} role="tabpanel" aria-labelledby={editTabId}><div data-localapp-issue-toolbar role="toolbar" aria-label="Markdown 工具栏" className="flex min-h-10 flex-wrap items-center gap-0.5 overflow-x-hidden border-b border-localapp-dev-border bg-localapp-dev-muted px-2 py-1 sm:flex-nowrap sm:overflow-x-auto">{devIssueToolbar.map(({ command, label, icon: Icon }, index) => <button key={command} ref={(element) => { toolbarButtonRefs.current[index] = element; }} type="button" tabIndex={toolbarFocusIndex === index ? 0 : -1} aria-label={label} title={label} className={`${DEV_ICON_BUTTON} h-11 w-11 shrink-0 sm:h-8 sm:w-8`} onFocus={() => setToolbarFocusIndex(index)} onKeyDown={(event) => handleDevIssueToolbarKeyDown(event, index)} onMouseDown={(event) => event.preventDefault()} onClick={() => runDevIssueMarkdownCommand(command)}><Icon className="h-4 w-4" /></button>)}</div><div className="relative"><textarea ref={textareaRef} aria-label={textareaLabel} placeholder={resolvedPlaceholder} aria-autocomplete="list" aria-expanded={mentionOptions.length > 0} aria-controls={mentionOptions.length > 0 ? mentionListId : undefined} aria-activedescendant={mentionOptions.length > 0 ? `${mentionListId}-${activeMentionIndex}` : undefined} value={body} onChange={handleDevIssueBodyChange} onSelect={(event) => { rememberDevIssueSelection(); setCaret(event.currentTarget.selectionStart); }} onKeyUp={(event) => { rememberDevIssueSelection(); setCaret(event.currentTarget.selectionStart); }} onKeyDown={handleDevIssueEditorKeyDown} onPaste={attachmentsEnabled ? handleIssuePaste : undefined} rows={6} className="block min-h-28 w-full resize-y bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-localapp-dev-focus" />{mentionOptions.length > 0 && <div id={mentionListId} role="listbox" aria-label="提及用户建议" className="absolute left-2 right-2 top-full z-30 mt-1 max-h-56 overflow-y-auto rounded-[6px] border border-localapp-dev-border bg-background p-1 shadow-lg">{mentionOptions.map((candidate, index) => { const displayName = candidate.displayName?.trim() || candidate.name?.trim() || candidate.id; return <button id={`${mentionListId}-${index}`} key={candidate.id} type="button" role="option" aria-label={`${displayName}，账号 @${candidate.id}`} aria-selected={index === activeMentionIndex} className={`flex min-h-11 w-full min-w-0 items-center gap-2 rounded px-2 text-left text-sm sm:min-h-10 ${index === activeMentionIndex ? "bg-localapp-dev-muted" : "hover:bg-localapp-dev-muted"}`} onMouseDown={(event) => event.preventDefault()} onClick={() => selectDevIssueMention(candidate)}><span aria-hidden="true" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-localapp-dev-muted text-xs font-semibold">{Array.from(displayName)[0]?.toLocaleUpperCase() || "?"}</span><span className="min-w-0 flex-1 truncate"><strong>{displayName}</strong><span className="ml-2 text-localapp-dev-muted-foreground">@{candidate.id}</span></span></button>; })}</div>}{mentionQuery && mentionOptions.length === 0 && <div role="status" aria-label="提及用户建议状态" className="absolute left-2 right-2 top-full z-30 mt-1 rounded-[6px] border border-localapp-dev-border bg-background px-3 py-3 text-sm text-localapp-dev-muted-foreground shadow-lg">没有匹配的用户</div>}</div></div> : <div id={panelId} role="tabpanel" aria-labelledby={previewTabId} className="min-h-28 px-3 py-2">{body ? <DevIssueMarkdown>{body}</DevIssueMarkdown> : <p className="text-sm text-localapp-dev-muted-foreground">暂无内容</p>}</div>}
      </div>
      {attachmentsEnabled && <div data-localapp-issue-attachment-queue tabIndex={-1} data-drag-active={dragActive ? "true" : undefined} aria-label="拖拽附件到此处" aria-busy={hasUploadingIssueAttachments || undefined} onDragEnter={handleIssueDragEnter} onDragLeave={handleIssueDragLeave} onDragOver={(event) => { if (Array.from(event.dataTransfer.types).includes("Files")) event.preventDefault(); }} onDrop={handleIssueDrop} className={`rounded border border-dashed px-3 py-2 transition-colors motion-reduce:transition-none ${dragActive ? "border-localapp-dev-focus bg-localapp-dev-muted ring-2 ring-localapp-dev-focus" : "border-localapp-dev-border"}`}>
        {dragActive && <span role="status" aria-label="附件拖拽状态" className="sr-only">松开以上传文件</span>}
        <span role="status" aria-label="附件队列状态" aria-live="polite" aria-atomic="true" className="sr-only">{attachmentStatus}</span>
        <div className="flex flex-wrap items-center gap-2"><input ref={inputRef} data-testid="issue-attachment-input" hidden type="file" multiple onChange={handleIssueFiles} /><button ref={addAttachmentButtonRef} type="button" className={`${DEV_OUTLINE_BUTTON} h-11 gap-1.5 sm:h-8`} onClick={() => inputRef.current?.click()}><Upload className="h-3.5 w-3.5" aria-hidden="true" />添加附件</button><span className={`text-xs ${dragActive ? "font-medium text-localapp-dev-accent" : "text-localapp-dev-muted-foreground"}`}>{dragActive ? "松开以上传文件" : "拖拽文件或粘贴截图"}</span></div>
        {attachments.length > 0 && <><ul id={attachmentListId} className="mt-2 grid gap-2 sm:grid-cols-2">{visibleAttachments.map((attachment) => <li key={attachment.clientId} className="flex min-w-0 items-center gap-2 rounded border border-localapp-dev-border bg-localapp-dev-muted p-2 text-xs">{attachment.previewUrl ? <img src={attachment.previewUrl} alt={`${attachment.fileName} 预览`} className="h-10 w-10 shrink-0 rounded object-cover" /> : <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded border border-localapp-dev-border text-localapp-dev-muted-foreground">文件</span>}<div className="min-w-0 flex-1"><p className="truncate font-medium">{attachment.fileName}</p>{attachment.status === "uploaded" ? <p role="status" aria-label={`${attachment.fileName} 已上传`} className="inline-flex items-center gap-1 text-localapp-dev-success"><Check className="h-3.5 w-3.5" aria-hidden="true" />已上传 · {formatDevIssueFileSize(attachment.fileSize)}</p> : <p className={attachment.error ? "text-localapp-dev-danger" : "text-localapp-dev-muted-foreground"}>{attachment.error ?? "上传中..."}</p>}</div>{attachment.status === "uploading" && <LoaderCircle className="h-4 w-4 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden="true" />}{attachment.status === "error" && <button type="button" aria-label={`重试 ${attachment.fileName}`} title={`重试 ${attachment.fileName}`} className={`${DEV_ICON_BUTTON} h-11 w-11 shrink-0 sm:h-7 sm:w-7`} onClick={() => retryAttachment(attachment)}><RotateCw className="h-3.5 w-3.5" aria-hidden="true" /></button>}<button ref={(element) => { if (element) attachmentRemoveButtonRefs.current.set(attachment.clientId, element); else attachmentRemoveButtonRefs.current.delete(attachment.clientId); }} type="button" aria-label={`移除 ${attachment.fileName}`} title={`移除 ${attachment.fileName}`} className={`${DEV_ICON_BUTTON} h-11 w-11 shrink-0 sm:h-7 sm:w-7`} onClick={() => removeAttachment(attachment)}><Trash2 className="h-3.5 w-3.5" aria-hidden="true" /></button></li>)}</ul>{hiddenUploadedAttachmentCount > 0 && <button type="button" className={`${DEV_OUTLINE_BUTTON} mt-2 h-11 sm:h-8`} aria-expanded={attachmentsExpanded} aria-controls={attachmentListId} onClick={() => setAttachmentsExpanded((expanded) => !expanded)}>{attachmentsExpanded ? "收起已上传附件" : `显示其余 ${hiddenUploadedAttachmentCount} 个已上传附件`}</button>}</>}
      </div>}
      {attachmentLimitError && <p role="alert" data-localapp-issue-attachment-limit-error className="text-xs text-localapp-dev-danger">{attachmentLimitError}</p>}
      {(attachmentSubmitError || submitError) && <p role="alert" className="text-xs text-localapp-dev-danger">{attachmentSubmitError || submitError}</p>}
      <div className="flex flex-wrap justify-end gap-2">{onCancel && <button type="button" disabled={submitting} className={`${DEV_OUTLINE_BUTTON} h-11 sm:h-8`} onClick={onCancel}>取消</button>}<button type="submit" aria-keyshortcuts="Meta+Enter Control+Enter" aria-busy={submittingAction === "submit" || undefined} disabled={submitting || hasBlockingIssueAttachments || contentMissing || submitDisabled} className={`h-11 min-w-[5.5rem] gap-1.5 rounded px-3 py-1.5 text-xs font-medium disabled:opacity-50 sm:h-8 ${DEV_BUTTON_ACTIVE}`}>{submittingAction === "submit" && <LoaderCircle className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />}{submitLabel}</button>{canChangeStatus && status === "open" && <button type="button" aria-busy={submittingAction === "close" || undefined} disabled={submitting || hasBlockingIssueAttachments || contentMissing || submitDisabled} className={`${DEV_OUTLINE_BUTTON} h-11 min-w-[7.5rem] gap-1.5 sm:h-8`} onClick={(event) => { void submit(event as unknown as React.FormEvent<HTMLFormElement>, "close"); }}>{submittingAction === "close" && <LoaderCircle className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />}评论并关闭</button>}{canChangeStatus && status === "closed" && <button type="button" aria-busy={submittingAction === "reopen" || undefined} disabled={submitting || hasBlockingIssueAttachments || contentMissing || submitDisabled} className={`${DEV_OUTLINE_BUTTON} h-11 min-w-[9rem] gap-1.5 sm:h-8`} onClick={(event) => { void submit(event as unknown as React.FormEvent<HTMLFormElement>, "reopen"); }}>{submittingAction === "reopen" && <LoaderCircle className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />}重新打开并评论</button>}</div>
    </form>
  );
}

interface DevIssueMetadataPickerItem { id: string; label: string; description?: string; leading?: React.ReactNode; }
function DevIssueMetadataPicker({ label, items, selectedIds, disabled, onToggle }: { label: "Labels" | "Assignees"; items: readonly DevIssueMetadataPickerItem[]; selectedIds: readonly string[]; disabled: boolean; onToggle: (id: string, selected: boolean) => Promise<void>; }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [toggleError, setToggleError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const optionRefs = useRef<Array<HTMLInputElement | null>>([]);
  const dialogId = React.useId();
  const localizedLabel = label === "Labels" ? "标签" : "负责人";
  const selected = new Set(selectedIds);
  const needle = query.trim().toLocaleLowerCase();
  const filtered = needle ? items.filter((item) => `${item.label}\n${item.id}\n${item.description ?? ""}`.toLocaleLowerCase().includes(needle)) : items;
  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => searchRef.current?.focus());
    const closeOnOutside = (event: MouseEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", closeOnOutside);
    return () => { window.cancelAnimationFrame(frame); document.removeEventListener("mousedown", closeOnOutside); };
  }, [open]);
  const closeWithFocus = () => { setOpen(false); setQuery(""); setToggleError(null); window.requestAnimationFrame(() => triggerRef.current?.focus()); };
  const toggle = async (item: DevIssueMetadataPickerItem) => {
    if (pendingId || disabled) return;
    setToggleError(null);
    setPendingId(item.id);
    try { await onToggle(item.id, !selected.has(item.id)); }
    catch (error) { setToggleError(error instanceof Error ? error.message : `${localizedLabel}更新失败`); }
    finally { setPendingId(null); }
  };
  const handlePickerKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
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
  return <div ref={rootRef} className="relative"><button ref={triggerRef} type="button" aria-label={`编辑${localizedLabel}`} title={`编辑${localizedLabel}`} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? dialogId : undefined} disabled={disabled} className={`${DEV_ICON_BUTTON} h-11 w-11 sm:h-7 sm:w-7`} onClick={() => { setOpen((value) => !value); setQuery(""); setToggleError(null); }}><Pencil className="h-3.5 w-3.5" /></button>{open && <div id={dialogId} role="dialog" aria-label={`选择${localizedLabel}`} onKeyDown={handlePickerKeyDown} className="absolute right-0 top-12 z-40 w-[min(320px,calc(100vw-2rem))] overflow-hidden rounded-[6px] border border-localapp-dev-border bg-background shadow-lg sm:top-8"><div className="relative border-b border-localapp-dev-border p-2"><Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-localapp-dev-muted-foreground" /><input ref={searchRef} type="search" role="searchbox" aria-label={`搜索${localizedLabel}`} value={query} onChange={(event) => setQuery(event.target.value)} className="h-11 w-full rounded border border-localapp-dev-border bg-background pl-8 pr-2 text-sm outline-none focus:ring-2 focus:ring-localapp-dev-focus sm:h-8" /></div>{toggleError && <div role="alert" className="mx-2 mt-2 rounded border border-localapp-dev-danger bg-localapp-dev-danger-muted px-3 py-2 text-xs text-localapp-dev-danger">{toggleError}</div>}<div className="max-h-64 overflow-y-auto p-1">{filtered.length === 0 ? <p className="px-3 py-8 text-center text-sm text-localapp-dev-muted-foreground">没有匹配项</p> : filtered.map((item, index) => <label key={item.id} className="flex min-h-11 cursor-pointer items-center gap-2 rounded px-2 py-1.5 hover:bg-localapp-dev-muted focus-within:bg-localapp-dev-muted focus-within:ring-2 focus-within:ring-localapp-dev-focus"><input ref={(node) => { optionRefs.current[index] = node; }} type="checkbox" className="sr-only" aria-label={item.label} checked={selected.has(item.id)} disabled={disabled || pendingId !== null} onChange={() => { void toggle(item); }} /><span aria-hidden="true" className="flex h-4 w-4 shrink-0 items-center justify-center rounded border border-localapp-dev-border">{selected.has(item.id) && <Check className="h-3 w-3" />}</span>{item.leading}<span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{item.label}</span><span className="block truncate text-xs text-localapp-dev-muted-foreground">{item.description || item.id}</span></span></label>)}</div></div>}</div>;
}

function DevIssueParticipantRoster({ participantIds, identities }: { participantIds: readonly string[]; identities: readonly DevUserBasic[] }) {
  const visibleIds = participantIds.slice(0, 8);
  const overflow = Math.max(0, participantIds.length - visibleIds.length);
  return <ul aria-label="Issue 参与者" className="flex flex-wrap gap-1.5">{visibleIds.map((id) => {
    const identity = resolveDevIssueIdentity(id, identities);
    const label = `${identity.displayName} @${identity.id}`;
    return <li key={id}><span aria-label={label} title={label} className="flex h-7 w-7 items-center justify-center overflow-hidden rounded-full border border-localapp-dev-border bg-localapp-dev-muted text-[10px] font-semibold text-localapp-dev-muted-foreground">{identity.avatarUrl ? <img src={identity.avatarUrl} alt="" className="h-full w-full object-cover" /> : getDevIssueIdentityInitial(identity)}</span></li>;
  })}{overflow > 0 && <li><span aria-label={`另外 ${overflow} 位参与者`} title={`另外 ${overflow} 位参与者`} className="flex h-7 min-w-7 items-center justify-center rounded-full border border-localapp-dev-border bg-localapp-dev-muted px-1 text-[10px] font-semibold text-localapp-dev-muted-foreground">+{overflow}</span></li>}</ul>;
}

function DevIssueMetadata({ detail, identities, availableLabels, availableMilestones, currentUserId, canManage, canManageLock, canManagePin, saving, onSetIssueType, onToggleLabel, onToggleAssignee, onSetMilestone, onToggleSubscription, onToggleLock, onTogglePin }: {
  detail: DevIssueDetail;
  identities: readonly DevUserBasic[];
  availableLabels: readonly DevIssueLabelDefinition[];
  availableMilestones: readonly DevIssueMilestoneDefinition[];
  currentUserId?: string;
  canManage: boolean;
  canManageLock: boolean;
  canManagePin: boolean;
  saving: boolean;
  onSetIssueType: (issueType: DevIssueType) => Promise<void>;
  onToggleLabel: (labelId: string, selected: boolean) => Promise<void>;
  onToggleAssignee: (userId: string, selected: boolean) => Promise<void>;
  onSetMilestone: (milestoneId: number | null) => Promise<void>;
  onToggleSubscription: (subscribed: boolean) => Promise<void>;
  onToggleLock: (locked: boolean, reason?: DevIssueLockReason) => Promise<void>;
  onTogglePin: (pinned: boolean) => Promise<void>;
}) {
  const [localMetadataError, setLocalMetadataError] = useState<string | null>(null);
  const [lockDialogOpen, setLockDialogOpen] = useState(false);
  const [lockReason, setLockReason] = useState<DevIssueLockReason>("resolved");
  const lockTriggerRef = useRef<HTMLButtonElement | null>(null);
  const lockDialogRef = useRef<HTMLDivElement | null>(null);
  const collaboration = detail.collaboration;
  const participantIds = Array.from(new Set([
    detail.issue.reporter_id,
    ...(collaboration?.participant_ids ?? []),
    ...(detail.issue.participant_ids ?? []),
    ...detail.timeline.flatMap((item) => item.kind === "comment" ? [item.comment.author_id] : item.kind === "event" ? [item.event.actor_id] : [item.crossReference.actor_id]),
  ])).filter(Boolean);
  const selectedLabelIds = collaboration?.labels.map((label) => label.id) ?? [];
  const labelCandidates = Array.from(new Map([...(collaboration?.labels ?? []), ...availableLabels].map((label) => [label.id, label])).values());
  const assigneeIds = collaboration?.assignee_ids ?? [];
  const assigneeCandidates = Array.from(new Set([...assigneeIds, ...identities.map((identity) => identity.id)]))
    .map((id) => resolveDevIssueIdentity(id, identities));
  const subscribed = Boolean(currentUserId && collaboration?.subscriber_ids.includes(currentUserId));
  const runMetadataAction = async (action: Promise<void>) => {
    setLocalMetadataError(null);
    try { await action; }
    catch (error) { setLocalMetadataError(error instanceof Error ? error.message : "Issue 元数据更新失败"); throw error; }
  };
  const closeLockDialog = () => {
    setLockDialogOpen(false);
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => lockTriggerRef.current?.focus()));
  };
  const handleLockDialogKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape" && !saving) { event.preventDefault(); event.stopPropagation(); closeLockDialog(); return; }
    if (event.key !== "Tab") return;
    const dialog = lockDialogRef.current;
    if (!dialog) return;
    const focusable = Array.from(dialog.querySelectorAll<HTMLElement>('button:not([disabled]), select:not([disabled])'));
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };
  return <div className="space-y-5 text-sm">
    {localMetadataError && !lockDialogOpen && <div role="alert" className="rounded border border-localapp-dev-danger bg-localapp-dev-danger-muted px-3 py-2 text-xs text-localapp-dev-danger">{localMetadataError}</div>}
    {localMetadataError && lockDialogOpen && <div data-localapp-issue-lock-error role="alert" className="absolute left-1/2 top-24 z-[90] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 rounded border border-localapp-dev-danger bg-localapp-dev-danger-muted px-3 py-2 text-sm text-localapp-dev-danger shadow-lg">{localMetadataError}</div>}
    <section><h4 className="mb-2 text-xs font-semibold text-localapp-dev-muted-foreground">创建者</h4><DevIssueActor identity={resolveDevIssueIdentity(detail.issue.reporter_id, identities)} /></section>
    <section><div className="mb-2 flex items-center justify-between gap-2"><h4 className="text-xs font-semibold text-localapp-dev-muted-foreground">类型</h4>{canManage && <select aria-label="设置 Issue 类型" value={detail.issue.issue_type ?? detail.issue.label} disabled={saving} onChange={(event) => void runMetadataAction(onSetIssueType(event.target.value as DevIssueType)).catch(() => undefined)} className="h-11 rounded border border-localapp-dev-border bg-background px-2 text-xs sm:h-8"><option value="task">任务</option><option value="bug">缺陷</option><option value="feature">功能</option></select>}</div><p className="text-xs font-medium text-localapp-dev-foreground">{DEV_ISSUE_TYPE_LABELS[detail.issue.issue_type ?? detail.issue.label]}</p></section>
    <section><div className="mb-2 flex items-center justify-between"><h4 className="text-xs font-semibold text-localapp-dev-muted-foreground">标签</h4>{canManage && <DevIssueMetadataPicker label="Labels" items={labelCandidates.map((label) => ({ id: label.id, label: label.name, description: label.description || label.id, leading: <span aria-hidden="true" className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: `#${label.color}` }} /> }))} selectedIds={selectedLabelIds} disabled={saving} onToggle={(labelId, selected) => onToggleLabel(labelId, selected)} />}</div><div className="flex flex-wrap gap-1.5">{(collaboration?.labels ?? []).map((label) => <DevIssueLabelBadge key={label.id} label={label} />)}</div></section>
    <section><div className="mb-2 flex items-center justify-between"><h4 className="text-xs font-semibold text-localapp-dev-muted-foreground">负责人</h4>{canManage && <DevIssueMetadataPicker label="Assignees" items={assigneeCandidates.map((identity) => ({ id: identity.id, label: identity.displayName, description: `@${identity.id}`, leading: <span aria-hidden="true" className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-localapp-dev-muted text-[10px] font-semibold">{Array.from(identity.displayName)[0]?.toLocaleUpperCase() || "?"}</span> }))} selectedIds={assigneeIds} disabled={saving} onToggle={(userId, selected) => onToggleAssignee(userId, selected)} />}</div>{assigneeIds.length > 0 ? <div className="space-y-2">{assigneeIds.map((id) => <DevIssueActor key={id} identity={resolveDevIssueIdentity(id, identities)} />)}</div> : <p className="text-xs text-localapp-dev-muted-foreground">尚未分配</p>}</section>
    <section><div className="mb-2 flex items-center justify-between gap-2"><h4 className="text-xs font-semibold text-localapp-dev-muted-foreground">里程碑</h4>{canManage && <select aria-label="设置里程碑" value={detail.issue.milestone_id ?? ""} disabled={saving} onChange={(event) => void runMetadataAction(onSetMilestone(event.target.value ? Number(event.target.value) : null)).catch(() => undefined)} className="h-11 min-w-0 max-w-[170px] rounded border border-localapp-dev-border bg-background px-2 text-xs sm:h-8"><option value="">无里程碑</option>{availableMilestones.map((item) => <option key={item.id} value={item.id}>{item.title}{item.state === "closed" ? "（已关闭）" : ""}</option>)}</select>}</div><p className="text-xs text-localapp-dev-muted-foreground">{availableMilestones.find((item) => item.id === detail.issue.milestone_id)?.title ?? "尚未设置"}</p></section>
    {currentUserId && <section><h4 className="mb-2 text-xs font-semibold text-localapp-dev-muted-foreground">通知</h4><button type="button" disabled={saving} aria-label={subscribed ? "取消订阅" : "订阅 Issue"} className={`${DEV_OUTLINE_BUTTON} h-11 w-full text-left sm:h-8`} onClick={() => { void runMetadataAction(onToggleSubscription(!subscribed)).catch(() => undefined); }}>{subscribed ? "取消订阅" : "订阅 Issue"}</button></section>}
    {canManagePin && <section><h4 className="mb-2 text-xs font-semibold text-localapp-dev-muted-foreground">置顶</h4><button type="button" disabled={saving} aria-label={detail.issue.pinned_at ? "取消置顶" : "置顶 Issue"} className={`${DEV_OUTLINE_BUTTON} flex h-11 w-full items-center gap-2 text-left sm:h-8`} onClick={() => { void runMetadataAction(onTogglePin(!detail.issue.pinned_at)).catch(() => undefined); }}>{detail.issue.pinned_at ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}{detail.issue.pinned_at ? "取消置顶" : "置顶 Issue"}</button></section>}
    {canManageLock && <section><h4 className="mb-2 text-xs font-semibold text-localapp-dev-muted-foreground">对话</h4><button ref={lockTriggerRef} type="button" disabled={saving} aria-label={detail.issue.locked_at ? "解锁对话" : "锁定对话"} className={`${DEV_OUTLINE_BUTTON} flex h-11 w-full items-center gap-2 text-left sm:h-8`} onClick={() => { if (detail.issue.locked_at) void runMetadataAction(onToggleLock(false)).catch(() => undefined); else setLockDialogOpen(true); }}>{detail.issue.locked_at ? <LockOpen className="h-4 w-4" /> : <LockKeyhole className="h-4 w-4" />}{detail.issue.locked_at ? "解锁对话" : "锁定对话"}</button></section>}
    <section><h4 className="mb-2 text-xs font-semibold text-localapp-dev-muted-foreground">参与者</h4><DevIssueParticipantRoster participantIds={participantIds} identities={identities} /></section>
    {lockDialogOpen && <div data-localapp-issue-lock-layer className="absolute inset-0 z-[80] flex items-center justify-center bg-black/45 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) closeLockDialog(); }}><div ref={lockDialogRef} role="dialog" aria-modal="true" aria-labelledby="dev-issue-lock-title" aria-describedby="dev-issue-lock-description" onKeyDown={handleLockDialogKeyDown} className="w-full max-w-md overflow-hidden rounded-[6px] border border-localapp-dev-border bg-background shadow-2xl"><header className="flex items-center gap-3 border-b border-localapp-dev-border px-4 py-3"><LockKeyhole className="h-4 w-4" /><h3 id="dev-issue-lock-title" className="min-w-0 flex-1 text-sm font-semibold">锁定对话</h3><button type="button" aria-label="取消锁定" disabled={saving} className={`${DEV_ICON_BUTTON} h-11 w-11 sm:h-8 sm:w-8`} onClick={closeLockDialog}><X className="h-4 w-4" /></button></header><div className="space-y-4 p-4"><p id="dev-issue-lock-description" className="text-sm text-localapp-dev-muted-foreground">锁定后，参与者无法新增评论、表态或勾选任务。现有内容仍然可见。</p><label className="block space-y-1.5 text-sm font-medium">锁定原因<select autoFocus aria-label="锁定原因" value={lockReason} disabled={saving} onChange={(event) => setLockReason(event.target.value as DevIssueLockReason)} className="block h-11 w-full rounded border border-localapp-dev-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-localapp-dev-focus sm:h-9">{(Object.entries(DEV_ISSUE_LOCK_REASON_LABELS) as Array<[DevIssueLockReason, string]>).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div><footer className="flex justify-end gap-2 border-t border-localapp-dev-border px-4 py-3"><button type="button" disabled={saving} className={`${DEV_OUTLINE_BUTTON} h-11 sm:h-8`} onClick={closeLockDialog}>取消</button><button type="button" disabled={saving} className={`${DEV_BUTTON_ACTIVE} h-11 sm:h-8`} onClick={() => { void runMetadataAction(onToggleLock(true, lockReason)).then(closeLockDialog).catch(() => undefined); }}>{saving ? "正在锁定..." : "确认锁定"}</button></footer></div></div>}
  </div>;
}

function DevIssueRevisionDialog({ pagePath, issueId, commentId, currentTitle, currentBody, currentUpdatedAt, identities, returnFocus, onClose }: {
  pagePath: string;
  issueId: number;
  commentId?: number;
  currentTitle?: string;
  currentBody: string;
  currentUpdatedAt: string;
  identities: readonly DevUserBasic[];
  returnFocus: HTMLElement | null;
  onClose: () => void;
}) {
  const [revisions, setRevisions] = useState<DevIssueRevision[]>([]);
  const [loading, setLoading] = useState(true);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const loadHistory = useCallback(async () => {
    setLoading(true);
    setHistoryError(null);
    const query = new URLSearchParams({ pagePath });
    const target = commentId === undefined ? `/api/issues/${issueId}/history` : `/api/issues/${issueId}/comments/${commentId}/history`;
    try { setRevisions(await requestDevIssue<DevIssueRevision[]>(`${target}?${query.toString()}`, { credentials: "include" })); }
    catch (error) { setHistoryError(error instanceof Error ? error.message : "无法加载编辑历史"); }
    finally { setLoading(false); }
  }, [commentId, issueId, pagePath]);
  useEffect(() => { void loadHistory(); }, [loadHistory]);
  useEffect(() => { dialogRef.current?.focus(); return () => { if (returnFocus?.isConnected) returnFocus.focus(); }; }, [returnFocus]);
  const closeHistory = () => onClose();
  const handleHistoryKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closeHistory(); return; }
    if (event.key !== "Tab" || !dialogRef.current) return;
    event.stopPropagation();
    const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>("button:not([disabled]), a[href], [tabindex]:not([tabindex='-1'])"));
    if (!focusable.length) { event.preventDefault(); dialogRef.current.focus(); return; }
    const first = focusable[0]; const last = focusable[focusable.length - 1];
    if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };
  const newestEditor = revisions[0] ? resolveDevIssueIdentity(revisions[0].editor_id, identities).displayName : "";
  return <div data-localapp-issue-history-layer className="absolute inset-0 z-[70] flex items-center justify-center bg-black/45 p-0 sm:p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) closeHistory(); }}><div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="dev-issue-history-title" aria-describedby="dev-issue-history-target" tabIndex={-1} onKeyDown={handleHistoryKeyDown} className="flex h-full w-full max-w-4xl flex-col overflow-hidden bg-background shadow-2xl outline-none sm:h-[min(760px,calc(100%-2rem))] sm:rounded-lg sm:border sm:border-localapp-dev-border"><header className="flex min-h-14 items-center gap-3 border-b border-localapp-dev-border px-4 py-3 sm:px-5"><div className="min-w-0 flex-1"><h3 id="dev-issue-history-title" className="truncate text-sm font-semibold">编辑历史</h3><p id="dev-issue-history-target" className="truncate text-xs text-localapp-dev-muted-foreground">{commentId === undefined ? `Issue #${issueId}` : `评论 #${commentId}`}</p></div><button type="button" aria-label="关闭编辑历史" className={`${DEV_ICON_BUTTON} h-11 w-11 sm:h-8 sm:w-8`} onClick={closeHistory}><X className="h-4 w-4" /></button></header><div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">{loading ? <p role="status" className="py-12 text-center text-sm text-localapp-dev-muted-foreground">正在加载编辑历史...</p> : historyError ? <div role="alert" className="mx-auto max-w-md rounded-[6px] border border-localapp-dev-danger bg-localapp-dev-danger-muted p-4 text-sm text-localapp-dev-danger"><p>{historyError}</p><button type="button" className={`${DEV_OUTLINE_BUTTON} mt-3 h-11 sm:h-8`} onClick={() => { void loadHistory(); }}>重试</button></div> : <ol aria-label="编辑历史版本" className="space-y-4"><li className="overflow-hidden rounded-[6px] border border-localapp-dev-border"><header className="border-b border-localapp-dev-border bg-localapp-dev-muted px-4 py-2.5 text-xs"><strong>当前版本</strong><span className="ml-2 text-localapp-dev-muted-foreground">{new Date(currentUpdatedAt).toLocaleString()}{newestEditor ? ` · ${newestEditor}` : ""}</span></header><div className="min-w-0 px-4 py-4">{currentTitle !== undefined && <h4 className="mb-3 break-words text-base font-semibold">{currentTitle}</h4>}<DevIssueMarkdown>{currentBody.trim() || "未提供内容。"}</DevIssueMarkdown></div></li>{revisions.map((revision) => <li key={revision.id} className="overflow-hidden rounded-[6px] border border-localapp-dev-border"><header className="border-b border-localapp-dev-border bg-localapp-dev-muted px-4 py-2.5 text-xs"><strong>编辑前版本</strong><span className="ml-2 text-localapp-dev-muted-foreground">{new Date(revision.created_at).toLocaleString()} · {resolveDevIssueIdentity(revision.editor_id, identities).displayName}</span></header><div className="min-w-0 px-4 py-4">{revision.title !== null && <h4 className="mb-3 break-words text-base font-semibold">{revision.title}</h4>}<DevIssueMarkdown>{revision.body.trim() || "未提供内容。"}</DevIssueMarkdown></div></li>)}</ol>}</div></div></div>;
}

function DevIssueTemplateChooser({ templates, loading, error, onSelect, onBlank, onRetry }: { templates: readonly DevIssueTemplateConfig[]; loading: boolean; error: string | null; onSelect: (template: DevIssueTemplateConfig) => void; onBlank: () => void; onRetry: () => void }) {
  return <main data-localapp-issue-template-chooser className="min-h-0 flex-1 overflow-y-auto px-5 py-6 sm:px-8"><div className="mx-auto w-full max-w-4xl"><div className="mb-5"><h3 className="text-base font-semibold">选择 Issue 模板</h3><p className="mt-1 text-sm text-localapp-dev-muted-foreground">选择最符合当前工作的模板，或从空白 Issue 开始。</p></div>{error && <div role="alert" className="mb-4 flex min-h-11 flex-wrap items-center gap-3 rounded border border-localapp-dev-danger bg-localapp-dev-danger-muted px-4 py-3 text-sm text-localapp-dev-danger"><span className="min-w-0 flex-1">{error}</span><button type="button" className={`${DEV_OUTLINE_BUTTON} h-11 sm:h-8`} onClick={onRetry}>重试</button></div>}{loading && templates.length === 0 ? <p role="status" className="py-10 text-center text-sm text-localapp-dev-muted-foreground">正在加载 Issue 模板...</p> : <ul aria-label="Issue 模板" className="divide-y divide-localapp-dev-border rounded border border-localapp-dev-border bg-background">{templates.map((template) => <li key={template.id} className="flex min-w-0 flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded border border-localapp-dev-border bg-localapp-dev-muted"><FileText className="h-4 w-4" aria-hidden="true" /></span><span className="min-w-0 flex-1"><strong className="block break-words text-sm">{template.name}</strong><span className="mt-1 block break-words text-sm text-localapp-dev-muted-foreground">{template.description}</span></span><button type="button" className={`${DEV_OUTLINE_BUTTON} h-11 w-full shrink-0 sm:h-8 sm:w-auto`} onClick={() => onSelect(template)}>开始</button></li>)}</ul>}<div className="mt-5 flex min-w-0 flex-col gap-3 rounded border border-dashed border-localapp-dev-border px-4 py-4 sm:flex-row sm:items-center"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded border border-localapp-dev-border bg-localapp-dev-muted"><Plus className="h-4 w-4" aria-hidden="true" /></span><span className="min-w-0 flex-1"><strong className="block text-sm">空白 Issue</strong><span className="mt-1 block text-sm text-localapp-dev-muted-foreground">不使用模板，自由填写标题和描述。</span></span><button type="button" className={`${DEV_BUTTON_ACTIVE} h-11 w-full shrink-0 rounded px-3 text-xs font-medium sm:h-8 sm:w-auto`} onClick={onBlank}>打开空白 Issue</button></div></div></main>;
}

function DevIssuePotentialDuplicates({ candidates, loading, error, onOpenIssue, onRetry }: { candidates: readonly DevIssuePotentialDuplicate[]; loading: boolean; error: string | null; onOpenIssue: (issueNumber: number) => void; onRetry: () => void }) {
  const [portalHost, setPortalHost] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    const titleInput = document.querySelector<HTMLElement>("[data-localapp-issue-create-title]");
    const titleField = titleInput?.closest("label");
    if (!titleField) return;
    const host = document.createElement("div");
    host.dataset.localappPotentialDuplicatesHost = "true";
    titleField.insertAdjacentElement("afterend", host);
    setPortalHost(host);
    return () => { setPortalHost(null); host.remove(); };
  }, []);
  if (!portalHost || (!loading && !error && candidates.length === 0)) return null;
  return createPortal(<section data-localapp-potential-duplicates aria-labelledby="dev-potential-duplicates-title" className="mt-4 overflow-hidden rounded-[6px] border border-localapp-dev-border bg-localapp-dev-muted"><header className="flex min-h-11 items-center gap-2 border-b border-localapp-dev-border px-3 py-2"><div className="min-w-0 flex-1"><h3 id="dev-potential-duplicates-title" className="text-sm font-semibold">可能重复的 Issue</h3><p className="text-xs text-localapp-dev-muted-foreground">提交前检查是否已有相同问题</p></div>{loading && <LoaderCircle className="h-4 w-4 animate-spin text-localapp-dev-muted-foreground motion-reduce:animate-none" aria-label="正在查找潜在重复 Issue" />}</header>{error ? <div role="alert" className="flex min-h-11 items-center gap-3 px-3 py-2 text-sm text-localapp-dev-danger"><span className="min-w-0 flex-1">{error}</span><button type="button" className={`${DEV_ICON_BUTTON} h-11 w-auto shrink-0 px-3 sm:h-8`} onClick={onRetry}>重试</button></div> : candidates.length > 0 && <ul aria-label="潜在重复 Issues" className="divide-y divide-localapp-dev-border">{candidates.map((candidate) => <li key={candidate.id}><a href={createDevIssueNumberHref(candidate.issue_number)} className="flex min-h-11 min-w-0 items-start gap-3 px-3 py-2.5 hover:bg-background focus:outline-none focus:ring-2 focus:ring-inset focus:ring-localapp-dev-focus" onClick={(event) => { if (!isPlainDevIssueLinkClick(event)) return; event.preventDefault(); onOpenIssue(candidate.issue_number); }}>{candidate.status === "closed" ? <CircleCheck className="mt-0.5 h-4 w-4 shrink-0 text-localapp-dev-muted-foreground" aria-label="已关闭" /> : <CircleDot className="mt-0.5 h-4 w-4 shrink-0 text-localapp-dev-success" aria-label="开启" />}<span className="min-w-0 flex-1"><span className="block break-words text-sm font-medium">{candidate.title}</span><span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-localapp-dev-muted-foreground"><span>#{candidate.issue_number}</span><span>活动于</span><DevIssueTime timestamp={candidate.last_activity_at} /></span></span></a></li>)}</ul>}</section>, portalHost);
}

function DevIssueNestedBranch({ pagePath, issue, level, ancestors, onOpenIssue }: { pagePath: string; issue: DevIssueSubIssueItem; level: number; ancestors: Set<number>; onOpenIssue: (issueNumber: number) => void }) {
  const hasChildren = (issue.child_count ?? 0) > 0 && level < 8 && !ancestors.has(issue.id);
  const [expanded, setExpanded] = useState(false);
  const [state, setState] = useState<{ status: "idle" | "loading" | "loaded" | "error"; items: DevIssueSubIssueItem[]; error?: string }>({ status: "idle", items: [] });
  const controllerRef = useRef<AbortController | null>(null);
  const load = useCallback(() => {
    controllerRef.current?.abort();
    const controller = new AbortController(); controllerRef.current = controller;
    setState((current) => ({ status: "loading", items: current.items }));
    const params = new URLSearchParams({ pagePath });
    void requestDevIssue<DevIssueSubIssueListResult>(`/api/issues/${issue.id}/sub-issues?${params.toString()}`, { credentials: "include", signal: controller.signal })
      .then((result) => { if (!controller.signal.aborted) setState({ status: "loaded", items: result.items }); })
      .catch((error) => { if (!controller.signal.aborted) setState((current) => ({ status: "error", items: current.items, error: error instanceof Error ? error.message : "无法加载子层级" })); });
  }, [issue.id, pagePath]);
  useEffect(() => () => controllerRef.current?.abort(), []);
  useEffect(() => { if (expanded && state.status === "idle") load(); }, [expanded, state.status, load]);
  useEffect(() => { if (expanded) load(); }, [issue]);
  if (!hasChildren) return <span className="h-8 w-8 shrink-0" />;
  const nextAncestors = new Set(ancestors).add(issue.id);
  return <><button type="button" className={`${DEV_ICON_BUTTON} h-8 w-8 shrink-0`} aria-label={`${expanded ? "折叠" : "展开"} Sub-issue #${issue.issue_number}`} aria-expanded={expanded} onClick={() => setExpanded((value) => !value)} onKeyDown={(event) => { if (event.key === "ArrowRight" && !expanded) { event.preventDefault(); setExpanded(true); } else if (event.key === "ArrowLeft" && expanded) { event.preventDefault(); setExpanded(false); } }}>{expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</button>{expanded && <div className="order-last basis-full"><div className="ml-8 border-l border-localapp-dev-border">{state.status === "loading" && <p role="status" className="flex items-center gap-2 px-4 py-3 text-sm text-localapp-dev-muted-foreground"><LoaderCircle className="h-4 w-4 animate-spin" />正在加载子项</p>}{state.status === "error" && <div role="alert" className="flex items-center gap-2 px-4 py-3 text-sm text-localapp-dev-danger"><span className="min-w-0 flex-1">{state.error}</span><button type="button" className={`${DEV_ICON_BUTTON} flex h-8 items-center gap-1 px-2`} onClick={load}><RotateCw className="h-4 w-4" />重试</button></div>}{state.status === "loaded" && <ul role="group" className="divide-y divide-localapp-dev-border">{state.items.filter((child) => !nextAncestors.has(child.id)).map((child) => <li key={child.id} role="treeitem" aria-level={level + 1} className="flex min-w-0 flex-wrap items-center gap-2 px-3 py-2"><DevIssueNestedBranch pagePath={pagePath} issue={child} level={level + 1} ancestors={nextAncestors} onOpenIssue={onOpenIssue} />{child.status === "closed" ? <CircleCheck className="h-4 w-4 shrink-0 text-localapp-dev-accent" aria-label="已关闭" /> : <CircleDot className="h-4 w-4 shrink-0 text-localapp-dev-success" aria-label="开启" />}<a href={createDevIssueNumberHref(child.issue_number)} aria-label={`#${child.issue_number} ${child.title}`} className="flex min-h-11 min-w-0 flex-1 items-center gap-2 py-2 font-medium hover:underline focus:outline-none focus:ring-2 focus:ring-localapp-dev-focus" onClick={(event) => { if (!isPlainDevIssueLinkClick(event)) return; event.preventDefault(); onOpenIssue(child.issue_number); }}><span className="min-w-0 flex-1 break-words">{child.title}</span><span className="text-xs text-localapp-dev-muted-foreground">#{child.issue_number}</span></a>{(child.child_count ?? 0) > 0 && <span className="text-xs text-localapp-dev-muted-foreground">{child.completed_child_count ?? 0}/{child.child_count}</span>}</li>)}</ul>}</div></div>}</>;
}

function DevIssueSubIssues({ pagePath, detail, identities, canManage, saving, onCreate, onLink, onRemove, onReprioritize, onOpenIssue }: { pagePath: string; detail: DevIssueDetail; identities: readonly DevUserBasic[]; canManage: boolean; saving: boolean; onCreate: () => void; onLink: (issueNumber: number) => Promise<void>; onRemove: (childIssueId: number) => Promise<void>; onReprioritize: (childIssueId: number, afterIssueId: number | null) => Promise<void>; onOpenIssue: (issueNumber: number) => void }) {
  const [linking, setLinking] = useState(false);
  const [issueNumber, setIssueNumber] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const linkTriggerRef = useRef<HTMLButtonElement | null>(null);
  const summary = detail.subIssueSummary ?? { total: 0, completed: 0, percent: 0 };
  const subIssues = detail.subIssues ?? [];
  const [announcement, setAnnouncement] = useState("");
  const [draggingId, setDraggingId] = useState<number | null>(null);
  const pendingFocusIdRef = useRef<number | null>(null);
  useEffect(() => {
    if (pendingFocusIdRef.current === null || saving) return;
    const childId = pendingFocusIdRef.current; pendingFocusIdRef.current = null;
    window.requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(`[data-localapp-sub-issue-id="${childId}"] button[aria-label^="重排 Sub-issue"]`)?.focus());
  }, [saving, subIssues]);
  const reprioritize = async (childId: number, afterId: number | null) => {
    setLocalError(null);
    try {
      pendingFocusIdRef.current = childId;
      await onReprioritize(childId, afterId);
      const remaining = subIssues.filter((item) => item.id !== childId);
      const position = afterId === null ? 1 : remaining.findIndex((item) => item.id === afterId) + 2;
      setAnnouncement(`Sub-issue #${subIssues.find((item) => item.id === childId)?.issue_number ?? childId} 已移动到第 ${position} 位`);
    } catch (requestError) { pendingFocusIdRef.current = null; setLocalError(requestError instanceof Error ? requestError.message : "无法重排 Sub-issue"); }
  };
  const submitLink = async () => {
    const parsed = Number(issueNumber.replace(/^#/, ""));
    if (!Number.isSafeInteger(parsed) || parsed < 1) { setLocalError("请输入有效的 Issue 编号"); return; }
    setLocalError(null);
    try { await onLink(parsed); setIssueNumber(""); setLinking(false); window.requestAnimationFrame(() => linkTriggerRef.current?.focus()); }
    catch (requestError) { setLocalError(requestError instanceof Error ? requestError.message : "无法关联 Sub-issue"); }
  };
  const [portalHost, setPortalHost] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    const bodyCard = document.querySelector<HTMLElement>("[data-localapp-issue-body-card]");
    if (!bodyCard) return;
    const host = document.createElement("div");
    host.dataset.localappSubIssuesHost = "true";
    bodyCard.insertAdjacentElement("afterend", host);
    setPortalHost(host);
    return () => { setPortalHost(null); host.remove(); };
  }, [detail.issue.id]);
  const content = <section data-localapp-sub-issues aria-labelledby="dev-issue-sub-issues-title" className="mt-5 overflow-hidden rounded-[6px] border border-localapp-dev-border bg-background"><span className="sr-only" aria-live="polite">{announcement}</span><header className="flex min-w-0 flex-wrap items-center gap-3 border-b border-localapp-dev-border bg-localapp-dev-muted px-4 py-3"><GitBranch className="h-4 w-4 shrink-0" aria-hidden="true" /><div className="min-w-0 flex-1"><h4 id="dev-issue-sub-issues-title" className="text-sm font-semibold">Sub-issues</h4><p className="text-xs text-localapp-dev-muted-foreground">{summary.completed} / {summary.total} 已完成</p></div>{canManage && <div className="flex items-center gap-1"><button ref={linkTriggerRef} type="button" className={`${DEV_ICON_BUTTON} flex h-11 items-center gap-1.5 px-3 sm:h-8`} disabled={saving} aria-expanded={linking} onClick={() => { setLocalError(null); setLinking((value) => !value); }}><Link2 className="h-4 w-4" />关联</button><button type="button" className={`${DEV_OUTLINE_BUTTON} flex h-11 items-center gap-1.5 sm:h-8`} disabled={saving} onClick={onCreate}><Plus className="h-4 w-4" />创建子 Issue</button></div>}</header>{summary.total > 0 && <div className="h-1 bg-localapp-dev-muted" role="progressbar" aria-label="Sub-issues 完成进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={summary.percent}><div className="h-full bg-localapp-dev-success" style={{ width: `${summary.percent}%` }} /></div>}{linking && <form className="flex flex-col gap-2 border-b border-localapp-dev-border px-4 py-3 sm:flex-row" onSubmit={(event) => { event.preventDefault(); void submitLink(); }}><input autoFocus aria-label="要关联的 Issue 编号" placeholder="#123" value={issueNumber} onChange={(event) => setIssueNumber(event.target.value)} className="h-11 min-w-0 flex-1 rounded border border-localapp-dev-border bg-background px-3 text-sm sm:h-9" /><div className="flex gap-2"><button type="button" className={`${DEV_ICON_BUTTON} h-11 px-3 sm:h-9`} onClick={() => { setLinking(false); setLocalError(null); window.requestAnimationFrame(() => linkTriggerRef.current?.focus()); }}>取消</button><button type="submit" className={`${DEV_BUTTON_ACTIVE} h-11 rounded px-3 text-xs font-medium sm:h-9`} disabled={saving}>关联 Issue</button></div>{localError && <p role="alert" className="basis-full text-sm text-localapp-dev-danger">{localError}</p>}</form>}{subIssues.length === 0 ? <div className="px-4 py-8 text-center text-sm text-localapp-dev-muted-foreground">还没有 Sub-issue</div> : <ul role="tree" aria-label="Sub-issues" className="divide-y divide-localapp-dev-border" onDragOver={(event) => { if (canManage && draggingId !== null) event.preventDefault(); }} onDrop={(event) => { if (!canManage || draggingId === null || event.target !== event.currentTarget) return; event.preventDefault(); void reprioritize(draggingId, null); setDraggingId(null); }}>{draggingId !== null && <li data-localapp-sub-issue-drop-first className="h-3 bg-localapp-dev-accent-muted" aria-hidden="true" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); event.stopPropagation(); void reprioritize(draggingId, null); setDraggingId(null); }} />}{subIssues.map((issue, index) => <li key={issue.id} data-localapp-sub-issue-id={issue.id} className="flex min-w-0 flex-wrap items-center gap-2 px-3 py-2.5 sm:gap-3 sm:px-4" role="treeitem" aria-level={1} onDragOver={(event) => { if (canManage && draggingId !== null && draggingId !== issue.id) event.preventDefault(); }} onDrop={(event) => { if (!canManage || draggingId === null || draggingId === issue.id) return; event.preventDefault(); event.stopPropagation(); void reprioritize(draggingId, issue.id); setDraggingId(null); }}><DevIssueNestedBranch pagePath={pagePath} issue={issue} level={1} ancestors={new Set([detail.issue.id])} onOpenIssue={onOpenIssue} />{issue.status === "closed" ? <CircleCheck className="h-4 w-4 shrink-0 text-localapp-dev-accent" aria-label="已关闭" /> : <CircleDot className="h-4 w-4 shrink-0 text-localapp-dev-success" aria-label="开启" />}<a href={createDevIssueNumberHref(issue.issue_number)} aria-label={`#${issue.issue_number} ${issue.title}`} className="flex min-h-11 min-w-0 flex-1 items-center gap-2 py-2 font-medium hover:underline focus:outline-none focus:ring-2 focus:ring-localapp-dev-focus" onClick={(event) => { if (!isPlainDevIssueLinkClick(event)) return; event.preventDefault(); onOpenIssue(issue.issue_number); }}><span className="min-w-0 flex-1 break-words">{issue.title}</span><span className="shrink-0 text-xs font-normal text-localapp-dev-muted-foreground">#{issue.issue_number}</span></a>{issue.assignee_ids.slice(0, 3).map((id) => { const identity = resolveDevIssueIdentity(id, identities); return <span key={id} title={`${identity.displayName} @${id}`} aria-label={`负责人 ${identity.displayName}`} className="hidden h-7 w-7 shrink-0 items-center justify-center rounded-full border border-localapp-dev-border bg-localapp-dev-muted text-[10px] font-semibold sm:flex">{Array.from(identity.displayName)[0]?.toLocaleUpperCase() || "?"}</span>; })}{canManage && <DevSubIssueReorderControls issue={issue} index={index} subIssues={subIssues} saving={saving} onMove={(afterId) => { void reprioritize(issue.id, afterId); }} onDragStart={() => setDraggingId(issue.id)} onDragEnd={() => setDraggingId(null)} />}{canManage && <button type="button" className={`${DEV_ICON_BUTTON} h-11 w-11 shrink-0 sm:h-8 sm:w-8`} disabled={saving} aria-label={`移除 Sub-issue #${issue.issue_number}`} onClick={() => { setLocalError(null); void onRemove(issue.id).catch((requestError) => setLocalError(requestError instanceof Error ? requestError.message : "无法移除 Sub-issue")); }}><Unlink className="h-4 w-4" /></button>}</li>)}</ul>}{localError && !linking && <p role="alert" className="border-t border-localapp-dev-border px-4 py-2 text-sm text-localapp-dev-danger">{localError}</p>}</section>;
  return portalHost ? createPortal(content, portalHost) : null;
}

function DevIssueDuplicates({ detail, canManage, saving, onOpenIssue, onUnmark }: { detail: DevIssueDetail; canManage: boolean; saving: boolean; onOpenIssue: (issueNumber: number) => void; onUnmark: (canonicalIssueId: number) => Promise<void> }) {
  const [localError, setLocalError] = useState<string | null>(null);
  const [unmarking, setUnmarking] = useState(false);
  const undoRef = useRef<HTMLButtonElement | null>(null);
  const duplicateOf = detail.duplicateOf;
  const duplicates = detail.duplicates ?? [];
  if (!duplicateOf && duplicates.length === 0) return null;
  const link = (issue: DevIssueDuplicateItem, prefix: string) => <a href={createDevIssueNumberHref(issue.issue_number)} aria-label={`${prefix} Issue #${issue.issue_number} ${issue.title}`} className="flex min-h-11 min-w-0 items-center gap-2 rounded px-3 py-2 text-sm hover:bg-localapp-dev-muted focus:outline-none focus:ring-2 focus:ring-localapp-dev-focus sm:min-h-9" onClick={(event) => { if (!isPlainDevIssueLinkClick(event)) return; event.preventDefault(); onOpenIssue(issue.issue_number); }}><span className="shrink-0 text-localapp-dev-muted-foreground">#{issue.issue_number}</span><span className="min-w-0 flex-1 break-words font-medium">{issue.title}</span></a>;
  const busy = saving || unmarking;
  return <section aria-label="Duplicate Issues" className="mt-5 overflow-hidden rounded-[6px] border border-localapp-dev-border bg-background">{duplicateOf && <div className="flex min-w-0 flex-wrap items-center gap-2 border-b border-localapp-dev-border bg-localapp-dev-muted px-3 py-2"><Copy className="h-4 w-4 shrink-0 text-localapp-dev-muted-foreground" aria-hidden="true" /><span className="text-sm">此 Issue 是重复项：</span><a href={createDevIssueNumberHref(duplicateOf.issue_number)} aria-label={`Canonical Issue #${duplicateOf.issue_number} ${duplicateOf.title}`} className="min-h-11 min-w-0 flex-1 break-words rounded py-2 text-sm font-medium hover:underline focus:outline-none focus:ring-2 focus:ring-localapp-dev-focus sm:min-h-8 sm:py-1" onClick={(event) => { if (!isPlainDevIssueLinkClick(event)) return; event.preventDefault(); onOpenIssue(duplicateOf.issue_number); }}>#{duplicateOf.issue_number} {duplicateOf.title}</a>{canManage && <button ref={undoRef} type="button" className={`${DEV_OUTLINE_BUTTON} h-11 shrink-0 sm:h-8`} disabled={busy} onClick={() => { setLocalError(null); setUnmarking(true); let succeeded = false; void onUnmark(duplicateOf.id).then(() => { succeeded = true; }).catch((error) => setLocalError(error instanceof Error ? error.message : "撤销重复标记失败")).finally(() => { setUnmarking(false); window.requestAnimationFrame(() => (succeeded ? document.querySelector<HTMLElement>("[data-localapp-issue-title]") : undoRef.current)?.focus()); }); }}>{busy ? "撤销中..." : "撤销重复标记"}</button>}</div>}{localError && <p role="alert" className="border-b border-localapp-dev-border px-3 py-2 text-sm text-localapp-dev-danger">{localError}</p>}{duplicates.length > 0 && <div><h4 className="px-3 pt-3 text-sm font-semibold">重复 Issue</h4><p className="px-3 pb-1 text-xs text-localapp-dev-muted-foreground">以下 Issue 已标记为当前 Issue 的重复项</p><ul aria-label="重复 Issues" className="divide-y divide-localapp-dev-border">{duplicates.map((issue) => <li key={issue.id}>{link(issue, "重复")}</li>)}</ul></div>}</section>;
}

function DevIssueDependencies({ detail, identities, canManage, saving, onAdd, onRemove, onOpenIssue }: { detail: DevIssueDetail; identities: readonly DevUserBasic[]; canManage: boolean; saving: boolean; onAdd: (direction: "blockedBy" | "blocking", issueNumber: number) => Promise<void>; onRemove: (direction: "blockedBy" | "blocking", issueId: number) => Promise<void>; onOpenIssue: (issueNumber: number) => void }) {
  type Direction = "blockedBy" | "blocking";
  const [adding, setAdding] = useState<Direction | null>(null);
  const [issueNumber, setIssueNumber] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const triggerRefs = useRef<Record<Direction, HTMLButtonElement | null>>({ blockedBy: null, blocking: null });
  const [portalHost, setPortalHost] = useState<HTMLElement | null>(null);
  const summary = detail.dependencySummary ?? { blockedBy: 0, blocking: 0, unresolvedBlockers: 0, isBlocked: false };
  const groups: Array<{ direction: Direction; title: string; empty: string; items: Array<DevIssue & { assignee_ids: string[] }> }> = [
    { direction: "blockedBy", title: "被以下 Issue 阻塞", empty: "没有 blocker", items: detail.blockedBy ?? [] },
    { direction: "blocking", title: "正在阻塞", empty: "没有阻塞其他 Issue", items: detail.blocking ?? [] },
  ];
  useLayoutEffect(() => {
    const anchor = document.querySelector<HTMLElement>("[data-localapp-sub-issues-host]") ?? document.querySelector<HTMLElement>("[data-localapp-issue-body-card]");
    if (!anchor) return;
    const host = document.createElement("div");
    host.dataset.localappIssueDependenciesHost = "true";
    anchor.insertAdjacentElement("afterend", host);
    setPortalHost(host);
    return () => { setPortalHost(null); host.remove(); };
  }, [detail.issue.id]);
  const submit = async () => {
    if (!adding) return;
    const parsed = Number(issueNumber.replace(/^#/, ""));
    if (!Number.isSafeInteger(parsed) || parsed < 1) { setLocalError("请输入有效的 Issue 编号"); return; }
    setLocalError(null);
    try {
      await onAdd(adding, parsed);
      const direction = adding;
      setIssueNumber(""); setAdding(null);
      window.requestAnimationFrame(() => triggerRefs.current[direction]?.focus());
    } catch (requestError) { setLocalError(requestError instanceof Error ? requestError.message : "无法添加 Issue 依赖"); }
  };
  const content = <section data-localapp-issue-dependencies aria-labelledby="dev-issue-dependencies-title" className="mt-5 overflow-hidden rounded-[6px] border border-localapp-dev-border bg-background"><header className="flex min-w-0 items-center gap-3 border-b border-localapp-dev-border bg-localapp-dev-muted px-4 py-3"><Network className="h-4 w-4 shrink-0" aria-hidden="true" /><div className="min-w-0 flex-1"><h4 id="dev-issue-dependencies-title" className="text-sm font-semibold">Relationships</h4><p className="text-xs text-localapp-dev-muted-foreground">{summary.unresolvedBlockers ? `${summary.unresolvedBlockers} 个未解决 blocker` : "当前未被阻塞"}</p></div></header>{groups.map((group) => <div key={group.direction} className="border-b border-localapp-dev-border last:border-b-0"><div className="flex min-h-11 items-center gap-2 px-4 py-2"><h5 className="min-w-0 flex-1 text-xs font-semibold text-localapp-dev-muted-foreground">{group.title}</h5>{canManage && <button ref={(node) => { triggerRefs.current[group.direction] = node; }} type="button" className={`${DEV_ICON_BUTTON} flex h-11 items-center gap-1.5 px-3 sm:h-8`} disabled={saving} aria-expanded={adding === group.direction} onClick={() => { setLocalError(null); setIssueNumber(""); setAdding((current) => current === group.direction ? null : group.direction); }}><Link2 className="h-4 w-4" />添加</button>}</div>{adding === group.direction && <form className="flex flex-col gap-2 border-t border-localapp-dev-border px-4 py-3 sm:flex-row" onSubmit={(event) => { event.preventDefault(); void submit(); }}><input autoFocus aria-label={`${group.title}的 Issue 编号`} placeholder="#123" value={issueNumber} onChange={(event) => setIssueNumber(event.target.value)} className="h-11 min-w-0 flex-1 rounded border border-localapp-dev-border bg-background px-3 text-sm sm:h-9" /><div className="flex gap-2"><button type="button" className={`${DEV_ICON_BUTTON} h-11 px-3 sm:h-9`} onClick={() => { setAdding(null); setLocalError(null); window.requestAnimationFrame(() => triggerRefs.current[group.direction]?.focus()); }}>取消</button><button type="submit" className={`${DEV_BUTTON_ACTIVE} h-11 rounded px-3 text-xs font-medium sm:h-9`} disabled={saving}>添加依赖</button></div>{localError && <p role="alert" className="basis-full text-sm text-localapp-dev-danger">{localError}</p>}</form>}{group.items.length === 0 ? <p className="border-t border-localapp-dev-border px-4 py-3 text-xs text-localapp-dev-muted-foreground">{group.empty}</p> : <ul aria-label={group.title} className="divide-y divide-localapp-dev-border border-t border-localapp-dev-border">{group.items.map((issue) => <li key={issue.id} className="flex min-w-0 items-center gap-3 px-4 py-2.5">{issue.status === "closed" ? <CircleCheck className="h-4 w-4 shrink-0 text-localapp-dev-accent" aria-label="已关闭" /> : <CircleDot className="h-4 w-4 shrink-0 text-localapp-dev-success" aria-label="开启" />}<a href={createDevIssueNumberHref(issue.issue_number)} className="flex min-h-11 min-w-0 flex-1 items-center gap-2 py-2 font-medium hover:underline focus:outline-none focus:ring-2 focus:ring-localapp-dev-focus" onClick={(event) => { if (!isPlainDevIssueLinkClick(event)) return; event.preventDefault(); onOpenIssue(issue.issue_number); }}><span className="min-w-0 flex-1 break-words">{issue.title}</span><span className="shrink-0 text-xs font-normal text-localapp-dev-muted-foreground">#{issue.issue_number}</span></a>{issue.assignee_ids.slice(0, 3).map((id) => { const identity = resolveDevIssueIdentity(id, identities); return <span key={id} title={`${identity.displayName} @${id}`} className="hidden h-7 w-7 shrink-0 items-center justify-center rounded-full border border-localapp-dev-border bg-localapp-dev-muted text-[10px] font-semibold sm:flex">{Array.from(identity.displayName)[0]?.toLocaleUpperCase() || "?"}</span>; })}{canManage && <button type="button" className={`${DEV_ICON_BUTTON} h-11 w-11 shrink-0 sm:h-8 sm:w-8`} disabled={saving} aria-label={`移除依赖 #${issue.issue_number}`} onClick={() => { setLocalError(null); void onRemove(group.direction, issue.id).catch((requestError) => setLocalError(requestError instanceof Error ? requestError.message : "无法移除 Issue 依赖")); }}><Unlink className="h-4 w-4" /></button>}</li>)}</ul>}</div>)}{localError && !adding && <p role="alert" className="border-t border-localapp-dev-border px-4 py-2 text-sm text-localapp-dev-danger">{localError}</p>}</section>;
  return portalHost ? createPortal(content, portalHost) : null;
}

function DevIssueDetailPanel({ detail, pagePath, pageOwnerId, user, recentUsers, platformUsers, availableLabels, availableMilestones, submitting, onUpdateIssue, onToggleStatus, onCreateComment, onUpdateComment, onDeleteComment, onToggleCommentPin, onToggleCommentMinimized, onDeleteIssue, onToggleLabel, onToggleAssignee, onSetMilestone, onToggleSubscription, onToggleLock, onTogglePin, onCreateSubIssue, onLinkSubIssue, onRemoveSubIssue, onReprioritizeSubIssue, onConvertIssueTask, onAddDependency, onRemoveDependency, onUnmarkDuplicate, onToggleReaction, onReferenceComment, onOpenIssueReference }: {
  detail: DevIssueDetail;
  pagePath: string;
  pageOwnerId: string | null;
  user: DevContext["user"];
  recentUsers: DevUserBasic[];
  platformUsers: DevUserBasic[];
  availableLabels: DevIssueLabelDefinition[];
  availableMilestones: DevIssueMilestoneDefinition[];
  submitting: boolean;
  onUpdateIssue: (updates: Partial<Pick<DevIssue, "title" | "description" | "status">> & { issueType?: DevIssueType; expectedUpdatedAt?: string; draftId?: string; attachmentIds?: string[]; removedAttachmentIds?: string[] }) => Promise<void>;
  onToggleStatus: (stateReason?: "completed" | "not_planned") => Promise<void>;
  onCreateComment: (input: DevIssueComposerSubmit) => Promise<void>;
  onUpdateComment: (commentId: number, body: string, expectedUpdatedAt?: string, draftId?: string, attachmentIds?: string[], removedAttachmentIds?: string[]) => Promise<void>;
  onDeleteComment: (commentId: number) => Promise<void>;
  onToggleCommentPin: (commentId: number, pinned: boolean) => Promise<void>;
  onToggleCommentMinimized: (commentId: number, reason: DevIssueCommentMinimizedReason | null) => Promise<void>;
  onDeleteIssue: () => Promise<void>;
  onToggleLabel: (labelId: string, selected: boolean) => Promise<void>;
  onToggleAssignee: (userId: string, selected: boolean) => Promise<void>;
  onSetMilestone: (milestoneId: number | null) => Promise<void>;
  onToggleSubscription: (subscribed: boolean) => Promise<void>;
  onToggleLock: (locked: boolean, reason?: DevIssueLockReason) => Promise<void>;
  onTogglePin: (pinned: boolean) => Promise<void>;
  onCreateSubIssue: () => void;
  onLinkSubIssue: (issueNumber: number) => Promise<void>;
  onRemoveSubIssue: (childIssueId: number) => Promise<void>;
  onReprioritizeSubIssue: (childIssueId: number, afterIssueId: number | null) => Promise<void>;
  onConvertIssueTask: (taskIndex: number, title: string, expectedUpdatedAt: string) => Promise<number>;
  onAddDependency: (direction: "blockedBy" | "blocking", issueNumber: number) => Promise<void>;
  onRemoveDependency: (direction: "blockedBy" | "blocking", issueId: number) => Promise<void>;
  onUnmarkDuplicate: (canonicalIssueId: number) => Promise<void>;
  onToggleReaction: (content: DevIssueReactionContent, reacted: boolean, commentId?: number) => Promise<void>;
  onReferenceComment: (commentId: number, body: string, authorId: string, trigger: HTMLButtonElement | null) => void;
  onOpenIssueReference: (issueNumber: number, commentId?: number | null) => void;
}) {
  const [editingIssue, setEditingIssue] = useState(false);
  const previousEditingIssueRef = useRef(false);
  const [editingIssueVersion, setEditingIssueVersion] = useState<string | null>(null);
  const [restoredIssueDraft, setRestoredIssueDraft] = useState(false);
  const [removedIssueAttachmentIds, setRemovedIssueAttachmentIds] = useState<string[]>([]);
  const [title, setTitle] = useState(detail.issue.title);
  const [description, setDescription] = useState(detail.issue.description ?? "");
  const [editingIssueType, setEditingIssueType] = useState<DevIssueType>(detail.issue.issue_type ?? detail.issue.label);
  const [commentDraftId, setCommentDraftId] = useState(createDevIssueDraftId);
  const [commentInsertRequest, setCommentInsertRequest] = useState<{ id: number; text: string } | null>(null);
  const [revisionTarget, setRevisionTarget] = useState<{ commentId?: number; title?: string; body: string; updatedAt: string; returnFocus: HTMLElement } | null>(null);
  const commentInsertSequenceRef = useRef(0);
  const [linkCopied, setLinkCopied] = useState(false);
  const [linkCopyError, setLinkCopyError] = useState<string | null>(null);
  const [savingTaskTarget, setSavingTaskTarget] = useState<"issue" | number | null>(null);
  const [taskConvertTarget, setTaskConvertTarget] = useState<{ index: number; title: string; trigger: HTMLButtonElement } | null>(null);
  const [taskConvertTitle, setTaskConvertTitle] = useState("");
  const [taskConvertSaving, setTaskConvertSaving] = useState(false);
  const [taskConvertError, setTaskConvertError] = useState<string | null>(null);
  const [taskConvertFocusIssueNumber, setTaskConvertFocusIssueNumber] = useState<number | null>(null);
  const taskConvertCancelRef = useRef<HTMLButtonElement | null>(null);
  const taskConvertConfirmRef = useRef<HTMLButtonElement | null>(null);
  const [closeReason, setCloseReason] = useState<"completed" | "not_planned">("completed");
  const [confirmingDeleteIssue, setConfirmingDeleteIssue] = useState(false);
  const [deletingIssue, setDeletingIssue] = useState(false);
  const [deleteIssueError, setDeleteIssueError] = useState<string | null>(null);
  const deleteIssueTriggerRef = useRef<HTMLButtonElement | null>(null);
  const deleteIssueCancelRef = useRef<HTMLButtonElement | null>(null);
  const deleteIssueConfirmRef = useRef<HTMLButtonElement | null>(null);
  const statusActionRef = useRef<HTMLButtonElement | null>(null);
  const statusActionFocusPendingRef = useRef(false);
  const focusDevIssueCommentComposer = () => {
    const textarea = document.querySelector<HTMLTextAreaElement>('[data-localapp-issue-comment-composer] textarea');
    textarea?.scrollIntoView?.({ block: "center", behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    window.requestAnimationFrame(() => textarea?.focus());
  };
  const issueDraftPrefix = createDevIssueDraftPrefix(pagePath, user?.id ?? "anonymous");
  const issueEditMetaKey = `${issueDraftPrefix}:edit:${detail.issue.id}:meta`;
  const issueEditBodyKey = `${issueDraftPrefix}:edit:${detail.issue.id}:body`;
  useEffect(() => {
    const wasEditingIssue = previousEditingIssueRef.current;
    previousEditingIssueRef.current = editingIssue;
    if (!wasEditingIssue || editingIssue) return;
    const frame = window.requestAnimationFrame(() => document.querySelector<HTMLButtonElement>('[data-localapp-issue-body-card] button[aria-label="Issue 操作"]')?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [editingIssue]);
  useEffect(() => {
    if (submitting || !statusActionFocusPendingRef.current) return;
    statusActionFocusPendingRef.current = false;
    const frame = window.requestAnimationFrame(() => statusActionRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [detail.issue.status, submitting]);
  const currentUser: DevUserBasic | null = user ? { id: user.id, name: user.name, displayName: user.displayName, avatarUrl: user.avatarUrl, role: user.role } : null;
  const identities: DevUserBasic[] = Array.from(new Map([...(currentUser ? [currentUser] : []), ...recentUsers, ...platformUsers].map((identity) => [identity.id, identity])).values());
  const reporter = resolveDevIssueIdentity(detail.issue.reporter_id, identities);
  const visibleComments = detail.timeline.filter((item): item is Extract<DevIssueTimelineItem, { kind: "comment" }> => item.kind === "comment" && !item.comment.deleted_at);
  const firstVisibleComment = visibleComments[0];
  const canEditIssueContent = user?.id === detail.issue.reporter_id;
  const canEditIssueType = user?.role === "owner";
  const canEditIssue = canEditIssueContent || canEditIssueType;
  const canDeleteIssue = Boolean(user && (user.id === pageOwnerId || user.role === "owner"));
  const titleCharacterCount = Array.from(title.trim()).length;
  const titleTooLong = titleCharacterCount > DEV_ISSUE_TITLE_MAX_CHARACTERS;
  const canManageIssue = Boolean(user && (user.id === detail.issue.reporter_id || user.role === "owner"));
  const canManageSubIssues = Boolean(user && (user.id === pageOwnerId || user.role === "owner"));
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
  const visibleIssueAttachments = detail.attachments.filter((attachment) => attachment.issue_id === detail.issue.id && attachment.comment_id === null && !removedIssueAttachmentIds.includes(attachment.id));
  const issueAttachmentRemoveRequest = removedIssueAttachmentIds.length > 0 ? (() => { const id = removedIssueAttachmentIds.at(-1)!; return { id, attachment: detail.attachments.find((candidate) => candidate.id === id) }; })() : null;
  const selectedCommentId = readDevIssueCommentDeepLinkId(new URL(window.location.href));
  const metadataLabelCount = detail.collaboration?.labels.length ?? 1;
  const metadataAssigneeCount = detail.collaboration?.assignee_ids.length ?? 0;
  const mobileMetadataSummary = `${metadataLabelCount} 个标签 · ${metadataAssigneeCount ? `${metadataAssigneeCount} 位负责人` : "未分配"}${detail.issue.locked_at ? " · 已锁定" : ""}`;
  const cancelIssueEdit = () => {
    writeDevIssueEditMeta(issueEditMetaKey, null);
    writeDevIssueSessionDraft(issueEditBodyKey, "");
    discardDevIssueAttachmentDraft(pagePath, issueEditBodyKey);
    setTitle(detail.issue.title);
    setDescription(detail.issue.description ?? "");
    setEditingIssueType(detail.issue.issue_type ?? detail.issue.label);
    setEditingIssue(false);
    setEditingIssueVersion(null);
    setRestoredIssueDraft(false);
    setRemovedIssueAttachmentIds([]);
  };
  const beginIssueEdit = () => {
    if (editingIssue) {
      writeDevIssueEditMeta(issueEditMetaKey, null);
      writeDevIssueSessionDraft(issueEditBodyKey, "");
      setEditingIssue(false);
      setRestoredIssueDraft(false);
      setRemovedIssueAttachmentIds([]);
      window.requestAnimationFrame(() => {
        setTitle(detail.issue.title);
        setDescription(detail.issue.description ?? "");
        setEditingIssueType(detail.issue.issue_type ?? detail.issue.label);
        setEditingIssueVersion(detail.issue.updated_at ?? detail.issue.created_at);
        setEditingIssue(true);
      });
      return;
    }
    const restored = readDevIssueEditMeta(issueEditMetaKey);
    setRestoredIssueDraft(Boolean(restored));
    setTitle(restored?.title ?? detail.issue.title);
    setDescription(detail.issue.description ?? "");
    setEditingIssueType(restored?.issueType ?? detail.issue.issue_type ?? detail.issue.label);
    setEditingIssueVersion(restored?.expectedUpdatedAt ?? detail.issue.updated_at ?? detail.issue.created_at);
    setRemovedIssueAttachmentIds([]);
    setEditingIssue(true);
  };
  useEffect(() => {
    if (!editingIssue || !editingIssueVersion) return;
    writeDevIssueEditMeta(issueEditMetaKey, { title, issueType: editingIssueType, expectedUpdatedAt: editingIssueVersion });
  }, [editingIssue, editingIssueVersion, editingIssueType, issueEditMetaKey, title]);
  const saveIssue = async (body = description, attachmentIds: string[] = [], draftId = `edit-issue-${detail.issue.id}`) => {
    try {
      await onUpdateIssue({
        ...(canEditIssueContent ? { title: title.trim(), description: body } : {}),
        ...(canEditIssueType ? { issueType: editingIssueType } : {}),
        expectedUpdatedAt: editingIssueVersion ?? detail.issue.updated_at ?? detail.issue.created_at,
        draftId, attachmentIds, removedAttachmentIds: removedIssueAttachmentIds,
      });
      writeDevIssueEditMeta(issueEditMetaKey, null);
      writeDevIssueSessionDraft(issueEditBodyKey, "");
      setEditingIssue(false);
      setEditingIssueVersion(null);
      setRestoredIssueDraft(false);
      setRemovedIssueAttachmentIds([]);
    } catch (error) {
      // The workspace alert keeps the API error visible without losing draft text.
      throw error;
    }
  };
  const submitComment = async (input: DevIssueComposerSubmit) => {
    await onCreateComment(input);
    setCommentDraftId(createDevIssueDraftId());
  };
  const copyIssueLink = async () => {
    setLinkCopyError(null);
    try {
      await copyDevIssueUrl(createDevIssueHref(detail.issue.id));
      setLinkCopied(true);
    } catch {
      setLinkCopied(false);
      setLinkCopyError("无法复制 Issue 链接，请从浏览器地址栏复制");
    }
  };
  const toggleBodyTask = async (taskIndex: number, checked: boolean) => {
    setSavingTaskTarget("issue");
    try {
      await onUpdateIssue({ description: toggleDevIssueTask(detail.issue.description ?? "", taskIndex, checked), expectedUpdatedAt: detail.issue.updated_at ?? detail.issue.created_at });
    } finally {
      setSavingTaskTarget(null);
    }
  };
  const toggleCommentTask = async (commentId: number, taskIndex: number, checked: boolean) => {
    const item = detail.timeline.find((entry) => entry.kind === "comment" && entry.comment.id === commentId);
    if (!item || item.kind !== "comment" || item.comment.author_id !== user?.id) return;
    setSavingTaskTarget(commentId);
    try {
      await onUpdateComment(commentId, toggleDevIssueTask(item.comment.body, taskIndex, checked), item.comment.updated_at);
    } finally {
      setSavingTaskTarget(null);
    }
  };

  return <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6"><section data-localapp-issue-detail className="relative grid min-w-0 grid-cols-1 lg:grid-cols-[minmax(0,3fr)_minmax(240px,1fr)] lg:gap-6 [&_[data-localapp-issue-body-card]]:rounded-[6px]"><span aria-label="Issue 元数据状态" aria-live="polite" className="sr-only">{submitting ? "正在更新 Issue 元数据" : "Issue 元数据已同步"}</span><span aria-live="polite" className="sr-only">{savingTaskTarget !== null ? "正在保存任务状态" : taskConvertSaving ? "正在创建 Sub-issue" : ""}</span>
    <header className="min-w-0 border-b border-localapp-dev-border pb-5 lg:col-span-2"><div className="flex min-w-0 items-start gap-3"><h3 data-localapp-issue-title tabIndex={-1} aria-label={detail.issue.title} className="min-w-0 flex-1 break-words text-2xl font-normal leading-8 tracking-normal outline-none sm:text-[32px] sm:leading-10">{detail.issue.title} <span className="whitespace-nowrap text-localapp-dev-muted-foreground">#{detail.issue.issue_number}</span></h3><div className="flex shrink-0 items-center gap-1">{user && !detail.issue.locked_at && <button type="button" aria-label="添加评论" aria-keyshortcuts="R" title="添加评论" className={`${DEV_ICON_BUTTON} h-11 w-11 sm:h-8 sm:w-8`} onClick={focusDevIssueCommentComposer}><MessageSquare className="h-4 w-4" /></button>}<button type="button" aria-label={linkCopied ? "已复制 Issue 链接" : "复制 Issue 链接"} title={linkCopied ? "已复制" : "复制 Issue 链接"} className={`${DEV_ICON_BUTTON} h-11 w-11 sm:h-8 sm:w-8`} onClick={() => { void copyIssueLink(); }}>{linkCopied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}</button></div></div>{linkCopyError && <div role="alert" className="mt-2 text-sm text-localapp-dev-danger">{linkCopyError}</div>}<div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-localapp-dev-muted-foreground"><span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-medium text-white ${detail.issue.status === "open" ? "bg-localapp-dev-success" : "bg-localapp-dev-accent"}`}>{detail.issue.status === "open" ? <DevIssueStatusIcon status="open" className="h-4 w-4 text-current" /> : detail.issue.state_reason === "not_planned" ? <CircleSlash2 className="h-4 w-4" aria-hidden="true" /> : <CircleCheck className="h-4 w-4" aria-hidden="true" />}{detail.issue.status === "open" ? "开启" : detail.issue.state_reason === "not_planned" ? "已关闭 · 不计划处理" : "已关闭 · 已完成"}</span><span className="min-w-0"><strong className="font-semibold text-localapp-dev-foreground">{reporter.displayName}</strong> 打开了此 Issue <DevIssueTime timestamp={detail.issue.created_at} /></span><span className="inline-flex items-center gap-2 whitespace-nowrap"><span className="hidden sm:inline" aria-hidden="true">·</span>{firstVisibleComment ? <a href={createDevIssueCommentHref(detail.issue.id, firstVisibleComment.comment.id)} className="-my-2 inline-flex h-11 items-center px-1 font-medium text-localapp-dev-foreground outline-none hover:underline focus:ring-2 focus:ring-localapp-dev-focus sm:-my-0 sm:h-6">{visibleComments.length} 条评论</a> : <span>0 条评论</span>}</span></div></header>
    <details data-localapp-issue-metadata className="border-b border-localapp-dev-border py-3 lg:hidden"><summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold"><span className="inline-flex w-[calc(100%-1.25rem)] items-center justify-between gap-3 align-middle"><span>Issue 详情</span><span data-localapp-issue-metadata-summary className="min-w-0 truncate text-xs font-normal text-localapp-dev-muted-foreground">{mobileMetadataSummary}</span></span></summary><div className="pt-4"><DevIssueMetadata detail={detail} identities={identities} availableLabels={availableLabels} availableMilestones={availableMilestones} currentUserId={user?.id} canManage={Boolean(user && (user.id === pageOwnerId || user.role === "owner"))} canManageLock={canManageIssue} canManagePin={Boolean(user && (user.id === pageOwnerId || user.role === "owner"))} saving={submitting} onSetIssueType={(issueType) => onUpdateIssue({ issueType })} onToggleLabel={onToggleLabel} onToggleAssignee={onToggleAssignee} onSetMilestone={onSetMilestone} onToggleSubscription={onToggleSubscription} onToggleLock={onToggleLock} onTogglePin={onTogglePin} /></div></details>
    <main data-localapp-issue-discussion className="min-w-0 py-6">
      {detail.parent && <a href={createDevIssueNumberHref(detail.parent.issue_number)} className="mb-4 inline-flex min-h-11 items-center text-sm font-medium hover:underline focus:outline-none focus:ring-2 focus:ring-localapp-dev-focus sm:min-h-7" onClick={(event) => { if (!isPlainDevIssueLinkClick(event)) return; event.preventDefault(); onOpenIssueReference(detail.parent!.issue_number); }}>父 Issue：#{detail.parent.issue_number} {detail.parent.title}</a>}
      <DevIssueSubIssues pagePath={pagePath} detail={detail} identities={identities} canManage={canManageSubIssues} saving={submitting} onCreate={onCreateSubIssue} onLink={onLinkSubIssue} onRemove={onRemoveSubIssue} onReprioritize={onReprioritizeSubIssue} onOpenIssue={onOpenIssueReference} />
      <DevIssueDuplicates detail={detail} canManage={canManageSubIssues} saving={submitting} onOpenIssue={onOpenIssueReference} onUnmark={onUnmarkDuplicate} />
      <DevIssueDependencies detail={detail} identities={identities} canManage={canManageSubIssues} saving={submitting} onAdd={onAddDependency} onRemove={onRemoveDependency} onOpenIssue={onOpenIssueReference} />
      {taskConvertTarget && <div className="absolute inset-0 z-[80] flex items-center justify-center bg-black/45 p-4"><div role="alertdialog" aria-label="转换为 Sub-issue" aria-modal="true" aria-describedby="dev-task-convert-description" onKeyDown={(event) => { if (event.key === "Escape" && !taskConvertSaving) { event.preventDefault(); const trigger = taskConvertTarget.trigger; setTaskConvertTarget(null); setTaskConvertError(null); window.requestAnimationFrame(() => trigger.focus()); } else if (event.key === "Tab") { const first = taskConvertCancelRef.current; const last = taskConvertConfirmRef.current; if (first && last && event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); } else if (first && last && !event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); } } }} className="w-full max-w-lg overflow-hidden rounded-[6px] border border-localapp-dev-border bg-background shadow-2xl"><header className="flex items-center gap-3 border-b border-localapp-dev-border px-4 py-3"><ListPlus className="h-4 w-4" /><h3 className="min-w-0 flex-1 text-sm font-semibold">转换为 Sub-issue</h3></header><div className="space-y-4 p-4"><p id="dev-task-convert-description" className="text-sm text-localapp-dev-muted-foreground">将创建一个新的 Sub-issue，并把当前任务替换为 Issue 引用。</p>{taskConvertError && <p role="alert" className="text-sm text-localapp-dev-danger">{taskConvertError}</p>}<label className="block space-y-1.5 text-sm font-medium"><span className="flex justify-between gap-3"><span>Sub-issue 标题</span><span className={Array.from(taskConvertTitle).length > 256 ? "text-localapp-dev-danger" : "text-localapp-dev-muted-foreground"}>{Array.from(taskConvertTitle).length} / 256</span></span><input autoFocus aria-label="Sub-issue 标题" value={taskConvertTitle} disabled={taskConvertSaving} onChange={(event) => setTaskConvertTitle(event.target.value)} className="h-11 w-full rounded border border-localapp-dev-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-localapp-dev-focus" /></label></div><footer className="flex justify-end gap-2 border-t border-localapp-dev-border px-4 py-3"><button ref={taskConvertCancelRef} type="button" disabled={taskConvertSaving} className={`${DEV_OUTLINE_BUTTON} h-11 sm:h-8`} onClick={() => { const trigger = taskConvertTarget.trigger; setTaskConvertTarget(null); setTaskConvertError(null); window.requestAnimationFrame(() => trigger.focus()); }}>取消</button><button ref={taskConvertConfirmRef} type="button" disabled={taskConvertSaving || !taskConvertTitle.trim() || Array.from(taskConvertTitle).length > 256} className={`${DEV_BUTTON_ACTIVE} h-11 rounded px-3 text-xs font-medium disabled:opacity-50 sm:h-8`} onClick={() => { setTaskConvertSaving(true); setTaskConvertError(null); void onConvertIssueTask(taskConvertTarget.index, taskConvertTitle.trim(), detail.issue.updated_at ?? detail.issue.created_at).then((issueNumber) => { setTaskConvertFocusIssueNumber(issueNumber); setTaskConvertTarget(null); }).catch((requestError) => setTaskConvertError(requestError instanceof Error ? requestError.message : "无法转换任务")).finally(() => setTaskConvertSaving(false)); }}>{taskConvertSaving ? "正在创建..." : "创建 Sub-issue"}</button></footer></div></div>}
      {confirmingDeleteIssue && <div role="alertdialog" aria-label="删除 Issue 确认" aria-describedby="dev-delete-issue-description" onKeyDown={(event) => { if (event.key === "Escape" && !deletingIssue) { event.preventDefault(); setConfirmingDeleteIssue(false); setDeleteIssueError(null); window.requestAnimationFrame(() => deleteIssueTriggerRef.current?.focus()); } else if (event.key === "Tab") { const first = deleteIssueCancelRef.current; const last = deleteIssueConfirmRef.current; if (first && last && event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); } else if (first && last && !event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); } } }} className="mb-4 rounded border border-localapp-dev-danger bg-localapp-dev-danger-muted p-4"><p className="font-medium">确定永久删除此 Issue 吗？</p><p id="dev-delete-issue-description" className="mt-1 text-sm text-localapp-dev-muted-foreground">评论、编辑历史、表态和附件都将被永久删除，此操作无法撤销。</p>{deleteIssueError && <p role="alert" className="mt-3 text-sm text-localapp-dev-danger">{deleteIssueError}</p>}<div className="mt-4 flex flex-wrap justify-end gap-2"><button ref={deleteIssueCancelRef} type="button" disabled={deletingIssue} className={`${DEV_OUTLINE_BUTTON} h-11 sm:h-8`} onClick={() => { setConfirmingDeleteIssue(false); setDeleteIssueError(null); window.requestAnimationFrame(() => deleteIssueTriggerRef.current?.focus()); }}>取消删除</button><button ref={deleteIssueConfirmRef} type="button" disabled={deletingIssue} className="h-11 rounded bg-localapp-dev-danger px-3 text-xs font-medium text-white disabled:opacity-50 sm:h-8" onClick={() => { setDeletingIssue(true); setDeleteIssueError(null); void onDeleteIssue().catch((error) => setDeleteIssueError(error instanceof Error ? error.message : "Issue 服务暂不可用")).finally(() => setDeletingIssue(false)); }}>确认删除 Issue</button></div></div>}
      {editingIssue ? <div className="space-y-3 rounded-md border border-localapp-dev-border bg-background p-4">{editingIssueVersion !== null && editingIssueVersion !== (detail.issue.updated_at ?? detail.issue.created_at) && <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded border border-localapp-dev-border bg-localapp-dev-muted px-3 py-2 text-xs"><span>此 Issue 有新变更，当前草稿尚未被覆盖。</span><button type="button" className={`${DEV_OUTLINE_BUTTON} h-11 shrink-0 sm:h-8`} onClick={beginIssueEdit}>放弃草稿并加载最新</button></div>}{restoredIssueDraft && <div role="status" className="flex flex-wrap items-center justify-between gap-2 rounded border border-localapp-dev-border bg-localapp-dev-muted px-3 py-2 text-xs"><span>已恢复上次未完成的编辑</span><DevIssueDiscardDraftControl triggerLabel="丢弃已恢复草稿" onConfirm={cancelIssueEdit} focusAfterConfirm={() => document.querySelector<HTMLElement>("[data-localapp-issue-title]")?.focus()} /></div>}{canEditIssueContent && <label className="block space-y-1.5"><span className="flex items-center justify-between gap-3 text-sm font-medium"><span>Issue 标题</span><span className={`text-xs font-normal ${titleTooLong ? "text-localapp-dev-danger" : "text-localapp-dev-muted-foreground"}`}>{titleCharacterCount} / {DEV_ISSUE_TITLE_MAX_CHARACTERS}</span></span><input aria-label="编辑 Issue 标题" aria-invalid={titleTooLong || undefined} aria-describedby={titleTooLong ? "dev-issue-edit-title-error" : undefined} value={title} onChange={(event) => setTitle(event.target.value)} className="block h-11 w-full rounded border border-localapp-dev-border bg-background px-3 text-lg font-semibold outline-none focus:ring-2 focus:ring-localapp-dev-focus sm:h-9" />{titleTooLong && <span id="dev-issue-edit-title-error" role="alert" className="block text-sm text-localapp-dev-danger">Issue 标题不能超过 256 个字符</span>}</label>}{canEditIssueType && <select aria-label="编辑 Issue 类型" value={editingIssueType} onChange={(event) => setEditingIssueType(event.target.value as DevIssueType)} className="h-11 rounded border border-localapp-dev-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-localapp-dev-focus sm:h-9"><option value="task">任务</option><option value="bug">缺陷</option><option value="feature">功能</option></select>}{canEditIssueContent ? <><DevIssueComposer key={`edit-issue-${detail.issue.id}-${editingIssueVersion}`} pagePath={pagePath} draftId={`edit-issue-${detail.issue.id}`} persistenceKey={issueEditBodyKey} preferPersistedDraft initialBody={description} textareaLabel="编辑 Issue 正文" placeholder="更新 Issue 描述" submitLabel="保存 Issue" mentionCandidates={identities} removeTextRequest={issueAttachmentRemoveRequest} allowEmpty submitDisabled={!title.trim() || titleTooLong || submitting} onCancel={cancelIssueEdit} onSubmit={async ({ body, attachmentIds, draftId }) => saveIssue(body, attachmentIds, draftId)} /><DevIssueAttachmentLinks attachments={visibleIssueAttachments} onRemove={(attachmentId) => setRemovedIssueAttachmentIds((current) => current.includes(attachmentId) ? current : [...current, attachmentId])} /></> : <div className="flex justify-end gap-2"><button type="button" className={`${DEV_OUTLINE_BUTTON} h-11 sm:h-8`} onClick={cancelIssueEdit}>取消</button><button type="button" disabled={submitting} className={`h-11 rounded px-3 py-1.5 text-xs font-medium disabled:opacity-50 sm:h-8 ${DEV_BUTTON_ACTIVE}`} onClick={() => { void saveIssue(); }}>保存 Issue</button></div>}</div> : <article data-localapp-issue-body-card className="min-w-0 overflow-hidden rounded-md border border-localapp-dev-border bg-background"><header className="border-b border-localapp-dev-border bg-localapp-dev-muted px-4 py-3"><DevIssueActor identity={reporter} timestamp={detail.issue.created_at} timestampHref={createDevIssueHref(detail.issue.id)} timestampSuffix={detail.issue.revision_count ? <button type="button" aria-label={`查看 Issue 编辑历史，${detail.issue.revision_count} 次修改`} className="-my-2 inline-flex h-11 items-center px-1 text-localapp-dev-muted-foreground hover:underline sm:-my-0 sm:h-6" onClick={(event) => setRevisionTarget({ title: detail.issue.title, body: detail.issue.description ?? "", updatedAt: detail.issue.updated_at ?? detail.issue.created_at, returnFocus: event.currentTarget })}>edited</button> : undefined} badge="Author" action={canEditIssue || canDeleteIssue || (user && !detail.issue.locked_at && detail.issue.description?.trim()) ? <DevIssueActionMenu label="Issue 操作" items={[...(canEditIssue ? [{ label: "编辑 Issue", restoreFocus: false, onSelect: beginIssueEdit }] : []), ...(user && !detail.issue.locked_at && detail.issue.description?.trim() ? [{ label: "引用回复", restoreFocus: false, onSelect: () => setCommentInsertRequest({ id: ++commentInsertSequenceRef.current, text: quoteDevIssueComment(detail.issue.description ?? "", detail.issue.reporter_id) }) }] : []), ...(canDeleteIssue ? [{ label: "删除 Issue", destructive: true, restoreFocus: false, onSelect: (trigger: HTMLButtonElement | null) => { deleteIssueTriggerRef.current = trigger; setDeleteIssueError(null); setConfirmingDeleteIssue(true); window.requestAnimationFrame(() => deleteIssueCancelRef.current?.focus()); } }] : [])]} /> : undefined} /></header><div className="min-w-0 px-4 py-4"><DevIssueMarkdown tasksDisabled={Boolean(detail.issue.locked_at) || savingTaskTarget === "issue" || taskConvertSaving} onToggleTask={canManageIssue ? (taskIndex, checked) => { void toggleBodyTask(taskIndex, checked).catch(() => undefined); } : undefined} onConvertTask={canManageSubIssues && !detail.issue.locked_at ? (index, taskTitle, trigger) => { setTaskConvertTarget({ index, title: taskTitle, trigger }); setTaskConvertTitle(taskTitle); setTaskConvertError(null); } : undefined} getIssueReferenceHref={createDevIssueNumberHref} onOpenIssueReference={onOpenIssueReference}>{detail.issue.description?.trim() || "未提供描述。"}</DevIssueMarkdown><DevIssueAttachmentLinks attachments={filterUnreferencedDevIssueAttachments(detail.issue.description ?? "", detail.attachments.filter((attachment) => attachment.issue_id === detail.issue.id && attachment.comment_id === null))} /><DevIssueReactions reactions={detail.reactions ?? []} currentUserId={user?.id} additionsDisabled={Boolean(detail.issue.locked_at)} onToggleReaction={onToggleReaction} /></div></article>}
      <div className="mt-5"><DevIssueTimeline issueId={detail.issue.id} reporterId={detail.issue.reporter_id} pagePath={pagePath} issueDraftPrefix={issueDraftPrefix} timeline={detail.timeline} attachments={detail.attachments} reactions={detail.reactions ?? []} identities={identities} currentUserId={user?.id} onUpdateComment={onUpdateComment} onDeleteComment={onDeleteComment} canManageCommentPins={Boolean(user && (user.id === pageOwnerId || user.role === "owner"))} onToggleCommentPin={onToggleCommentPin} canManageCommentMinimization={Boolean(user && (user.id === pageOwnerId || user.role === "owner"))} onToggleCommentMinimized={onToggleCommentMinimized} onToggleReaction={onToggleReaction} onQuoteComment={(body, authorId) => setCommentInsertRequest({ id: ++commentInsertSequenceRef.current, text: quoteDevIssueComment(body, authorId) })} onReferenceComment={onReferenceComment} selectedCommentId={selectedCommentId} getCommentHref={(commentId) => createDevIssueCommentHref(detail.issue.id, commentId)} getIssueReferenceHref={createDevIssueNumberHref} onOpenIssueReference={onOpenIssueReference} onCopyCommentLink={async (commentId) => { setLinkCopyError(null); try { await copyDevIssueUrl(createDevIssueCommentHref(detail.issue.id, commentId)); } catch { setLinkCopyError("无法复制评论链接，请从浏览器地址栏复制"); throw new Error("无法复制评论链接"); } }} onViewHistory={(commentId, trigger) => { const item = detail.timeline.find((entry) => entry.kind === "comment" && entry.comment.id === commentId); if (item?.kind === "comment") setRevisionTarget({ commentId, body: item.comment.body, updatedAt: item.comment.updated_at, returnFocus: trigger }); }} savingTaskTarget={typeof savingTaskTarget === "number" ? savingTaskTarget : null} onToggleCommentTask={toggleCommentTask} interactionsLocked={Boolean(detail.issue.locked_at)} /></div>
      {canManageIssue && <div role="group" aria-label={detail.issue.status === "open" ? "关闭 Issue" : "重新打开 Issue"} className="mt-4 grid w-full grid-cols-2 gap-2 sm:ml-auto sm:w-fit sm:flex sm:items-center sm:justify-end">{detail.issue.status === "open" ? <><label className="inline-flex h-11 min-w-0 items-center justify-center rounded border border-localapp-dev-border bg-background px-2 text-xs text-localapp-dev-muted-foreground focus-within:ring-2 focus-within:ring-localapp-dev-focus sm:h-8"><span className="sr-only">关闭原因</span><select aria-label="关闭原因" value={closeReason} disabled={submitting} onChange={(event) => setCloseReason(event.target.value as "completed" | "not_planned")} className="h-full min-w-0 bg-transparent outline-none"><option value="completed">已完成</option><option value="not_planned">不计划处理</option></select></label><button ref={statusActionRef} type="button" disabled={submitting} aria-busy={submitting || undefined} onClick={() => { statusActionFocusPendingRef.current = true; onToggleStatus(closeReason); }} className={`${DEV_OUTLINE_BUTTON} h-11 min-w-[6.5rem] shrink-0 gap-1.5 sm:h-8`}>{submitting && <LoaderCircle className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />}关闭 Issue</button></> : <button ref={statusActionRef} type="button" aria-label="重新打开 Issue" aria-busy={submitting || undefined} disabled={submitting} onClick={() => { statusActionFocusPendingRef.current = true; onToggleStatus(); }} className={`${DEV_OUTLINE_BUTTON} h-11 min-w-[7.5rem] gap-1.5 sm:h-8`}>{submitting && <LoaderCircle className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />}重新打开 Issue</button>}</div>}
      {detail.issue.locked_at ? <div role="status" className="mt-6 flex items-start gap-2 border-t border-localapp-dev-border bg-localapp-dev-muted px-4 py-3 text-sm"><strong>对话已锁定</strong><span className="text-localapp-dev-muted-foreground">{detail.issue.locked_by ? `@${detail.issue.locked_by} 锁定了此 Issue${detail.issue.lock_reason ? `（${DEV_ISSUE_LOCK_REASON_LABELS[detail.issue.lock_reason]}）` : ""}，解锁后可继续评论。` : "解锁后可继续评论。"}</span></div> : user ? <div data-localapp-issue-comment-composer className="mt-6 border-t border-localapp-dev-border pt-5"><DevIssueComposer pagePath={pagePath} draftId={commentDraftId} persistenceKey={`${issueDraftPrefix}:comment:${detail.issue.id}:body`} showRestoredDraftNotice textareaLabel="添加评论" placeholder="留下评论" submitLabel="评论" status={detail.issue.status} closeReason={closeReason} canChangeStatus={canManageIssue} mentionCandidates={identities} insertRequest={commentInsertRequest} onInsertRequestApplied={(requestId) => setCommentInsertRequest((current) => current?.id === requestId ? null : current)} onSubmit={submitComment} /></div> : <p className="mt-6 border-t border-localapp-dev-border pt-5 text-sm text-localapp-dev-muted-foreground">登录后可以评论。</p>}
    </main>
    <aside data-localapp-issue-metadata className="max-lg:hidden min-w-0 border-l border-localapp-dev-border py-6 pl-6"><DevIssueMetadata detail={detail} identities={identities} availableLabels={availableLabels} availableMilestones={availableMilestones} currentUserId={user?.id} canManage={Boolean(user && (user.id === pageOwnerId || user.role === "owner"))} canManageLock={canManageIssue} canManagePin={Boolean(user && (user.id === pageOwnerId || user.role === "owner"))} saving={submitting} onSetIssueType={(issueType) => onUpdateIssue({ issueType })} onToggleLabel={onToggleLabel} onToggleAssignee={onToggleAssignee} onSetMilestone={onSetMilestone} onToggleSubscription={onToggleSubscription} onToggleLock={onToggleLock} onTogglePin={onTogglePin} /></aside>
  </section>{revisionTarget && <DevIssueRevisionDialog pagePath={pagePath} issueId={detail.issue.id} commentId={revisionTarget.commentId} currentTitle={revisionTarget.title} currentBody={revisionTarget.body} currentUpdatedAt={revisionTarget.updatedAt} identities={identities} returnFocus={revisionTarget.returnFocus} onClose={() => setRevisionTarget(null)} />}</div>;
}

function DevToolkitSidebar({
  context,
  error,
  open,
  platformUsers,
  onClose,
  onPlatformUsersChange,
  onUpdateContext,
}: {
  context: DevContext | null;
  error: string | null;
  open: boolean;
  platformUsers: DevUserBasic[];
  onClose: () => void;
  onPlatformUsersChange: (users: DevUserBasic[]) => void;
  onUpdateContext: (patch: Partial<DevContext>) => Promise<void>;
}) {
  const [userSearch, setUserSearch] = useState("");
  const [ownUser, setOwnUser] = useState<DevUserBasic | null>(null);
  const [userSourceError, setUserSourceError] = useState<string | null>(null);
  const defaultFixedDate = new Date("2026-07-01T09:00:00.000Z");
  const [fixedDate, setFixedDate] = useState(toDateInputValue(defaultFixedDate));
  const [fixedTime, setFixedTime] = useState(toTimeInputValue(defaultFixedDate));
  const fixedDateRef = useRef<HTMLInputElement>(null);
  const fixedTimeRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [dataMessage, setDataMessage] = useState<string | null>(null);
  const [snapshotId, setSnapshotId] = useState("");
  const [requests, setRequests] = useState<DevRequestDiagnostic[]>([]);
  const [business, setBusiness] = useState<DevBusinessConfig>({});

  const run = async (action: () => Promise<void>) => {
    setPending(true);
    setLocalError(null);
    try {
      await action();
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    let active = true;
    const query = userSearch.trim() ? `?search=${encodeURIComponent(userSearch.trim())}` : "";
    fetch(`/api/dev/users${query}`)
      .then(async (res) => {
        const body = await readDevJson(res, "Dev users request");
        if (!res.ok || !body.success) throw new Error(body.error || `加载平台用户失败: ${res.status}`);
        if (!active) return;
        onPlatformUsersChange(body.data?.users ?? []);
        setOwnUser(body.data?.ownUser ?? null);
        setUserSourceError(body.data?.source === "unavailable" ? body.data?.error || "平台用户不可用" : null);
      })
      .catch((e) => {
        if (!active) return;
        onPlatformUsersChange([]);
        setUserSourceError(e instanceof Error ? e.message : String(e));
      });
    return () => { active = false; };
  }, [onPlatformUsersChange, open, userSearch]);

  const setUser = (user: DevUserBasic) =>
    run(() => onUpdateContext({
      user: {
        id: user.id,
        name: user.displayName || user.name || user.id,
        displayName: user.displayName || user.name || user.id,
        avatarUrl: user.avatarUrl ?? null,
        role: user.role || "user",
      },
    }));

  const setGuest = () => run(() => onUpdateContext({ user: null }));
  const setRealTime = () => run(() => onUpdateContext({ timeMode: "real", now: null }));
  const setFixedDateTime = () => run(() => onUpdateContext({
    timeMode: "fixed",
    now: toDevIsoDateTime(fixedDateRef.current?.value || fixedDate, fixedTimeRef.current?.value || fixedTime),
  }));
  const postDevAction = async (url: string) => {
    const res = await fetch(url, { method: "POST" });
    const body = await readDevJson(res, "Dev action request");
    if (!res.ok || !body.success) throw new Error(body.error || `Dev action failed: ${res.status}`);
    window.dispatchEvent(new CustomEvent("localapp:dev-context-changed", { detail: context }));
    return body.data;
  };
  const resetData = () => run(async () => {
    await postDevAction("/api/dev/data/reset");
    setDataMessage("dev.db reset complete");
  });
  const createSnapshot = () => run(async () => {
    const data = await postDevAction("/api/dev/data/snapshots");
    setSnapshotId(data.id);
    setDataMessage(`snapshot saved: ${data.id}`);
  });
  const restoreSnapshot = () => run(async () => {
    if (!snapshotId.trim()) return;
    await postDevAction(`/api/dev/data/snapshots/${encodeURIComponent(snapshotId.trim())}/restore`);
    setDataMessage(`snapshot restored: ${snapshotId.trim()}`);
  });
  const loadDiagnostics = () => run(async () => {
    const [requestRes, businessRes] = await Promise.all([
      fetch("/api/dev/diagnostics/requests"),
      fetch("/api/dev/business"),
    ]);
    const [requestBody, businessBody] = await Promise.all([
      readDevJson(requestRes, "Dev diagnostics request"),
      readDevJson(businessRes, "Dev business request"),
    ]);
    if (!requestRes.ok || !requestBody.success) throw new Error(requestBody.error || "Failed to load recent requests");
    if (!businessRes.ok || !businessBody.success) throw new Error(businessBody.error || "Failed to load business config");
    setRequests(requestBody.data ?? []);
    setBusiness(businessBody.data ?? {});
  });

  const recentUsers = context?.recentUsers ?? [];
  const quickUsers: Array<{ label: string; user: DevUserBasic | null; disabled?: boolean }> = [
    { label: "自己", user: ownUser, disabled: !ownUser },
    { label: "未登录", user: null },
    { label: "历史用户 1", user: recentUsers[0] ?? null, disabled: !recentUsers[0] },
    { label: "历史用户 2", user: recentUsers[1] ?? null, disabled: !recentUsers[1] },
  ];
  const formatUserLabel = (user: DevUserBasic | null) =>
    user ? `${user.displayName || user.name || user.id} (${user.id})` : "未登录";

  return (
    <div
      className={`${DEV_PANEL_CLASS} left-0 w-[360px] border-r`}
      style={{ transform: open ? "translateX(0)" : "translateX(-100%)" }}
    >
      <div className="flex items-center justify-between border-b border-localapp-dev-border px-3 py-2">
        <span className="text-xs font-medium text-localapp-dev-foreground">开发工具</span>
        <button onClick={onClose} className={DEV_ICON_BUTTON}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
        </button>
      </div>

      {(error || localError) && (
        <div className="border-b border-localapp-dev-danger bg-localapp-dev-danger-muted px-3 py-2 text-xs text-localapp-dev-danger">{localError || error}</div>
      )}

      <div className="flex-1 space-y-5 overflow-y-auto px-4 py-4 text-xs text-localapp-dev-muted-foreground">
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-[11px] font-semibold uppercase text-localapp-dev-muted-foreground">身份</h3>
            <span className="rounded bg-localapp-dev-success-muted px-1.5 py-0.5 text-[10px] font-medium text-localapp-dev-success">开发上下文</span>
          </div>
          <p className="truncate text-localapp-dev-foreground">
            {context?.user ? `${context.user.name} (${context.user.id})` : "未登录"}
          </p>
          <div className="grid grid-cols-2 gap-1.5">
            {quickUsers.map((item) => (
              <button
                key={item.label}
                disabled={pending || item.disabled}
                onClick={() => item.user ? setUser(item.user) : setGuest()}
                className={`${DEV_OUTLINE_BUTTON} min-h-10 text-left disabled:opacity-50`}
                title={formatUserLabel(item.user)}
              >
                <span className="block text-[10px] font-medium text-localapp-dev-muted-foreground">{item.label}</span>
                <span className="block truncate text-localapp-dev-foreground">{formatUserLabel(item.user)}</span>
              </button>
            ))}
          </div>
          <div className="space-y-1.5">
            <input
              value={userSearch}
              onChange={(e) => setUserSearch(e.target.value)}
              placeholder="搜索平台用户"
              className="w-full rounded border border-localapp-dev-border px-2 py-1 outline-none focus:border-localapp-dev-success"
            />
            {userSourceError && <p className="leading-relaxed text-localapp-dev-danger">{userSourceError}</p>}
            <div className="max-h-32 space-y-1 overflow-y-auto">
              {platformUsers.map((user) => (
                <button
                  key={user.id}
                  disabled={pending}
                  onClick={() => setUser(user)}
                  className={`${DEV_OUTLINE_BUTTON} w-full text-left`}
                  title={formatUserLabel(user)}
                >
                  <span className="block truncate text-localapp-dev-foreground">{user.displayName || user.name || user.id}</span>
                  <span className="block truncate text-[10px] text-localapp-dev-muted-foreground">{user.id}</span>
                </button>
              ))}
              {platformUsers.length === 0 && !userSourceError && (
                <p className="leading-relaxed text-localapp-dev-muted-foreground">没有匹配的平台用户。</p>
              )}
            </div>
          </div>
        </section>

        <section className="space-y-2">
          <h3 className="text-[11px] font-semibold uppercase text-localapp-dev-muted-foreground">时间</h3>
          <p className="truncate text-localapp-dev-foreground">
            {context?.timeMode === "fixed" ? `固定时间：${formatDevDateTime(context.now)}` : "真实时间"}
          </p>
          <div className="grid grid-cols-[1fr_88px_auto_auto] gap-1.5">
            <input
              ref={fixedDateRef}
              type="date"
              value={fixedDate}
              onChange={(e) => setFixedDate(e.target.value)}
              className="min-w-0 rounded border border-localapp-dev-border px-2 py-1 outline-none focus:border-localapp-dev-success"
            />
            <input
              ref={fixedTimeRef}
              type="time"
              value={fixedTime}
              onChange={(e) => setFixedTime(e.target.value)}
              className="min-w-0 rounded border border-localapp-dev-border px-2 py-1 outline-none focus:border-localapp-dev-success"
            />
            <button disabled={pending} onClick={setFixedDateTime} className="rounded bg-localapp-dev-success px-2 py-1 font-medium text-localapp-dev-success-foreground disabled:opacity-50">固定</button>
            <button disabled={pending} onClick={setRealTime} className={DEV_OUTLINE_BUTTON}>真实</button>
          </div>
        </section>

        <section className="space-y-2">
          <h3 className="text-[11px] font-semibold uppercase text-localapp-dev-muted-foreground">数据</h3>
          <div className="grid grid-cols-2 gap-1.5">
            <button disabled={pending} onClick={resetData} className="rounded border border-localapp-dev-danger px-2 py-1 text-left font-medium text-localapp-dev-danger hover:bg-localapp-dev-danger-muted disabled:opacity-50">重置 dev.db</button>
            <button disabled={pending} onClick={createSnapshot} className={`${DEV_OUTLINE_BUTTON} text-left`}>保存快照</button>
          </div>
          <div className="grid grid-cols-[1fr_auto] gap-1.5">
            <input value={snapshotId} onChange={(e) => setSnapshotId(e.target.value)} placeholder="快照 ID" className="min-w-0 rounded border border-localapp-dev-border px-2 py-1 outline-none focus:border-localapp-dev-success" />
            <button disabled={pending || !snapshotId.trim()} onClick={restoreSnapshot} className="rounded bg-localapp-dev-success px-2 py-1 font-medium text-localapp-dev-success-foreground disabled:opacity-50">恢复</button>
          </div>
          {dataMessage && <p className="truncate text-localapp-dev-success">{dataMessage}</p>}
        </section>

        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-[11px] font-semibold uppercase text-localapp-dev-muted-foreground">诊断</h3>
            <button disabled={pending} onClick={loadDiagnostics} className={DEV_OUTLINE_BUTTON}>刷新</button>
          </div>
          <div className="space-y-1">
            {requests.slice(0, 5).map((request, index) => (
              <div key={`${request.method}-${request.path}-${index}`} className="grid grid-cols-[auto_1fr_auto] gap-1.5 rounded bg-localapp-dev-muted px-2 py-1">
                <span className="font-medium text-localapp-dev-muted-foreground">{request.method}</span>
                <span className="truncate text-localapp-dev-foreground">{request.path}</span>
                <span className={request.status >= 400 ? "text-localapp-dev-danger" : "text-localapp-dev-success"}>{request.status} · {request.durationMs}ms</span>
              </div>
            ))}
            {requests.length === 0 && <p className="leading-relaxed text-localapp-dev-muted-foreground">最近请求会显示在这里。</p>}
          </div>
          <div className="space-y-1">
            {Object.entries(business).map(([resource, config]) => (
              <details key={resource} className="rounded border border-localapp-dev-border bg-localapp-dev-muted px-2 py-1">
                <summary className="cursor-pointer font-medium text-localapp-dev-foreground">{resource}</summary>
                <pre className="mt-1 max-h-36 overflow-auto text-[10px] text-localapp-dev-muted-foreground">{JSON.stringify({
                  recordAccess: config.recordAccess,
                  defaultFields: config.defaultFields,
                  transitions: config.transitions,
                  enums: config.enums,
                }, null, 2)}</pre>
              </details>
            ))}
            {Object.keys(business).length === 0 && <p className="leading-relaxed text-localapp-dev-muted-foreground">业务规则会显示在这里。</p>}
          </div>
        </section>

        <button onClick={() => window.location.reload()} className="w-full rounded border border-localapp-dev-border px-2 py-1.5 font-medium hover:bg-localapp-dev-muted">
          重新加载应用
        </button>
      </div>
    </div>
  );
}

function DevSidebar({
  messages,
  isRunning,
  error,
  onSend,
  open,
  onClose,
}: {
  messages: ChatMessage[];
  isRunning: boolean;
  error: string | null;
  onSend: (text: string) => void;
  open: boolean;
  onClose: () => void;
}) {
  const [width, setWidth] = useState(() => {
    if (typeof window === "undefined") return AI_SIDEBAR_DEFAULT_WIDTH;
    const stored = localStorage.getItem(AI_SIDEBAR_WIDTH_STORAGE_KEY);
    if (!stored) return AI_SIDEBAR_DEFAULT_WIDTH;
    const parsed = parseInt(stored, 10);
    return Number.isNaN(parsed)
      ? AI_SIDEBAR_DEFAULT_WIDTH
      : Math.min(AI_SIDEBAR_MAX_WIDTH, Math.max(AI_SIDEBAR_MIN_WIDTH, parsed));
  });
  const [input, setInput] = useState("");
  const [dragging, setDragging] = useState(false);
  const viewportRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef({ startX: 0, startWidth: 0 });
  const widthRef = useRef(width);
  widthRef.current = width;

  useEffect(() => {
    if (viewportRef.current) viewportRef.current.scrollTop = viewportRef.current.scrollHeight;
  }, [messages]);

  const handleSend = () => {
    const text = input.trim();
    if (!text || isRunning) return;
    onSend(text);
    setInput("");
  };

  const handleDragStart = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    setDragging(true);
    dragRef.current = { startX: event.clientX, startWidth: width };
  }, [width]);

  useEffect(() => {
    if (!dragging) return;

    const onMouseMove = (event: MouseEvent) => {
      const delta = dragRef.current.startX - event.clientX;
      const nextWidth = Math.min(
        AI_SIDEBAR_MAX_WIDTH,
        Math.max(AI_SIDEBAR_MIN_WIDTH, dragRef.current.startWidth + delta),
      );
      setWidth(nextWidth);
    };

    const onMouseUp = () => {
      setDragging(false);
      document.body.style.userSelect = "";
      localStorage.setItem(AI_SIDEBAR_WIDTH_STORAGE_KEY, String(widthRef.current));
    };

    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [dragging]);

  return (
    <div className={`${DEV_PANEL_CLASS} right-0 z-50 border-l`}
      style={{ width, transform: open ? "translateX(0)" : "translateX(100%)" }}
    >
      <div
        className="group absolute bottom-0 left-0 top-0 cursor-col-resize"
        style={{ width: 8, marginLeft: -4 }}
        onMouseDown={handleDragStart}
      >
        <div
          className="mx-auto h-full w-1 rounded-full transition-colors group-hover:bg-localapp-dev-focus"
          style={dragging ? { backgroundColor: "var(--localapp-dev-focus)" } : undefined}
        />
      </div>

      <div className="flex items-center justify-between border-b border-localapp-dev-border px-3 py-2">
        <span className="text-sm font-medium text-localapp-dev-foreground">AI 助手</span>
        <button onClick={onClose} className={DEV_ICON_BUTTON}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
        </button>
      </div>

      {error && (
        <div className="border-b border-localapp-dev-danger bg-localapp-dev-danger-muted px-3 py-2 text-xs text-localapp-dev-danger">{error}</div>
      )}

      <div ref={viewportRef} className="flex-1 space-y-3 overflow-y-auto px-3 py-3 text-sm">
        {messages.length === 0 && (
          <p className="py-8 text-center text-xs text-localapp-dev-muted-foreground">发送消息开始对话</p>
        )}
        {messages.map((msg, i) =>
          msg.role === "user" ? (
            <div key={i} className="flex justify-end">
              <div className="max-w-[80%] rounded-2xl rounded-br-sm bg-localapp-dev-accent px-3 py-2 text-sm text-localapp-dev-accent-foreground whitespace-pre-wrap">{msg.content}</div>
            </div>
          ) : (
            <div key={i} className="flex justify-start">
              <div className="max-w-[80%] space-y-1.5">
                {msg.content && (
                  <div className="rounded-2xl rounded-bl-sm bg-localapp-dev-muted px-3 py-2 text-sm leading-relaxed text-localapp-dev-foreground">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                  </div>
                )}
                {msg.toolCalls?.map((tc) => <ToolCallCard key={tc.id} tc={tc} />)}
              </div>
            </div>
          ),
        )}
        {isRunning && messages[messages.length - 1]?.role === "user" && (
          <div className="flex items-center gap-1.5 text-xs text-localapp-dev-muted-foreground">
            <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>
            思考中...
          </div>
        )}
      </div>

      <div className="border-t border-localapp-dev-border px-3 py-2">
        <div className="flex gap-2">
          <input
            className="flex-1 rounded-md border border-localapp-dev-border bg-transparent px-3 py-1.5 text-sm outline-none focus:border-localapp-dev-accent focus:ring-1 focus:ring-localapp-dev-accent"
            placeholder="输入消息..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
            disabled={isRunning}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || isRunning}
            className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md disabled:opacity-40 ${DEV_BUTTON_ACTIVE}`}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m5 12 7-7 7 7M12 19V5" /></svg>
          </button>
        </div>
      </div>
    </div>
  );
}

function ToolCallCard({ tc }: { tc: ToolCallInfo }) {
  const hasResult = tc.status === "completed" || tc.status === "timeout";
  const [expanded, setExpanded] = useState(!hasResult);
  useEffect(() => { if (hasResult) setExpanded(false); }, [hasResult]);

  const resultText = tc.result !== undefined ? (typeof tc.result === "string" ? tc.result : JSON.stringify(tc.result)) : "";
  const summary = resultText.slice(0, 60);
  const icon = tc.status === "running" ? "⏳" : tc.isError ? "✗" : "✓";

  return (
    <div className="rounded-md bg-localapp-dev-muted px-2.5 py-1.5 text-xs" onClick={hasResult ? () => setExpanded((p) => !p) : undefined} style={{ cursor: hasResult ? "pointer" : "default" }}>
      <div className="flex items-center gap-1.5 font-medium">
        <span>{icon}</span>
        <span className="text-localapp-dev-foreground">{tc.name}</span>
        {!expanded && summary && <span className="flex-1 truncate font-normal text-localapp-dev-muted-foreground">{summary}{resultText.length > 60 ? "..." : ""}</span>}
        {hasResult && <span className="ml-auto text-[10px] font-normal text-localapp-dev-muted-foreground">{expanded ? "▲ 折叠" : "▼ 展开"}</span>}
      </div>
      {expanded && (
        <>
          {Object.keys(tc.args).length > 0 && <pre className="mt-1 text-[11px] text-localapp-dev-muted-foreground whitespace-pre-wrap">{JSON.stringify(tc.args, null, 2)}</pre>}
          {tc.result !== undefined && <pre className={`mt-1 text-[11px] whitespace-pre-wrap ${tc.isError ? "text-localapp-dev-danger" : "text-localapp-dev-success"}`}>{typeof tc.result === "string" ? tc.result : JSON.stringify(tc.result, null, 2)}</pre>}
        </>
      )}
    </div>
  );
}

function ToolsSidebar({
  tools,
  open,
  onClose,
}: {
  tools: Map<string, ToolEntry>;
  open: boolean;
  onClose: () => void;
}) {
  const toolList = Array.from(tools.values());
  const [selected, setSelected] = useState(toolList[0]?.schema.name);
  const selectedTool = toolList.find((t) => t.schema.name === selected);

  return (
    <div className={`${DEV_PANEL_CLASS} left-0 w-[460px] border-r`}
      style={{ transform: open ? "translateX(0)" : "translateX(-100%)" }}
    >
      <div className="flex items-center justify-between border-b border-localapp-dev-border px-3 py-2">
        <span className="text-xs font-medium text-localapp-dev-muted-foreground">已注册工具 ({toolList.length})</span>
        <button onClick={onClose} className={DEV_ICON_BUTTON}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
        </button>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Left: tool name list */}
        <div className="w-36 flex-shrink-0 overflow-y-auto border-r border-localapp-dev-border py-1">
          {toolList.map((t) => (
            <button
              key={t.schema.name}
              onClick={() => setSelected(t.schema.name)}
              className={`w-full px-3 py-2 text-left text-xs transition-colors ${
                selected === t.schema.name
                  ? "bg-localapp-dev-muted font-medium text-localapp-dev-accent"
                  : "text-localapp-dev-muted-foreground hover:bg-localapp-dev-muted"
              }`}
            >
              <span className="block truncate">{t.schema.name}</span>
              <span className={`mt-0.5 inline-block rounded px-1 py-px text-[9px] font-medium ${
                t.isSystem ? "bg-localapp-dev-hover text-localapp-dev-muted-foreground" : "bg-localapp-dev-muted text-localapp-dev-accent"
              }`}>{t.isSystem ? "系统" : "自定义"}</span>
            </button>
          ))}
          {toolList.length === 0 && (
            <p className="px-3 py-4 text-center text-[11px] text-localapp-dev-muted-foreground">暂无工具</p>
          )}
        </div>

        {/* Right: selected tool details */}
        <div className="flex-1 overflow-y-auto px-4 py-3">
          {selectedTool ? (
            <div className="space-y-4">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold text-localapp-dev-foreground">{selectedTool.schema.name}</h3>
                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                    selectedTool.isSystem ? "bg-localapp-dev-hover text-localapp-dev-muted-foreground" : "bg-localapp-dev-muted text-localapp-dev-accent"
                  }`}>{selectedTool.isSystem ? "系统" : "自定义"}</span>
                </div>
                <p className="mt-1 text-xs leading-relaxed text-localapp-dev-muted-foreground">{selectedTool.schema.description}</p>
              </div>

              {(() => {
                const params = selectedTool.schema.parameters as Record<string, unknown> | undefined;
                const props = (params as Record<string, unknown>)?.properties as Record<string, Record<string, unknown>> | undefined;
                const reqList = (params as Record<string, unknown>)?.required as string[] | undefined;
                const entries = props ? Object.entries(props) : [];
                return entries.length > 0 ? (
                  <div>
                    <h4 className="mb-2 text-[11px] font-medium uppercase tracking-wider text-localapp-dev-muted-foreground">参数</h4>
                    <div className="space-y-2">
                      {entries.map(([name, def]) => (
                        <div key={name} className="rounded-md border border-localapp-dev-border bg-localapp-dev-muted px-3 py-2">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-medium text-localapp-dev-foreground">{name}</span>
                            <span className="rounded bg-localapp-dev-hover px-1.5 py-0.5 text-[10px] text-localapp-dev-muted-foreground">{String(def.type || "any")}</span>
                            {reqList?.includes(name) && (
                              <span className="rounded bg-localapp-dev-warning-muted px-1.5 py-0.5 text-[10px] font-medium text-localapp-dev-warning">必填</span>
                            )}
                          </div>
                          {typeof def.description === "string" && (
                            <p className="mt-1 text-[11px] leading-relaxed text-localapp-dev-muted-foreground">{def.description}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <p className="text-[11px] text-localapp-dev-muted-foreground">无参数</p>
                );
              })()}
            </div>
          ) : (
            <p className="py-8 text-center text-xs text-localapp-dev-muted-foreground">选择左侧工具查看详情</p>
          )}
        </div>
      </div>
    </div>
  );
}
