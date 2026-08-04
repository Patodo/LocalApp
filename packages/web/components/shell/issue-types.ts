export type IssueStatus = "open" | "closed";
export type IssueStateReason = "completed" | "not_planned";
export type IssueType = "task" | "bug" | "feature";
export type IssueLabel = IssueType;
export const ISSUE_TYPE_LABELS: Record<IssueType, string> = { task: "任务", bug: "缺陷", feature: "功能" };
export type IssueStatusAction = IssueStatus | undefined;
export type IssueLockReason = "resolved" | "off_topic" | "too_heated" | "spam";
export const ISSUE_LOCK_REASON_LABELS: Record<IssueLockReason, string> = {
  resolved: "已解决",
  off_topic: "偏离主题",
  too_heated: "讨论过热",
  spam: "垃圾信息",
};
export type IssueListSort = "activity" | "created" | "updated" | "comments";
export type IssueListDirection = "asc" | "desc";

export interface ShellUser {
  id: string;
  name: string;
}

export interface IssueUserIdentity {
  id: string;
  name?: string;
  displayName: string | null;
  avatarUrl: string | null;
}

export interface IssueLabelDefinition {
  id: string;
  name: string;
  color: string;
  description: string;
  built_in: number;
  created_at: string;
  updated_at: string;
}

export interface IssueMilestoneDefinition {
  id: number;
  title: string;
  description: string;
  due_on: string | null;
  state: "open" | "closed";
  created_by: string;
  created_at: string;
  updated_at: string;
  open_issues: number;
  closed_issues: number;
}

export interface IssueCollaborationMetadata {
  labels: IssueLabelDefinition[];
  assignee_ids: string[];
  subscriber_ids: string[];
  participant_ids: string[];
}

export interface Issue {
  id: number;
  issue_number: number;
  title: string;
  description: string;
  status: IssueStatus;
  state_reason?: IssueStateReason | null;
  label: IssueLabel;
  issue_type?: IssueType;
  reporter_id: string;
  locked_at?: string | null;
  locked_by?: string | null;
  lock_reason?: IssueLockReason | null;
  milestone_id?: number | null;
  pinned_at?: string | null;
  pinned_by?: string | null;
  created_at: string;
  updated_at: string;
  comment_count?: number;
  last_activity_at?: string;
  participant_ids?: string[];
  labels?: IssueLabelDefinition[];
  assignee_ids?: string[];
  revision_count?: number;
  is_blocked?: number;
  is_duplicate?: number;
}

export interface IssuePotentialDuplicate {
  id: number;
  issue_number: number;
  title: string;
  status: IssueStatus;
  updated_at: string;
  last_activity_at: string;
  score: number;
  matched_in: "title" | "body" | "title,body";
}

export interface IssueTemplateConfig {
  id: string;
  name: string;
  description: string;
  titlePrefix: string;
  body: string;
  type: IssueType;
  labels: string[];
}

export interface IssueListMeta {
  total: number;
  open: number;
  closed: number;
  limit: number;
  offset: number;
}

export interface IssueListResponse {
  data: Issue[];
  pinned: Issue[];
  meta: IssueListMeta;
}

export interface IssueComment {
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
  minimized_reason?: IssueCommentMinimizedReason | null;
  revision_count?: number;
}

export type IssueCommentMinimizedReason = "abuse" | "off-topic" | "outdated" | "resolved" | "duplicate" | "spam";

export const ISSUE_COMMENT_MINIMIZED_REASON_LABELS: Record<IssueCommentMinimizedReason, string> = {
  abuse: "滥用内容",
  "off-topic": "偏离主题",
  outdated: "内容过时",
  resolved: "问题已解决",
  duplicate: "重复内容",
  spam: "垃圾内容",
};

export interface IssueRevision {
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

export interface IssueEvent {
  id: number;
  issue_id: number;
  actor_id: string;
  event_type: string;
  payload_json: string;
  created_at: string;
}

export interface IssueCrossReferenceRecord {
  id: number;
  target_issue_id: number;
  source_issue_id: number;
  source_issue_number: number;
  source_issue_title: string;
  source_issue_status: IssueStatus;
  source_type: "issue" | "comment";
  source_id: number;
  source_comment_id: number | null;
  actor_id: string;
  excerpt: string;
  created_at: string;
  updated_at: string;
}

export interface IssueAttachment {
  id: string;
  url: string;
  issue_id: number | null;
  comment_id: number | null;
  draft_id: string;
  uploader_id: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  created_at: string;
}

export const ISSUE_REACTION_CONTENTS = ["+1", "-1", "laugh", "hooray", "confused", "heart", "rocket", "eyes"] as const;
export type IssueReactionContent = typeof ISSUE_REACTION_CONTENTS[number];

export interface IssueReaction {
  issue_id: number;
  comment_id: number;
  user_id: string;
  content: IssueReactionContent;
  created_at: string;
}

export type IssueTimelineItem =
  | { kind: "comment"; comment: IssueComment }
  | { kind: "event"; event: IssueEvent }
  | { kind: "cross_reference"; crossReference: IssueCrossReferenceRecord };

export interface IssueDetail {
  issue: Issue;
  timeline: IssueTimelineItem[];
  attachments: IssueAttachment[];
  collaboration?: IssueCollaborationMetadata;
  reactions: IssueReaction[];
  parent?: Issue | null;
  subIssues?: IssueSubIssueItem[];
  subIssueSummary?: { total: number; completed: number; percent: number };
  blockedBy?: Array<Issue & { added_by: string; relation_created_at: string; assignee_ids: string[] }>;
  blocking?: Array<Issue & { added_by: string; relation_created_at: string; assignee_ids: string[] }>;
  dependencySummary?: { blockedBy: number; blocking: number; unresolvedBlockers: number; isBlocked: boolean };
  duplicateOf?: IssueDuplicateItem | null;
  duplicates?: IssueDuplicateItem[];
}

export type IssueSubIssueItem = Issue & {
  position: number;
  added_by: string;
  relation_created_at: string;
  assignee_ids: string[];
  child_count?: number;
  completed_child_count?: number;
  child_percent?: number;
};

export interface IssueSubIssueListResult {
  items: IssueSubIssueItem[];
  summary: { total: number; completed: number; percent: number };
}

export type IssueDuplicateItem = Issue & { marked_by: string; comment_id: number; relation_created_at: string };

export interface IssueSavedView {
  id: number;
  user_id: string;
  name: string;
  description: string;
  query: import("./issue-list-query").IssueSavedViewQuery;
  created_at: string;
  updated_at: string;
}

export interface ComposerSubmit {
  body: string;
  attachmentIds: string[];
  draftId: string;
  statusAction?: IssueStatus;
  stateReason?: IssueStateReason;
}

export interface PendingAttachment {
  clientId: string;
  file?: File;
  fileName: string;
  fileSize: number;
  previewUrl: string | null;
  attachment?: IssueAttachment;
  markdown?: string;
  error?: string;
  status: "uploading" | "uploaded" | "error";
}

export function isSafeImage(mimeType: string): boolean {
  return ["image/png", "image/jpeg", "image/gif", "image/webp"].includes(mimeType.toLowerCase());
}

export function attachmentUrl(pagePath: string, attachmentId: string): string {
  const query = new URLSearchParams({ pagePath });
  return `/api/issues/attachments/${encodeURIComponent(attachmentId)}?${query.toString()}`;
}

export function formatFileSize(sizeBytes: number): string {
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  if (sizeBytes < 1024 * 1024) return `${Math.ceil(sizeBytes / 1024)} KB`;
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}
