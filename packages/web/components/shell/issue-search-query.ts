import type { IssueLabelDefinition } from "./issue-types";
import type { IssueListQuery } from "./issue-list-query";

interface IssueSearchContext {
  currentUserId?: string;
  labels: readonly Pick<IssueLabelDefinition, "id" | "name">[];
  milestones?: readonly { id: number; title: string }[];
}

export interface IssueSearchSuggestionUser {
  id: string;
  name?: string | null;
  displayName?: string | null;
  avatarUrl?: string | null;
}

export interface IssueSearchSuggestion {
  id: string;
  value: string;
  label: string;
  description: string;
}

export interface IssueSearchSuggestionResult {
  start: number;
  end: number;
  items: IssueSearchSuggestion[];
}

interface IssueSearchSuggestionContext extends IssueSearchContext {
  users: readonly IssueSearchSuggestionUser[];
}

const QUALIFIER_KEYS = [
  { value: "is:", label: "状态", description: "筛选 Open 或 Closed Issue" },
  { value: "in:", label: "范围", description: "限定搜索标题、正文或评论" },
  { value: "label:", label: "标签", description: "筛选带指定标签的 Issue" },
  { value: "type:", label: "类型", description: "筛选任务、缺陷或功能 Issue" },
  { value: "author:", label: "作者", description: "筛选指定用户创建的 Issue" },
  { value: "assignee:", label: "负责人", description: "筛选分配给指定用户的 Issue" },
  { value: "involves:", label: "参与者", description: "筛选指定用户参与的 Issue" },
  { value: "milestone:", label: "里程碑", description: "筛选指定里程碑内的 Issue" },
  { value: "reason:", label: "关闭原因", description: "筛选已完成或不计划处理的 Closed Issue" },
  { value: "mentions:", label: "提及", description: "筛选提及当前用户的 Issue" },
  { value: "no:", label: "缺失项", description: "筛选缺少元数据的 Issue" },
  { value: "sort:", label: "排序", description: "按活动、创建、更新或评论排序" },
] as const;

const SORT_SUGGESTIONS = [
  ["activity-desc", "最近活动"], ["activity-asc", "最早活动"],
  ["created-desc", "最新创建"], ["created-asc", "最早创建"],
  ["updated-desc", "最近更新"], ["updated-asc", "最早更新"],
  ["comments-desc", "评论最多"], ["comments-asc", "评论最少"],
] as const;
const SEARCH_SCOPES = ["title", "body", "comments"] as const;

function activeTokenRange(input: string, cursor: number): { start: number; end: number } {
  const end = Math.max(0, Math.min(cursor, input.length));
  let start = 0;
  let quoted = false;
  for (let index = 0; index < end; index += 1) {
    const character = input[index];
    if (character === '"') quoted = !quoted;
    else if (/\s/.test(character) && !quoted) start = index + 1;
  }
  return { start, end };
}

function quoteSuggestionValue(value: string): string {
  return /\s/.test(value) ? `"${value.replaceAll('"', '\\"')}"` : value;
}

export function getIssueSearchSuggestions(
  input: string,
  cursor: number,
  context: IssueSearchSuggestionContext,
): IssueSearchSuggestionResult {
  const range = activeTokenRange(input, cursor);
  const token = input.slice(range.start, range.end);
  const separator = token.indexOf(":");
  if (separator < 0) {
    const normalized = token.toLowerCase();
    return {
      ...range,
      items: QUALIFIER_KEYS
        .filter((item) => item.value !== "mentions:" || Boolean(context.currentUserId))
        .filter((item) => item.value.startsWith(normalized))
        .map((item) => ({ id: `key-${item.value.slice(0, -1)}`, ...item })),
    };
  }

  const key = token.slice(0, separator).toLowerCase();
  const partial = token.slice(separator + 1).replace(/^"/, "").toLowerCase();
  let items: IssueSearchSuggestion[] = [];
  const add = (value: string, label: string, description: string) => {
    const insertion = `${key}:${quoteSuggestionValue(value)}`;
    if (!value.toLowerCase().startsWith(partial) && (key === "is" || !label.toLowerCase().includes(partial))) return;
    items.push({ id: `${key}-${encodeURIComponent(value.toLowerCase())}`, value: insertion, label, description });
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
    const uniqueUsers = new Map(context.users.map((user) => [user.id.toLowerCase(), user]));
    for (const user of uniqueUsers.values()) {
      const displayName = user.displayName || user.name || user.id;
      add(user.id, displayName, `@${user.id}`);
    }
  } else if (key === "sort") {
    for (const [value, label] of SORT_SUGGESTIONS) add(value, label, value.endsWith("-desc") ? "降序" : "升序");
  }

  return { ...range, items: items.slice(0, 8) };
}

export function applyIssueSearchSuggestion(
  input: string,
  cursor: number,
  range: Pick<IssueSearchSuggestionResult, "start" | "end">,
  suggestion: string,
): { value: string; cursor: number } {
  const suffix = input.slice(range.end);
  const completesValue = !suggestion.endsWith(":");
  const needsSpace = completesValue && (suffix.length === 0 || !/^\s/.test(suffix));
  const value = input.slice(0, range.start) + suggestion + (needsSpace ? " " : "") + suffix;
  const nextCursor = range.start + suggestion.length + (completesValue && (needsSpace || /^\s/.test(suffix)) ? 1 : 0);
  return { value, cursor: Math.min(nextCursor, value.length) };
}

interface SearchToken {
  value: string;
  quotesClosed: boolean;
}

function tokenizeSearch(input: string): SearchToken[] {
  const tokens: SearchToken[] = [];
  let value = "";
  let quoted = false;

  const flush = () => {
    if (value) tokens.push({ value, quotesClosed: !quoted });
    value = "";
    quoted = false;
  };

  for (const character of input.trim()) {
    if (/\s/.test(character) && !quoted) {
      flush();
      continue;
    }
    value += character;
    if (character === '"') quoted = !quoted;
  }
  flush();
  return tokens;
}

function qualifierValue(value: string): string | null {
  if (!value) return null;
  if (value.startsWith('"') || value.endsWith('"')) {
    if (!(value.startsWith('"') && value.endsWith('"') && value.length >= 2)) return null;
    return value.slice(1, -1);
  }
  return value;
}

export function parseIssueSearchInput(input: string, context: IssueSearchContext): Partial<IssueListQuery> & { q: string; offset: 0 } {
  const updates: Partial<IssueListQuery> & { q: string; offset: 0 } = { q: "", offset: 0 };
  const freeText: string[] = [];
  const searchScopes = new Set<typeof SEARCH_SCOPES[number]>();

  for (const token of tokenizeSearch(input)) {
    const separator = token.value.indexOf(":");
    if (separator <= 0 || !token.quotesClosed) {
      freeText.push(token.value);
      continue;
    }
    const key = token.value.slice(0, separator).toLowerCase();
    const rawValue = qualifierValue(token.value.slice(separator + 1));
    let handled = false;

    if (rawValue !== null && key === "in") {
      const requested = rawValue.toLowerCase().split(",");
      if (requested.length > 0 && requested.every((scope) => SEARCH_SCOPES.includes(scope as typeof SEARCH_SCOPES[number]))) {
        for (const scope of requested) searchScopes.add(scope as typeof SEARCH_SCOPES[number]);
        handled = true;
      }
    } else if (rawValue !== null && key === "is" && /^(open|closed)$/i.test(rawValue)) {
      updates.status = rawValue.toLowerCase() as IssueListQuery["status"];
      handled = true;
    } else if (rawValue !== null && key === "is" && /^(locked|unlocked)$/i.test(rawValue)) {
      updates.locked = rawValue.toLowerCase() as IssueListQuery["locked"];
      handled = true;
    } else if (rawValue !== null && key === "is" && rawValue.toLowerCase() === "subscribed" && context.currentUserId) {
      updates.subscribed = true;
      handled = true;
    } else if (rawValue !== null && key === "label") {
      const label = context.labels.find((candidate) => (
        candidate.id.toLowerCase() === rawValue.toLowerCase()
        || candidate.name.toLowerCase() === rawValue.toLowerCase()
      ));
      if (label) {
        updates.label = label.id;
        handled = true;
      }
    } else if (rawValue !== null && key === "type" && /^(task|bug|feature)$/i.test(rawValue)) {
      updates.issueType = rawValue.toLowerCase() as IssueListQuery["issueType"];
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
      const identity = rawValue.toLowerCase() === "@me"
        ? context.currentUserId
        : rawValue.replace(/^@/, "");
      if (identity) {
        updates[key === "author" ? "author" : key === "assignee" ? "assignee" : "participant"] = identity;
        handled = true;
      }
    } else if (rawValue !== null && key === "sort") {
      const match = /^(activity|created|updated|comments)-(asc|desc)$/i.exec(rawValue);
      if (match) {
        updates.sort = match[1].toLowerCase() as IssueListQuery["sort"];
        updates.direction = match[2].toLowerCase() as IssueListQuery["direction"];
        handled = true;
      }
    }

    if (!handled) freeText.push(token.value);
  }

  updates.q = freeText.join(" ");
  if (updates.q && searchScopes.size > 0) updates.searchIn = SEARCH_SCOPES.filter((scope) => searchScopes.has(scope)).join(",");
  return updates;
}

export function formatIssueSearchInput(q: string, searchIn: string): string {
  return [q, q && searchIn ? `in:${searchIn}` : ""].filter(Boolean).join(" ");
}
