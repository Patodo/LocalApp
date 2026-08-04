import {
  Boxes,
  ListChecks,
  Heart,
  Inbox,
  MonitorCog,
  Settings,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { getDesktopGateway, type DesktopGateway } from "./lib/desktop-gateway";
import type {
  AccountState,
  ActionActivation,
  LocalTask,
  LocalApp,
  LocalRuntimeSnapshot,
  ServerProfileSummary,
} from "./lib/types";
import { FavoritesView } from "./views/favorites-view";
import { AppsView } from "./views/apps-view";
import { MessagesView } from "./views/messages-view";
import { SettingsView } from "./views/settings-view";
import { TasksView } from "./views/tasks-view";

type ViewId = "apps" | "messages" | "favorites" | "tasks" | "settings";

const navigation: Array<{ id: ViewId; label: string; icon: typeof Inbox }> = [
  { id: "apps", label: "本地应用", icon: Boxes },
  { id: "messages", label: "消息", icon: Inbox },
  { id: "favorites", label: "收藏", icon: Heart },
  { id: "tasks", label: "本地任务", icon: MonitorCog },
  { id: "settings", label: "设置", icon: Settings },
];

const terminalStatuses = new Set<LocalTask["status"]>([
  "succeeded", "failed", "cancelled", "expired", "interrupted",
]);

export function preferTask(current: LocalTask | undefined, incoming: LocalTask): LocalTask {
  if (!current || incoming.updatedAt > current.updatedAt) return incoming;
  if (incoming.updatedAt < current.updatedAt) return current;
  if (terminalStatuses.has(current.status) && !terminalStatuses.has(incoming.status)) return current;
  return incoming;
}

export function App() {
  const [activeView, setActiveView] = useState<ViewId>("apps");
  const [connection, setConnection] = useState<AccountState["connection"]>("offline");
  const [account, setAccount] = useState<AccountState>();
  const [unreadCount, setUnreadCount] = useState(0);
  const [tasks, setTasks] = useState<LocalTask[]>([]);
  const [localApps, setLocalApps] = useState<LocalApp[]>([]);
  const [localRuntime, setLocalRuntime] = useState<LocalRuntimeSnapshot>({
    status: "stopped",
    restartCount: 0,
  });
  const [serverProfiles, setServerProfiles] = useState<ServerProfileSummary[]>([]);
  const [taskLogRevisions, setTaskLogRevisions] = useState<Record<string, number>>({});
  const completedActionIds = useRef(new Set<string>());
  const claimInFlight = useRef(new Set<string>());
  const mounted = useRef(false);
  const gateway = getDesktopGateway();

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    let connectionRevision = 0;
    let unreadRevision = 0;
    mounted.current = true;

    function storeActions(actions: LocalTask[]) {
      if (actions.length === 0 || !mounted.current) return;
      for (const action of actions) completedActionIds.current.add(action.id);
      setTasks((current) => {
        const byId = new Map(current.map((action) => [action.id, action]));
        for (const action of actions) byId.set(action.id, preferTask(byId.get(action.id), action));
        return [...byId.values()];
      });
      setActiveView("tasks");
    }

    async function claimActivations(activations: ActionActivation[]) {
      for (const activation of activations) {
        if (
          completedActionIds.current.has(activation.requestId) ||
          claimInFlight.current.has(activation.requestId)
        ) continue;
        claimInFlight.current.add(activation.requestId);
        try {
          const action = await gateway.claimAction(activation);
          storeActions([action]);
        } catch {
          completedActionIds.current.delete(activation.requestId);
        } finally {
          claimInFlight.current.delete(activation.requestId);
        }
      }
    }

    async function reconcileActions(includeServerPending: boolean) {
      const [queued, pending, recoverable] = await Promise.all([
        gateway.takePendingActivations().catch(() => []),
        includeServerPending
          ? gateway.listPendingActions().catch(() => [])
          : Promise.resolve([]),
        includeServerPending
          ? gateway.listRecoverableActions().catch(() => [])
          : Promise.resolve([]),
      ]);
      storeActions(recoverable);
      await claimActivations([
        ...queued,
        ...pending.map(({ id, nonce }) => ({ requestId: id, nonce })),
      ]);
    }

    void (async () => {
      try {
        const registered = await gateway.listen((event) => {
          if (disposed) return;
          if (event.type === "connection:changed") {
            connectionRevision += 1;
            setConnection(event.status);
            if (event.status === "connected") void reconcileActions(true);
          } else if (event.type === "inbox:updated") {
            unreadRevision += 1;
            setUnreadCount(event.unreadCount);
          } else if (event.type === "notification:received") {
            unreadRevision += 1;
            setUnreadCount((current) => current + 1);
          } else if (event.type === "inbox:missed") {
            unreadRevision += 1;
            setUnreadCount(event.count);
          } else if (event.type === "action:activation") {
            void reconcileActions(false);
          } else if (event.type === "task:updated") {
            storeTask(event.task);
          } else if (event.type === "task:log") {
            setTaskLogRevisions((current) => ({
              ...current,
              [event.log.requestId]: (current[event.log.requestId] ?? 0) + 1,
            }));
          }
        });
        if (disposed) {
          registered();
          return;
        }
        unlisten = registered;

        void Promise.all([
          gateway.listLocalTasks().then(storeActions).catch(() => undefined),
          reconcileActions(true),
          gateway.listLocalApps().then(setLocalApps).catch(() => undefined),
          gateway
            .getLocalRuntimeStatus()
            .then(setLocalRuntime)
            .catch(() => undefined),
          gateway.listServerProfiles().then(setServerProfiles).catch(() => undefined),
        ]);

        const revisionAtRequest = connectionRevision;
        const unreadRevisionAtRequest = unreadRevision;
        const [account, unread] = await Promise.all([
          gateway.getAccount(),
          gateway.getUnreadCount().catch(() => 0),
        ]);
        if (!disposed) {
          setAccount(account);
          if (connectionRevision === revisionAtRequest) setConnection(account.connection);
          if (unreadRevision === unreadRevisionAtRequest) {
            setUnreadCount(unread || account.unreadCount);
          }
        }
      } catch {
        if (!disposed && connectionRevision === 0) setConnection("offline");
      }
    })();

    return () => {
      disposed = true;
      mounted.current = false;
      unlisten?.();
    };
  }, [gateway]);

  function storeTask(task: LocalTask) {
    setTasks((current) => {
      const byId = new Map(current.map((candidate) => [candidate.id, candidate]));
      byId.set(task.id, preferTask(byId.get(task.id), task));
      return [...byId.values()];
    });
  }

  async function refreshLocalApps() {
    const [apps, runtime] = await Promise.all([
      gateway.listLocalApps(),
      gateway.getLocalRuntimeStatus(),
    ]);
    setLocalApps(apps);
    setLocalRuntime(runtime);
  }

  return (
    <main className="desktop-shell">
      <aside className="sidebar" aria-label="主导航">
        <div className="brand" aria-label="LocalApp Desktop">
          <span className="brand-mark"><ListChecks aria-hidden="true" size={17} /></span>
          <strong>LocalApp</strong>
        </div>
        <nav className="nav-list" aria-label="桌面功能">
          {navigation.map(({ id, label, icon: Icon }) => (
            <button
              aria-current={activeView === id ? "page" : undefined}
              className={`nav-button${activeView === id ? " is-active" : ""}`}
              key={id}
              onClick={() => setActiveView(id)}
              type="button"
            >
              <Icon aria-hidden="true" size={19} strokeWidth={1.8} />
              <span>{label}</span>
              {id === "messages" && unreadCount > 0 ? (
                <span className="unread-count" aria-label={`${unreadCount} 条未读消息`}>{unreadCount}</span>
              ) : null}
            </button>
          ))}
        </nav>
        <div className="sidebar-connection" aria-label="连接状态">
          <span className={`status-dot is-${connection}`} aria-hidden="true" />
          <div>
            <span>{connectionLabel(connection)}</span>
            <small>{account?.serverUrl || "未配置服务器"}</small>
          </div>
        </div>
        <div className="sidebar-account" aria-label="当前账户">
          <span className="profile-initial" aria-hidden="true">{account?.displayName?.slice(0, 1).toUpperCase() || "Q"}</span>
          <div>
            <strong>{account?.displayName || "未登录"}</strong>
            <small>{account?.id ? "LocalApp 用户" : "离线账户"}</small>
          </div>
        </div>
      </aside>

      <section className="workspace">
        <div className="content-area">
          {renderView(activeView, tasks, localApps, localRuntime, serverProfiles, {
            trustAndRun: async (requestId) => storeTask(await gateway.trustAndRunTask(requestId)),
            reject: async (requestId) => storeTask(await gateway.rejectLocalTask(requestId)),
            cancel: async (requestId) => storeTask(await gateway.cancelLocalTask(requestId)),
            pin: async (requestId, pinned) =>
              storeTask(await gateway.setLocalTaskPinned(requestId, pinned)),
            readLogs: gateway.readLocalTaskLogs,
            logRevision: (requestId) => taskLogRevisions[requestId] ?? 0,
            installLocalApp: async () => {
              await gateway.installLocalApp();
              await refreshLocalApps();
            },
            openLocalApp: async (appId) => {
              try {
                await gateway.openLocalApp(appId);
              } finally {
                await refreshLocalApps();
              }
            },
            uninstallLocalApp: async (appId) => {
              await gateway.uninstallLocalApp(appId);
              await refreshLocalApps();
            },
            deleteLocalApp: async (appId) => {
              await gateway.deleteLocalApp(appId);
              await refreshLocalApps();
            },
            publishLocalApp: gateway.publishLocalApp,
          })}
        </div>
      </section>
    </main>
  );
}

function connectionLabel(connection: AccountState["connection"]): string {
  switch (connection) {
    case "connected":
      return "已连接";
    case "connecting":
      return "连接中";
    case "offline":
      return "未连接";
  }
}

function renderView(
  view: ViewId,
  tasks: LocalTask[],
  localApps: LocalApp[],
  localRuntime: LocalRuntimeSnapshot,
  serverProfiles: ServerProfileSummary[],
  actions: {
    trustAndRun: (requestId: string) => Promise<void>;
    reject: (requestId: string) => Promise<void>;
    cancel: (requestId: string) => Promise<void>;
    pin: (requestId: string, pinned: boolean) => Promise<void>;
    readLogs: DesktopGateway["readLocalTaskLogs"];
    logRevision: (requestId: string) => number;
    installLocalApp: () => Promise<void>;
    openLocalApp: (appId: string) => Promise<void>;
    uninstallLocalApp: (appId: string) => Promise<void>;
    deleteLocalApp: (appId: string) => Promise<void>;
    publishLocalApp: DesktopGateway["publishLocalApp"];
  },
) {
  switch (view) {
    case "apps":
      return (
        <AppsView
          apps={localApps}
          profiles={serverProfiles}
          runtime={localRuntime}
          onDelete={actions.deleteLocalApp}
          onInstall={actions.installLocalApp}
          onOpen={actions.openLocalApp}
          onPublish={actions.publishLocalApp}
          onUninstall={actions.uninstallLocalApp}
        />
      );
    case "messages":
      return <MessagesView />;
    case "favorites":
      return <FavoritesView />;
    case "tasks":
      return (
        <TasksView
          tasks={tasks}
          onCancel={actions.cancel}
          onPin={actions.pin}
          onReadLogs={actions.readLogs}
          logRevisionFor={actions.logRevision}
          onReject={actions.reject}
          onTrustAndRun={actions.trustAndRun}
        />
      );
    case "settings":
      return <SettingsView />;
  }
}
