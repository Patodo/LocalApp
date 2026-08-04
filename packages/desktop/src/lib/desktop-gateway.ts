import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import type {
  AccountState,
  ActionActivation,
  DesktopEvent,
  DesktopSettings,
  DesktopSettingsUpdate,
  DesktopUpdateInfo,
  Favorite,
  InboxItem,
  InboxPage,
  LocalApp,
  LocalRuntimeSnapshot,
  PublishResult,
  ServerProfileSummary,
  LocalTask,
  PendingAction,
  TaskLogs,
  TaskLogEvent,
  TrustedApp,
  TrustKey,
} from "./types";

export interface DesktopGateway {
  getAccount(): Promise<AccountState>;
  listInbox(input?: { cursor?: string; unreadOnly?: boolean }): Promise<InboxPage>;
  getUnreadCount(): Promise<number>;
  markNotificationRead(notificationId: string): Promise<InboxItem>;
  deleteNotification(notificationId: string): Promise<void>;
  markAllRead(): Promise<number>;
  listFavorites(): Promise<Favorite[]>;
  removeFavorite(storedPagePath: string): Promise<void>;
  openApp(appPath: string): Promise<void>;
  getSettings(): Promise<DesktopSettings>;
  updateSettings(input: DesktopSettingsUpdate): Promise<DesktopSettings>;
  checkForUpdates(): Promise<DesktopUpdateInfo>;
  installUpdate(): Promise<void>;
  clearDependencyCache(): Promise<void>;
  logout(): Promise<void>;
  quitApp(): Promise<void>;
  listTrustedApps(): Promise<TrustedApp[]>;
  revokeAppTrust(key: TrustKey): Promise<void>;
  disconnectBus(): Promise<void>;
  reconnectBus(): Promise<void>;
  openExternal(url: string): Promise<void>;
  openNotification(notificationId: string | undefined, url: string): Promise<InboxItem | undefined>;
  takePendingActivations(): Promise<ActionActivation[]>;
  listPendingActions(): Promise<PendingAction[]>;
  listRecoverableActions(): Promise<LocalTask[]>;
  listLocalTasks(): Promise<LocalTask[]>;
  readLocalTaskLogs(requestId: string): Promise<TaskLogs>;
  claimAction(activation: ActionActivation): Promise<LocalTask>;
  trustAndRunTask(requestId: string): Promise<LocalTask>;
  rejectLocalTask(requestId: string): Promise<LocalTask>;
  cancelLocalTask(requestId: string): Promise<LocalTask>;
  setLocalTaskPinned(requestId: string, pinned: boolean): Promise<LocalTask>;
  listLocalApps(): Promise<LocalApp[]>;
  getLocalRuntimeStatus(): Promise<LocalRuntimeSnapshot>;
  installLocalApp(): Promise<void>;
  openLocalApp(appId: string): Promise<void>;
  uninstallLocalApp(appId: string): Promise<void>;
  deleteLocalApp(appId: string): Promise<void>;
  listServerProfiles(): Promise<ServerProfileSummary[]>;
  saveServerProfile(input: {
    name: string;
    serverUrl: string;
    apiKey: string;
  }): Promise<ServerProfileSummary[]>;
  removeServerProfile(name: string): Promise<ServerProfileSummary[]>;
  useServerProfile(name: string): Promise<void>;
  publishLocalApp(appId: string, profileName: string): Promise<PublishResult>;
  listen(handler: (event: DesktopEvent) => void): Promise<() => void>;
}

const browserGateway: DesktopGateway = {
  async getAccount() {
    return {
      id: "",
      displayName: "未登录",
      serverUrl: "",
      connection: "offline",
      unreadCount: 0,
    };
  },
  async listInbox() {
    return { items: [] };
  },
  async getUnreadCount() {
    return 0;
  },
  async markNotificationRead(notificationId) {
    return {
      id: notificationId,
      appOwner: "",
      appName: "",
      title: "",
      createdAt: "",
      read: true,
    };
  },
  async deleteNotification() {
    return undefined;
  },
  async markAllRead() {
    return 0;
  },
  async listFavorites() {
    return [];
  },
  async removeFavorite() {
    return undefined;
  },
  async openApp(appPath) {
    window.open(appPath, "_blank", "noopener,noreferrer");
  },
  async getSettings() {
    return { launchAtLogin: false, notificationsEnabled: true };
  },
  async updateSettings(input) {
    return {
      launchAtLogin: input.launchAtLogin ?? false,
      notificationsEnabled: input.notificationsEnabled ?? true,
    };
  },
  async checkForUpdates() {
    return { available: false };
  },
  async installUpdate() {
    throw new Error("Desktop updates require the LocalApp desktop runtime");
  },
  async clearDependencyCache() {},
  async logout() {},
  async quitApp() {},
  async listTrustedApps() {
    return [];
  },
  async revokeAppTrust() {
    return undefined;
  },
  async disconnectBus() {
    return undefined;
  },
  async reconnectBus() {
    return undefined;
  },
  async openExternal(url) {
    window.open(url, "_blank", "noopener,noreferrer");
  },
  async openNotification(notificationId, url) {
    const updated = notificationId
      ? await browserGateway.markNotificationRead(notificationId)
      : undefined;
    window.open(url, "_blank", "noopener,noreferrer");
    return updated;
  },
  async takePendingActivations() {
    return [];
  },
  async listPendingActions() {
    return [];
  },
  async listRecoverableActions() {
    return [];
  },
  async listLocalTasks() {
    return [];
  },
  async readLocalTaskLogs() {
    return { stdout: "", stderr: "", stdoutTruncated: false, stderrTruncated: false };
  },
  async claimAction() {
    throw new Error("Desktop actions require the LocalApp desktop runtime");
  },
  async trustAndRunTask() {
    throw new Error("Desktop actions require the LocalApp desktop runtime");
  },
  async rejectLocalTask() {
    throw new Error("Desktop actions require the LocalApp desktop runtime");
  },
  async cancelLocalTask() {
    throw new Error("Desktop actions require the LocalApp desktop runtime");
  },
  async setLocalTaskPinned() {
    throw new Error("Desktop actions require the LocalApp desktop runtime");
  },
  async listLocalApps() {
    return [];
  },
  async getLocalRuntimeStatus() {
    return { status: "stopped", restartCount: 0 };
  },
  async installLocalApp() {
    throw new Error("Installing local applications requires LocalApp Desktop");
  },
  async openLocalApp() {
    throw new Error("Opening local applications requires LocalApp Desktop");
  },
  async uninstallLocalApp() {
    throw new Error("Uninstalling local applications requires LocalApp Desktop");
  },
  async deleteLocalApp() {
    throw new Error("Deleting local applications requires LocalApp Desktop");
  },
  async listServerProfiles() {
    return [];
  },
  async saveServerProfile() {
    throw new Error("Server profiles require LocalApp Desktop");
  },
  async removeServerProfile() {
    throw new Error("Server profiles require LocalApp Desktop");
  },
  async useServerProfile() {
    throw new Error("Server profiles require LocalApp Desktop");
  },
  async publishLocalApp() {
    throw new Error("Publishing applications requires LocalApp Desktop");
  },
  async listen() {
    return () => undefined;
  },
};

const tauriGateway: DesktopGateway = {
  getAccount: () => invoke<AccountState>("get_account"),
  listInbox: (input) => invoke<InboxPage>("list_inbox", { input }),
  getUnreadCount: () => invoke<number>("get_unread_count"),
  markNotificationRead: (notificationId) =>
    invoke<InboxItem>("mark_notification_read", { notificationId }),
  deleteNotification: (notificationId) =>
    invoke<void>("delete_notification", { notificationId }),
  markAllRead: () => invoke<number>("mark_all_read"),
  listFavorites: () => invoke<Favorite[]>("list_favorites"),
  removeFavorite: (storedPagePath) => invoke<void>("remove_favorite", { storedPagePath }),
  openApp: (appPath) => invoke<void>("open_app", { appPath }),
  getSettings: () => invoke<DesktopSettings>("get_settings"),
  updateSettings: (input) => invoke<DesktopSettings>("update_settings", { input }),
  checkForUpdates: () => invoke<DesktopUpdateInfo>("check_for_updates"),
  installUpdate: () => invoke<void>("install_update"),
  clearDependencyCache: () => invoke<void>("clear_dependency_cache"),
  logout: () => invoke<void>("logout"),
  quitApp: () => invoke<void>("quit_app"),
  listTrustedApps: () => invoke<TrustedApp[]>("list_trusted_apps"),
  revokeAppTrust: (key) => invoke<void>("revoke_app_trust", { key }),
  disconnectBus: () => invoke<void>("disconnect_bus"),
  reconnectBus: () => invoke<void>("reconnect_bus"),
  openExternal: (url) => invoke<void>("open_external", { url }),
  openNotification: (notificationId, url) =>
    invoke<InboxItem | undefined>("open_notification", { notificationId, url }),
  takePendingActivations: () => invoke<ActionActivation[]>("take_pending_activations"),
  listPendingActions: () => invoke<PendingAction[]>("list_pending_actions"),
  listRecoverableActions: () => invoke<LocalTask[]>("list_recoverable_actions"),
  listLocalTasks: () => invoke<LocalTask[]>("list_local_tasks"),
  readLocalTaskLogs: (requestId) => invoke<TaskLogs>("read_local_task_logs", { requestId }),
  claimAction: (activation) => invoke<LocalTask>("claim_action", { activation }),
  trustAndRunTask: (requestId) => invoke<LocalTask>("trust_and_run_task", { requestId }),
  rejectLocalTask: (requestId) => invoke<LocalTask>("reject_local_task", { requestId }),
  cancelLocalTask: (requestId) => invoke<LocalTask>("cancel_local_task", { requestId }),
  setLocalTaskPinned: (requestId, pinned) =>
    invoke<LocalTask>("set_local_task_pinned", { requestId, pinned }),
  listLocalApps: () => invoke<LocalApp[]>("list_local_apps"),
  getLocalRuntimeStatus: () =>
    invoke<LocalRuntimeSnapshot>("get_local_runtime_status"),
  async installLocalApp() {
    const selected = await open({
      directory: false,
      multiple: false,
      filters: [{ name: "LocalApp 应用包", extensions: ["localapp"] }],
    });
    if (typeof selected !== "string") return;
    await invoke("install_local_app", { packagePath: selected });
  },
  openLocalApp: (appId) => invoke<void>("open_local_app", { appId }),
  uninstallLocalApp: (appId) => invoke<void>("uninstall_local_app", { appId }),
  deleteLocalApp: (appId) => invoke<void>("delete_local_app", { appId }),
  listServerProfiles: () =>
    invoke<ServerProfileSummary[]>("list_server_profiles"),
  saveServerProfile: ({ name, serverUrl, apiKey }) =>
    invoke<ServerProfileSummary[]>("save_server_profile", { name, serverUrl, apiKey }),
  removeServerProfile: (name) =>
    invoke<ServerProfileSummary[]>("remove_server_profile", { name }),
  useServerProfile: (name) => invoke<void>("use_server_profile", { name }),
  publishLocalApp: (appId, profileName) =>
    invoke<PublishResult>("publish_local_app", { appId, profileName }),
  async listen(handler) {
    const unlisteners: Array<() => void> = [];
    try {
      unlisteners.push(
        await listen<{ status: AccountState["connection"] }>(
          "desktop://connection",
          ({ payload }) => handler({ type: "connection:changed", status: payload.status }),
        ),
      );
      unlisteners.push(
        await listen<Omit<InboxItem, "read">>("desktop://notification", ({ payload }) =>
          handler({ type: "notification:received", notification: payload }),
        ),
      );
      unlisteners.push(
        await listen<{ count: number }>("desktop://missed", ({ payload }) =>
          handler({ type: "inbox:missed", count: payload.count }),
        ),
      );
      unlisteners.push(
        await listen<number>("desktop://unread-count", ({ payload }) =>
          handler({ type: "inbox:updated", unreadCount: payload }),
        ),
      );
      unlisteners.push(
        await listen("desktop://action-activation", () =>
          handler({ type: "action:activation" }),
        ),
      );
      unlisteners.push(
        await listen<LocalTask>("desktop://task-updated", ({ payload }) =>
          handler({ type: "task:updated", task: payload }),
        ),
      );
      unlisteners.push(
        await listen<TaskLogEvent>("desktop://task-log", ({ payload }) =>
          handler({ type: "task:log", log: payload }),
        ),
      );
    } catch (error) {
      unlisteners.forEach((unlisten) => unlisten());
      throw error;
    }
    return () => unlisteners.forEach((unlisten) => unlisten());
  },
};

let testGateway: DesktopGateway | undefined;

export function setDesktopGatewayForTests(gateway?: DesktopGateway): void {
  testGateway = gateway;
}

export function getDesktopGateway(): DesktopGateway {
  if (testGateway) return testGateway;
  return "__TAURI_INTERNALS__" in window ? tauriGateway : browserGateway;
}
