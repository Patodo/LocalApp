import type { IssueListDirection, IssueListSort, IssueStatus, IssueType } from "./issue-types";

export interface IssueListQuery {
  q: string;
  searchIn: string;
  status: IssueStatus;
  label: string;
  issueType: "" | IssueType;
  author: string;
  participant: string;
  assignee: string;
  milestone: string;
  reason: "" | "completed" | "not_planned";
  subscribed: boolean;
  mentioned: boolean;
  locked: "" | "locked" | "unlocked";
  sort: IssueListSort;
  direction: IssueListDirection;
  limit: number;
  offset: number;
}

export const DEFAULT_ISSUE_LIST_QUERY: IssueListQuery = {
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

export interface IssueSavedViewQuery {
  q?: string;
  searchIn?: string[];
  status?: IssueStatus;
  label?: string;
  issueType?: IssueType;
  author?: string;
  participant?: string;
  assignee?: string;
  milestone?: string;
  reason?: "completed" | "not_planned";
  subscribed?: boolean;
  mentioned?: boolean;
  locked?: "locked" | "unlocked";
  sort?: IssueListSort;
  direction?: IssueListDirection;
  limit?: number;
  offset: 0;
}

export function issueListQueryToSavedView(query: IssueListQuery): IssueSavedViewQuery {
  return {
    ...(query.q ? { q: query.q.trim() } : {}),
    ...(query.searchIn ? { searchIn: query.searchIn.split(",") } : {}),
    ...(query.status !== DEFAULT_ISSUE_LIST_QUERY.status ? { status: query.status } : {}),
    ...(query.label ? { label: query.label } : {}),
    ...(query.issueType ? { issueType: query.issueType } : {}),
    ...(query.author ? { author: query.author } : {}),
    ...(query.participant ? { participant: query.participant } : {}),
    ...(query.assignee ? { assignee: query.assignee } : {}),
    ...(query.milestone ? { milestone: query.milestone } : {}),
    ...(query.status === "closed" && query.reason ? { reason: query.reason } : {}),
    ...(query.subscribed ? { subscribed: true } : {}),
    ...(query.mentioned ? { mentioned: true } : {}),
    ...(query.locked ? { locked: query.locked } : {}),
    ...(query.sort !== DEFAULT_ISSUE_LIST_QUERY.sort ? { sort: query.sort } : {}),
    ...(query.direction !== DEFAULT_ISSUE_LIST_QUERY.direction ? { direction: query.direction } : {}),
    ...(query.limit !== DEFAULT_ISSUE_LIST_QUERY.limit ? { limit: query.limit } : {}),
    offset: 0,
  };
}

export function issueListQueryFromSavedView(saved: IssueSavedViewQuery): IssueListQuery {
  return {
    ...DEFAULT_ISSUE_LIST_QUERY,
    ...saved,
    searchIn: saved.searchIn?.join(",") ?? "",
    reason: saved.status === "closed" ? saved.reason ?? "" : "",
    offset: 0,
  };
}

export function issueSavedViewMatchesListQuery(saved: IssueSavedViewQuery, query: IssueListQuery): boolean {
  return JSON.stringify(issueListQueryToSavedView(issueListQueryFromSavedView(saved))) === JSON.stringify(issueListQueryToSavedView(query));
}

const ISSUE_LIST_URL_PARAMS = {
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

const ISSUE_LIST_SORTS: IssueListSort[] = ["activity", "created", "updated", "comments"];
const ISSUE_SEARCH_IN_VALUES = new Set(["title", "body", "comments", "title,body", "title,comments", "body,comments", "title,body,comments"]);

function readTextParam(url: URL, name: string, maxLength: number): string {
  const value = url.searchParams.get(name)?.trim() ?? "";
  return value.length <= maxLength ? value : "";
}

export function readIssueListQuery(url: URL): IssueListQuery {
  const status = url.searchParams.get(ISSUE_LIST_URL_PARAMS.status);
  const sort = url.searchParams.get(ISSUE_LIST_URL_PARAMS.sort);
  const direction = url.searchParams.get(ISSUE_LIST_URL_PARAMS.direction);
  const rawOffset = url.searchParams.get(ISSUE_LIST_URL_PARAMS.offset);
  const issueType = url.searchParams.get(ISSUE_LIST_URL_PARAMS.issueType);
  const parsedOffset = rawOffset !== null && /^\d+$/.test(rawOffset) ? Number(rawOffset) : 0;
  return {
    ...DEFAULT_ISSUE_LIST_QUERY,
    q: readTextParam(url, ISSUE_LIST_URL_PARAMS.q, 200),
    searchIn: ISSUE_SEARCH_IN_VALUES.has(url.searchParams.get(ISSUE_LIST_URL_PARAMS.searchIn) ?? "") ? url.searchParams.get(ISSUE_LIST_URL_PARAMS.searchIn)! : "",
    status: status === "closed" ? "closed" : "open",
    label: readTextParam(url, ISSUE_LIST_URL_PARAMS.label, 100),
    issueType: issueType === "task" || issueType === "bug" || issueType === "feature" ? issueType : "",
    author: readTextParam(url, ISSUE_LIST_URL_PARAMS.author, 100),
    participant: readTextParam(url, ISSUE_LIST_URL_PARAMS.participant, 100),
    assignee: readTextParam(url, ISSUE_LIST_URL_PARAMS.assignee, 100),
    milestone: readTextParam(url, ISSUE_LIST_URL_PARAMS.milestone, 100),
    reason: status === "closed" && url.searchParams.get(ISSUE_LIST_URL_PARAMS.reason) === "not_planned" ? "not_planned" : status === "closed" && url.searchParams.get(ISSUE_LIST_URL_PARAMS.reason) === "completed" ? "completed" : "",
    subscribed: url.searchParams.get(ISSUE_LIST_URL_PARAMS.subscribed) === "1",
    mentioned: url.searchParams.get(ISSUE_LIST_URL_PARAMS.mentioned) === "1",
    locked: url.searchParams.get(ISSUE_LIST_URL_PARAMS.locked) === "locked" ? "locked" : url.searchParams.get(ISSUE_LIST_URL_PARAMS.locked) === "unlocked" ? "unlocked" : "",
    sort: ISSUE_LIST_SORTS.includes(sort as IssueListSort) ? sort as IssueListSort : DEFAULT_ISSUE_LIST_QUERY.sort,
    direction: direction === "asc" ? "asc" : "desc",
    offset: Number.isSafeInteger(parsedOffset) && parsedOffset >= 0 ? parsedOffset : 0,
  };
}

export function updateIssueListQueryUrl(source: URL, query: IssueListQuery): URL {
  const url = new URL(source.href);
  url.searchParams.set("localappIssues", "1");
  for (const name of Object.values(ISSUE_LIST_URL_PARAMS)) url.searchParams.delete(name);
  const values: Array<[string, string | number, string | number]> = [
    [ISSUE_LIST_URL_PARAMS.q, query.q, DEFAULT_ISSUE_LIST_QUERY.q],
    [ISSUE_LIST_URL_PARAMS.searchIn, query.searchIn, DEFAULT_ISSUE_LIST_QUERY.searchIn],
    [ISSUE_LIST_URL_PARAMS.status, query.status, DEFAULT_ISSUE_LIST_QUERY.status],
    [ISSUE_LIST_URL_PARAMS.label, query.label, DEFAULT_ISSUE_LIST_QUERY.label],
    [ISSUE_LIST_URL_PARAMS.issueType, query.issueType, DEFAULT_ISSUE_LIST_QUERY.issueType],
    [ISSUE_LIST_URL_PARAMS.author, query.author, DEFAULT_ISSUE_LIST_QUERY.author],
    [ISSUE_LIST_URL_PARAMS.participant, query.participant, DEFAULT_ISSUE_LIST_QUERY.participant],
    [ISSUE_LIST_URL_PARAMS.assignee, query.assignee, DEFAULT_ISSUE_LIST_QUERY.assignee],
    [ISSUE_LIST_URL_PARAMS.milestone, query.milestone, DEFAULT_ISSUE_LIST_QUERY.milestone],
    [ISSUE_LIST_URL_PARAMS.reason, query.status === "closed" ? query.reason : "", DEFAULT_ISSUE_LIST_QUERY.reason],
    [ISSUE_LIST_URL_PARAMS.subscribed, query.subscribed ? 1 : 0, 0],
    [ISSUE_LIST_URL_PARAMS.mentioned, query.mentioned ? 1 : 0, 0],
    [ISSUE_LIST_URL_PARAMS.locked, query.locked, DEFAULT_ISSUE_LIST_QUERY.locked],
    [ISSUE_LIST_URL_PARAMS.sort, query.sort, DEFAULT_ISSUE_LIST_QUERY.sort],
    [ISSUE_LIST_URL_PARAMS.direction, query.direction, DEFAULT_ISSUE_LIST_QUERY.direction],
    [ISSUE_LIST_URL_PARAMS.offset, query.offset, DEFAULT_ISSUE_LIST_QUERY.offset],
  ];
  for (const [name, value, defaultValue] of values) {
    if (value !== defaultValue && value !== "") url.searchParams.set(name, String(value));
  }
  return url;
}

const TEXT_FILTERS = ["q", "searchIn", "author", "participant", "assignee", "milestone"] as const;

export function normalizeIssueListQuery(
  current: IssueListQuery,
  updates: Partial<IssueListQuery>,
): IssueListQuery {
  const normalizedUpdates = { ...updates };
  for (const key of TEXT_FILTERS) {
    if (typeof normalizedUpdates[key] === "string") {
      normalizedUpdates[key] = normalizedUpdates[key].trim();
    }
  }

  const next = { ...current, ...normalizedUpdates };
  if (next.status === "open") next.reason = "";
  const changesQuery = Object.keys(normalizedUpdates).some((key) => (
    key !== "offset"
    && current[key as keyof IssueListQuery] !== next[key as keyof IssueListQuery]
  ));
  if (changesQuery) next.offset = 0;
  return next;
}

export function serializeIssueListQuery(query: IssueListQuery): URLSearchParams {
  const params = new URLSearchParams({
    status: query.status,
    sort: query.sort,
    direction: query.direction,
    limit: String(query.limit),
    offset: String(query.offset),
  });
  for (const key of ["q", "label", "author", "participant", "assignee", "milestone", "reason"] as const) {
    if (query[key]) params.set(key, query[key]);
  }
  if (query.issueType) params.set("type", query.issueType);
  if (query.q && query.searchIn) params.set("in", query.searchIn);
  if (query.locked) params.set("locked", query.locked === "locked" ? "true" : "false");
  if (query.subscribed) params.set("subscribed", "true");
  if (query.mentioned) params.set("mentioned", "true");
  return params;
}
