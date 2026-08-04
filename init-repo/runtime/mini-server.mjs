import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { unified } from "unified";
import remarkParse from "remark-parse";
import {
  applyPendingMigrations,
  closeAllConnections,
  execRawSql,
  getConnection,
  loadBackendContract,
  loadDefaultBackendContract,
  LocalAppRuntimeError,
  matchAppApiRoute,
  classifyAppRuntimeError,
  createAppNamedSqlRuntime,
  executeNamedSql,
  bindIssueAttachments,
  createIssueLabel,
  createIssueMilestone,
  deleteIssueLabel,
  deleteIssueMilestone,
  deleteIssueComment,
  deleteIssue,
  getIssueAttachment,
  getIssueById,
  getIssueComment,
  getIssueDetail,
  getIssueDetailByNumber,
  getIssueCollaborationMetadata,
  listExpiredUnboundIssueAttachments,
  deleteIssueAttachmentMetadata,
  releaseUnboundIssueAttachment,
  restoreReleasedIssueAttachment,
  deleteBoundIssueAttachments,
  insertIssue,
  insertIssueAttachment,
  insertIssueComment,
  insertIssueEvent,
  insertIssueRevision,
  listIssueRevisions,
  listIssues,
  listPotentialDuplicateIssues,
  listIssueLabels,
  listIssueMilestones,
  replaceIssueAssignees,
  replaceIssueLabels,
  replaceIssueMentions,
  runDbTransaction,
  isIssueReactionContent,
  isIssueLockReason,
  isIssueType,
  parseIssueSearchScopes,
  setIssueReaction,
  setIssueLock,
  setIssuePin,
  setIssueCommentPin,
  setIssueCommentMinimized,
  convertIssueTaskToSubIssue,
  isIssueCommentMinimizedReason,
  addIssueSubIssue,
  removeIssueSubIssue,
  reprioritizeIssueSubIssue,
  listIssueAncestorIds,
  listIssueSubIssues,
  addIssueDependency,
  removeIssueDependency,
  setIssueSubscription,
  setIssueMilestone,
  updateIssue,
  updateIssueComment,
  updateIssueLabel,
  updateIssueMilestone,
  parseIssueTemplatesConfig,
  IssueTemplateConfigError,
  listIssueSavedViews,
  createIssueSavedView,
  updateIssueSavedView,
  duplicateIssueSavedView,
  deleteIssueSavedView,
  IssueSavedViewLimitError,
  ISSUE_SAVED_REPLY_LIMIT,
  normalizeIssueSavedReplyInput,
  parseIssueDuplicateReference,
  markIssueDuplicateWithComment,
  unmarkIssueDuplicate,
  reconcileIssueCrossReferences,
  buildContentReadResponse,
  validateContentUpload,
} from "@localapp/server-core";

const PLATFORM_CAPABILITIES = JSON.parse(
  fs.readFileSync(fileURLToPath(new URL("./platform-capabilities.json", import.meta.url)), "utf8"),
);

const PLATFORM_CACHE_TTL_MS = 5 * 60 * 1000;
const REQUEST_LOG_LIMIT = 100;
const REQUEST_BODY_PREVIEW_LIMIT = 500;
const DEFAULT_DEV_CONTEXT = {
  user: { id: "dev-user", name: "Dev User", role: "owner" },
  timeMode: "real",
  now: null,
  recentUsers: [],
};
const DEV_ISSUE_MENTION_SKIPPED_NODES = new Set(["code", "inlineCode", "link", "linkReference", "image", "imageReference", "definition"]);
const DEV_ISSUE_MENTION_PATTERN = /(?:^|[^A-Za-z0-9_.+@/-])@([A-Za-z0-9][A-Za-z0-9_-]{0,63})(?![A-Za-z0-9_.-])/g;
const ISSUE_TITLE_MAX_CHARACTERS = 256;
const ISSUE_SUB_ISSUE_ERRORS = {
  self_reference: { code: "issue_sub_issue_self_reference", error: "Issue 不能作为自己的子项" },
  duplicate: { code: "issue_sub_issue_duplicate", error: "该 Issue 已是当前父项的子项" },
  has_parent: { code: "issue_sub_issue_has_parent", error: "该 Issue 已有父项" },
  cycle: { code: "issue_sub_issue_cycle", error: "父子关系不能形成循环" },
  limit: { code: "issue_sub_issue_limit_exceeded", error: "每个 Issue 最多包含 100 个直接子项" },
  depth: { code: "issue_sub_issue_depth_exceeded", error: "Issue 层级最多为 8 层" },
};
const ISSUE_DEPENDENCY_ERRORS = {
  self_reference: { code: "issue_dependency_self_reference", error: "Issue 不能依赖自身" },
  duplicate: { code: "issue_dependency_duplicate", error: "该依赖关系已存在" },
  cycle: { code: "issue_dependency_cycle", error: "Issue 依赖不能形成循环" },
  limit: { code: "issue_dependency_limit_exceeded", error: "每个 Issue 每个方向最多包含 100 条直接依赖" },
};

function isIssueTitleTooLong(title) {
  return Array.from(title.trim()).length > ISSUE_TITLE_MAX_CHARACTERS;
}

function parseDevIssueMentions(markdown) {
  if (!markdown?.includes("@")) return [];
  const root = unified().use(remarkParse).parse(markdown);
  const mentions = [];
  const seen = new Set();
  const visit = (node, skipped) => {
    const nextSkipped = skipped || DEV_ISSUE_MENTION_SKIPPED_NODES.has(node.type ?? "");
    if (!nextSkipped && node.type === "text" && typeof node.value === "string") {
      for (const match of node.value.matchAll(DEV_ISSUE_MENTION_PATTERN)) {
        if (!seen.has(match[1])) { seen.add(match[1]); mentions.push(match[1]); }
      }
    }
    for (const child of node.children ?? []) visit(child, nextSkipped);
  };
  visit(root, false);
  return mentions;
}

async function autoSubscribeDevIssueMentions(dbPath, issueId, markdown, previousMarkdown, actorId, options) {
  const previous = new Set(parseDevIssueMentions(previousMarkdown));
  const recipients = resolveDevIssueMentionUserIds(markdown, options).filter((userId) => userId !== actorId && !previous.has(userId));
  for (const userId of recipients) await setIssueSubscription(dbPath, issueId, userId, true);
  return recipients;
}

function resolveDevIssueMentionUserIds(markdown, options) {
  const knownUsers = new Set([
    options.devContext?.user?.id,
    ...(options.devContext?.recentUsers ?? []).map((user) => user.id),
    ...(options.devUserState?.users ?? []).map((user) => user.id),
  ].filter(Boolean));
  return parseDevIssueMentions(markdown).filter((userId) => knownUsers.has(userId));
}

function readOption(args, name) {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`Missing value for ${name}`);
  }
  return value;
}

export function parseArgs(argv = process.argv.slice(2)) {
  const portValue = readOption(argv, "--port");
  const dataDir = readOption(argv, "--data-dir");
  const prodServer = readOption(argv, "--prod-server");
  const apiKey = readOption(argv, "--api-key");
  const projectDir = readOption(argv, "--project-dir");
  const devUserId = readOption(argv, "--dev-user-id");
  const devPageName = readOption(argv, "--dev-page-name");

  if (!portValue) throw new Error("Missing required option --port");
  if (!dataDir) throw new Error("Missing required option --data-dir");
  if (!prodServer) throw new Error("Missing required option --prod-server");
  if (apiKey === undefined) throw new Error("Missing required option --api-key");

  const port = Number(portValue);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`Invalid --port value: ${portValue}`);
  }

  return {
    port,
    dataDir,
    prodServer,
    apiKey,
    projectDir,
    devUserId,
    devPageName,
  };
}

export function createMiniServer(options) {
  const platformCache = new Map();
  const requestLog = [];
  const devContext = cloneDevContext(options.devContext ?? DEFAULT_DEV_CONTEXT);
  devContext.pageName = devContext.pageName || getConfiguredDevPageName(options);
  devContext.pageOwnerId = devContext.pageOwnerId
    || getConfiguredDevUserId(options)
    || devContext.user?.id
    || "dev-user";
  const devUserState = {
    users: null,
    source: "unknown",
    lastError: null,
  };
  const collaborationSseClients = new Set();
  const presenceSseClients = new Set();
  const presenceLeases = new Map();
  const issueSseClients = new Set();
  const runtimeOptions = { ...options, platformCache, requestLog, devContext, devUserState, collaborationSseClients, presenceSseClients, presenceLeases, issueSseClients };
  return http.createServer((req, res) => {
    const startedAt = Date.now();
    let statusCode = 200;
    const originalWriteHead = res.writeHead.bind(res);
    res.writeHead = (status, ...args) => {
      statusCode = status;
      return originalWriteHead(status, ...args);
    };
    res.on("finish", () => {
      recordRequestDiagnostic(requestLog, req, statusCode || res.statusCode, Date.now() - startedAt);
      const responseStatus = statusCode || res.statusCode;
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (["POST", "PATCH", "PUT", "DELETE"].includes(req.method ?? "")
        && responseStatus >= 200 && responseStatus < 300
        && url.pathname.startsWith("/api/issues")
        && url.pathname !== "/api/issues"
        && !url.pathname.startsWith("/api/issues/attachments")) {
        const pagePath = typeof req.__localappParsedBody?.pagePath === "string" ? req.__localappParsedBody.pagePath : url.searchParams.get("pagePath");
        const match = url.pathname.match(/^\/api\/issues\/(\d+)(?:\/|$)/);
        if (pagePath) {
          const issueId = match ? Number(match[1]) : null;
          const kind = `${(req.method ?? "").toLowerCase()}:${url.pathname.replace(/^\/api\/issues\/?/, "")}`;
          publishIssueChanged(runtimeOptions, pagePath, issueId, kind);
          if (issueId !== null) {
            void listIssueAncestorIds(getDevDbPath(runtimeOptions.dataDir), issueId)
              .then((ancestors) => ancestors.forEach((ancestorId) => publishIssueChanged(runtimeOptions, pagePath, ancestorId, `descendant:${kind}`)))
              .catch((error) => console.error("Failed to publish ancestor Issue changes", error));
          }
        }
      }
    });

    handleRequest(req, res, runtimeOptions).catch((error) => {
      console.error(error);
      sendJson(res, 500, { success: false, error: "Internal server error" });
    });
  });
}

async function handleRequest(req, res, options) {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");

  if (req.method === "GET" && url.pathname === "/api/issues/events") {
    handleIssueEvents(req, res, options, url);
    return;
  }

  if (req.method === "GET" && url.pathname === "/health") {
    sendJson(res, 200, { status: "ok" });
    return;
  }

  if (url.pathname === "/api/dev/context") {
    await handleDevContextRequest(req, res, options);
    return;
  }

  if (url.pathname === "/api/dev/users") {
    await handleDevUsersRequest(req, res, options, url);
    return;
  }

  if (url.pathname.startsWith("/api/dev/data/")) {
    await handleDevDataRequest(req, res, options, url);
    return;
  }

  if (url.pathname === "/api/dev/diagnostics/requests") {
    await handleDevDiagnosticsRequest(req, res, options);
    return;
  }

  if (url.pathname === "/api/dev/business") {
    await handleDevBusinessRequest(req, res, options);
    return;
  }

  if (url.pathname.startsWith("/api/")) {
    await handleAppApiRequest(req, res, options, url);
    return;
  }

  sendJson(res, 404, { error: "not_found" });
}

async function handleAppApiRequest(req, res, options, url) {
  if (url.pathname === "/api/issues/config") {
    await handleIssueConfigRequest(req, res, options, url);
    return;
  }
  if (url.pathname === "/api/issues/potential-duplicates") {
    await handleIssuePotentialDuplicatesRequest(req, res, options, url);
    return;
  }
  if (url.pathname === "/api/issues/views") {
    await handleIssueSavedViewsRequest(req, res, options, url);
    return;
  }
  if (url.pathname === "/api/issues/saved-replies") {
    await handleIssueSavedRepliesRequest(req, res, options, url);
    return;
  }
  const issueSavedReplyMatch = url.pathname.match(/^\/api\/issues\/saved-replies\/(\d+)$/);
  if (issueSavedReplyMatch) {
    await handleIssueSavedRepliesRequest(req, res, options, url, Number(issueSavedReplyMatch[1]));
    return;
  }
  const issueSavedViewCopyMatch = url.pathname.match(/^\/api\/issues\/views\/(\d+)\/copy$/);
  if (issueSavedViewCopyMatch) {
    await handleIssueSavedViewsRequest(req, res, options, url, Number(issueSavedViewCopyMatch[1]), true);
    return;
  }
  const issueSavedViewMatch = url.pathname.match(/^\/api\/issues\/views\/(\d+)$/);
  if (issueSavedViewMatch) {
    await handleIssueSavedViewsRequest(req, res, options, url, Number(issueSavedViewMatch[1]), false);
    return;
  }
  if (url.pathname === "/api/issues") {
    await handleIssuesRequest(req, res, options, url);
    return;
  }
  if (url.pathname === "/api/issues/labels") {
    await handleIssueLabelsRequest(req, res, options, url);
    return;
  }
  if (url.pathname === "/api/issues/milestones") {
    await handleIssueMilestonesRequest(req, res, options, url);
    return;
  }
  const issueMilestoneDefinitionMatch = url.pathname.match(/^\/api\/issues\/milestones\/(\d+)$/);
  if (issueMilestoneDefinitionMatch) {
    await handleIssueMilestonesRequest(req, res, options, url, Number(issueMilestoneDefinitionMatch[1]));
    return;
  }
  const issueLabelDefinitionMatch = url.pathname.match(/^\/api\/issues\/labels\/([a-zA-Z0-9-]+)$/);
  if (issueLabelDefinitionMatch) {
    await handleIssueLabelsRequest(req, res, options, url, issueLabelDefinitionMatch[1]);
    return;
  }
  if (url.pathname === "/api/issues/attachments") {
    await handleIssueAttachmentUpload(req, res, options);
    return;
  }
  const issueAttachmentMatch = url.pathname.match(/^\/api\/issues\/attachments\/([a-zA-Z0-9-]+)$/);
  if (issueAttachmentMatch) {
    await handleIssueAttachmentRead(req, res, options, url, issueAttachmentMatch[1]);
    return;
  }
  const issueCommentsMatch = url.pathname.match(/^\/api\/issues\/(\d+)\/comments$/);
  if (issueCommentsMatch) {
    await handleIssueCommentsRequest(req, res, options, Number(issueCommentsMatch[1]));
    return;
  }
  const issueDuplicateMatch = url.pathname.match(/^\/api\/issues\/(\d+)\/duplicate\/(\d+)$/);
  if (issueDuplicateMatch) {
    await handleIssueDuplicateRequest(req, res, options, Number(issueDuplicateMatch[1]), Number(issueDuplicateMatch[2]));
    return;
  }
  const issueCommentPinMatch = url.pathname.match(/^\/api\/issues\/(\d+)\/comments\/(\d+)\/pin$/);
  if (issueCommentPinMatch) {
    await handleIssueCommentPinRequest(req, res, options, Number(issueCommentPinMatch[1]), Number(issueCommentPinMatch[2]));
    return;
  }
  const issueCommentMinimizeMatch = url.pathname.match(/^\/api\/issues\/(\d+)\/comments\/(\d+)\/minimize$/);
  if (issueCommentMinimizeMatch) {
    await handleIssueCommentMinimizeRequest(req, res, options, Number(issueCommentMinimizeMatch[1]), Number(issueCommentMinimizeMatch[2]));
    return;
  }
  const issueCommentMatch = url.pathname.match(/^\/api\/issues\/(\d+)\/comments\/(\d+)$/);
  if (issueCommentMatch) {
    await handleIssueCommentDetailRequest(req, res, options, Number(issueCommentMatch[1]), Number(issueCommentMatch[2]));
    return;
  }
  const issueCommentHistoryMatch = url.pathname.match(/^\/api\/issues\/(\d+)\/comments\/(\d+)\/history$/);
  if (issueCommentHistoryMatch) {
    await handleIssueHistoryRequest(req, res, options, url, Number(issueCommentHistoryMatch[1]), "comment", Number(issueCommentHistoryMatch[2]));
    return;
  }
  const issueHistoryMatch = url.pathname.match(/^\/api\/issues\/(\d+)\/history$/);
  if (issueHistoryMatch) {
    await handleIssueHistoryRequest(req, res, options, url, Number(issueHistoryMatch[1]), "issue", Number(issueHistoryMatch[1]));
    return;
  }
  const issueMetadataMatch = url.pathname.match(/^\/api\/issues\/(\d+)\/(labels|assignees|subscription|milestone)$/);
  if (issueMetadataMatch) {
    await handleIssueMetadataRequest(req, res, options, Number(issueMetadataMatch[1]), issueMetadataMatch[2]);
    return;
  }
  const issueLockMatch = url.pathname.match(/^\/api\/issues\/(\d+)\/lock$/);
  if (issueLockMatch) {
    await handleIssueLockRequest(req, res, options, Number(issueLockMatch[1]));
    return;
  }
  const issuePinMatch = url.pathname.match(/^\/api\/issues\/(\d+)\/pin$/);
  if (issuePinMatch) {
    await handleIssuePinRequest(req, res, options, Number(issuePinMatch[1]));
    return;
  }
  const issueSubIssueMatch = url.pathname.match(/^\/api\/issues\/(\d+)\/sub-issues\/(\d+)$/);
  if (issueSubIssueMatch) {
    await handleIssueSubIssueRequest(req, res, options, Number(issueSubIssueMatch[1]), Number(issueSubIssueMatch[2]));
    return;
  }
  const issueSubIssuePriorityMatch = url.pathname.match(/^\/api\/issues\/(\d+)\/sub-issues\/priority$/);
  if (issueSubIssuePriorityMatch) {
    await handleIssueSubIssuePriorityRequest(req, res, options, Number(issueSubIssuePriorityMatch[1]));
    return;
  }
  const issueSubIssueListMatch = url.pathname.match(/^\/api\/issues\/(\d+)\/sub-issues$/);
  if (issueSubIssueListMatch) {
    await handleIssueSubIssueListRequest(req, res, options, url, Number(issueSubIssueListMatch[1]));
    return;
  }
  const issueTaskConvertMatch = url.pathname.match(/^\/api\/issues\/(\d+)\/tasks\/(\d+)\/convert$/);
  if (issueTaskConvertMatch) {
    await handleIssueTaskConvertRequest(req, res, options, Number(issueTaskConvertMatch[1]), Number(issueTaskConvertMatch[2]));
    return;
  }
  const issueDependencyMatch = url.pathname.match(/^\/api\/issues\/(\d+)\/dependencies\/blocked-by\/(\d+)$/);
  if (issueDependencyMatch) {
    await handleIssueDependencyRequest(req, res, options, Number(issueDependencyMatch[1]), Number(issueDependencyMatch[2]));
    return;
  }
  const issueReactionMatch = url.pathname.match(/^\/api\/issues\/(\d+)\/reactions$/);
  if (issueReactionMatch) {
    await handleIssueReactionRequest(req, res, options, Number(issueReactionMatch[1]));
    return;
  }
  const issueNumberMatch = url.pathname.match(/^\/api\/issues\/by-number\/(\d+)$/);
  if (issueNumberMatch) {
    await handleIssueDetailByNumberRequest(req, res, options, url, Number(issueNumberMatch[1]));
    return;
  }
  const issueDetailMatch = url.pathname.match(/^\/api\/issues\/(\d+)$/);
  if (issueDetailMatch) {
    await handleIssueDetailRequest(req, res, options, url, Number(issueDetailMatch[1]));
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/collaboration/commit") {
    await handleCollaborationCommit(req, res, options);
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/collaboration/events") {
    handleCollaborationEvents(req, res, options, url);
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/presence/events") {
    handlePresenceEvents(req, res, options, url);
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/presence/heartbeat") {
    await handlePresenceLeaseMutation(req, res, options, false);
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/presence/leave") {
    await handlePresenceLeaseMutation(req, res, options, true);
    return;
  }

  const route = matchAppApiRoute(req.method ?? "GET", url.pathname);

  switch (route.kind) {
    case "time":
      sendJson(res, 200, { success: true, data: buildServerTime(resolveDevNow(options.devContext)) });
      return;
    case "me":
      handleMeRequest(res, options);
      return;
    case "users":
      await handleDevUsersApiRequest(res, options);
      return;
    case "groups":
      sendJson(res, 200, { success: true, data: listDevGroups(options.devContext) });
      return;
    case "group-detail":
      handleDevGroupDetail(res, options, route.id);
      return;
    case "content-upload":
      await handleUploadRequest(req, res, options);
      return;
    case "content-read":
      await handleContentReadRequest(req, res, options, route.key);
      return;
    case "platform":
      await handlePlatformRequest(req, res, options, url);
      return;
    case "named-query":
      await handleNamedSqlRequest(req, res, options, route);
      return;
    case "named-mutation":
      await handleNamedSqlRequest(req, res, options, route);
      return;
    case "named-mutation-transaction":
      await handleNamedSqlTransactionRequest(req, res, options);
      return;
    case "action":
      await handleActionRequest(req, res, options, route);
      return;
    case "invalid":
      sendJson(res, 400, { success: false, error: route.error });
      return;
    case "not-found":
    default:
      // REST CRUD / transitions / db-exec / legacy-upload 路径已由
      // restrict-app-api-to-named-sql 变更整体移除——所有未识别路径统一 404。
      sendJson(res, 404, { success: false, error: "Not found" });
      return;
  }
}

async function handleIssueConfigRequest(req, res, options, url) {
  if (req.method !== "GET" || Array.from(url.searchParams.keys()).some((key) => key !== "pagePath" || url.searchParams.getAll(key).length !== 1)) {
    sendJson(res, 400, { success: false, error: "Invalid Issue config query" });
    return;
  }
  const pagePath = url.searchParams.get("pagePath") ?? undefined;
  if (!isValidIssuePagePath(pagePath)) {
    sendJson(res, 400, { success: false, error: "Invalid Issue config query" });
    return;
  }
  if (rejectForeignIssuePagePath(res, pagePath, options)) return;
  try {
    const manifestPath = path.join(options.projectDir ?? process.cwd(), "manifest.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    sendJson(res, 200, { success: true, data: { templates: parseIssueTemplatesConfig(manifest) } });
  } catch (error) {
    if (error instanceof IssueTemplateConfigError) {
      sendJson(res, 400, { success: false, code: error.code, path: error.path, error: error.message });
      return;
    }
    sendJson(res, 400, { success: false, code: "invalid_issue_templates", path: "manifest", error: "manifest: must contain valid JSON" });
  }
}

async function handleIssuePotentialDuplicatesRequest(req, res, options, url) {
  if (req.method !== "GET") {
    sendJson(res, 405, { success: false, error: "Method not allowed" });
    return;
  }
  const allowed = new Set(["pagePath", "title", "body"]);
  if (Array.from(url.searchParams.keys()).some((key) => !allowed.has(key) || url.searchParams.getAll(key).length !== 1)) {
    sendJson(res, 400, { success: false, error: "Invalid potential duplicate query" });
    return;
  }
  const pagePath = url.searchParams.get("pagePath");
  const title = url.searchParams.get("title");
  const body = url.searchParams.get("body");
  if (!isValidIssuePagePath(pagePath) || title === null || Array.from(title.trim()).length > ISSUE_TITLE_MAX_CHARACTERS || body === null || Array.from(body).length > 20_000) {
    sendJson(res, 400, { success: false, error: "Invalid potential duplicate query" });
    return;
  }
  if (rejectForeignIssuePagePath(res, pagePath, options)) return;
  const dbPath = getDevDbPath(options.dataDir);
  sendJson(res, 200, { success: true, data: await listPotentialDuplicateIssues(dbPath, title, body) });
}

function sendIssueSavedViewError(res, error) {
  if (error instanceof IssueSavedViewLimitError) {
    sendJson(res, 409, { success: false, code: "issue_saved_view_limit_exceeded", error: "每个应用最多保存 25 个 Issue 视图" });
    return;
  }
  if (error instanceof TypeError || error instanceof RangeError) {
    sendJson(res, 400, { success: false, error: error.message });
    return;
  }
  if (error instanceof Error && error.message === "Saved view name already exists") {
    sendJson(res, 409, { success: false, code: "issue_saved_view_name_conflict", error: "已存在同名保存视图" });
    return;
  }
  throw error;
}

async function handleIssueSavedViewsRequest(req, res, options, url, viewId, copy = false) {
  const visitor = getDevVisitor(options.devContext);
  if (!visitor.id) { sendJson(res, 401, { success: false, error: "Authentication required" }); return; }
  const dbPath = getDevDbPath(options.dataDir);
  if (req.method === "GET" && viewId === undefined) {
    if (Array.from(url.searchParams.keys()).some((key) => key !== "pagePath" || url.searchParams.getAll(key).length !== 1)) { sendJson(res, 400, { success: false, error: "Invalid saved view query" }); return; }
    const pagePath = url.searchParams.get("pagePath");
    if (!isValidIssuePagePath(pagePath) || rejectForeignIssuePagePath(res, pagePath, options)) return;
    sendJson(res, 200, { success: true, data: await listIssueSavedViews(dbPath, visitor.id) });
    return;
  }
  let body;
  try { body = await readJsonBody(req); }
  catch (error) { sendJson(res, 400, { success: false, error: error?.message ?? "Invalid JSON body" }); return; }
  const pagePath = body?.pagePath;
  if (!isValidIssuePagePath(pagePath) || rejectForeignIssuePagePath(res, pagePath, options)) return;
  try {
    if (req.method === "POST" && viewId === undefined && !copy) {
      if (Object.keys(body).some((key) => !["pagePath", "name", "description", "query"].includes(key))) { sendJson(res, 400, { success: false, error: "Invalid saved view request" }); return; }
      sendJson(res, 200, { success: true, data: await createIssueSavedView(dbPath, visitor.id, { name: body.name, description: body.description, query: body.query }) });
      return;
    }
    if (req.method === "PATCH" && Number.isSafeInteger(viewId) && !copy) {
      if (Object.keys(body).some((key) => !["pagePath", "name", "description", "query"].includes(key))) { sendJson(res, 400, { success: false, error: "Invalid saved view request" }); return; }
      const data = await updateIssueSavedView(dbPath, visitor.id, viewId, { name: body.name, description: body.description, query: body.query });
      sendJson(res, data ? 200 : 404, data ? { success: true, data } : { success: false, error: "Saved view not found" });
      return;
    }
    if (req.method === "POST" && Number.isSafeInteger(viewId) && copy && Object.keys(body).every((key) => key === "pagePath")) {
      const data = await duplicateIssueSavedView(dbPath, visitor.id, viewId);
      sendJson(res, data ? 200 : 404, data ? { success: true, data } : { success: false, error: "Saved view not found" });
      return;
    }
    if (req.method === "DELETE" && Number.isSafeInteger(viewId) && !copy && Object.keys(body).every((key) => key === "pagePath")) {
      const deleted = await deleteIssueSavedView(dbPath, visitor.id, viewId);
      sendJson(res, deleted ? 200 : 404, deleted ? { success: true } : { success: false, error: "Saved view not found" });
      return;
    }
    sendJson(res, 405, { success: false, error: "Method not allowed" });
  } catch (error) { sendIssueSavedViewError(res, error); }
}

function ensureIssueSavedReplyTable(dbPath) {
  execRawSql(dbPath, `CREATE TABLE IF NOT EXISTS _issue_saved_replies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(user_id, title)
  )`);
  execRawSql(dbPath, "CREATE INDEX IF NOT EXISTS idx_issue_saved_replies_user ON _issue_saved_replies(user_id, updated_at DESC, id DESC)");
}

function listLocalIssueSavedReplies(dbPath, userId) {
  ensureIssueSavedReplyTable(dbPath);
  return execRawSql(dbPath, "SELECT * FROM _issue_saved_replies WHERE user_id = ? ORDER BY updated_at DESC, id DESC", [userId]).rows ?? [];
}

function sendIssueSavedReplyError(res, error) {
  if (error instanceof Error && error.message === "SAVED_REPLY_LIMIT_EXCEEDED") return sendJson(res, 409, { success: false, code: "issue_saved_reply_limit_exceeded", error: "每位用户最多保存 100 条回复" });
  if (error instanceof Error && (error.message === "SAVED_REPLY_TITLE_CONFLICT" || error.message.includes("UNIQUE constraint failed"))) return sendJson(res, 409, { success: false, code: "issue_saved_reply_title_conflict", error: "已存在同名保存回复" });
  if (error instanceof Error && error.message.startsWith("INVALID_SAVED_REPLY")) return sendJson(res, 400, { success: false, error: "Invalid saved reply request" });
  throw error;
}

async function handleIssueSavedRepliesRequest(req, res, options, url, replyId) {
  const visitor = getDevVisitor(options.devContext);
  if (!visitor.id) { sendJson(res, 401, { success: false, error: "Authentication required" }); return; }
  if (url.searchParams.size > 0) { sendJson(res, 400, { success: false, error: "Invalid saved reply query" }); return; }
  const dbPath = getDevDbPath(options.dataDir);
  await getConnection(dbPath);
  ensureIssueSavedReplyTable(dbPath);
  if (req.method === "GET" && replyId === undefined) {
    sendJson(res, 200, { success: true, data: listLocalIssueSavedReplies(dbPath, visitor.id) });
    return;
  }
  try {
    if (req.method === "POST" && replyId === undefined) {
      const input = normalizeIssueSavedReplyInput(await readJsonBody(req));
      const data = await runDbTransaction(dbPath, async () => {
        const count = Number(execRawSql(dbPath, "SELECT COUNT(*) AS count FROM _issue_saved_replies WHERE user_id = ?", [visitor.id]).rows?.[0]?.count ?? 0);
        if (count >= ISSUE_SAVED_REPLY_LIMIT) throw new Error("SAVED_REPLY_LIMIT_EXCEEDED");
        const now = new Date().toISOString();
        try { execRawSql(dbPath, "INSERT INTO _issue_saved_replies (user_id, title, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?)", [visitor.id, input.title, input.body, now, now]); }
        catch (error) { if (String(error).includes("UNIQUE constraint failed")) throw new Error("SAVED_REPLY_TITLE_CONFLICT"); throw error; }
        return execRawSql(dbPath, "SELECT * FROM _issue_saved_replies WHERE id = last_insert_rowid()").rows?.[0];
      });
      sendJson(res, 201, { success: true, data });
      return;
    }
    if (req.method === "PATCH" && Number.isSafeInteger(replyId)) {
      const input = normalizeIssueSavedReplyInput(await readJsonBody(req));
      const existing = execRawSql(dbPath, "SELECT id FROM _issue_saved_replies WHERE id = ? AND user_id = ?", [replyId, visitor.id]).rows?.[0];
      if (!existing) { sendJson(res, 404, { success: false, error: "Saved reply not found" }); return; }
      try { execRawSql(dbPath, "UPDATE _issue_saved_replies SET title = ?, body = ?, updated_at = ? WHERE id = ? AND user_id = ?", [input.title, input.body, new Date().toISOString(), replyId, visitor.id]); }
      catch (error) { if (String(error).includes("UNIQUE constraint failed")) throw new Error("SAVED_REPLY_TITLE_CONFLICT"); throw error; }
      sendJson(res, 200, { success: true, data: execRawSql(dbPath, "SELECT * FROM _issue_saved_replies WHERE id = ? AND user_id = ?", [replyId, visitor.id]).rows?.[0] });
      return;
    }
    if (req.method === "DELETE" && Number.isSafeInteger(replyId)) {
      const existing = execRawSql(dbPath, "SELECT id FROM _issue_saved_replies WHERE id = ? AND user_id = ?", [replyId, visitor.id]).rows?.[0];
      if (!existing) { sendJson(res, 404, { success: false, error: "Saved reply not found" }); return; }
      execRawSql(dbPath, "DELETE FROM _issue_saved_replies WHERE id = ? AND user_id = ?", [replyId, visitor.id]);
      sendJson(res, 200, { success: true });
      return;
    }
    sendJson(res, 405, { success: false, error: "Method not allowed" });
  } catch (error) { sendIssueSavedReplyError(res, error); }
}

function isValidIssuePagePath(pagePath) {
  return typeof pagePath === "string" && /^[^/]+\/[^/]+$/.test(pagePath);
}

function isCurrentIssuePagePath(pagePath, options) {
  if (!isValidIssuePagePath(pagePath)) return false;
  return pagePath.split("/")[1] === getConfiguredDevPageName(options);
}

function rejectForeignIssuePagePath(res, pagePath, options) {
  if (isCurrentIssuePagePath(pagePath, options)) return false;
  sendJson(res, 404, { success: false, error: "Application not found" });
  return true;
}

function isValidIssueStatus(status) {
  return status === undefined || status === "open" || status === "closed";
}

function isValidIssueLabel(label) {
  return label === undefined || label === "bug" || label === "feature";
}

function isValidIssueLabelFilter(label) {
  return label === undefined || (typeof label === "string" && label.length > 0 && label.length <= 100);
}

const ISSUE_LIST_QUERY_KEYS = new Set([
  "pagePath",
  "q",
  "in",
  "status",
  "label",
  "type",
  "author",
  "participant",
  "assignee",
  "milestone",
  "reason",
  "subscribed",
  "mentioned",
  "locked",
  "sort",
  "direction",
  "limit",
  "offset",
]);

function parseIssueListQuery(searchParams) {
  for (const key of searchParams.keys()) {
    if (!ISSUE_LIST_QUERY_KEYS.has(key)) {
      return { error: `Unknown Issue query parameter: ${key}` };
    }
    if (searchParams.getAll(key).length > 1) {
      return { error: `Duplicate Issue query parameter: ${key}` };
    }
  }

  const get = (name) => searchParams.get(name) ?? undefined;
  const pagePath = get("pagePath");
  const q = get("q");
  const searchIn = get("in");
  const status = get("status");
  const label = get("label");
  const issueType = get("type");
  const author = get("author");
  const participant = get("participant");
  const assignee = get("assignee");
  const milestone = get("milestone");
  const reason = get("reason");
  const subscribed = get("subscribed");
  const mentioned = get("mentioned");
  const locked = get("locked");
  const sort = get("sort");
  const direction = get("direction");
  const limitValue = get("limit");
  const offsetValue = get("offset");

  if (!isValidIssuePagePath(pagePath)) {
    return { error: "Valid pagePath query parameter is required" };
  }
  if (!isValidIssueStatus(status) || !isValidIssueLabelFilter(label) || (issueType !== undefined && !isIssueType(issueType))) {
    return { error: "Invalid Issue filter" };
  }
  const searchScopes = searchIn === undefined ? undefined : parseIssueSearchScopes(searchIn);
  if (searchIn !== undefined && searchScopes === null) return { error: "Invalid Issue search scope" };
  if (milestone !== undefined && milestone !== "none" && (!/^\d+$/.test(milestone) || Number(milestone) < 1)) return { error: "Invalid Issue milestone filter" };
  if (reason !== undefined && reason !== "completed" && reason !== "not_planned") return { error: "Invalid Issue reason filter" };
  if (locked !== undefined && locked !== "true" && locked !== "false") return { error: "Invalid Issue locked filter" };
  if (subscribed !== undefined && subscribed !== "true") return { error: "Invalid Issue subscribed filter" };
  if (mentioned !== undefined && mentioned !== "true") return { error: "Invalid Issue mentioned filter" };
  if (sort !== undefined && !["activity", "created", "updated", "comments"].includes(sort)) {
    return { error: "Invalid Issue sort" };
  }
  if (direction !== undefined && direction !== "asc" && direction !== "desc") {
    return { error: "Invalid Issue direction" };
  }

  let limit = 25;
  if (limitValue !== undefined) {
    if (!/^\d+$/.test(limitValue)) return { error: "Invalid Issue limit" };
    limit = Number(limitValue);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      return { error: "Invalid Issue limit" };
    }
  }

  let offset = 0;
  if (offsetValue !== undefined) {
    if (!/^\d+$/.test(offsetValue)) return { error: "Invalid Issue offset" };
    offset = Number(offsetValue);
    if (!Number.isSafeInteger(offset)) return { error: "Invalid Issue offset" };
  }

  return {
    pagePath,
    subscribed: subscribed === "true",
    mentioned: mentioned === "true",
    options: { q, searchIn: searchScopes, status, label, issueType, author, participant, assignee, milestone: milestone === undefined ? undefined : milestone === "none" ? "none" : Number(milestone), reason, locked: locked === undefined ? undefined : locked === "true", sort, direction, limit, offset },
  };
}

class InvalidIssueAttachmentsError extends Error {}
class InvalidIssueSubIssueError extends Error {
  constructor(result) {
    super(result);
    this.result = result;
  }
}

async function handleIssuesRequest(req, res, options, url) {
  const dbPath = getDevDbPath(options.dataDir);

  if (req.method === "GET") {
    const parsed = parseIssueListQuery(url.searchParams);
    if (parsed.error) {
      sendJson(res, 400, { success: false, error: parsed.error });
      return;
    }
    if (rejectForeignIssuePagePath(res, parsed.pagePath, options)) return;
    const visitor = getDevVisitor(options.devContext);
    if (parsed.subscribed && !visitor.id) {
      sendJson(res, 401, { success: false, error: "Authentication required" });
      return;
    }
    if (parsed.mentioned && !visitor.id) {
      sendJson(res, 401, { success: false, error: "Authentication required" });
      return;
    }
    if (parsed.subscribed) parsed.options.subscriberId = visitor.id;
    if (parsed.mentioned) parsed.options.mentionedUserId = visitor.id;
    const result = await listIssues(dbPath, parsed.options);
    sendJson(res, 200, { success: true, data: result.data, pinned: result.pinned, meta: result.meta });
    return;
  }

  if (req.method === "POST") {
    const visitor = getDevVisitor(options.devContext);
    if (!visitor.id) {
      sendJson(res, 401, { success: false, error: "Authentication required" });
      return;
    }

    let body;
    try {
      body = await readJsonBody(req);
    } catch (error) {
      sendJson(res, 400, { success: false, error: error?.message ?? "Invalid JSON body" });
      return;
    }
    const pagePath = body?.pagePath;
    const title = typeof body?.title === "string" ? body.title.trim() : "";
    const description = typeof body?.description === "string" ? body.description.trim() : "";
    const issueType = isIssueType(body?.issueType) ? body.issueType : body?.label === "feature" ? "feature" : body?.label === "bug" ? "bug" : "task";
    if (!isValidIssuePagePath(pagePath) || !title) {
      sendJson(res, 400, { success: false, error: "pagePath and title are required" });
      return;
    }
    if (isIssueTitleTooLong(title)) {
      sendJson(res, 400, { success: false, code: "issue_title_too_long", error: "Issue 标题不能超过 256 个字符" });
      return;
    }
    if (rejectForeignIssuePagePath(res, pagePath, options)) return;
    if ((body?.issueType !== undefined && !isIssueType(body.issueType)) || !isValidIssueLabel(body?.label)) {
      sendJson(res, 400, { success: false, error: "Invalid Issue type" });
      return;
    }

    if ((body?.labelIds !== undefined && (!Array.isArray(body.labelIds) || body.labelIds.length > 20 || body.labelIds.some((id) => typeof id !== "string")))
      || (body?.assigneeIds !== undefined && (!Array.isArray(body.assigneeIds) || body.assigneeIds.length > 20 || body.assigneeIds.some((id) => typeof id !== "string")))) {
      sendJson(res, 400, { success: false, error: "Invalid Issue creation metadata" });
      return;
    }
    if (body?.milestoneId !== undefined && (!Number.isInteger(body.milestoneId) || body.milestoneId < 1)) {
      sendJson(res, 400, { success: false, error: "Invalid Issue creation milestone" });
      return;
    }
    if (body?.parentIssueId !== undefined && (!Number.isInteger(body.parentIssueId) || body.parentIssueId < 1)) {
      sendJson(res, 400, { success: false, error: "Invalid parent Issue" });
      return;
    }
    if ((body?.labelIds !== undefined || body?.assigneeIds !== undefined || body?.milestoneId !== undefined || body?.parentIssueId !== undefined) && !isDevPageOwner(options, visitor)) {
      sendJson(res, 403, { success: false, error: "Only the app owner can set Issue creation metadata" });
      return;
    }
    const labelIds = body?.labelIds === undefined ? undefined : Array.from(new Set(body.labelIds));
    const assigneeIds = body?.assigneeIds === undefined ? undefined : Array.from(new Set(body.assigneeIds));
    const platformUsers = options.devUserState?.source === "platform" ? options.devUserState.users ?? [] : null;
    const knownUsers = platformUsers ? new Set(platformUsers.map((user) => user.id)) : null;
    if (knownUsers && assigneeIds?.some((userId) => !knownUsers.has(userId))) {
      sendJson(res, 400, { success: false, error: "One or more assignees do not exist" });
      return;
    }

    const attachmentIds = Array.isArray(body?.attachmentIds) ? body.attachmentIds.filter((id) => typeof id === "string") : [];
    const crossReferenceTargets = new Set();
    let result;
    try {
      result = await runDbTransaction(dbPath, async () => {
        const created = await insertIssue(dbPath, title, description, issueType, visitor.id);
        const crossReferences = await reconcileIssueCrossReferences(dbPath, { sourceIssueId: created.id, sourceType: "issue", sourceId: created.id, actorId: visitor.id, markdown: description });
        crossReferences.addedTargetIssueIds.forEach((targetId) => crossReferenceTargets.add(targetId));
        await insertIssueEvent(dbPath, created.id, visitor.id, "opened", {});
        await setIssueSubscription(dbPath, created.id, visitor.id, true);
        await replaceIssueMentions(dbPath, { issueId: created.id, targetType: "issue", targetId: created.id, userIds: resolveDevIssueMentionUserIds(`${title}\n\n${description}`, options) });
        await autoSubscribeDevIssueMentions(dbPath, created.id, `${title}\n\n${description}`, "", visitor.id, options);
        if (labelIds) {
          const before = await getIssueCollaborationMetadata(dbPath, created.id);
          await replaceIssueLabels(dbPath, created.id, labelIds);
          const beforeIds = before.labels.map((item) => item.id);
          if (beforeIds.length !== labelIds.length || beforeIds.some((id) => !labelIds.includes(id))) {
            await insertIssueEvent(dbPath, created.id, visitor.id, "labels_changed", { from: beforeIds, to: labelIds });
          }
        }
        if (assigneeIds?.length) {
          await replaceIssueAssignees(dbPath, created.id, assigneeIds, visitor.id);
          for (const userId of assigneeIds) await setIssueSubscription(dbPath, created.id, userId, true);
          await insertIssueEvent(dbPath, created.id, visitor.id, "assignees_changed", { from: [], to: assigneeIds });
        }
        if (typeof body?.milestoneId === "number") {
          await setIssueMilestone(dbPath, created.id, body.milestoneId);
          await insertIssueEvent(dbPath, created.id, visitor.id, "milestoned", { milestoneId: body.milestoneId });
        }
        if (typeof body?.parentIssueId === "number") {
          const relationResult = await addIssueSubIssue(dbPath, body.parentIssueId, created.id, visitor.id, { joinTransaction: true });
          if (relationResult !== "added") throw new InvalidIssueSubIssueError(relationResult);
        }
        if (attachmentIds.length > 0) {
          const bound = await bindIssueAttachments(dbPath, {
            attachmentIds,
            draftId: typeof body?.draftId === "string" ? body.draftId : "",
            uploaderId: visitor.id,
            issueId: created.id,
            pagePath,
          });
          if (bound.length !== attachmentIds.length) throw new InvalidIssueAttachmentsError();
        }
        return created;
      });
    } catch (error) {
      if (error instanceof InvalidIssueAttachmentsError) {
        sendJson(res, 400, { success: false, error: "One or more Issue attachments are invalid" });
        return;
      }
      if (error instanceof InvalidIssueSubIssueError) {
        if (error.result === "not_found") sendJson(res, 404, { success: false, error: "Parent Issue not found" });
        else sendJson(res, 409, { success: false, ...ISSUE_SUB_ISSUE_ERRORS[error.result] });
        return;
      }
      if (labelIds || assigneeIds || body?.milestoneId !== undefined) {
        sendJson(res, 400, { success: false, error: error?.message ?? "Invalid Issue creation metadata" });
        return;
      }
      throw error;
    }
    const issue = await getIssueById(dbPath, result.id);
    publishIssueChanged(options, pagePath, issue.id, "created");
    crossReferenceTargets.forEach((targetId) => publishIssueChanged(options, pagePath, targetId, "cross-reference:added"));
    sendJson(res, 200, { success: true, data: issue });
    return;
  }

  sendJson(res, 405, { success: false, error: "Method not allowed" });
}

function isValidIssueLabelDefinition(body) {
  return isObject(body)
    && isValidIssuePagePath(body.pagePath)
    && typeof body.name === "string" && body.name.trim().length > 0 && body.name.trim().length <= 50
    && typeof body.color === "string" && /^[0-9a-fA-F]{6}$/.test(body.color)
    && (body.description === undefined || (typeof body.description === "string" && body.description.length <= 200));
}

async function handleIssueLabelsRequest(req, res, options, url, labelId) {
  const dbPath = getDevDbPath(options.dataDir);
  if (req.method === "GET" && !labelId) {
    const pagePath = url.searchParams.get("pagePath") ?? undefined;
    if (!isValidIssuePagePath(pagePath)) {
      sendJson(res, 400, { success: false, error: "Valid pagePath query parameter is required" });
      return;
    }
    if (rejectForeignIssuePagePath(res, pagePath, options)) return;
    sendJson(res, 200, { success: true, data: await listIssueLabels(dbPath) });
    return;
  }

  const visitor = getDevVisitor(options.devContext);
  if (!visitor.id) {
    sendJson(res, 401, { success: false, error: "Authentication required" });
    return;
  }
  if (!isDevPageOwner(options, visitor)) {
    sendJson(res, 403, { success: false, error: "Only the app owner can manage Issue labels" });
    return;
  }

  if (req.method === "DELETE" && labelId) {
    const pagePath = url.searchParams.get("pagePath") ?? undefined;
    if (!isValidIssuePagePath(pagePath)) {
      sendJson(res, 400, { success: false, error: "Valid pagePath query parameter is required" });
      return;
    }
    if (rejectForeignIssuePagePath(res, pagePath, options)) return;
    try {
      if (!await deleteIssueLabel(dbPath, labelId)) {
        sendJson(res, 404, { success: false, error: "Issue label not found" });
        return;
      }
    } catch (error) {
      sendJson(res, 400, { success: false, error: error?.message ?? "Issue label cannot be deleted" });
      return;
    }
    sendJson(res, 200, { success: true });
    return;
  }

  if ((req.method !== "POST" || labelId) && (req.method !== "PATCH" || !labelId)) {
    sendJson(res, 405, { success: false, error: "Method not allowed" });
    return;
  }
  let body;
  try {
    body = await readJsonBody(req);
  } catch (error) {
    sendJson(res, 400, { success: false, error: error?.message ?? "Invalid JSON body" });
    return;
  }
  if (!isValidIssueLabelDefinition(body)) {
    sendJson(res, 400, { success: false, error: "Invalid Issue label" });
    return;
  }
  if (rejectForeignIssuePagePath(res, body.pagePath, options)) return;
  if (req.method === "POST") {
    let label;
    try {
      label = await createIssueLabel(dbPath, {
        id: crypto.randomUUID(), name: body.name.trim(), color: body.color.toLowerCase(), description: body.description?.trim(),
      });
    } catch {
      sendJson(res, 400, { success: false, error: "Issue label name already exists" });
      return;
    }
    sendJson(res, 201, { success: true, data: label });
    return;
  }
  let label;
  try {
    label = await updateIssueLabel(dbPath, labelId, {
      name: body.name.trim(), color: body.color.toLowerCase(), description: body.description?.trim() ?? "",
    });
  } catch (error) {
    const message = error?.message ?? "";
    sendJson(res, 400, { success: false, error: message.includes("UNIQUE") ? "Issue label name already exists" : message || "Issue label cannot be edited" });
    return;
  }
  if (!label) {
    sendJson(res, 404, { success: false, error: "Issue label not found" });
    return;
  }
  sendJson(res, 200, { success: true, data: label });
}

function isValidIssueMilestoneDefinition(body, allowState = false) {
  return isObject(body)
    && isValidIssuePagePath(body.pagePath)
    && typeof body.title === "string" && body.title.trim().length > 0 && body.title.trim().length <= 100
    && (body.description === undefined || (typeof body.description === "string" && body.description.length <= 1000))
    && (body.dueOn === undefined || body.dueOn === null || (typeof body.dueOn === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.dueOn)))
    && (body.state === undefined || (allowState && (body.state === "open" || body.state === "closed")));
}

async function handleIssueMilestonesRequest(req, res, options, url, milestoneId) {
  const dbPath = getDevDbPath(options.dataDir);
  if (req.method === "GET" && milestoneId === undefined) {
    const pagePath = url.searchParams.get("pagePath") ?? undefined;
    if (!isValidIssuePagePath(pagePath)) return sendJson(res, 400, { success: false, error: "Valid pagePath query parameter is required" });
    if (rejectForeignIssuePagePath(res, pagePath, options)) return;
    sendJson(res, 200, { success: true, data: await listIssueMilestones(dbPath) });
    return;
  }
  const visitor = getDevVisitor(options.devContext);
  if (!visitor.id) return sendJson(res, 401, { success: false, error: "Authentication required" });
  if (!isDevPageOwner(options, visitor)) return sendJson(res, 403, { success: false, error: "Only the app owner can manage Issue milestones" });
  if (req.method === "DELETE" && milestoneId !== undefined) {
    const pagePath = url.searchParams.get("pagePath") ?? undefined;
    if (!isValidIssuePagePath(pagePath)) return sendJson(res, 400, { success: false, error: "Valid pagePath query parameter is required" });
    if (rejectForeignIssuePagePath(res, pagePath, options)) return;
    if (!await deleteIssueMilestone(dbPath, milestoneId)) return sendJson(res, 404, { success: false, error: "Issue milestone not found" });
    sendJson(res, 200, { success: true });
    return;
  }
  if ((req.method !== "POST" || milestoneId !== undefined) && (req.method !== "PATCH" || milestoneId === undefined)) {
    return sendJson(res, 405, { success: false, error: "Method not allowed" });
  }
  let body;
  try { body = await readJsonBody(req); } catch (error) { return sendJson(res, 400, { success: false, error: error?.message ?? "Invalid JSON body" }); }
  if (!isValidIssueMilestoneDefinition(body, req.method === "PATCH")) return sendJson(res, 400, { success: false, error: "Invalid Issue milestone" });
  if (rejectForeignIssuePagePath(res, body.pagePath, options)) return;
  try {
    if (req.method === "POST") {
      const milestone = await createIssueMilestone(dbPath, { title: body.title.trim(), description: body.description?.trim(), dueOn: body.dueOn, createdBy: visitor.id });
      sendJson(res, 201, { success: true, data: milestone });
      return;
    }
    const milestone = await updateIssueMilestone(dbPath, milestoneId, { title: body.title.trim(), description: body.description?.trim() ?? "", dueOn: body.dueOn, state: body.state });
    if (!milestone) return sendJson(res, 404, { success: false, error: "Issue milestone not found" });
    sendJson(res, 200, { success: true, data: milestone });
  } catch {
    sendJson(res, 400, { success: false, error: "Issue milestone title already exists" });
  }
}

async function handleIssueMetadataRequest(req, res, options, issueId, kind) {
  if (req.method !== "PUT") {
    sendJson(res, 405, { success: false, error: "Method not allowed" });
    return;
  }
  const visitor = getDevVisitor(options.devContext);
  if (!visitor.id) {
    sendJson(res, 401, { success: false, error: "Authentication required" });
    return;
  }
  let body;
  try {
    body = await readJsonBody(req);
  } catch (error) {
    sendJson(res, 400, { success: false, error: error?.message ?? "Invalid JSON body" });
    return;
  }
  if (!isValidIssuePagePath(body?.pagePath)) {
    sendJson(res, 400, { success: false, error: "Valid pagePath is required" });
    return;
  }
  if (rejectForeignIssuePagePath(res, body.pagePath, options)) return;
  const dbPath = getDevDbPath(options.dataDir);
  if (!await getIssueById(dbPath, issueId)) {
    sendJson(res, 404, { success: false, error: "Issue not found" });
    return;
  }
  if (kind !== "subscription" && !isDevPageOwner(options, visitor)) {
    sendJson(res, 403, { success: false, error: `Only the app owner can change Issue ${kind}` });
    return;
  }

  if (kind === "labels") {
    if (!Array.isArray(body.labelIds) || body.labelIds.length > 20 || body.labelIds.some((value) => typeof value !== "string")) {
      sendJson(res, 400, { success: false, error: "Invalid Issue labels update" });
      return;
    }
    try {
      await runDbTransaction(dbPath, async () => {
        const before = await getIssueCollaborationMetadata(dbPath, issueId);
        await replaceIssueLabels(dbPath, issueId, body.labelIds);
        const after = await getIssueCollaborationMetadata(dbPath, issueId);
        await insertIssueEvent(dbPath, issueId, visitor.id, "labels_changed", {
          from: before.labels.map((label) => label.id), to: after.labels.map((label) => label.id),
        });
      });
    } catch (error) {
      sendJson(res, 400, { success: false, error: error?.message ?? "Invalid Issue labels" });
      return;
    }
  } else if (kind === "assignees") {
    if (!Array.isArray(body.userIds) || body.userIds.length > 20 || body.userIds.some((value) => typeof value !== "string")) {
      sendJson(res, 400, { success: false, error: "Invalid Issue assignees update" });
      return;
    }
    const userIds = Array.from(new Set(body.userIds));
    const platformUsers = options.devUserState?.source === "platform" ? options.devUserState.users ?? [] : null;
    const knownUsers = platformUsers ? new Set(platformUsers.map((user) => user.id)) : null;
    if (knownUsers && userIds.some((userId) => !knownUsers.has(userId))) {
      sendJson(res, 400, { success: false, error: "One or more assignees do not exist" });
      return;
    }
    await runDbTransaction(dbPath, async () => {
      const before = await getIssueCollaborationMetadata(dbPath, issueId);
      await replaceIssueAssignees(dbPath, issueId, userIds, visitor.id);
      for (const userId of userIds.filter((candidate) => !before.assignee_ids.includes(candidate))) await setIssueSubscription(dbPath, issueId, userId, true);
      await insertIssueEvent(dbPath, issueId, visitor.id, "assignees_changed", { from: before.assignee_ids, to: userIds });
    });
  } else if (kind === "milestone") {
    if (body.milestoneId !== null && (!Number.isInteger(body.milestoneId) || body.milestoneId < 1)) {
      sendJson(res, 400, { success: false, error: "Invalid Issue milestone update" });
      return;
    }
    const before = await getIssueById(dbPath, issueId);
    try {
      await runDbTransaction(dbPath, async () => {
        await setIssueMilestone(dbPath, issueId, body.milestoneId);
        await insertIssueEvent(dbPath, issueId, visitor.id, body.milestoneId === null ? "demilestoned" : "milestoned", { from: before.milestone_id, to: body.milestoneId });
      });
    } catch (error) {
      sendJson(res, 400, { success: false, error: error?.message ?? "Invalid Issue milestone" });
      return;
    }
  } else {
    if (typeof body.subscribed !== "boolean") {
      sendJson(res, 400, { success: false, error: "Invalid Issue subscription update" });
      return;
    }
    await runDbTransaction(dbPath, async () => {
      const before = await getIssueCollaborationMetadata(dbPath, issueId);
      await setIssueSubscription(dbPath, issueId, visitor.id, body.subscribed);
      if (before.subscriber_ids.includes(visitor.id) !== body.subscribed) {
        await insertIssueEvent(dbPath, issueId, visitor.id, body.subscribed ? "subscribed" : "unsubscribed", {});
      }
    });
  }
  const detail = await getIssueDetail(dbPath, issueId);
  sendJson(res, 200, { success: true, data: devIssuePublicDetail(detail, body.pagePath, visitor.id) });
}

async function handleIssueDetailRequest(req, res, options, url, issueId) {
  const dbPath = getDevDbPath(options.dataDir);
  if (req.method === "GET") {
    const pagePath = url.searchParams.get("pagePath") ?? undefined;
    if (!isValidIssuePagePath(pagePath)) {
      sendJson(res, 400, { success: false, error: "Valid pagePath query parameter is required" });
      return;
    }
    if (rejectForeignIssuePagePath(res, pagePath, options)) return;
    const detail = await getIssueDetail(dbPath, issueId);
    if (!detail) {
      sendJson(res, 404, { success: false, error: "Issue not found" });
      return;
    }
    sendJson(res, 200, { success: true, data: devIssuePublicDetail(detail, pagePath, getDevVisitor(options.devContext).id) });
    return;
  }
  if (req.method === "DELETE") {
    const visitor = getDevVisitor(options.devContext);
    if (!visitor.id) {
      sendJson(res, 401, { success: false, error: "Authentication required" });
      return;
    }
    const pagePath = url.searchParams.get("pagePath") ?? undefined;
    if (!isValidIssuePagePath(pagePath)) {
      sendJson(res, 400, { success: false, error: "Valid pagePath query parameter is required" });
      return;
    }
    if (rejectForeignIssuePagePath(res, pagePath, options)) return;
    if (!isDevPageOwner(options, visitor)) {
      sendJson(res, 403, { success: false, error: "Only the app owner can delete Issues" });
      return;
    }
    const attachments = await runDbTransaction(dbPath, () => deleteIssue(dbPath, issueId));
    if (!attachments) {
      sendJson(res, 404, { success: false, error: "Issue not found" });
      return;
    }
    const attachmentDir = path.join(options.dataDir, "issues", "attachments");
    for (const attachment of attachments) fs.rmSync(path.join(attachmentDir, attachment.storage_key), { force: true });
    sendJson(res, 200, { success: true, data: { id: issueId } });
    return;
  }
  if (req.method !== "PATCH") {
    sendJson(res, 405, { success: false, error: "Method not allowed" });
    return;
  }

  const visitor = getDevVisitor(options.devContext);
  if (!visitor.id) {
    sendJson(res, 401, { success: false, error: "Authentication required" });
    return;
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch (error) {
    sendJson(res, 400, { success: false, error: error?.message ?? "Invalid JSON body" });
    return;
  }
  if (!isValidIssuePagePath(body?.pagePath)) {
    sendJson(res, 400, { success: false, error: "Valid pagePath is required" });
    return;
  }
  if (rejectForeignIssuePagePath(res, body.pagePath, options)) return;
  if (!isValidIssueStatus(body?.status) || !isValidIssueLabel(body?.label) || (body?.issueType !== undefined && !isIssueType(body.issueType))) {
    sendJson(res, 400, { success: false, error: "Invalid Issue update" });
    return;
  }
  if (body?.stateReason !== undefined && body.stateReason !== null && body.stateReason !== "completed" && body.stateReason !== "not_planned") {
    sendJson(res, 400, { success: false, error: "Invalid Issue state reason" });
    return;
  }

  const issue = await getIssueById(dbPath, issueId);
  if (!issue) {
    sendJson(res, 404, { success: false, error: "Issue not found" });
    return;
  }
  if (issue.reporter_id !== visitor.id && !isDevPageOwner(options, visitor)) {
    sendJson(res, 403, { success: false, error: "Permission denied" });
    return;
  }
  if ((body.issueType !== undefined || body.label !== undefined) && !isDevPageOwner(options, visitor)) {
    sendJson(res, 403, { success: false, error: "Only the app owner can change Issue type" });
    return;
  }

  const title = body?.title === undefined ? undefined : String(body.title).trim();
  const description = body?.description === undefined ? undefined : String(body.description);
  const expectedUpdatedAt = body?.expectedUpdatedAt;
  const editAttachmentIds = Array.isArray(body?.attachmentIds) ? body.attachmentIds.filter((id) => typeof id === "string") : [];
  const removedIssueAttachmentIds = Array.isArray(body?.removedAttachmentIds) ? body.removedAttachmentIds.filter((id) => typeof id === "string") : [];
  if (typeof title === "string" && isIssueTitleTooLong(title)) {
    sendJson(res, 400, { success: false, code: "issue_title_too_long", error: "Issue 标题不能超过 256 个字符" });
    return;
  }
  if (body?.attachmentIds !== undefined && (editAttachmentIds.length !== body.attachmentIds.length || typeof body?.draftId !== "string" || !body.draftId)) {
    sendJson(res, 400, { success: false, error: "draftId and attachmentIds are required for attachments" });
    return;
  }
  if (body?.removedAttachmentIds !== undefined && removedIssueAttachmentIds.length !== body.removedAttachmentIds.length) {
    sendJson(res, 400, { success: false, error: "Invalid removed Issue attachments" });
    return;
  }
  if (expectedUpdatedAt !== undefined && typeof expectedUpdatedAt !== "string") {
    sendJson(res, 400, { success: false, error: "Invalid expectedUpdatedAt" });
    return;
  }
  if (title !== undefined && !title) {
    sendJson(res, 400, { success: false, error: "Issue title is required" });
    return;
  }
  const existingDetail = await getIssueDetail(dbPath, issueId);
  const existingIssueAttachments = existingDetail?.attachments.filter((attachment) => attachment.issue_id === issueId && attachment.comment_id === null) ?? [];
  const removedIssueSet = new Set(removedIssueAttachmentIds);
  if (removedIssueSet.size !== removedIssueAttachmentIds.length || removedIssueAttachmentIds.some((attachmentId) => !existingIssueAttachments.some((attachment) => attachment.id === attachmentId))) {
    sendJson(res, 400, { success: false, error: "Invalid removed Issue attachments" });
    return;
  }
  const removedIssueAttachments = removedIssueAttachmentIds.map((attachmentId) => existingIssueAttachments.find((attachment) => attachment.id === attachmentId));
  const targetStatus = body.status ?? issue.status;
  if (targetStatus === "open" && body.stateReason !== undefined && body.stateReason !== null) {
    sendJson(res, 400, { success: false, error: "Open Issues cannot have a state reason" });
    return;
  }
  const stateReason = targetStatus === "open"
    ? body.status === "open" || body.stateReason === null ? null : undefined
    : body.stateReason === "not_planned" ? "not_planned" : body.stateReason === "completed" ? "completed" : issue.state_reason ?? "completed";
  let contentConflict = false;
  const crossReferenceTargets = new Set();
  await runDbTransaction(dbPath, async () => {
    const currentIssue = await getIssueById(dbPath, issueId);
    if (!currentIssue) throw new Error("Issue disappeared during update");
    if (expectedUpdatedAt !== undefined && currentIssue.updated_at !== expectedUpdatedAt) {
      contentConflict = true;
      return;
    }
    const revisedFields = [
      ...(title !== undefined && title !== currentIssue.title ? ["title"] : []),
      ...(description !== undefined && description !== currentIssue.description ? ["description"] : []),
    ];
    if (revisedFields.length > 0) {
      await insertIssueRevision(dbPath, {
        issueId, targetType: "issue", targetId: issueId, editorId: visitor.id,
        title: currentIssue.title, body: currentIssue.description, fields: revisedFields,
      });
    }
    const nextIssueType = isIssueType(body.issueType) ? body.issueType : body.label === "bug" || body.label === "feature" ? body.label : undefined;
    await updateIssue(dbPath, issueId, { status: body.status, stateReason, issueType: nextIssueType, title, description });
    if (title !== undefined || description !== undefined) {
      const markdown = `${title ?? currentIssue.title}\n\n${description ?? currentIssue.description}`;
      if (description !== undefined && description !== currentIssue.description) {
        const crossReferences = await reconcileIssueCrossReferences(dbPath, { sourceIssueId: issueId, sourceType: "issue", sourceId: issueId, actorId: visitor.id, markdown: description });
        [...crossReferences.addedTargetIssueIds, ...crossReferences.removedTargetIssueIds].forEach((targetId) => crossReferenceTargets.add(targetId));
      }
      await replaceIssueMentions(dbPath, { issueId, targetType: "issue", targetId: issueId, userIds: resolveDevIssueMentionUserIds(markdown, options) });
      await autoSubscribeDevIssueMentions(dbPath, issueId, markdown, `${currentIssue.title}\n\n${currentIssue.description}`, visitor.id, options);
    }
    if (editAttachmentIds.length > 0) {
      const bound = await bindIssueAttachments(dbPath, { attachmentIds: editAttachmentIds, draftId: body.draftId, uploaderId: visitor.id, pagePath: body.pagePath, issueId });
      if (bound.length !== editAttachmentIds.length) throw new InvalidIssueAttachmentsError();
    }
    if (removedIssueAttachmentIds.length > 0 && !await deleteBoundIssueAttachments(dbPath, { attachmentIds: removedIssueAttachmentIds, issueId, commentId: null })) {
      throw new InvalidIssueAttachmentsError();
    }
    if (body.status && body.status !== currentIssue.status) {
      await insertIssueEvent(dbPath, issueId, visitor.id, body.status === "closed" ? "closed" : "reopened", {
        from: currentIssue.status,
        to: body.status,
        ...(body.status === "closed" ? { stateReason } : {}),
      });
    }
    if (nextIssueType && nextIssueType !== currentIssue.issue_type) {
      await insertIssueEvent(dbPath, issueId, visitor.id, "type_changed", { from: currentIssue.issue_type, to: nextIssueType });
    }
    if (title !== undefined || description !== undefined) {
      await insertIssueEvent(dbPath, issueId, visitor.id, "edited", {});
    }
  });
  if (contentConflict) {
    sendJson(res, 409, { success: false, code: "issue_content_conflict", error: "Issue content changed; latest version required" });
    return;
  }
  crossReferenceTargets.forEach((targetId) => publishIssueChanged(options, body.pagePath, targetId, "cross-reference:reconciled"));
  for (const attachment of removedIssueAttachments) {
    try { fs.rmSync(path.join(options.dataDir, "issues", "attachments", attachment.storage_key), { force: true }); }
    catch { /* Metadata already hides the attachment; later cleanup can remove orphaned files. */ }
  }
  const updated = await getIssueById(dbPath, issueId);
  sendJson(res, 200, { success: true, data: updated });
}

async function handleIssueDetailByNumberRequest(req, res, options, url, issueNumber) {
  if (req.method !== "GET") {
    sendJson(res, 405, { success: false, error: "Method not allowed" });
    return;
  }
  const pagePath = url.searchParams.get("pagePath") ?? undefined;
  if (!isValidIssuePagePath(pagePath)) {
    sendJson(res, 400, { success: false, error: "Valid pagePath query parameter is required" });
    return;
  }
  if (rejectForeignIssuePagePath(res, pagePath, options)) return;
  const detail = await getIssueDetailByNumber(getDevDbPath(options.dataDir), issueNumber);
  if (!detail) {
    sendJson(res, 404, { success: false, error: "Issue not found" });
    return;
  }
  sendJson(res, 200, { success: true, data: devIssuePublicDetail(detail, pagePath, getDevVisitor(options.devContext).id) });
}

async function handleIssueHistoryRequest(req, res, options, url, issueId, targetType, targetId) {
  if (req.method !== "GET") {
    sendJson(res, 405, { success: false, error: "Method not allowed" });
    return;
  }
  const pagePath = url.searchParams.get("pagePath") ?? undefined;
  if (!isValidIssuePagePath(pagePath)) {
    sendJson(res, 400, { success: false, error: "Valid pagePath query parameter is required" });
    return;
  }
  if (rejectForeignIssuePagePath(res, pagePath, options)) return;
  const dbPath = getDevDbPath(options.dataDir);
  if (!await getIssueById(dbPath, issueId)) {
    sendJson(res, 404, { success: false, error: "Issue not found" });
    return;
  }
  if (targetType === "comment") {
    const comment = await getIssueComment(dbPath, targetId);
    if (!comment || comment.issue_id !== issueId || comment.deleted_at) {
      sendJson(res, 404, { success: false, error: "Comment not found" });
      return;
    }
  }
  sendJson(res, 200, { success: true, data: await listIssueRevisions(dbPath, issueId, targetType, targetId) });
}

async function handleIssueReactionRequest(req, res, options, issueId) {
  if (req.method !== "PUT") {
    sendJson(res, 405, { success: false, error: "Method not allowed" });
    return;
  }
  const visitor = getDevVisitor(options.devContext);
  if (!visitor.id) {
    sendJson(res, 401, { success: false, error: "Authentication required" });
    return;
  }
  let body;
  try {
    body = await readJsonBody(req);
  } catch (error) {
    sendJson(res, 400, { success: false, error: error?.message ?? "Invalid JSON body" });
    return;
  }
  const commentId = body?.commentId === undefined
    ? undefined
    : typeof body.commentId === "number" && Number.isSafeInteger(body.commentId) && body.commentId > 0
      ? body.commentId
      : null;
  if (!isValidIssuePagePath(body?.pagePath) || !isIssueReactionContent(body?.content) || typeof body?.reacted !== "boolean" || commentId === null) {
    sendJson(res, 400, { success: false, error: "Invalid Issue reaction update" });
    return;
  }
  if (rejectForeignIssuePagePath(res, body.pagePath, options)) return;
  const dbPath = getDevDbPath(options.dataDir);
  let result = "unchanged";
  let locked = false;
  await runDbTransaction(dbPath, async () => {
    const issue = await getIssueById(dbPath, issueId);
    if (!issue) { result = "target_not_found"; return; }
    if (body.reacted && issue.locked_at !== null) { locked = true; return; }
    result = await setIssueReaction(dbPath, {
      issueId,
      commentId,
      userId: visitor.id,
      content: body.content,
      reacted: body.reacted,
    });
  });
  if (locked) {
    sendJson(res, 409, { success: false, code: "issue_locked", error: "This Issue conversation is locked" });
    return;
  }
  if (result === "target_not_found") {
    sendJson(res, 404, { success: false, error: commentId ? "Comment not found" : "Issue not found" });
    return;
  }
  const detail = await getIssueDetail(dbPath, issueId);
  sendJson(res, 200, { success: true, data: devIssuePublicDetail(detail, body.pagePath, visitor.id) });
}

async function handleIssueLockRequest(req, res, options, issueId) {
  if (req.method !== "PUT") {
    sendJson(res, 405, { success: false, error: "Method not allowed" });
    return;
  }
  const visitor = getDevVisitor(options.devContext);
  if (!visitor.id) {
    sendJson(res, 401, { success: false, error: "Authentication required" });
    return;
  }
  let body;
  try {
    body = await readJsonBody(req);
  } catch (error) {
    sendJson(res, 400, { success: false, error: error?.message ?? "Invalid JSON body" });
    return;
  }
  if (!isValidIssuePagePath(body?.pagePath) || typeof body?.locked !== "boolean" || (body.reason !== undefined && !isIssueLockReason(body.reason)) || (!body.locked && body.reason !== undefined)) {
    sendJson(res, 400, { success: false, error: "Invalid Issue lock update" });
    return;
  }
  if (rejectForeignIssuePagePath(res, body.pagePath, options)) return;
  const dbPath = getDevDbPath(options.dataDir);
  const issue = await getIssueById(dbPath, issueId);
  if (!issue) {
    sendJson(res, 404, { success: false, error: "Issue not found" });
    return;
  }
  if (issue.reporter_id !== visitor.id && !isDevPageOwner(options, visitor)) {
    sendJson(res, 403, { success: false, error: "Only the app owner or Issue reporter can lock this conversation" });
    return;
  }
  if ((issue.locked_at !== null) !== body.locked) {
    await runDbTransaction(dbPath, async () => {
      const currentIssue = await getIssueById(dbPath, issueId);
      if (!currentIssue) throw new Error("Issue disappeared during lock update");
      if ((currentIssue.locked_at !== null) === body.locked) return;
      await setIssueLock(dbPath, issueId, body.locked ? visitor.id : null, body.locked && isIssueLockReason(body.reason) ? body.reason : null);
      await insertIssueEvent(dbPath, issueId, visitor.id, body.locked ? "locked" : "unlocked", body.locked && isIssueLockReason(body.reason) ? { reason: body.reason } : {});
    });
  }
  const detail = await getIssueDetail(dbPath, issueId);
  sendJson(res, 200, { success: true, data: devIssuePublicDetail(detail, body.pagePath, visitor.id) });
}

async function handleIssuePinRequest(req, res, options, issueId) {
  if (req.method !== "PUT") {
    sendJson(res, 405, { success: false, error: "Method not allowed" });
    return;
  }
  const visitor = getDevVisitor(options.devContext);
  if (!visitor.id) {
    sendJson(res, 401, { success: false, error: "Authentication required" });
    return;
  }
  let body;
  try { body = await readJsonBody(req); }
  catch (error) {
    sendJson(res, 400, { success: false, error: error?.message ?? "Invalid JSON body" });
    return;
  }
  if (!isValidIssuePagePath(body?.pagePath) || typeof body?.pinned !== "boolean") {
    sendJson(res, 400, { success: false, error: "Invalid Issue pin update" });
    return;
  }
  if (rejectForeignIssuePagePath(res, body.pagePath, options)) return;
  if (!isDevPageOwner(options, visitor)) {
    sendJson(res, 403, { success: false, error: "Only the app owner can pin Issues" });
    return;
  }
  const dbPath = getDevDbPath(options.dataDir);
  const result = await setIssuePin(dbPath, issueId, visitor.id, body.pinned);
  if (result === "not_found") {
    sendJson(res, 404, { success: false, error: "Issue not found" });
    return;
  }
  if (result === "limit") {
    sendJson(res, 409, { success: false, code: "issue_pin_limit_exceeded", error: "每个应用最多置顶 3 条 Issue" });
    return;
  }
  const detail = await getIssueDetail(dbPath, issueId);
  sendJson(res, 200, { success: true, data: devIssuePublicDetail(detail, body.pagePath, visitor.id) });
}

async function handleIssueCommentPinRequest(req, res, options, issueId, commentId) {
  if (req.method !== "PUT" && req.method !== "DELETE") {
    sendJson(res, 405, { success: false, error: "Method not allowed" });
    return;
  }
  const visitor = getDevVisitor(options.devContext);
  if (!visitor.id) {
    sendJson(res, 401, { success: false, error: "Authentication required" });
    return;
  }
  let body;
  try { body = await readJsonBody(req); }
  catch (error) {
    sendJson(res, 400, { success: false, error: error?.message ?? "Invalid JSON body" });
    return;
  }
  if (!isValidIssuePagePath(body?.pagePath)) {
    sendJson(res, 400, { success: false, error: "Invalid Issue comment pin update" });
    return;
  }
  if (rejectForeignIssuePagePath(res, body.pagePath, options)) return;
  if (!isDevPageOwner(options, visitor)) {
    sendJson(res, 403, { success: false, error: "Only the app owner can pin Issue comments" });
    return;
  }
  const dbPath = getDevDbPath(options.dataDir);
  const result = await setIssueCommentPin(dbPath, issueId, commentId, visitor.id, req.method === "PUT");
  if (result === "not_found") {
    sendJson(res, 404, { success: false, error: "Comment not found" });
    return;
  }
  if (result === "conflict") {
    sendJson(res, 409, { success: false, code: "issue_comment_pin_conflict", error: "This Issue already has a pinned comment" });
    return;
  }
  publishIssueChanged(options, body.pagePath, issueId, req.method === "PUT" ? "comment:pinned" : "comment:unpinned");
  const detail = await getIssueDetail(dbPath, issueId);
  sendJson(res, 200, { success: true, data: devIssuePublicDetail(detail, body.pagePath, visitor.id) });
}

async function handleIssueCommentMinimizeRequest(req, res, options, issueId, commentId) {
  if (req.method !== "PUT" && req.method !== "DELETE") {
    sendJson(res, 405, { success: false, error: "Method not allowed" });
    return;
  }
  const visitor = getDevVisitor(options.devContext);
  if (!visitor.id) {
    sendJson(res, 401, { success: false, error: "Authentication required" });
    return;
  }
  let body;
  try { body = await readJsonBody(req); }
  catch (error) {
    sendJson(res, 400, { success: false, error: error?.message ?? "Invalid JSON body" });
    return;
  }
  if (!isValidIssuePagePath(body?.pagePath) || (req.method === "PUT" && !isIssueCommentMinimizedReason(body?.reason))) {
    sendJson(res, 400, { success: false, code: "issue_comment_minimized_reason_invalid", error: "Invalid Issue comment minimization update" });
    return;
  }
  if (rejectForeignIssuePagePath(res, body.pagePath, options)) return;
  if (!isDevPageOwner(options, visitor)) {
    sendJson(res, 403, { success: false, error: "Only the app owner can minimize Issue comments" });
    return;
  }
  const dbPath = getDevDbPath(options.dataDir);
  const result = await setIssueCommentMinimized(dbPath, issueId, commentId, visitor.id, req.method === "PUT" ? body.reason : null);
  if (result === "not_found") { sendJson(res, 404, { success: false, error: "Comment not found" }); return; }
  if (result === "pinned_conflict") { sendJson(res, 409, { success: false, code: "issue_comment_minimized_pinned_conflict", error: "Unpin this comment before minimizing it" }); return; }
  if (result === "invalid_reason") { sendJson(res, 400, { success: false, code: "issue_comment_minimized_reason_invalid", error: "Invalid Issue comment minimization reason" }); return; }
  publishIssueChanged(options, body.pagePath, issueId, req.method === "PUT" ? "comment:minimized" : "comment:unminimized");
  sendJson(res, 200, { success: true, data: devIssuePublicDetail((await getIssueDetail(dbPath, issueId)), body.pagePath, visitor.id) });
}

async function handleIssueSubIssueListRequest(req, res, options, url, parentIssueId) {
  if (req.method !== "GET") { sendJson(res, 405, { success: false, error: "Method not allowed" }); return; }
  const pagePath = url.searchParams.get("pagePath");
  if (!isValidIssuePagePath(pagePath)) { sendJson(res, 400, { success: false, error: "Invalid Sub-issue query" }); return; }
  if (rejectForeignIssuePagePath(res, pagePath, options)) return;
  const dbPath = getDevDbPath(options.dataDir);
  if (!await getIssueById(dbPath, parentIssueId)) { sendJson(res, 404, { success: false, error: "Issue not found" }); return; }
  sendJson(res, 200, { success: true, data: await listIssueSubIssues(dbPath, parentIssueId) });
}

async function handleIssueSubIssueRequest(req, res, options, parentIssueId, childIssueId) {
  if (req.method !== "PUT" && req.method !== "DELETE") {
    sendJson(res, 405, { success: false, error: "Method not allowed" });
    return;
  }
  const visitor = getDevVisitor(options.devContext);
  if (!visitor.id) {
    sendJson(res, 401, { success: false, error: "Authentication required" });
    return;
  }
  let body;
  try { body = await readJsonBody(req); }
  catch (error) {
    sendJson(res, 400, { success: false, error: error?.message ?? "Invalid JSON body" });
    return;
  }
  if (!isValidIssuePagePath(body?.pagePath)) {
    sendJson(res, 400, { success: false, error: "Invalid Sub-issue update" });
    return;
  }
  if (rejectForeignIssuePagePath(res, body.pagePath, options)) return;
  if (!isDevPageOwner(options, visitor)) {
    sendJson(res, 403, { success: false, error: "Only the app owner can manage Sub-issues" });
    return;
  }
  const dbPath = getDevDbPath(options.dataDir);
  if (req.method === "DELETE") {
    const result = await removeIssueSubIssue(dbPath, parentIssueId, childIssueId, visitor.id);
    if (result === "not_found") {
      sendJson(res, 404, { success: false, error: "Sub-issue relationship not found" });
      return;
    }
  } else {
    const result = await addIssueSubIssue(dbPath, parentIssueId, childIssueId, visitor.id);
    if (result === "not_found") {
      sendJson(res, 404, { success: false, error: "Issue not found" });
      return;
    }
    if (result !== "added") {
      sendJson(res, 409, { success: false, ...ISSUE_SUB_ISSUE_ERRORS[result] });
      return;
    }
  }
  const detail = await getIssueDetail(dbPath, parentIssueId);
  sendJson(res, 200, { success: true, data: devIssuePublicDetail(detail, body.pagePath, visitor.id) });
}

async function handleIssueSubIssuePriorityRequest(req, res, options, parentIssueId) {
  if (req.method !== "PATCH") { sendJson(res, 405, { success: false, error: "Method not allowed" }); return; }
  const visitor = getDevVisitor(options.devContext);
  if (!visitor.id) { sendJson(res, 401, { success: false, error: "Authentication required" }); return; }
  let body;
  try { body = await readJsonBody(req); }
  catch (error) { sendJson(res, 400, { success: false, error: error?.message ?? "Invalid JSON body" }); return; }
  if (!isValidIssuePagePath(body?.pagePath) || !Number.isSafeInteger(body?.childIssueId) || body.childIssueId < 1 || (body.afterIssueId !== null && (!Number.isSafeInteger(body?.afterIssueId) || body.afterIssueId < 1))) {
    sendJson(res, 400, { success: false, error: "Invalid Sub-issue priority update", code: "invalid_sub_issue_priority" }); return;
  }
  if (rejectForeignIssuePagePath(res, body.pagePath, options)) return;
  if (!isDevPageOwner(options, visitor)) { sendJson(res, 403, { success: false, error: "Only the app owner can manage Sub-issues" }); return; }
  const result = await reprioritizeIssueSubIssue(getDevDbPath(options.dataDir), parentIssueId, body.childIssueId, body.afterIssueId, visitor.id);
  const failure = result === "self_after" ? [400, "A Sub-issue cannot be positioned after itself", "sub_issue_self_after"]
    : result === "parent_not_found" ? [404, "Parent Issue not found", "parent_issue_not_found"]
    : result === "child_not_found" ? [409, "Sub-issue relationship changed", "sub_issue_not_found"]
    : result === "after_not_found" ? [409, "Target Sub-issue relationship changed", "sub_issue_after_not_found"] : null;
  if (failure) { sendJson(res, failure[0], { success: false, error: failure[1], code: failure[2] }); return; }
  const detail = await getIssueDetail(getDevDbPath(options.dataDir), parentIssueId);
  sendJson(res, 200, { success: true, data: devIssuePublicDetail(detail, body.pagePath, visitor.id), unchanged: result === "unchanged" });
}

async function handleIssueTaskConvertRequest(req, res, options, parentIssueId, taskIndex) {
  if (req.method !== "POST") {
    sendJson(res, 405, { success: false, error: "Method not allowed" });
    return;
  }
  const visitor = getDevVisitor(options.devContext);
  if (!visitor.id) {
    sendJson(res, 401, { success: false, error: "Authentication required" });
    return;
  }
  let body;
  try { body = await readJsonBody(req); }
  catch (error) {
    sendJson(res, 400, { success: false, error: error?.message ?? "Invalid JSON body" });
    return;
  }
  if (!isValidIssuePagePath(body?.pagePath) || typeof body?.expectedUpdatedAt !== "string" || (body?.title !== undefined && typeof body.title !== "string")) {
    sendJson(res, 400, { success: false, error: "Invalid Issue task conversion" });
    return;
  }
  if (rejectForeignIssuePagePath(res, body.pagePath, options)) return;
  if (!isDevPageOwner(options, visitor)) {
    sendJson(res, 403, { success: false, error: "Only the app owner can convert Issue tasks" });
    return;
  }
  const dbPath = getDevDbPath(options.dataDir);
  const result = await convertIssueTaskToSubIssue(dbPath, {
    parentIssueId,
    taskIndex,
    expectedUpdatedAt: body.expectedUpdatedAt,
    actorId: visitor.id,
    ...(body.title === undefined ? {} : { title: body.title }),
    resolveMentionUserIds: async (markdown) => resolveDevIssueMentionUserIds(markdown, options),
  });
  if (result.status === "not_found" || result.status === "task_not_found") {
    sendJson(res, 404, { success: false, code: result.status === "task_not_found" ? "issue_task_not_found" : "issue_not_found", error: result.status === "task_not_found" ? "Issue task not found" : "Issue not found" });
    return;
  }
  if (result.status === "content_conflict") { sendJson(res, 409, { success: false, code: "issue_content_conflict", error: "Issue content changed. Refresh and try again." }); return; }
  if (result.status === "task_not_convertible") { sendJson(res, 409, { success: false, code: "issue_task_not_convertible", error: "This task cannot be converted" }); return; }
  if (result.status === "title_invalid") { sendJson(res, 400, { success: false, code: "issue_title_invalid", error: "Issue title must contain 1 to 256 characters" }); return; }
  if (result.status === "relation_conflict") { sendJson(res, 409, { success: false, ...ISSUE_SUB_ISSUE_ERRORS[result.reason] }); return; }

  publishIssueChanged(options, body.pagePath, parentIssueId, "task:converted");
  publishIssueChanged(options, body.pagePath, result.childIssueId, "created");
  [...result.addedTargetIssueIds, ...result.removedTargetIssueIds].forEach((targetId) => publishIssueChanged(options, body.pagePath, targetId, "cross-reference:reconciled"));
  sendJson(res, 200, { success: true, data: devIssuePublicDetail((await getIssueDetail(dbPath, parentIssueId)), body.pagePath, visitor.id) });
}

async function handleIssueDependencyRequest(req, res, options, blockedIssueId, blockingIssueId) {
  if (req.method !== "PUT" && req.method !== "DELETE") {
    sendJson(res, 405, { success: false, error: "Method not allowed" });
    return;
  }
  const visitor = getDevVisitor(options.devContext);
  if (!visitor.id) {
    sendJson(res, 401, { success: false, error: "Authentication required" });
    return;
  }
  let body;
  try { body = await readJsonBody(req); }
  catch (error) {
    sendJson(res, 400, { success: false, error: error?.message ?? "Invalid JSON body" });
    return;
  }
  if (!isValidIssuePagePath(body?.pagePath)) {
    sendJson(res, 400, { success: false, error: "Invalid Issue dependency update" });
    return;
  }
  if (rejectForeignIssuePagePath(res, body.pagePath, options)) return;
  if (!isDevPageOwner(options, visitor)) {
    sendJson(res, 403, { success: false, error: "Only the app owner can manage Issue dependencies" });
    return;
  }
  const dbPath = getDevDbPath(options.dataDir);
  if (req.method === "DELETE") {
    if (await removeIssueDependency(dbPath, blockedIssueId, blockingIssueId, visitor.id) === "not_found") {
      sendJson(res, 404, { success: false, error: "Issue dependency not found" });
      return;
    }
  } else {
    const result = await addIssueDependency(dbPath, blockedIssueId, blockingIssueId, visitor.id);
    if (result === "not_found") {
      sendJson(res, 404, { success: false, error: "Issue not found" });
      return;
    }
    if (result !== "added") {
      sendJson(res, 409, { success: false, ...ISSUE_DEPENDENCY_ERRORS[result] });
      return;
    }
  }
  const detail = await getIssueDetail(dbPath, blockedIssueId);
  sendJson(res, 200, { success: true, data: devIssuePublicDetail(detail, body.pagePath, visitor.id) });
}

async function handleIssueDuplicateRequest(req, res, options, issueId, canonicalIssueId) {
  if (req.method !== "DELETE") { sendJson(res, 405, { success: false, error: "Method not allowed" }); return; }
  const visitor = getDevVisitor(options.devContext);
  if (!visitor.id) { sendJson(res, 401, { success: false, error: "Authentication required" }); return; }
  let body;
  try { body = await readJsonBody(req); }
  catch (error) { sendJson(res, 400, { success: false, error: error?.message ?? "Invalid JSON body" }); return; }
  if (!isValidIssuePagePath(body?.pagePath) || Object.keys(body).some((key) => key !== "pagePath")) { sendJson(res, 400, { success: false, error: "Invalid duplicate request" }); return; }
  if (rejectForeignIssuePagePath(res, body.pagePath, options)) return;
  if (!isDevPageOwner(options, visitor)) { sendJson(res, 403, { success: false, error: "Only the app owner can unmark duplicate Issues" }); return; }
  const result = await unmarkIssueDuplicate(getDevDbPath(options.dataDir), issueId, canonicalIssueId, visitor.id);
  if (result !== "removed") { sendJson(res, 404, { success: false, error: "Duplicate relation not found" }); return; }
  publishIssueChanged(options, body.pagePath, issueId, "duplicate:unmarked");
  publishIssueChanged(options, body.pagePath, canonicalIssueId, "duplicate:unmarked");
  sendJson(res, 200, { success: true, data: devIssuePublicDetail(await getIssueDetail(getDevDbPath(options.dataDir), issueId), body.pagePath, visitor.id) });
}

const ISSUE_DUPLICATE_ERROR_MESSAGES = {
  self_reference: ["issue_duplicate_self_reference", "Issue 不能标记为自身的重复项"],
  already_marked: ["issue_duplicate_already_marked", "该 Issue 已标记为重复项"],
  canonical_is_duplicate: ["issue_duplicate_canonical_is_duplicate", "目标 Issue 本身已是重复项"],
  has_duplicates: ["issue_duplicate_has_duplicates", "已有重复项的 canonical Issue 不能再标记为重复项"],
};

async function handleIssueCommentsRequest(req, res, options, issueId) {
  if (req.method !== "POST") {
    sendJson(res, 405, { success: false, error: "Method not allowed" });
    return;
  }
  const visitor = getDevVisitor(options.devContext);
  if (!visitor.id) {
    sendJson(res, 401, { success: false, error: "Authentication required" });
    return;
  }
  let body;
  try {
    body = await readJsonBody(req);
  } catch (error) {
    sendJson(res, 400, { success: false, error: error?.message ?? "Invalid JSON body" });
    return;
  }
  if (!isValidIssuePagePath(body?.pagePath)) {
    sendJson(res, 400, { success: false, error: "Valid pagePath is required" });
    return;
  }
  if (rejectForeignIssuePagePath(res, body.pagePath, options)) return;
  const dbPath = getDevDbPath(options.dataDir);
  const issue = await getIssueById(dbPath, issueId);
  if (!issue) {
    sendJson(res, 404, { success: false, error: "Issue not found" });
    return;
  }
  const commentBody = typeof body?.body === "string" ? body.body.trim() : "";
  const attachmentIds = Array.isArray(body?.attachmentIds) ? body.attachmentIds.filter((id) => typeof id === "string") : [];
  if (!commentBody && attachmentIds.length === 0) {
    sendJson(res, 400, { success: false, error: "Comment body or attachment is required" });
    return;
  }
  const requestedStatus = body?.statusAction === "close" || body?.statusAction === "closed"
    ? "closed"
    : body?.statusAction === "reopen" || body?.statusAction === "open"
      ? "open"
      : undefined;
  if (body?.statusAction !== undefined && !requestedStatus) {
    sendJson(res, 400, { success: false, error: "Invalid statusAction" });
    return;
  }
  if (body?.stateReason !== undefined && (requestedStatus !== "closed" || (body.stateReason !== "completed" && body.stateReason !== "not_planned"))) {
    sendJson(res, 400, { success: false, error: "Invalid stateReason" });
    return;
  }
  if (requestedStatus && requestedStatus !== issue.status && issue.reporter_id !== visitor.id && !isDevPageOwner(options, visitor)) {
    sendJson(res, 403, { success: false, error: "Permission denied" });
    return;
  }
  const duplicateIssueNumber = isDevPageOwner(options, visitor) ? parseIssueDuplicateReference(commentBody) : null;
  const crossReferenceTargets = new Set();
  try {
    let conversationLocked = false;
    await runDbTransaction(dbPath, async () => {
      const currentIssue = await getIssueById(dbPath, issueId);
      if (!currentIssue) throw new Error("Issue disappeared during comment");
      if (currentIssue.locked_at !== null) { conversationLocked = true; return; }
      const created = await insertIssueComment(dbPath, issueId, commentBody, visitor.id);
      const crossReferences = await reconcileIssueCrossReferences(dbPath, { sourceIssueId: issueId, sourceType: "comment", sourceId: created.id, actorId: visitor.id, markdown: commentBody });
      crossReferences.addedTargetIssueIds.forEach((targetId) => crossReferenceTargets.add(targetId));
      if (duplicateIssueNumber !== null) {
        const duplicateResult = await markIssueDuplicateWithComment(dbPath, { duplicateIssueId: issueId, canonicalIssueNumber: duplicateIssueNumber, actorId: visitor.id, commentId: created.id });
        if (duplicateResult !== "created") { const failure = new Error(duplicateResult); failure.issueDuplicateResult = duplicateResult; throw failure; }
      }
      await setIssueSubscription(dbPath, issueId, visitor.id, true);
      await replaceIssueMentions(dbPath, { issueId, targetType: "comment", targetId: created.id, userIds: resolveDevIssueMentionUserIds(commentBody, options) });
      await autoSubscribeDevIssueMentions(dbPath, issueId, commentBody, "", visitor.id, options);
      if (attachmentIds.length > 0) {
        const bound = await bindIssueAttachments(dbPath, {
          attachmentIds,
          draftId: typeof body?.draftId === "string" ? body.draftId : "",
          uploaderId: visitor.id,
          issueId,
          commentId: created.id,
          pagePath: body.pagePath,
        });
        if (bound.length !== attachmentIds.length) throw new InvalidIssueAttachmentsError();
      }
      if (requestedStatus && requestedStatus !== currentIssue.status) {
        const stateReason = requestedStatus === "closed" ? (body.stateReason === "not_planned" ? "not_planned" : "completed") : null;
        await updateIssue(dbPath, issueId, { status: requestedStatus, stateReason });
        await insertIssueEvent(dbPath, issueId, visitor.id, requestedStatus === "closed" ? "closed" : "reopened", {
          from: currentIssue.status,
          to: requestedStatus,
          ...(requestedStatus === "closed" ? { stateReason } : {}),
        });
      }
      return created;
    });
    if (conversationLocked) {
      sendJson(res, 409, { success: false, code: "issue_locked", error: "This Issue conversation is locked" });
      return;
    }
    crossReferenceTargets.forEach((targetId) => publishIssueChanged(options, body.pagePath, targetId, "cross-reference:added"));
  } catch (error) {
    if (error instanceof InvalidIssueAttachmentsError) {
      sendJson(res, 400, { success: false, error: "One or more Issue attachments are invalid" });
      return;
    }
    if (error?.issueDuplicateResult) {
      if (error.issueDuplicateResult === "not_found") { sendJson(res, 404, { success: false, code: "issue_duplicate_target_not_found", error: "Duplicate target Issue not found" }); return; }
      const mapped = ISSUE_DUPLICATE_ERROR_MESSAGES[error.issueDuplicateResult];
      sendJson(res, 409, { success: false, code: mapped[0], error: mapped[1] });
      return;
    }
    throw error;
  }
  const detail = await getIssueDetail(dbPath, issueId);
  if (duplicateIssueNumber !== null && detail?.duplicateOf) publishIssueChanged(options, body.pagePath, detail.duplicateOf.id, "duplicate:marked");
  sendJson(res, 201, { success: true, data: devIssuePublicDetail(detail, body.pagePath, visitor.id) });
}

async function handleIssueCommentDetailRequest(req, res, options, issueId, commentId) {
  const visitor = getDevVisitor(options.devContext);
  if (!visitor.id) {
    sendJson(res, 401, { success: false, error: "Authentication required" });
    return;
  }
  if (req.method !== "PATCH" && req.method !== "DELETE") {
    sendJson(res, 405, { success: false, error: "Method not allowed" });
    return;
  }
  let body;
  if (req.method === "DELETE") {
    const requestUrl = new URL(req.url ?? "/", "http://127.0.0.1");
    body = { pagePath: requestUrl.searchParams.get("pagePath") ?? undefined };
  } else {
    try {
      body = await readJsonBody(req);
    } catch (error) {
      sendJson(res, 400, { success: false, error: error?.message ?? "Invalid JSON body" });
      return;
    }
  }
  if (!isValidIssuePagePath(body?.pagePath)) {
    sendJson(res, 400, { success: false, error: "Valid pagePath is required" });
    return;
  }
  if (rejectForeignIssuePagePath(res, body.pagePath, options)) return;
  const dbPath = getDevDbPath(options.dataDir);
  const existing = await getIssueComment(dbPath, commentId);
  if (!existing || existing.issue_id !== issueId) {
    sendJson(res, 404, { success: false, error: "Comment not found" });
    return;
  }
  if (existing.author_id !== visitor.id) {
    sendJson(res, 403, { success: false, error: "Permission denied" });
    return;
  }
  if (req.method === "PATCH") {
    const commentBody = typeof body?.body === "string" ? body.body.trim() : "";
    const editAttachmentIds = Array.isArray(body?.attachmentIds) ? body.attachmentIds.filter((id) => typeof id === "string") : [];
    const removedAttachmentIds = Array.isArray(body?.removedAttachmentIds) ? body.removedAttachmentIds.filter((id) => typeof id === "string") : [];
    if (body?.expectedUpdatedAt !== undefined && typeof body.expectedUpdatedAt !== "string") {
      sendJson(res, 400, { success: false, error: "Invalid expectedUpdatedAt" });
      return;
    }
    if (body?.attachmentIds !== undefined && (editAttachmentIds.length !== body.attachmentIds.length || typeof body?.draftId !== "string" || !body.draftId)) {
      sendJson(res, 400, { success: false, error: "draftId and attachmentIds are required for attachments" });
      return;
    }
    if (body?.removedAttachmentIds !== undefined && removedAttachmentIds.length !== body.removedAttachmentIds.length) {
      sendJson(res, 400, { success: false, error: "Invalid removed Issue attachments" });
      return;
    }
    const existingDetail = await getIssueDetail(dbPath, issueId);
    const existingAttachments = existingDetail?.attachments.filter((attachment) => attachment.comment_id === commentId) ?? [];
    const removedSet = new Set(removedAttachmentIds);
    if (removedSet.size !== removedAttachmentIds.length || removedAttachmentIds.some((attachmentId) => !existingAttachments.some((attachment) => attachment.id === attachmentId))) {
      sendJson(res, 400, { success: false, error: "Invalid removed Issue attachments" });
      return;
    }
    if (!commentBody && existingAttachments.filter((attachment) => !removedSet.has(attachment.id)).length + editAttachmentIds.length === 0) {
      sendJson(res, 400, { success: false, error: "Comment body or attachment is required" });
      return;
    }
    const removedAttachments = removedAttachmentIds.map((attachmentId) => existingAttachments.find((attachment) => attachment.id === attachmentId));
    let contentConflict = false;
    const crossReferenceTargets = new Set();
    if (existing.body !== commentBody || editAttachmentIds.length > 0 || removedAttachmentIds.length > 0) {
      await runDbTransaction(dbPath, async () => {
        const currentComment = await getIssueComment(dbPath, commentId);
        if (!currentComment || currentComment.issue_id !== issueId || currentComment.deleted_at) throw new Error("Comment disappeared during update");
        if (body?.expectedUpdatedAt !== undefined && currentComment.updated_at !== body.expectedUpdatedAt) { contentConflict = true; return; }
        if (currentComment.body !== commentBody) {
          await insertIssueRevision(dbPath, {
            issueId, targetType: "comment", targetId: commentId, editorId: visitor.id,
            body: currentComment.body, fields: ["body"],
          });
          await updateIssueComment(dbPath, commentId, commentBody, visitor.id);
          const crossReferences = await reconcileIssueCrossReferences(dbPath, { sourceIssueId: issueId, sourceType: "comment", sourceId: commentId, actorId: visitor.id, markdown: commentBody });
          [...crossReferences.addedTargetIssueIds, ...crossReferences.removedTargetIssueIds].forEach((targetId) => crossReferenceTargets.add(targetId));
          await replaceIssueMentions(dbPath, { issueId, targetType: "comment", targetId: commentId, userIds: resolveDevIssueMentionUserIds(commentBody, options) });
          await autoSubscribeDevIssueMentions(dbPath, issueId, commentBody, existing.body, visitor.id, options);
        }
        if (editAttachmentIds.length > 0) {
          const bound = await bindIssueAttachments(dbPath, { attachmentIds: editAttachmentIds, draftId: body.draftId, uploaderId: visitor.id, pagePath: body.pagePath, issueId, commentId });
          if (bound.length !== editAttachmentIds.length) throw new InvalidIssueAttachmentsError();
        }
        if (removedAttachmentIds.length > 0 && !await deleteBoundIssueAttachments(dbPath, { attachmentIds: removedAttachmentIds, issueId, commentId })) {
          throw new InvalidIssueAttachmentsError();
        }
      });
    }
    if (contentConflict) {
      sendJson(res, 409, { success: false, code: "issue_content_conflict", error: "Issue content changed; latest version required" });
      return;
    }
    crossReferenceTargets.forEach((targetId) => publishIssueChanged(options, body.pagePath, targetId, "cross-reference:reconciled"));
    for (const attachment of removedAttachments) {
      try { fs.rmSync(path.join(options.dataDir, "issues", "attachments", attachment.storage_key), { force: true }); }
      catch { /* Metadata already hides the attachment; later cleanup can remove orphaned files. */ }
    }
    const detail = await getIssueDetail(dbPath, issueId);
    sendJson(res, 200, { success: true, data: devIssuePublicDetail(detail, body.pagePath, visitor.id) });
    return;
  }
  const crossReferenceTargets = new Set();
  await runDbTransaction(dbPath, async () => {
    const crossReferences = await reconcileIssueCrossReferences(dbPath, { sourceIssueId: issueId, sourceType: "comment", sourceId: commentId, actorId: visitor.id, markdown: "" });
    crossReferences.removedTargetIssueIds.forEach((targetId) => crossReferenceTargets.add(targetId));
    await deleteIssueComment(dbPath, commentId, visitor.id);
  });
  crossReferenceTargets.forEach((targetId) => publishIssueChanged(options, body.pagePath, targetId, "cross-reference:removed"));
  const detail = await getIssueDetail(dbPath, issueId);
  sendJson(res, 200, { success: true, data: devIssuePublicDetail(detail, body.pagePath, visitor.id) });
}

const ISSUE_ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024;
const ISSUE_ATTACHMENT_DRAFT_TTL_MS = 24 * 60 * 60 * 1000;
const INLINE_ISSUE_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

async function handleIssueAttachmentUpload(req, res, options) {
  if (req.method !== "POST") {
    sendJson(res, 405, { success: false, error: "Method not allowed" });
    return;
  }
  const visitor = getDevVisitor(options.devContext);
  if (!visitor.id) {
    sendJson(res, 401, { success: false, error: "Authentication required" });
    return;
  }
  const request = new Request("http://127.0.0.1/api/issues/attachments", {
    method: "POST",
    headers: headersFromIncoming(req),
    body: Readable.toWeb(req),
    duplex: "half",
  });
  const form = await request.formData();
  const file = form.get("file");
  const pagePath = form.get("pagePath");
  const draftId = form.get("draftId");
  if (!isValidIssuePagePath(pagePath) || typeof draftId !== "string" || !draftId || !file || typeof file === "string") {
    sendJson(res, 400, { success: false, error: "file, pagePath, and draftId are required" });
    return;
  }
  if (rejectForeignIssuePagePath(res, pagePath, options)) return;
  const bytes = Buffer.from(await file.arrayBuffer());
  if (bytes.length === 0) {
    sendJson(res, 400, { success: false, error: "Attachment is empty" });
    return;
  }
  if (bytes.length > ISSUE_ATTACHMENT_MAX_BYTES) {
    sendJson(res, 413, { success: false, error: "Attachment exceeds 25 MiB limit" });
    return;
  }
  const id = crypto.randomUUID();
  const attachmentDir = path.join(options.dataDir, "issues", "attachments");
  fs.mkdirSync(attachmentDir, { recursive: true });
  const dbPath = getDevDbPath(options.dataDir);
  const expired = await listExpiredUnboundIssueAttachments(
    dbPath,
    new Date(Date.now() - ISSUE_ATTACHMENT_DRAFT_TTL_MS).toISOString(),
  );
  for (const draft of expired) {
    try {
      fs.rmSync(path.join(attachmentDir, draft.storage_key), { force: true });
      await deleteIssueAttachmentMetadata(dbPath, draft.id);
    } catch {
      // A later upload retries cleanup without blocking local development.
    }
  }
  const attachmentPath = path.join(attachmentDir, id);
  fs.writeFileSync(attachmentPath, bytes);
  let attachment;
  try {
    attachment = await runDbTransaction(dbPath, () => insertIssueAttachment(dbPath, {
      id,
      pagePath,
      draftId,
      uploaderId: visitor.id,
      storageKey: id,
      fileName: sanitizeFilename(file.name || "attachment.bin"),
      mimeType: file.type || "application/octet-stream",
      sizeBytes: bytes.length,
    }));
  } catch (error) {
    fs.rmSync(attachmentPath, { force: true });
    if (typeof error === "object" && error !== null && error.name === "IssueAttachmentDraftLimitError") {
      sendJson(res, 409, {
        success: false,
        code: "attachment_limit_exceeded",
        error: "每个草稿最多添加 20 个附件",
      });
      return;
    }
    throw error;
  }
  sendJson(res, 201, { success: true, data: issueAttachmentPublicData(attachment, pagePath) });
}

async function handleIssueAttachmentRead(req, res, options, url, attachmentId) {
  const pagePath = url.searchParams.get("pagePath") ?? undefined;
  if (!isValidIssuePagePath(pagePath)) {
    sendJson(res, 400, { success: false, error: "Valid pagePath query parameter is required" });
    return;
  }
  if (rejectForeignIssuePagePath(res, pagePath, options)) return;
  if (req.method === "DELETE") {
    const draftId = url.searchParams.get("draftId") ?? undefined;
    if (!draftId) {
      sendJson(res, 400, { success: false, error: "draftId query parameter is required" });
      return;
    }
    const visitor = getDevVisitor(options.devContext);
    const attachment = await releaseUnboundIssueAttachment(getDevDbPath(options.dataDir), {
      attachmentId,
      pagePath,
      draftId,
      uploaderId: visitor.id,
    });
    if (!attachment) {
      sendJson(res, 404, { success: false, error: "Attachment not found" });
      return;
    }
    try {
      fs.rmSync(path.join(options.dataDir, "issues", "attachments", attachment.storage_key), { force: true });
    } catch {
      await restoreReleasedIssueAttachment(getDevDbPath(options.dataDir), {
        attachmentId: attachment.id,
        pagePath,
        draftId,
        uploaderId: visitor.id,
        releaseDeletedAt: attachment.deleted_at,
      });
      sendJson(res, 503, { success: false, error: "Attachment cleanup temporarily unavailable" });
      return;
    }
    sendJson(res, 200, { success: true });
    return;
  }
  if (req.method !== "GET") {
    sendJson(res, 405, { success: false, error: "Method not allowed" });
    return;
  }
  const attachment = await getIssueAttachment(getDevDbPath(options.dataDir), attachmentId);
  const visitor = getDevVisitor(options.devContext);
  if (!attachment || attachment.page_path !== pagePath || (attachment.issue_id === null && attachment.uploader_id !== visitor.id)) {
    sendJson(res, 404, { success: false, error: "Attachment not found" });
    return;
  }
  const filePath = path.join(options.dataDir, "issues", "attachments", attachment.storage_key);
  if (!fs.existsSync(filePath)) {
    sendJson(res, 404, { success: false, error: "Attachment not found" });
    return;
  }
  const inline = INLINE_ISSUE_IMAGE_TYPES.has(attachment.mime_type);
  res.writeHead(200, {
    "content-type": attachment.mime_type || "application/octet-stream",
    "content-length": String(attachment.size_bytes),
    "content-disposition": `${inline ? "inline" : "attachment"}; filename="${sanitizeFilename(attachment.file_name)}"`,
    "x-content-type-options": "nosniff",
  });
  fs.createReadStream(filePath).pipe(res);
}

function issueAttachmentPublicData(attachment, pagePath) {
  const { storage_key: _storageKey, ...publicAttachment } = attachment;
  return {
    ...publicAttachment,
    url: `/api/issues/attachments/${attachment.id}?pagePath=${encodeURIComponent(pagePath)}`,
  };
}

function devIssuePublicDetail(detail, pagePath, viewerId) {
  const viewerSubscribed = Boolean(viewerId && detail.collaboration.subscriber_ids.includes(viewerId));
  return {
    ...detail,
    timeline: detail.timeline.filter((item) => item.kind !== "event" || !["subscribed", "unsubscribed"].includes(item.event.event_type) || item.event.actor_id === viewerId),
    collaboration: {
      ...detail.collaboration,
      subscriber_ids: viewerSubscribed && viewerId ? [viewerId] : [],
    },
    attachments: detail.attachments.map((attachment) => issueAttachmentPublicData(attachment, pagePath)),
  };
}

function readManifestCollaboration(projectDir) {
  try {
    const manifestPath = path.join(projectDir, "manifest.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    return isObject(manifest.collaboration) ? manifest.collaboration : undefined;
  } catch {
    return undefined;
  }
}

function ensureCollaborationTables(dbPath) {
  execRawSql(dbPath, `
    CREATE TABLE IF NOT EXISTS _localapp_record_revisions (
      app_owner TEXT NOT NULL,
      app_name TEXT NOT NULL,
      resource TEXT NOT NULL,
      record_id TEXT NOT NULL,
      revision INTEGER NOT NULL DEFAULT 0,
      updated_by TEXT,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (app_owner, app_name, resource, record_id)
    )
  `);
  execRawSql(dbPath, `
    CREATE TABLE IF NOT EXISTS _localapp_operation_log (
      id TEXT PRIMARY KEY,
      app_owner TEXT NOT NULL,
      app_name TEXT NOT NULL,
      resource TEXT NOT NULL,
      record_id TEXT NOT NULL,
      actor_id TEXT,
      operation_id TEXT NOT NULL,
      operation_kind TEXT,
      base_revision INTEGER NOT NULL,
      next_revision INTEGER NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `);
}

function readRecordRevision(dbPath, ownerId, pageName, resource, recordId) {
  const rows = execRawSql(
    dbPath,
    "SELECT revision FROM _localapp_record_revisions WHERE app_owner = ? AND app_name = ? AND resource = ? AND record_id = ?",
    [ownerId, pageName, resource, recordId],
  ).rows ?? [];
  const value = rows[0]?.revision;
  return typeof value === "number" ? value : 0;
}

function publishCollaborationCommitted(options, event) {
  for (const client of options.collaborationSseClients ?? []) {
    if (client.resource && client.resource !== event.data.resource) continue;
    client.res.write("event: collab:operation_committed\n");
    client.res.write(`data: ${JSON.stringify(event)}\n\n`);
  }
}

function publishIssueChanged(options, pagePath, issueId, kind) {
  const event = { type: "issue:changed", data: { pagePath, issueId, kind, updatedAt: new Date().toISOString() } };
  for (const client of options.issueSseClients ?? []) {
    if (client.pagePath !== pagePath) continue;
    client.res.write("event: issue:changed\n");
    client.res.write(`data: ${JSON.stringify(event)}\n\n`);
  }
}

function handleIssueEvents(req, res, options, url) {
  const pagePath = url.searchParams.get("pagePath") ?? "";
  if (!isValidIssuePagePath(pagePath)) {
    sendJson(res, 400, { success: false, error: "Valid pagePath query parameter is required" });
    return;
  }
  if (rejectForeignIssuePagePath(res, pagePath, options)) return;
  const client = { pagePath, res };
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
  });
  res.write(": connected\n\n");
  options.issueSseClients.add(client);
  req.on("close", () => options.issueSseClients.delete(client));
}

function handleCollaborationEvents(req, res, options, url) {
  const projectDir = options.projectDir ?? process.cwd();
  const collaboration = readManifestCollaboration(projectDir);
  if (!collaboration?.enabled) {
    sendJson(res, 404, { success: false, error: "Collaboration is not enabled" });
    return;
  }
  const client = {
    resource: url.searchParams.get("resource") || null,
    res,
  };
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
  });
  res.write(": connected\n\n");
  options.collaborationSseClients.add(client);
  req.on("close", () => {
    options.collaborationSseClients.delete(client);
  });
}

const PRESENCE_LEASE_TTL_MS = 120_000;

function normalizePresenceClientId(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(value) ? value : null;
}

function resolvePresenceLease(options, clientId) {
  const visitor = getDevVisitor(options.devContext);
  const visitorKey = visitor.id ? `user:${visitor.id}` : `anon:${clientId}`;
  return { key: `${visitorKey}:${clientId}`, visitorKey, visitor, expiresAt: Date.now() + PRESENCE_LEASE_TTL_MS };
}

function pruneExpiredPresenceLeases(options) {
  const now = Date.now();
  for (const [key, lease] of options.presenceLeases ?? []) {
    if (lease.expiresAt <= now) options.presenceLeases.delete(key);
  }
}

function publishPresenceSnapshot(options) {
  pruneExpiredPresenceLeases(options);
  const authenticatedUsers = new Map();
  const anonymousKeys = new Set();
  for (const presence of (options.presenceLeases ?? new Map()).values()) {
    if (presence.visitor?.id) authenticatedUsers.set(presence.visitor.id, {
      id: presence.visitor.id,
      name: presence.visitor.name || presence.visitor.id,
      displayName: presence.visitor.displayName || null,
      avatarUrl: null,
    });
    else anonymousKeys.add(presence.visitorKey);
  }
  const pageName = getConfiguredDevPageName(options);
  const event = {
    type: "presence:snapshot",
    data: {
      appOwner: "__localapp_dev_page_owner__",
      appName: pageName,
      count: authenticatedUsers.size + anonymousKeys.size,
      anonymousCount: anonymousKeys.size,
      authenticatedUsers: [...authenticatedUsers.values()],
    },
  };
  for (const client of options.presenceSseClients ?? []) {
    client.res.write("event: presence:snapshot\n");
    client.res.write(`data: ${JSON.stringify(event)}\n\n`);
  }
}

async function handlePresenceLeaseMutation(req, res, options, leave) {
  let body;
  try {
    body = await readJsonBody(req);
  } catch (error) {
    sendJson(res, 400, { success: false, error: error?.message ?? "Invalid JSON body" });
    return;
  }
  const clientId = normalizePresenceClientId(body?.clientId);
  if (!clientId) {
    sendJson(res, 400, { success: false, error: "clientId is required" });
    return;
  }
  const lease = resolvePresenceLease(options, clientId);
  if (leave) options.presenceLeases.delete(lease.key);
  else options.presenceLeases.set(lease.key, lease);
  publishPresenceSnapshot(options);
  sendJson(res, 200, { success: true });
}

function handlePresenceEvents(req, res, options, url) {
  const clientId = normalizePresenceClientId(url.searchParams.get("clientId")) || crypto.randomUUID();
  const lease = resolvePresenceLease(options, clientId);
  options.presenceLeases.set(lease.key, lease);
  const client = {
    res,
  };
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
  });
  options.presenceSseClients.add(client);
  publishPresenceSnapshot(options);
  req.on("close", () => {
    options.presenceSseClients.delete(client);
    publishPresenceSnapshot(options);
  });
}

async function handleCollaborationCommit(req, res, options) {
  let body;
  try {
    body = await readJsonBody(req);
  } catch (error) {
    sendJson(res, 400, { success: false, error: error?.message ?? "Invalid JSON body" });
    return;
  }
  if (!isObject(body)) {
    sendJson(res, 400, { success: false, error: "Collaboration commit body must be an object" });
    return;
  }
  if ("sql" in body) {
    sendJson(res, 400, { success: false, error: "Client SQL is not allowed in collaboration commits" });
    return;
  }

  const resource = typeof body.resource === "string" ? body.resource : "";
  const recordId = typeof body.recordId === "string" ? body.recordId : "";
  const baseRevision = typeof body.baseRevision === "number" ? body.baseRevision : NaN;
  const params = isObject(body.params) ? body.params : undefined;
  if (!resource || !recordId || !Number.isInteger(baseRevision) || baseRevision < 0 || !params) {
    sendJson(res, 400, { success: false, error: "Collaboration commit requires resource, recordId, baseRevision and params" });
    return;
  }

  const projectDir = options.projectDir ?? process.cwd();
  const collaboration = readManifestCollaboration(projectDir);
  const collaborationResource = collaboration?.enabled ? collaboration.resources?.[resource] : undefined;
  if (!collaborationResource) {
    sendJson(res, 403, { success: false, error: `Collaboration resource is not declared: ${resource}` });
    return;
  }

  const backendConfig = readManifestBackendConfig(projectDir);
  const contract = backendConfig
    ? loadBackendContract(projectDir, backendConfig)
    : loadDefaultBackendContract(projectDir);
  if (!contract.mutations[collaborationResource.mutation]) {
    sendJson(res, 400, { success: false, error: `Collaboration mutation is not declared in backend contract: ${collaborationResource.mutation}` });
    return;
  }

  const visitor = getDevVisitor(options.devContext);
  const ownerId = options.devContext.pageOwnerId;
  const pageName = options.devContext.pageName || getConfiguredDevPageName(options) || "App";
  const dbPath = getDevDbPath(options.dataDir);
  const operationId = typeof body.operationId === "string" && body.operationId.trim()
    ? body.operationId
    : crypto.randomUUID();
  const operationKind = typeof body.operationKind === "string" ? body.operationKind : "save";
  const now = resolveDevNow(options.devContext);

  try {
    const result = await runDbTransaction(dbPath, async () => {
      ensureCollaborationTables(dbPath);
      const currentRevision = readRecordRevision(dbPath, ownerId, pageName, resource, recordId);
      if (currentRevision !== baseRevision) {
        const conflict = new Error("revision_conflict");
        conflict.code = "revision_conflict";
        conflict.serverRevision = currentRevision;
        throw conflict;
      }

      const mutationResult = await executeNamedSql(contract, {
        kind: "mutation",
        name: collaborationResource.mutation,
        dbPath: options.dataDir,
        body: { params },
        context: {
          visitorId: visitor.id,
          ownerId,
          now: new Date(now),
        },
        queue: { bypass: true },
      });

      const nextRevision = currentRevision + 1;
      execRawSql(
        dbPath,
        `INSERT INTO _localapp_record_revisions
          (app_owner, app_name, resource, record_id, revision, updated_by, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(app_owner, app_name, resource, record_id)
         DO UPDATE SET revision = excluded.revision, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
        [ownerId, pageName, resource, recordId, nextRevision, visitor.id, now],
      );
      execRawSql(
        dbPath,
        `INSERT INTO _localapp_operation_log
          (id, app_owner, app_name, resource, record_id, actor_id, operation_id, operation_kind, base_revision, next_revision, payload_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [crypto.randomUUID(), ownerId, pageName, resource, recordId, visitor.id, operationId, operationKind, baseRevision, nextRevision, JSON.stringify({ params }), now],
      );
      return { revision: nextRevision, operationId, mutation: mutationResult };
    });

    publishCollaborationCommitted(options, {
      type: "collab:operation_committed",
      data: {
        appOwner: ownerId,
        appName: pageName,
        resource,
        recordId,
        revision: result.revision,
        actorId: visitor.id,
        operationId,
        patch: params,
      },
    });
    sendJson(res, 200, { success: true, data: result });
  } catch (error) {
    if (error?.code === "revision_conflict") {
      sendJson(res, 409, {
        success: false,
        code: "revision_conflict",
        error: "Revision conflict",
        data: { serverRevision: error.serverRevision },
      });
      return;
    }
    const message = error?.message ?? "Collaboration commit failed";
    if (error instanceof LocalAppRuntimeError) {
      sendJson(res, error.status, { success: false, error: message, code: error.code });
      return;
    }
    if (/access denied/i.test(message)) {
      sendJson(res, visitor.id ? 403 : 401, { success: false, error: visitor.id ? message : "Authentication required" });
      return;
    }
    sendJson(res, 400, { success: false, error: message });
  }
}

function handleMeRequest(res, options) {
  const visitor = getDevVisitor(options.devContext);
  if (visitor.id === null) {
    sendJson(res, 200, { success: true, data: null });
    return;
  }
  sendJson(res, 200, {
    success: true,
    data: { id: visitor.id, name: visitor.name, role: visitor.role },
  });
}

async function handleDevContextRequest(req, res, options) {
  if (req.method === "GET") {
    sendJson(res, 200, { success: true, data: cloneDevContext(options.devContext) });
    return;
  }

  if (req.method === "PUT") {
    const body = await readJsonBody(req);
    const next = await updateDevContext(options, body);
    if (!next.ok) {
      sendJson(res, 400, { success: false, error: next.error });
      return;
    }
    Object.assign(options.devContext, next.data);
    sendJson(res, 200, { success: true, data: cloneDevContext(options.devContext) });
    return;
  }

  sendJson(res, 405, { success: false, error: "Method not allowed" });
}

async function handleDevUsersRequest(req, res, options, url) {
  if (req.method !== "GET") {
    sendJson(res, 405, { success: false, error: "Method not allowed" });
    return;
  }

  const search = url.searchParams.get("search") ?? "";
  const platform = await getPlatformUsers(options);
  const availableUsers = getAvailableDevUsers(options, platform.users);
  const users = filterUsers(availableUsers, search);
  const ownUser = getConfiguredDevUser(options, availableUsers);
  sendJson(res, 200, {
    success: true,
    data: {
      currentUser: contextUserToBasic(options.devContext.user),
      ownUser,
      recentUsers: options.devContext.recentUsers ?? [],
      users,
      source: platform.source,
      error: platform.error ?? null,
    },
  });
}

async function handleDevUsersApiRequest(res, options) {
  const platform = await getPlatformUsers(options);
  const users = getAvailableDevUsers(options, platform.users);
  sendJson(res, 200, { success: true, data: users });
}

async function handleDevDataRequest(req, res, options, url) {
  if (req.method === "POST" && url.pathname === "/api/dev/data/reset") {
    await resetDevDatabase(options);
    sendJson(res, 200, { success: true, data: { reset: true } });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/dev/data/snapshots") {
    const snapshot = await saveDevSnapshot(options);
    sendJson(res, 201, { success: true, data: snapshot });
    return;
  }

  const restoreMatch = url.pathname.match(/^\/api\/dev\/data\/snapshots\/([^/]+)\/restore$/);
  if (req.method === "POST" && restoreMatch) {
    const id = restoreMatch[1];
    await restoreDevSnapshot(options, id);
    sendJson(res, 200, { success: true, data: { restored: true, id } });
    return;
  }

  sendJson(res, 404, { success: false, error: "Not found" });
}

async function handleDevDiagnosticsRequest(req, res, options) {
  if (req.method !== "GET") {
    sendJson(res, 405, { success: false, error: "Method not allowed" });
    return;
  }
  sendJson(res, 200, { success: true, data: options.requestLog.slice().reverse() });
}

async function handleDevBusinessRequest(req, res, options) {
  if (req.method !== "GET") {
    sendJson(res, 405, { success: false, error: "Method not allowed" });
    return;
  }
  sendJson(res, 200, { success: true, data: readManifestBusiness(options.projectDir ?? process.cwd()) });
}

// 注：handleCrudRequest / handleCrudCountRequest / handleTransitionRequest
// 三个原 REST CRUD/transition 处理函数已随 restrict-app-api-to-named-sql 变更
// 整体移除。应用层数据操作现由 named SQL 唯一承担，对应路径在
// matchAppApiRoute 中返回 not-found，统一在 handleAppApiRequest 兜底 404。

async function handlePlatformRequest(req, res, options, url) {
  if (req.method !== "GET") {
    sendJson(res, 405, { success: false, error: "Platform data is read-only" });
    return;
  }

  if (url.pathname === "/api/platform/capabilities") {
    sendJson(res, 200, { success: true, data: PLATFORM_CAPABILITIES });
    return;
  }

  if (isLocalPlatformMode(options)) {
    sendPlatformFallback(res, options, url, null, "mock");
    return;
  }

  const cacheKey = `${req.method}:${url.pathname}${url.search}`;
  const cached = options.platformCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    sendCachedResponse(res, cached);
    return;
  }

  const upstreamUrl = new URL(`${url.pathname}${url.search}`, options.prodServer);
  const headers = headersFromIncoming(req);
  headers.set("X-API-Key", options.apiKey);
  headers.delete("host");

  let upstream;
  try {
    upstream = await fetch(upstreamUrl, {
      method: req.method,
      headers,
    });
  } catch (error) {
    sendPlatformFallback(res, options, url, error);
    return;
  }
  const body = Buffer.from(await upstream.arrayBuffer());
  const contentType = upstream.headers.get("content-type") ?? "application/json; charset=utf-8";

  if (upstream.ok) {
    options.platformCache.set(cacheKey, {
      status: upstream.status,
      contentType,
      body,
      expiresAt: Date.now() + PLATFORM_CACHE_TTL_MS,
    });
  }

  res.writeHead(upstream.status, { "content-type": contentType });
  res.end(body);
}

function isLocalPlatformMode(options) {
  return !String(options.apiKey ?? "").trim();
}

function sendPlatformFallback(res, options, url, error, source = "cache") {
  const errorMessage = error
    ? `Platform proxy failed: ${error?.message ?? "upstream unavailable"}`
    : null;

  if (url.pathname === "/api/platform/users") {
    const body = {
      success: true,
      data: listDevUsers(options.devContext),
      source,
    };
    if (errorMessage) body.error = errorMessage;
    sendJson(res, 200, body);
    return;
  }

  const userMatch = url.pathname.match(/^\/api\/platform\/users\/([^/]+)$/);
  if (userMatch) {
    const user = listDevUsers(options.devContext).find((item) => item.id === decodeURIComponent(userMatch[1]));
    if (!user) {
      sendJson(res, 404, { success: false, error: "User not found", source });
      return;
    }
    const body = { success: true, data: user, source };
    if (errorMessage) body.error = errorMessage;
    sendJson(res, 200, body);
    return;
  }

  if (url.pathname === "/api/platform/groups") {
    const body = { success: true, data: listDevPlatformGroups(options.devContext), source };
    if (errorMessage) body.error = errorMessage;
    sendJson(res, 200, body);
    return;
  }

  const groupMatch = url.pathname.match(/^\/api\/platform\/groups\/([^/]+)$/);
  if (groupMatch) {
    const group = listDevGroups(options.devContext).find((item) => item.id === decodeURIComponent(groupMatch[1]));
    if (!group) {
      sendJson(res, 404, { success: false, error: "Group not found", source });
      return;
    }
    const body = { success: true, data: group, source };
    if (errorMessage) body.error = errorMessage;
    sendJson(res, 200, body);
    return;
  }

  if (url.pathname === "/api/platform/roles") {
    const body = { success: true, data: listDevRoles(), source };
    if (errorMessage) body.error = errorMessage;
    sendJson(res, 200, body);
    return;
  }

  if (url.pathname === "/api/platform/version") {
    const body = { success: true, data: { version: "local-dev" }, source };
    if (errorMessage) body.error = errorMessage;
    sendJson(res, 200, body);
    return;
  }
  sendJson(res, 502, {
    success: false,
    error: errorMessage ?? "Platform data is unavailable in local dev",
  });
}

// 注：handleDbExecRequest 已随 /api/db/exec 端点整体移除（restrict-app-api-to-named-sql
// 变更）。原 raw SQL dev 入口不再可用，应用必须声明 named SQL。

async function handleNamedSqlRequest(req, res, options, route) {
  let body;
  try {
    body = await readJsonBody(req);
  } catch (error) {
    sendJson(res, 400, { success: false, error: error?.message ?? "Invalid JSON body" });
    return;
  }

  const visitor = getDevVisitor(options.devContext);
  try {
    const projectDir = options.projectDir ?? process.cwd();
    const backendConfig = readManifestBackendConfig(projectDir);
    const contract = backendConfig
      ? loadBackendContract(projectDir, backendConfig)
      : loadDefaultBackendContract(projectDir);
    const runtime = createAppNamedSqlRuntime({
      contract,
      dbPath: options.dataDir,
      context: () => ({
        visitorId: visitor.id,
        ownerId: options.devContext.pageOwnerId,
        now: new Date(resolveDevNow(options.devContext)),
      }),
    });
    const result = await runtime.execute(route, body);
    sendJson(res, 200, { success: true, data: result });
  } catch (error) {
    const response = classifyAppRuntimeError(error, visitor.id !== null);
    sendJson(res, response.status, response.body);
  }
}

async function handleNamedSqlTransactionRequest(req, res, options) {
  let body;
  try {
    body = await readJsonBody(req);
  } catch (error) {
    sendJson(res, 400, { success: false, error: error?.message ?? "Invalid JSON body" });
    return;
  }

  const visitor = getDevVisitor(options.devContext);
  try {
    const projectDir = options.projectDir ?? process.cwd();
    const backendConfig = readManifestBackendConfig(projectDir);
    const contract = backendConfig
      ? loadBackendContract(projectDir, backendConfig)
      : loadDefaultBackendContract(projectDir);
    const runtime = createAppNamedSqlRuntime({
      contract,
      dbPath: options.dataDir,
      context: () => ({
        visitorId: visitor.id,
        ownerId: options.devContext.pageOwnerId,
        now: new Date(resolveDevNow(options.devContext)),
      }),
    });
    const result = await runtime.execute(
      { kind: "named-mutation-transaction" },
      body,
    );
    sendJson(res, 200, { success: true, data: result });
  } catch (error) {
    const response = classifyAppRuntimeError(error, visitor.id !== null);
    sendJson(res, response.status, response.body);
  }
}

async function handleActionRequest(_req, res) {
  sendJson(res, 410, {
    success: false,
    error: "Hosted backend actions are disabled. Use named SQL, transaction mutation, or a platform primitive instead.",
    code: "hosted_actions_disabled",
  });
}

async function handleUploadRequest(req, res, options) {
  const request = new Request("http://127.0.0.1/api/content/upload", {
    method: "POST",
    headers: headersFromIncoming(req),
    body: Readable.toWeb(req),
    duplex: "half",
  });
  const formData = await request.formData();
  const file = formData.get("file");

  if (!file || typeof file === "string") {
    sendJson(res, 400, { success: false, error: "No file provided" });
    return;
  }

  const filename = file.name || "upload.bin";
  const bytes = Buffer.from(await file.arrayBuffer());
  const validation = validateContentUpload({
    filename,
    declaredMimeType: file.type,
    bytes,
  });
  if (!validation.ok) {
    sendJson(res, validation.status, {
      success: false,
      error: validation.message,
      code: validation.code,
    });
    return;
  }

  const storedName = `${Date.now()}-${crypto.randomUUID()}.${validation.extension}`;
  const uploadDir = path.join(options.dataDir, "dev-uploads");
  fs.mkdirSync(uploadDir, { recursive: true });
  fs.writeFileSync(path.join(uploadDir, storedName), bytes);

  sendJson(res, 201, {
    success: true,
    data: {
      key: storedName,
      url: `/api/content/${encodeURIComponent(storedName)}`,
    },
  });
}

async function handleContentReadRequest(req, res, options, key) {
  if (!/^[a-zA-Z0-9._-]+$/.test(key)) {
    sendJson(res, 400, { success: false, error: "Invalid content key" });
    return;
  }

  const uploadDir = path.resolve(options.dataDir, "dev-uploads");
  const filePath = path.resolve(uploadDir, key);
  if (!filePath.startsWith(uploadDir + path.sep)) {
    sendJson(res, 400, { success: false, error: "Invalid content key" });
    return;
  }
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    sendJson(res, 404, { success: false, error: "Content not found" });
    return;
  }

  const bytes = fs.readFileSync(filePath);
  const response = buildContentReadResponse({
    filename: key,
    size: bytes.length,
    rangeHeader: typeof req.headers.range === "string" ? req.headers.range : undefined,
  });
  if (response.status === 416) {
    res.writeHead(416, response.headers);
    res.end();
    return;
  }
  const body = response.start === null || response.end === null
    ? bytes
    : bytes.subarray(response.start, response.end + 1);
  res.writeHead(response.status, response.headers);
  res.end(body);
}

// 注：inferSchema / readBusinessConfig / applyBusinessFieldConstraints /
// toDataSchema 四个原 REST CRUD schema 推断辅助函数已随 REST CRUD 整体移除。
// 应用层数据 schema 由 SQL migration + backend/resources/<r>/schema.json 表达，
// 服务端不再从 manifest.business 推断字段约束下沉到 REST 中间件。

function readManifestBusiness(projectDir) {
  try {
    const manifestPath = path.join(projectDir, "manifest.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    return isObject(manifest.business) ? manifest.business : {};
  } catch {
    return {};
  }
}

function readManifestBackendConfig(projectDir) {
  try {
    const manifestPath = path.join(projectDir, "manifest.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    const backend = manifest.backend;
    if (!isObject(backend)) return undefined;
    return {
      root: typeof backend.root === "string" ? backend.root : undefined,
      include: Array.isArray(backend.include) ? backend.include.filter((entry) => typeof entry === "string") : undefined,
    };
  } catch {
    return undefined;
  }
}

function readManifestDbConfig(projectDir) {
  try {
    const manifestPath = path.join(projectDir, "manifest.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    const db = manifest.db;
    if (!isObject(db)) return { mode: "crud", sqlAccess: "authenticated" };
    return {
      mode: typeof db.mode === "string" ? db.mode : "crud",
      sqlAccess: typeof db.sqlAccess === "string" ? db.sqlAccess : "authenticated",
    };
  } catch {
    return { mode: "crud", sqlAccess: "authenticated" };
  }
}

function cloneDevContext(context) {
  return {
    user: context.user === null ? null : { ...context.user },
    timeMode: context.timeMode ?? "real",
    now: context.now ?? null,
    pageName: context.pageName ?? "",
    pageOwnerId: context.pageOwnerId ?? null,
    recentUsers: Array.isArray(context.recentUsers) ? context.recentUsers.map((user) => ({ ...user })) : [],
  };
}

async function updateDevContext(options, body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "Invalid dev context payload" };
  }

  const next = cloneDevContext(options.devContext);

  if ("user" in body) {
    if (body.user === null) {
      next.user = null;
    } else if (isObject(body.user) && typeof body.user.id === "string" && body.user.id.trim()) {
      const platform = await getPlatformUsers(options);
      const platformUser = platform.users.find((user) => user.id === body.user.id);
      if (platform.source === "platform" && !platformUser && body.user.id !== options.devContext.pageOwnerId) {
        return { ok: false, error: "Dev context user must be a platform user" };
      }
      const displayName = platformUser?.displayName ?? body.user.name ?? body.user.id;
      next.user = {
        id: body.user.id,
        name: typeof displayName === "string" && displayName.trim() ? displayName : body.user.id,
        role: typeof body.user.role === "string" && body.user.role.trim() ? body.user.role : "user",
        displayName: platformUser?.displayName ?? undefined,
        avatarUrl: platformUser?.avatarUrl ?? undefined,
      };
      next.recentUsers = rememberRecentUser(next.recentUsers, {
        id: next.user.id,
        name: platformUser?.name ?? next.user.id,
        displayName: next.user.name,
        avatarUrl: platformUser?.avatarUrl ?? undefined,
        role: next.user.role,
      });
    } else {
      return { ok: false, error: "Invalid dev context user" };
    }
  }

  if ("timeMode" in body) {
    if (body.timeMode !== "real" && body.timeMode !== "fixed") {
      return { ok: false, error: "Invalid dev context timeMode" };
    }
    next.timeMode = body.timeMode;
    if (next.timeMode === "real") next.now = null;
  }

  if ("now" in body) {
    if (body.now === null) {
      next.now = null;
      if (!("timeMode" in body)) next.timeMode = "real";
    } else if (typeof body.now === "string" && !Number.isNaN(Date.parse(body.now))) {
      next.now = new Date(body.now).toISOString();
      if (!("timeMode" in body)) next.timeMode = "fixed";
    } else {
      return { ok: false, error: "Invalid dev context now" };
    }
  }

  if (next.timeMode === "fixed" && !next.now) {
    return { ok: false, error: "Fixed dev time requires now" };
  }

  return { ok: true, data: next };
}

function getDevVisitor(context) {
  if (context.user === null) return { id: null, name: null, role: null };
  return {
    id: context.user.id,
    name: context.user.name,
    role: context.user.role,
  };
}

function isDevPageOwner(options, visitor) {
  return Boolean(visitor?.id && (visitor.id === options.devContext?.pageOwnerId || visitor.role === "owner"));
}

function listDevUsers(context) {
  const ownerId = context.pageOwnerId;
  const owner = context.user?.id === ownerId
    ? contextUserToBasic(context.user)
    : ownerId
      ? { id: ownerId, name: ownerId, displayName: ownerId === "dev-user" ? "Dev User" : ownerId, avatarUrl: null, role: "owner" }
      : null;
  return dedupeUsers([
    owner,
    contextUserToBasic(context.user),
    ...(context.recentUsers ?? []),
  ]);
}

function getAvailableDevUsers(options, platformUsers) {
  return dedupeUsers([...listDevUsers(options.devContext), ...platformUsers]);
}

async function getPlatformUsers(options) {
  if (options.devUserState?.users) {
    return {
      users: options.devUserState.users,
      source: options.devUserState.source,
      error: options.devUserState.lastError,
    };
  }

  if (isLocalPlatformMode(options)) {
    if (options.devUserState) {
      options.devUserState.users = [];
      options.devUserState.source = "local";
      options.devUserState.lastError = null;
    }
    return { users: [], source: "local", error: null };
  }

  try {
    const upstreamUrl = new URL("/api/platform/users", options.prodServer);
    const headers = new Headers();
    headers.set("X-API-Key", options.apiKey ?? "");
    const response = await fetch(upstreamUrl, { headers });
    const body = await response.json();
    if (!response.ok || body?.success === false || !Array.isArray(body?.data)) {
      throw new Error(body?.error || `platform users request failed: ${response.status}`);
    }
    const users = dedupeUsers(body.data.map(normalizePlatformUser));
    if (options.devUserState) {
      options.devUserState.users = users;
      options.devUserState.source = "platform";
      options.devUserState.lastError = null;
    }
    return { users, source: "platform", error: null };
  } catch (error) {
    const message = error?.message ?? "platform users unavailable";
    if (options.devUserState) {
      options.devUserState.users = [];
      options.devUserState.source = "unavailable";
      options.devUserState.lastError = message;
    }
    return { users: [], source: "unavailable", error: message };
  }
}

function normalizePlatformUser(value) {
  if (!isObject(value) || typeof value.id !== "string" || !value.id.trim()) return null;
  const name = typeof value.name === "string" && value.name.trim() ? value.name : value.id;
  const displayName = typeof value.displayName === "string" && value.displayName.trim()
    ? value.displayName
    : name;
  const role = typeof value.role === "string" && value.role.trim() ? value.role : "user";
  const avatarUrl = typeof value.avatarUrl === "string" && value.avatarUrl.trim() ? value.avatarUrl : null;
  return { id: value.id, name, displayName, avatarUrl, role };
}

function contextUserToBasic(user) {
  if (!user?.id) return null;
  return {
    id: user.id,
    name: user.id,
    displayName: user.name ?? user.id,
    avatarUrl: user.avatarUrl ?? null,
    role: user.role ?? "user",
  };
}

function getConfiguredDevUser(options, users) {
  const userId = getConfiguredDevUserId(options);
  if (!userId) return null;
  return users.find((user) => user.id === userId) ?? null;
}

function getConfiguredDevPageName(options) {
  if (typeof options.devPageName === "string" && options.devPageName.trim()) {
    return options.devPageName.trim();
  }
  if (typeof options.projectDir !== "string" || !options.projectDir) return "";
  try {
    const configPath = path.join(options.projectDir, ".localapp", "dev-config.json");
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    if (typeof config.pageName === "string" && config.pageName.trim()) return config.pageName.trim();
  } catch {}
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(options.projectDir, "manifest.json"), "utf8"));
    return typeof manifest.name === "string" && manifest.name.trim() ? manifest.name.trim() : "";
  } catch {}
  return "";
}

function getConfiguredDevUserId(options) {
  if (typeof options.devUserId === "string" && options.devUserId.trim()) {
    return options.devUserId.trim();
  }
  if (typeof options.projectDir !== "string" || !options.projectDir) return null;
  try {
    const configPath = path.join(options.projectDir, ".localapp", "dev-config.json");
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    return typeof config.userId === "string" && config.userId.trim() ? config.userId.trim() : null;
  } catch {
    return null;
  }
}

function dedupeUsers(users) {
  const byId = new Map();
  for (const user of users) {
    if (!user?.id) continue;
    byId.set(user.id, user);
  }
  return [...byId.values()];
}

function filterUsers(users, search) {
  const needle = search.trim().toLowerCase();
  if (!needle) return users;
  return users.filter((user) =>
    [user.id, user.name, user.displayName].some((value) => String(value ?? "").toLowerCase().includes(needle)),
  );
}

function rememberRecentUser(recentUsers, user) {
  return dedupeUsers([user, ...(recentUsers ?? [])]).slice(0, 2);
}

function listDevGroups() {
  return [
    {
      id: "dev-team",
      name: "Dev Team",
      description: "Local development team",
      isCreator: true,
    },
  ];
}

function listDevPlatformGroups(context) {
  return listDevGroups(context).map((group) => ({
    id: group.id,
    name: group.name,
    description: group.description,
    memberCount: listDevUsers(context).length,
  }));
}

function listDevRoles() {
  return [
    { id: "admin", name: "Admin", permissions: ["*"] },
    { id: "user", name: "User", permissions: ["apps:read", "apps:create"] },
  ];
}

function handleDevGroupDetail(res, options, groupId) {
  const group = listDevGroups(options.devContext).find((item) => item.id === groupId);
  if (!group) {
    sendJson(res, 404, { success: false, error: "Group not found" });
    return;
  }
  sendJson(res, 200, {
    success: true,
    data: {
      ...group,
      members: listDevUsers(options.devContext),
    },
  });
}

function resolveDevNow(context) {
  if (context.timeMode === "fixed" && context.now) return context.now;
  return new Date().toISOString();
}

function buildServerTime(now) {
  return {
    now,
    today: now.slice(0, 10),
  };
}

function getDevDbPath(dataDir) {
  return path.join(dataDir, "dev.db");
}

async function prepareDevDatabase(options, { forceSeed = false } = {}) {
  const dbPath = getDevDbPath(options.dataDir);
  const existed = fs.existsSync(dbPath);
  await applyPendingMigrations({
    dbPath,
    migrationsDir: path.join(options.projectDir ?? process.cwd(), "migrations"),
  });
  closeAllConnections();
  if (forceSeed || !existed) {
    await applyDevSeed(options);
  }
}

async function resetDevDatabase(options) {
  closeAllConnections();
  const dbPath = getDevDbPath(options.dataDir);
  if (fs.existsSync(dbPath)) fs.rmSync(dbPath);
  fs.rmSync(path.join(options.dataDir, "issues", "attachments"), { recursive: true, force: true });
  await prepareDevDatabase(options, { forceSeed: true });
}

async function applyDevSeed(options) {
  const seedPath = path.join(options.projectDir ?? process.cwd(), "db", "seeds", "dev.sql");
  if (!fs.existsSync(seedPath)) return;
  const dbPath = getDevDbPath(options.dataDir);
  const db = await getConnection(dbPath);
  db.run(fs.readFileSync(seedPath, "utf8"));
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  fs.writeFileSync(dbPath, Buffer.from(db.export()));
}

async function saveDevSnapshot(options) {
  closeAllConnections();
  const dbPath = getDevDbPath(options.dataDir);
  if (!fs.existsSync(dbPath)) await prepareDevDatabase(options);
  const id = `snapshot-${new Date().toISOString().replace(/[:.]/g, "-")}-${crypto.randomUUID()}`;
  const snapshotPath = getDevSnapshotPath(options, id);
  fs.mkdirSync(path.dirname(snapshotPath), { recursive: true });
  fs.copyFileSync(dbPath, snapshotPath);
  const attachmentDir = path.join(options.dataDir, "issues", "attachments");
  const snapshotAttachmentDir = getDevSnapshotAttachmentPath(options, id);
  fs.rmSync(snapshotAttachmentDir, { recursive: true, force: true });
  if (fs.existsSync(attachmentDir)) fs.cpSync(attachmentDir, snapshotAttachmentDir, { recursive: true });
  return { id, createdAt: new Date().toISOString() };
}

async function restoreDevSnapshot(options, id) {
  if (!/^[a-zA-Z0-9._-]+$/.test(id)) {
    throw new Error("Invalid snapshot id");
  }
  closeAllConnections();
  const dbPath = getDevDbPath(options.dataDir);
  const snapshotPath = getDevSnapshotPath(options, id);
  if (!fs.existsSync(snapshotPath)) {
    throw new Error(`Snapshot '${id}' not found`);
  }
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  fs.copyFileSync(snapshotPath, dbPath);
  const attachmentDir = path.join(options.dataDir, "issues", "attachments");
  const snapshotAttachmentDir = getDevSnapshotAttachmentPath(options, id);
  fs.rmSync(attachmentDir, { recursive: true, force: true });
  if (fs.existsSync(snapshotAttachmentDir)) fs.cpSync(snapshotAttachmentDir, attachmentDir, { recursive: true });
}

function getDevSnapshotPath(options, id) {
  const root = path.resolve(options.dataDir);
  const snapshotDir = path.resolve(root, "dev-snapshots");
  const snapshotPath = path.resolve(snapshotDir, `${id}.db`);
  if (!snapshotPath.startsWith(snapshotDir + path.sep)) {
    throw new Error("Invalid snapshot path");
  }
  return snapshotPath;
}

function getDevSnapshotAttachmentPath(options, id) {
  const root = path.resolve(options.dataDir);
  const snapshotDir = path.resolve(root, "dev-snapshots");
  const snapshotPath = path.resolve(snapshotDir, `${id}.attachments`);
  if (!snapshotPath.startsWith(snapshotDir + path.sep)) {
    throw new Error("Invalid snapshot attachment path");
  }
  return snapshotPath;
}

function recordRequestDiagnostic(requestLog, req, status, durationMs) {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  if (url.pathname === "/api/dev/diagnostics/requests") return;
  requestLog.push({
    method: req.method ?? "GET",
    path: url.pathname,
    status,
    durationMs,
    body: req.__localappBodyPreview ?? null,
    at: new Date().toISOString(),
  });
  if (requestLog.length > REQUEST_LOG_LIMIT) {
    requestLog.splice(0, requestLog.length - REQUEST_LOG_LIMIT);
  }
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

// 注：applyDefaultFrom / validateEnum / quoteIdentifier 三个原 REST CRUD 专用
// 辅助函数已随 REST CRUD 整体移除。defaultFrom / enum 等字段约束现在由
// named SQL 的 SQL 语句直接表达（INSERT 列表、WHERE 子句、CHECK 约束等）。

function sendJson(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function sendCachedResponse(res, cached) {
  res.writeHead(cached.status, { "content-type": cached.contentType });
  res.end(cached.body);
}

function headersFromIncoming(req) {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) {
      for (const item of value) headers.append(key, item);
    } else if (value !== undefined) {
      headers.set(key, value);
    }
  }
  return headers;
}

function sanitizeFilename(filename) {
  return filename.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes = {
    ".txt": "text/plain; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
    ".webp": "image/webp",
    ".pdf": "application/pdf",
  };
  return mimeTypes[ext] ?? "application/octet-stream";
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (chunks.length === 0) {
    req.__localappBodyPreview = null;
    return {};
  }
  const text = Buffer.concat(chunks).toString("utf8");
  req.__localappBodyPreview = truncateBodyPreview(text);
  const parsed = JSON.parse(text);
  req.__localappParsedBody = parsed;
  return parsed;
}

function truncateBodyPreview(text) {
  if (text.length <= REQUEST_BODY_PREVIEW_LIMIT) return text;
  return `${text.slice(0, REQUEST_BODY_PREVIEW_LIMIT)}...`;
}

export async function startMiniServer(options) {
  await prepareDevDatabase(options);

  const server = createMiniServer(options);
  await new Promise((resolve) => {
    server.listen(options.port, "127.0.0.1", resolve);
  });
  return server;
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const server = await startMiniServer(options);

  const shutdown = createGracefulShutdown({
    server,
    flush: closeAllConnections,
    exit: (code) => {
      process.exitCode = code;
    },
  });

  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}

export function createGracefulShutdown({ server, flush, exit = process.exit }) {
  let shuttingDown = false;

  return () => {
    if (shuttingDown) return;
    shuttingDown = true;

    try {
      flush();
    } catch (error) {
      console.error(error);
      exit(1);
      return;
    }

    server.close((error) => {
      if (error) {
        console.error(error);
        exit(1);
        return;
      }
      exit(0);
    });
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
