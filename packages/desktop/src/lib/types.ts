export interface AccountState {
  id: string;
  displayName: string;
  serverUrl: string;
  connection: "connected" | "connecting" | "offline";
  unreadCount: number;
}

export interface InboxItem {
  id: string;
  appOwner: string;
  appName: string;
  title: string;
  body?: string;
  url?: string;
  priority?: "normal" | "high" | string;
  createdAt: string;
  read: boolean;
}

export interface InboxPage {
  items: InboxItem[];
  nextCursor?: string;
}

export interface Favorite {
  id: number;
  storedPagePath: string;
  appPath: string;
  pageName: string | null;
  ownerName: string | null;
  createdAt: string;
}

export interface DesktopSettings {
  launchAtLogin: boolean;
  notificationsEnabled: boolean;
  npmRegistry?: string;
  httpProxyConfigured?: boolean;
  httpsProxyConfigured?: boolean;
}

export interface DesktopSettingsUpdate {
  launchAtLogin?: boolean;
  notificationsEnabled?: boolean;
  npmRegistry?: string;
  httpProxy?: string;
  httpsProxy?: string;
  clearHttpProxy?: boolean;
  clearHttpsProxy?: boolean;
}

export interface DesktopUpdateInfo {
  available: boolean;
  version?: string | null;
  notes?: string | null;
}

export interface LocalApp {
  appId: string;
  currentVersion: string;
  installedVersions: string[];
  versionRoot: string;
  dataRoot: string;
  status: "ready" | "unavailable" | "error";
  error?: string | null;
}

export interface LocalRuntimeReady {
  host: string;
  port: number;
  pid: number;
}

export interface LocalRuntimeSnapshot {
  status: "stopped" | "starting" | "running" | "restarting" | "failed";
  ready?: LocalRuntimeReady | null;
  restartCount: number;
  error?: string | null;
  apps?: Array<{
    appId: string;
    status: LocalApp["status"];
    error?: string | null;
  }>;
}

export interface ServerProfileSummary {
  name: string;
  serverUrl: string;
  active: boolean;
  loggedIn: boolean;
}

export interface PublishResult {
  name: string;
  url: string;
  rawUrl: string;
  version: number;
  serverUrl: string;
  profile?: string | null;
}

export interface TrustKey {
  serverOrigin: string;
  appOwner: string;
  appName: string;
  publisherUserId: string;
}

export interface TrustedApp extends TrustKey {
  publisherDisplayName?: string | null;
  trustedAt: string;
}

export type ActionStatus =
  | "pending"
  | "claimed"
  | "awaiting_trust"
  | "preparing"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "expired"
  | "interrupted";

export interface ActionActivation {
  requestId: string;
  nonce: string;
}

export interface PendingAction {
  id: string;
  nonce: string;
  serverOrigin: string;
  appOwner: string;
  appName: string;
  appVersion: string | null;
  publisherUserId: string;
  publisherDisplayName: string | null;
  title: string;
  description: string | null;
  createdAt: string;
  expiresAt: string;
}

export interface ClaimedAction {
  id: string;
  serverOrigin: string;
  appOwner: string;
  appName: string;
  appVersion: string | null;
  publisherUserId: string;
  publisherDisplayName: string | null;
  title: string;
  description: string | null;
  script: string;
  dependencies: Record<string, string>;
  input: unknown;
  timeoutSeconds: number;
  status: ActionStatus;
}

export interface LocalTask extends ClaimedAction {
  workingDirectory: string;
  pinned: boolean;
  createdAt: number;
  updatedAt: number;
  startedAt?: number | null;
  completedAt?: number | null;
  result?: unknown;
  errorCode?: string | null;
  errorSummary?: string | null;
  stdout?: string | null;
  stderr?: string | null;
}

export interface TaskLogs {
  stdout: string;
  stderr: string;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
}

export interface TaskLogEvent {
  requestId: string;
  stream: "stdout" | "stderr";
  message: string;
  truncated: boolean;
}

// ── Studio（应用源码管理 + agent 工作台）──

export interface StudioProject {
  appId: string;
  name: string;
  sourcePath: string;
  createdAt: number;
  lastBuiltAt?: number | null;
  presentOnDisk: boolean;
}

export interface CreatedStudioProject {
  appId: string;
  sourcePath: string;
}

export interface StudioDirEntry {
  name: string;
  isDir: boolean;
  size?: number | null;
}

export interface BuildOutcome {
  appId: string;
  version: string;
  packagePath: string;
  sha256: string;
  size: number;
}

export interface InstallOutcome {
  appId: string;
  version: string;
  upgraded: boolean;
  openable: boolean;
}

export type AgentSessionStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "timedOut";

export interface AgentSession {
  id: string;
  appId: string;
  agentKind: string;
  status: AgentSessionStatus;
  startedAt: number;
  completedAt?: number | null;
  exitCode?: number | null;
  error?: string | null;
  stdoutPath: string;
  stderrPath?: string | null;
  opencodeSessionId?: string | null;
}

export interface StartedAgentSession {
  sessionId: string;
  appId: string;
  agentKind: string;
  status: AgentSessionStatus;
  stdoutPath: string;
  stderrPath: string;
  supportsContinuation: boolean;
}

export interface AvailableAgent {
  kind: string;
  binary: string;
  isDefault: boolean;
}

export interface AgentSessionLogs {
  sessionId: string;
  stdout: string;
  stderr: string;
}

export interface AgentLogEvent {
  sessionId: string;
  stream: "stdout" | "stderr";
  message: string;
  truncated: boolean;
}

export interface ActionSnapshot {
  id: string;
  status: ActionStatus;
}

export type LiveNotification = Omit<InboxItem, "read">;

export type DesktopEvent =
  | { type: "inbox:updated"; unreadCount: number }
  | { type: "connection:changed"; status: AccountState["connection"] }
  | { type: "notification:received"; notification: LiveNotification }
  | { type: "inbox:missed"; count: number }
  | { type: "task:updated"; task: LocalTask }
  | { type: "task:log"; log: TaskLogEvent }
  | { type: "agent:log"; log: AgentLogEvent }
  | { type: "agent:updated"; sessionId: string; appId: string; agentKind: string }
  | { type: "local-apps:changed" }
  | { type: "action:activation" };
