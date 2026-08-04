import {
  MoreHorizontal,
  PackageMinus,
  PackagePlus,
  Play,
  UploadCloud,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import type {
  LocalApp,
  LocalRuntimeSnapshot,
  PublishResult,
  ServerProfileSummary,
} from "../lib/types";

interface AppsViewProps {
  apps: LocalApp[];
  profiles: ServerProfileSummary[];
  runtime: LocalRuntimeSnapshot;
  onInstall: () => Promise<void> | void;
  onOpen: (appId: string) => Promise<void> | void;
  onPublish: (appId: string, profileName: string) => Promise<PublishResult>;
  onUninstall: (appId: string) => Promise<void> | void;
  onDelete: (appId: string) => Promise<void> | void;
}

export function AppsView({
  apps,
  profiles,
  runtime,
  onDelete,
  onInstall,
  onOpen,
  onPublish,
  onUninstall,
}: AppsViewProps) {
  const [menuApp, setMenuApp] = useState<string>();
  const [deleteApp, setDeleteApp] = useState<string>();
  const [publishApp, setPublishApp] = useState<string>();
  const [publishProfile, setPublishProfile] = useState(
    profiles.find((profile) => profile.active)?.name ?? profiles[0]?.name ?? "",
  );
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string>();
  const [publishResult, setPublishResult] = useState<PublishResult>();
  const [openErrors, setOpenErrors] = useState<Record<string, string>>({});

  async function publish() {
    if (!publishApp || !publishProfile || publishing) return;
    setPublishing(true);
    setPublishError(undefined);
    setPublishResult(undefined);
    try {
      setPublishResult(await onPublish(publishApp, publishProfile));
    } catch (error) {
      setPublishError(error instanceof Error ? error.message : "应用发布失败。");
    } finally {
      setPublishing(false);
    }
  }

  async function open(appId: string) {
    setOpenErrors((current) => {
      const next = { ...current };
      delete next[appId];
      return next;
    });
    try {
      await onOpen(appId);
    } catch (error) {
      setOpenErrors((current) => ({
        ...current,
        [appId]: error instanceof Error ? error.message : "无法打开本地应用。",
      }));
    }
  }

  return (
    <section className="view-stack apps-view">
      <header className="view-header apps-header">
        <div>
          <h1>本地应用</h1>
          <p>安装在这台设备上的 LocalApp 应用</p>
        </div>
        <button className="primary-button" onClick={() => void onInstall()} type="button">
          <PackagePlus aria-hidden="true" size={17} />
          安装应用包
        </button>
      </header>

      <div className="runtime-strip" aria-label="本地运行服务">
        <span className={`status-dot is-${runtime.status}`} aria-hidden="true" />
        <strong>本地运行服务</strong>
        <span>{runtimeLabel(runtime.status)}</span>
        {runtime.error ? <small>{runtime.error}</small> : null}
      </div>

      {apps.length === 0 ? (
        <div className="empty-state" aria-label="本地应用为空">
          <PackagePlus aria-hidden="true" size={28} strokeWidth={1.5} />
          <h2>尚未安装应用</h2>
        </div>
      ) : (
        <div className="app-list" role="list">
          {apps.map((app) => (
            <article className="app-row" key={app.appId} role="listitem">
              <div className="app-identity">
                <span className="app-monogram" aria-hidden="true">
                  {app.appId.slice(0, 1).toUpperCase()}
                </span>
                <div>
                  <h2>{app.appId}</h2>
                  <p>
                    版本 <span>{app.currentVersion}</span>
                  </p>
                  <div className={`app-health is-${app.status}`} role="status">
                    <span className="status-dot" aria-hidden="true" />
                    {appStatusLabel(app.status)}
                  </div>
                  {app.error || openErrors[app.appId] ? (
                    <p className="app-health-error" role="alert">
                      {app.error ?? openErrors[app.appId]}
                    </p>
                  ) : null}
                </div>
              </div>
              <div className="app-row-actions">
                <button
                  className="secondary-button"
                  onClick={() => {
                    setPublishApp(app.appId);
                    setPublishProfile(
                      profiles.find((profile) => profile.active)?.name
                        ?? profiles[0]?.name
                        ?? "",
                    );
                    setPublishError(undefined);
                    setPublishResult(undefined);
                  }}
                  type="button"
                  aria-label={`发布 ${app.appId}`}
                >
                  <UploadCloud aria-hidden="true" size={16} />
                  发布
                </button>
                <button
                  className="secondary-button"
                  disabled={app.status === "error"}
                  onClick={() => {
                    void open(app.appId);
                  }}
                  type="button"
                  aria-label={`打开 ${app.appId}`}
                >
                  <Play aria-hidden="true" size={16} />
                  打开
                </button>
                <div className="menu-anchor">
                  <button
                    aria-expanded={menuApp === app.appId}
                    aria-label="更多操作"
                    className="icon-button"
                    onClick={() =>
                      setMenuApp((current) =>
                        current === app.appId ? undefined : app.appId,
                      )
                    }
                    title="更多操作"
                    type="button"
                  >
                    <MoreHorizontal aria-hidden="true" size={18} />
                  </button>
                  {menuApp === app.appId ? (
                    <div className="action-menu" role="menu">
                      <button
                        onClick={() => {
                          setMenuApp(undefined);
                          void onUninstall(app.appId);
                        }}
                        role="menuitem"
                        type="button"
                      >
                        <PackageMinus aria-hidden="true" size={16} />
                        卸载并保留数据
                      </button>
                      <button
                        className="danger-item"
                        onClick={() => {
                          setMenuApp(undefined);
                          setDeleteApp(app.appId);
                        }}
                        role="menuitem"
                        type="button"
                      >
                        <Trash2 aria-hidden="true" size={16} />
                        永久删除
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      {deleteApp ? (
        <div className="dialog-backdrop">
          <section
            aria-label={`永久删除 ${deleteApp}`}
            aria-modal="true"
            className="confirm-dialog"
            role="dialog"
          >
            <h2>永久删除 {deleteApp}</h2>
            <p>应用代码、数据库、文件和备份都将从这台设备移除。</p>
            <div className="dialog-actions">
              <button
                className="secondary-button"
                onClick={() => setDeleteApp(undefined)}
                type="button"
              >
                取消
              </button>
              <button
                className="danger-button"
                onClick={() => {
                  const appId = deleteApp;
                  setDeleteApp(undefined);
                  void onDelete(appId);
                }}
                type="button"
              >
                <Trash2 aria-hidden="true" size={16} />
                确认永久删除
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {publishApp ? (
        <div className="dialog-backdrop">
          <section
            aria-label={`发布 ${publishApp}`}
            aria-modal="true"
            className="confirm-dialog publish-dialog"
            role="dialog"
          >
            <h2>发布 {publishApp}</h2>
            <p>本地数据库、文件和备份不会随应用发布。</p>
            {profiles.length > 0 ? (
              <label>
                <span>目标 Server</span>
                <select
                  aria-label="目标 Server"
                  disabled={publishing}
                  onChange={(event) => setPublishProfile(event.target.value)}
                  value={publishProfile}
                >
                  {profiles.map((profile) => (
                    <option key={profile.name} value={profile.name}>
                      {profile.name} · {profile.serverUrl}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <div className="message-error" role="alert">
                请先在设置中添加 Server profile。
              </div>
            )}
            {publishError ? <div className="message-error" role="alert">{publishError}</div> : null}
            {publishResult ? (
              <div className="publish-result" role="status">
                <strong>版本 {publishResult.version} 已发布</strong>
                <span>{publishResult.url}</span>
              </div>
            ) : null}
            <div className="dialog-actions">
              <button
                className="secondary-button"
                disabled={publishing}
                onClick={() => setPublishApp(undefined)}
                type="button"
              >
                {publishResult ? "完成" : "取消"}
              </button>
              {!publishResult ? (
                <button
                  className="primary-button"
                  disabled={publishing || !publishProfile}
                  onClick={() => void publish()}
                  type="button"
                >
                  <UploadCloud aria-hidden="true" size={16} />
                  {publishing ? "正在发布" : "确认发布"}
                </button>
              ) : null}
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}

function runtimeLabel(status: LocalRuntimeSnapshot["status"]): string {
  switch (status) {
    case "running":
      return "运行中";
    case "starting":
      return "启动中";
    case "restarting":
      return "正在恢复";
    case "failed":
      return "不可用";
    case "stopped":
      return "已停止";
  }
}

function appStatusLabel(status: LocalApp["status"]): string {
  switch (status) {
    case "ready":
      return "可用";
    case "unavailable":
      return "尚未就绪";
    case "error":
      return "不可用";
  }
}
