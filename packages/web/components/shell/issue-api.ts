import type { Issue, IssueAttachment, IssueDetail, IssueLabel, IssueLabelDefinition, IssueListMeta, IssueListResponse, IssueLockReason, IssueMilestoneDefinition, IssuePotentialDuplicate, IssueReactionContent, IssueRevision, IssueSavedView, IssueStateReason, IssueStatus, IssueSubIssueListResult, IssueTemplateConfig, IssueUserIdentity } from "./issue-types";
import { issueListQueryToSavedView, serializeIssueListQuery, type IssueListQuery } from "./issue-list-query";

const UNAVAILABLE = "Issue 服务暂不可用";
const ISSUE_REQUEST_TIMEOUT_MS = 8_000;
export const ISSUE_CATALOG_RETRY_DELAY_MS = 300;

function waitForIssueCatalogRetry(signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(finish, ISSUE_CATALOG_RETRY_DELAY_MS);
    function finish() {
      signal?.removeEventListener("abort", abort);
      resolve();
    }
    function abort() {
      clearTimeout(timer);
      reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
    }
    signal?.addEventListener("abort", abort, { once: true });
  });
}

export async function requestIssueCatalogWithRetry<T>(request: (signal?: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T> {
  try {
    return await request(signal);
  } catch (error) {
    if (signal?.aborted || (error instanceof Error && error.name === "AbortError")) throw error;
    await waitForIssueCatalogRetry(signal);
    return request(signal);
  }
}

async function withIssueRequestDeadline<T>(
  request: (signal: AbortSignal) => Promise<T>,
  signal?: AbortSignal,
  timeoutMs = ISSUE_REQUEST_TIMEOUT_MS,
): Promise<T> {
  const controller = new AbortController();
  let timedOut = false;
  const forwardAbort = () => controller.abort(signal?.reason);
  if (signal?.aborted) forwardAbort();
  else signal?.addEventListener("abort", forwardAbort, { once: true });
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort(new DOMException("Issue list request timed out", "TimeoutError"));
  }, timeoutMs);
  try {
    return await request(controller.signal);
  } catch (error) {
    if (timedOut) throw new Error(UNAVAILABLE);
    throw error;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", forwardAbort);
  }
}

export class IssueContentConflictError extends Error {
  constructor() {
    super("内容已被其他用户更新，当前草稿已保留");
    this.name = "IssueContentConflictError";
  }
}

async function readIssueEnvelope<T>(response: Response): Promise<{ data: T; pinned?: Issue[]; meta?: IssueListMeta }> {
  if (!response.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    throw new Error(UNAVAILABLE);
  }

  let body: { success?: boolean; data?: T; pinned?: Issue[]; meta?: IssueListMeta; error?: string; code?: string };
  try {
    body = await response.json() as { success?: boolean; data?: T; pinned?: Issue[]; meta?: IssueListMeta; error?: string; code?: string };
  } catch {
    throw new Error(UNAVAILABLE);
  }
  if (!response.ok || !body.success) {
    if (response.status === 409 && body.code === "issue_content_conflict") throw new IssueContentConflictError();
    throw new Error(body.error || UNAVAILABLE);
  }
  return { data: body.data as T, pinned: body.pinned, meta: body.meta };
}

async function readIssueResponse<T>(response: Response): Promise<T> {
  return (await readIssueEnvelope<T>(response)).data;
}

async function requestIssueResponse<T>(input: RequestInfo | URL, init: RequestInit = {}): Promise<T> {
  return withIssueRequestDeadline(
    async (signal) => readIssueResponse<T>(await fetch(input, { ...init, signal })),
    init.signal ?? undefined,
  );
}

function issueQuery(pagePath: string): string {
  return new URLSearchParams({ pagePath }).toString();
}

export async function listIssueUsers(signal?: AbortSignal): Promise<IssueUserIdentity[]> {
  try {
    return await withIssueRequestDeadline(async (requestSignal) => {
      const response = await fetch("/api/users", { credentials: "include", signal: requestSignal });
      if (!response.ok || !response.headers.get("content-type")?.toLowerCase().includes("application/json")) {
        throw new Error("负责人目录加载失败");
      }
      let body: { success?: boolean; data?: unknown };
      try {
        body = await response.json() as { success?: boolean; data?: unknown };
      } catch {
        throw new Error("负责人目录加载失败");
      }
      if (!body.success || !Array.isArray(body.data)) throw new Error("负责人目录加载失败");
      return body.data.filter((user): user is IssueUserIdentity => {
        if (!user || typeof user !== "object") return false;
        const candidate = user as Partial<IssueUserIdentity>;
        return typeof candidate.id === "string"
          && (candidate.displayName === null || typeof candidate.displayName === "string")
          && (candidate.name === undefined || typeof candidate.name === "string")
          && (candidate.avatarUrl === null || typeof candidate.avatarUrl === "string");
      });
    }, signal);
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new Error("负责人目录加载失败");
  }
}

export async function listIssueTemplates(pagePath: string, signal?: AbortSignal): Promise<IssueTemplateConfig[]> {
  return requestIssueResponse<{ templates?: IssueTemplateConfig[] }>(`/api/issues/config?${issueQuery(pagePath)}`, { credentials: "include", signal }).then((config) => Array.isArray(config.templates) ? config.templates : []);
}

export async function listIssueSavedViews(pagePath: string, signal?: AbortSignal): Promise<IssueSavedView[]> {
  const views = await requestIssueResponse<unknown[]>(`/api/issues/views?${issueQuery(pagePath)}`, { credentials: "include", signal });
  return Array.isArray(views) ? views.filter((view): view is IssueSavedView => {
    if (!view || typeof view !== "object") return false;
    const candidate = view as Partial<IssueSavedView>;
    return Number.isSafeInteger(candidate.id) && typeof candidate.user_id === "string" && typeof candidate.name === "string" && Boolean(candidate.name.trim())
      && typeof candidate.description === "string" && Boolean(candidate.query) && typeof candidate.query === "object"
      && (candidate.query as { offset?: unknown }).offset === 0 && typeof candidate.created_at === "string" && typeof candidate.updated_at === "string";
  }) : [];
}

export async function unmarkIssueDuplicate(pagePath: string, issueId: number, canonicalIssueId: number): Promise<IssueDetail> {
  return requestIssueResponse<IssueDetail>(`/api/issues/${issueId}/duplicate/${canonicalIssueId}`, {
    method: "DELETE",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pagePath }),
  });
}

export async function createIssueSavedView(pagePath: string, name: string, description: string, query: IssueListQuery): Promise<IssueSavedView> {
  return requestIssueResponse<IssueSavedView>("/api/issues/views", {
    method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pagePath, name, description, query: issueListQueryToSavedView(query) }),
  });
}

export async function updateIssueSavedView(pagePath: string, viewId: number, input: { name?: string; description?: string; query?: IssueListQuery }): Promise<IssueSavedView> {
  return requestIssueResponse<IssueSavedView>(`/api/issues/views/${viewId}`, {
    method: "PATCH", credentials: "include", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pagePath, ...input, ...(input.query ? { query: issueListQueryToSavedView(input.query) } : {}) }),
  });
}

export async function duplicateIssueSavedView(pagePath: string, viewId: number): Promise<IssueSavedView> {
  return requestIssueResponse<IssueSavedView>(`/api/issues/views/${viewId}/copy`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pagePath }) });
}

export async function deleteIssueSavedView(pagePath: string, viewId: number): Promise<void> {
  await requestIssueResponse<undefined>(`/api/issues/views/${viewId}`, { method: "DELETE", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pagePath }) });
}

export async function listIssues(
  pagePath: string,
  query: IssueListQuery,
  signal?: AbortSignal,
  timeoutMs = ISSUE_REQUEST_TIMEOUT_MS,
): Promise<IssueListResponse> {
  const params = serializeIssueListQuery(query);
  params.set("pagePath", pagePath);
  const response = await withIssueRequestDeadline(
    async (requestSignal) => readIssueEnvelope<Issue[]>(await fetch(`/api/issues?${params.toString()}`, {
      credentials: "include",
      signal: requestSignal,
    })),
    signal,
    timeoutMs,
  );
  return {
    data: response.data,
    pinned: Array.isArray(response.pinned) ? response.pinned : [],
    meta: response.meta ?? {
      total: response.data.length,
      open: query.status === "open" ? response.data.length : 0,
      closed: query.status === "closed" ? response.data.length : 0,
      limit: query.limit,
      offset: query.offset,
    },
  };
}

export async function listPotentialDuplicateIssues(pagePath: string, title: string, body: string, signal?: AbortSignal): Promise<IssuePotentialDuplicate[]> {
  const query = new URLSearchParams({ pagePath, title, body });
  return readIssueResponse<IssuePotentialDuplicate[]>(await fetch(`/api/issues/potential-duplicates?${query}`, { credentials: "include", signal }));
}

export async function updateIssuePin(pagePath: string, issueId: number, pinned: boolean): Promise<IssueDetail> {
  return requestIssueResponse<IssueDetail>(`/api/issues/${issueId}/pin`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pagePath, pinned }),
  });
}

export async function addIssueSubIssue(pagePath: string, parentIssueId: number, childIssueId: number): Promise<IssueDetail> {
  return requestIssueResponse<IssueDetail>(`/api/issues/${parentIssueId}/sub-issues/${childIssueId}`, {
    method: "PUT", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pagePath }),
  });
}

export async function removeIssueSubIssue(pagePath: string, parentIssueId: number, childIssueId: number): Promise<IssueDetail> {
  return requestIssueResponse<IssueDetail>(`/api/issues/${parentIssueId}/sub-issues/${childIssueId}`, {
    method: "DELETE", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pagePath }),
  });
}

export async function reprioritizeIssueSubIssue(pagePath: string, parentIssueId: number, childIssueId: number, afterIssueId: number | null): Promise<IssueDetail> {
  return requestIssueResponse<IssueDetail>(`/api/issues/${parentIssueId}/sub-issues/priority`, {
    method: "PATCH", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pagePath, childIssueId, afterIssueId }),
  });
}

export async function convertIssueTaskToSubIssue(pagePath: string, parentIssueId: number, taskIndex: number, expectedUpdatedAt: string, title: string): Promise<IssueDetail> {
  return requestIssueResponse<IssueDetail>(`/api/issues/${parentIssueId}/tasks/${taskIndex}/convert`, {
    method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pagePath, expectedUpdatedAt, title }),
  });
}

export async function addIssueDependency(pagePath: string, blockedIssueId: number, blockingIssueId: number): Promise<IssueDetail> {
  return requestIssueResponse<IssueDetail>(`/api/issues/${blockedIssueId}/dependencies/blocked-by/${blockingIssueId}`, {
    method: "PUT", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pagePath }),
  });
}

export async function removeIssueDependency(pagePath: string, blockedIssueId: number, blockingIssueId: number): Promise<IssueDetail> {
  return requestIssueResponse<IssueDetail>(`/api/issues/${blockedIssueId}/dependencies/blocked-by/${blockingIssueId}`, {
    method: "DELETE", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pagePath }),
  });
}

export async function listIssueSubIssues(pagePath: string, issueId: number, signal?: AbortSignal): Promise<IssueSubIssueListResult> {
  return readIssueResponse<IssueSubIssueListResult>(await fetch(`/api/issues/${issueId}/sub-issues?${issueQuery(pagePath)}`, { credentials: "include", signal }));
}

export async function getIssueDetail(pagePath: string, issueId: number, timeoutMs = ISSUE_REQUEST_TIMEOUT_MS): Promise<IssueDetail> {
  return withIssueRequestDeadline(
    async (signal) => readIssueResponse<IssueDetail>(await fetch(`/api/issues/${issueId}?${issueQuery(pagePath)}`, { credentials: "include", signal })),
    undefined,
    timeoutMs,
  );
}

export async function getIssueDetailByNumber(pagePath: string, issueNumber: number, timeoutMs = ISSUE_REQUEST_TIMEOUT_MS): Promise<IssueDetail> {
  return withIssueRequestDeadline(
    async (signal) => readIssueResponse<IssueDetail>(await fetch(`/api/issues/by-number/${issueNumber}?${issueQuery(pagePath)}`, { credentials: "include", signal })),
    undefined,
    timeoutMs,
  );
}

export async function getIssueRevisions(pagePath: string, issueId: number, commentId?: number): Promise<IssueRevision[]> {
  const target = commentId === undefined
    ? `/api/issues/${issueId}/history`
    : `/api/issues/${issueId}/comments/${commentId}/history`;
  return requestIssueResponse<IssueRevision[]>(`${target}?${issueQuery(pagePath)}`, { credentials: "include" });
}

export async function listIssueLabels(pagePath: string, signal?: AbortSignal): Promise<IssueLabelDefinition[]> {
  const labels = await requestIssueResponse<unknown[]>(`/api/issues/labels?${issueQuery(pagePath)}`, { credentials: "include", signal });
  return labels.filter((label): label is IssueLabelDefinition => {
    if (!label || typeof label !== "object") return false;
    const value = label as Partial<IssueLabelDefinition>;
    return typeof value.id === "string" && typeof value.name === "string" && typeof value.color === "string";
  });
}

export function createIssueLabel(pagePath: string, input: { name: string; color: string; description: string }): Promise<IssueLabelDefinition> {
  return requestIssueResponse<IssueLabelDefinition>("/api/issues/labels", {
    method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pagePath, ...input }),
  });
}

export function updateIssueLabel(pagePath: string, labelId: string, input: { name: string; color: string; description: string }): Promise<IssueLabelDefinition> {
  return requestIssueResponse<IssueLabelDefinition>(`/api/issues/labels/${encodeURIComponent(labelId)}`, {
    method: "PATCH", credentials: "include", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pagePath, ...input }),
  });
}

export async function deleteIssueLabel(pagePath: string, labelId: string): Promise<void> {
  await requestIssueResponse<unknown>(`/api/issues/labels/${encodeURIComponent(labelId)}?${issueQuery(pagePath)}`, {
    method: "DELETE", credentials: "include",
  });
}

export function listIssueMilestones(pagePath: string, signal?: AbortSignal): Promise<IssueMilestoneDefinition[]> {
  return requestIssueResponse<IssueMilestoneDefinition[]>(`/api/issues/milestones?${issueQuery(pagePath)}`, { credentials: "include", signal });
}

export function createIssueMilestone(pagePath: string, input: { title: string; description: string; dueOn: string | null }): Promise<IssueMilestoneDefinition> {
  return requestIssueResponse<IssueMilestoneDefinition>("/api/issues/milestones", {
    method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pagePath, ...input }),
  });
}

export function updateIssueMilestone(pagePath: string, milestoneId: number, input: { title: string; description: string; dueOn: string | null; state: "open" | "closed" }): Promise<IssueMilestoneDefinition> {
  return requestIssueResponse<IssueMilestoneDefinition>(`/api/issues/milestones/${milestoneId}`, {
    method: "PATCH", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pagePath, ...input }),
  });
}

export async function deleteIssueMilestone(pagePath: string, milestoneId: number): Promise<void> {
  await requestIssueResponse<unknown>(`/api/issues/milestones/${milestoneId}?${issueQuery(pagePath)}`, { method: "DELETE", credentials: "include" });
}

async function updateIssueMetadata(pagePath: string, issueId: number, kind: "labels" | "assignees" | "subscription" | "milestone", body: Record<string, unknown>): Promise<IssueDetail> {
  return requestIssueResponse<IssueDetail>(`/api/issues/${issueId}/${kind}`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pagePath, ...body }),
  });
}

export function updateIssueLabels(pagePath: string, issueId: number, labelIds: string[]): Promise<IssueDetail> {
  return updateIssueMetadata(pagePath, issueId, "labels", { labelIds });
}

export function updateIssueAssignees(pagePath: string, issueId: number, userIds: string[]): Promise<IssueDetail> {
  return updateIssueMetadata(pagePath, issueId, "assignees", { userIds });
}

export function updateIssueSubscription(pagePath: string, issueId: number, subscribed: boolean): Promise<IssueDetail> {
  return updateIssueMetadata(pagePath, issueId, "subscription", { subscribed });
}

export function updateIssueMilestoneAssignment(pagePath: string, issueId: number, milestoneId: number | null): Promise<IssueDetail> {
  return updateIssueMetadata(pagePath, issueId, "milestone", { milestoneId });
}

export async function updateIssueLock(pagePath: string, issueId: number, locked: boolean, reason?: IssueLockReason): Promise<IssueDetail> {
  return requestIssueResponse<IssueDetail>(`/api/issues/${issueId}/lock`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pagePath, locked, ...(locked && reason ? { reason } : {}) }),
  });
}

export async function updateIssueReaction(pagePath: string, issueId: number, content: IssueReactionContent, reacted: boolean, commentId?: number): Promise<IssueDetail> {
  return requestIssueResponse<IssueDetail>(`/api/issues/${issueId}/reactions`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pagePath, ...(commentId === undefined ? {} : { commentId }), content, reacted }),
  });
}

export async function createIssue(input: {
  pagePath: string;
  title: string;
  description: string;
  issueType: IssueLabel;
  draftId: string;
  attachmentIds: string[];
  labelIds?: string[];
  assigneeIds?: string[];
  milestoneId?: number;
  parentIssueId?: number;
}): Promise<Issue> {
  return requestIssueResponse<Issue>("/api/issues", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function updateIssue(pagePath: string, issueId: number, updates: Partial<Pick<Issue, "title" | "description" | "status">> & { issueType?: IssueLabel; stateReason?: "completed" | "not_planned" | null; expectedUpdatedAt?: string; draftId?: string; attachmentIds?: string[]; removedAttachmentIds?: string[] }): Promise<Issue> {
  return requestIssueResponse<Issue>(`/api/issues/${issueId}`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pagePath, ...updates }),
  });
}

export async function createIssueComment(pagePath: string, issueId: number, input: {
  body: string;
  attachmentIds: string[];
  draftId: string;
  statusAction?: IssueStatus;
  stateReason?: IssueStateReason;
}): Promise<IssueDetail> {
  return requestIssueResponse<IssueDetail>(`/api/issues/${issueId}/comments`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pagePath, ...input }),
  });
}

export async function updateIssueComment(pagePath: string, issueId: number, commentId: number, body: string, expectedUpdatedAt?: string, draftId?: string, attachmentIds?: string[], removedAttachmentIds?: string[]): Promise<IssueDetail> {
  return requestIssueResponse<IssueDetail>(`/api/issues/${issueId}/comments/${commentId}`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pagePath, body, ...(expectedUpdatedAt ? { expectedUpdatedAt } : {}), ...(draftId ? { draftId, attachmentIds: attachmentIds ?? [], removedAttachmentIds: removedAttachmentIds ?? [] } : {}) }),
  });
}

export async function deleteIssueComment(pagePath: string, issueId: number, commentId: number): Promise<IssueDetail> {
  return requestIssueResponse<IssueDetail>(`/api/issues/${issueId}/comments/${commentId}?${issueQuery(pagePath)}`, {
    method: "DELETE",
    credentials: "include",
  });
}

export async function updateIssueCommentPin(pagePath: string, issueId: number, commentId: number, pinned: boolean): Promise<IssueDetail> {
  return requestIssueResponse<IssueDetail>(`/api/issues/${issueId}/comments/${commentId}/pin`, {
    method: pinned ? "PUT" : "DELETE",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pagePath }),
  });
}

export async function updateIssueCommentMinimized(pagePath: string, issueId: number, commentId: number, reason: import("./issue-types").IssueCommentMinimizedReason | null): Promise<IssueDetail> {
  return requestIssueResponse<IssueDetail>(`/api/issues/${issueId}/comments/${commentId}/minimize`, {
    method: reason === null ? "DELETE" : "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pagePath, ...(reason === null ? {} : { reason }) }),
  });
}

export async function deleteIssue(pagePath: string, issueId: number): Promise<{ id: number }> {
  return requestIssueResponse<{ id: number }>(`/api/issues/${issueId}?${issueQuery(pagePath)}`, {
    method: "DELETE",
    credentials: "include",
  });
}

export async function uploadIssueAttachment(pagePath: string, draftId: string, file: File): Promise<IssueAttachment> {
  const form = new FormData();
  form.set("pagePath", pagePath);
  form.set("draftId", draftId);
  form.set("file", file);
  return requestIssueResponse<IssueAttachment>("/api/issues/attachments", {
    method: "POST",
    credentials: "include",
    body: form,
  });
}

export { UNAVAILABLE };
