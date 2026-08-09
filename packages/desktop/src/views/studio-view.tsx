import {
  FolderPlus,
  Play,
  Package,
  UploadCloud,
  RefreshCw,
  Square,
  Trash2,
  Loader2,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { DesktopGateway } from "../lib/desktop-gateway";
import type {
  AgentSession,
  AvailableAgent,
  BuildOutcome,
  PublishResult,
  ServerProfileSummary,
  StudioProject,
} from "../lib/types";

interface StudioViewProps {
  gateway: DesktopGateway;
  profiles: ServerProfileSummary[];
}

export function StudioView({ gateway, profiles }: StudioViewProps) {
  const [projects, setProjects] = useState<StudioProject[]>([]);
  const [selectedAppId, setSelectedAppId] = useState<string>();
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  // agent 会话
  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const [availableAgents, setAvailableAgents] = useState<AvailableAgent[]>([]);
  const [selectedAgentKind, setSelectedAgentKind] = useState<string>(() => {
    return localStorage.getItem("studio.selectedAgentKind") ?? "";
  });
  const [activeSessionId, setActiveSessionId] = useState<string>();
  const [prompt, setPrompt] = useState("");
  const [logRevisions, setLogRevisions] = useState<Record<string, number>>({});
  const [stdoutBySession, setStdoutBySession] = useState<Record<string, string>>({});

  // 构建结果
  const [lastBuild, setLastBuild] = useState<BuildOutcome>();
  const [publishOpen, setPublishOpen] = useState(false);
  const [publishProfile, setPublishProfile] = useState(
    profiles.find((p) => p.active)?.name ?? profiles[0]?.name ?? "",
  );
  const [publishing, setPublishing] = useState(false);
  const [publishResult, setPublishResult] = useState<PublishResult>();
  const [publishError, setPublishError] = useState<string>();

  const logEndRef = useRef<HTMLDivElement>(null);

  async function refreshProjects() {
    try {
      const list = await gateway.listStudioProjects();
      setProjects(list);
      if (!selectedAppId && list.length > 0) setSelectedAppId(list[0].appId);
    } catch (err) {
      setError(typeof err === "string" ? err : err instanceof Error ? err.message : "加载项目失败");
    }
  }

  async function refreshSessions() {
    try {
      const list = await gateway.listStudioAgents();
      setSessions(list);
      // 自动选中最新的会话
      const running = list.find((s) => s.status === "running" || s.status === "pending");
      if (running) setActiveSessionId(running.id);
    } catch {
      // 忽略
    }
  }

  useEffect(() => {
    void refreshProjects();
    void refreshSessions();
    void gateway.listAvailableAgents().then((agents) => {
      setAvailableAgents(agents);
      // 若用户未选过或选的已不存在，回退到默认
      const stillExists = agents.some((a) => a.kind === selectedAgentKind);
      if (!stillExists) {
        const def = agents.find((a) => a.isDefault)?.kind ?? agents[0]?.kind ?? "";
        setSelectedAgentKind(def);
        if (def) localStorage.setItem("studio.selectedAgentKind", def);
      }
    });
  }, []);

  // 订阅 agent 事件
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    gateway
      .listen((event) => {
        if (event.type === "agent:log") {
          setStdoutBySession((prev) => {
            const existing = prev[event.log.sessionId] ?? "";
            return { ...prev, [event.log.sessionId]: existing + event.log.message };
          });
          setLogRevisions((prev) => ({
            ...prev,
            [event.log.sessionId]: (prev[event.log.sessionId] ?? 0) + 1,
          }));
        } else if (event.type === "agent:updated") {
          void refreshSessions();
        }
      })
      .then((fn) => {
        unlisten = fn;
      });
    return () => unlisten?.();
  }, [gateway]);

  // 日志滚动到底部
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logRevisions, activeSessionId]);

  const selected = useMemo(
    () => projects.find((p) => p.appId === selectedAppId),
    [projects, selectedAppId],
  );
  const activeSession = useMemo(
    () => sessions.find((s) => s.id === activeSessionId),
    [sessions, activeSessionId],
  );
  const stdout = activeSessionId ? stdoutBySession[activeSessionId] ?? "" : "";

  async function createProject() {
    const name = newName.trim();
    if (!name) return;
    setBusy(true);
    setError(undefined);
    try {
      const created = await gateway.createStudioProject(name);
      setNewName("");
      await refreshProjects();
      setSelectedAppId(created.appId);
    } catch (err) {
      setError(typeof err === "string" ? err : err instanceof Error ? err.message : "创建项目失败");
    } finally {
      setBusy(false);
    }
  }

  // 当前会话是否支持多轮对话(opencode = true, stdio = false)
  const canContinue = Boolean(
    activeSession?.opencodeSessionId &&
      (activeSession.status === "running" || activeSession.status === "completed"),
  );

  async function runAgent() {
    if (!selected || !prompt.trim()) return;
    if (availableAgents.length === 0) {
      setError("未检测到任何 agent CLI。请先安装 OpenCode / Claude Code / Codex / ZCode 之一。");
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      // 多轮对话:当前会话是 opencode 且仍在续聊,走 sendStudioMessage
      if (canContinue && activeSessionId) {
        await gateway.sendStudioMessage(activeSessionId, prompt);
        setPrompt("");
        void refreshSessions();
        return;
      }
      // 新建会话
      const kind = selectedAgentKind || undefined;
      const started = await gateway.runStudioAgent(selected.appId, prompt, kind);
      setActiveSessionId(started.sessionId);
      setStdoutBySession((prev) => ({ ...prev, [started.sessionId]: "" }));
      setPrompt("");
      void refreshSessions();
    } catch (err) {
      setError(typeof err === "string" ? err : err instanceof Error ? err.message : "启动 agent 失败");
    } finally {
      setBusy(false);
    }
  }

  async function cancelAgent() {
    if (!activeSession) return;
    try {
      await gateway.cancelStudioAgent(activeSession.id);
      void refreshSessions();
    } catch (err) {
      setError(typeof err === "string" ? err : err instanceof Error ? err.message : "取消 agent 失败");
    }
  }

  async function build() {
    if (!selected) return;
    setBusy(true);
    setError(undefined);
    setLastBuild(undefined);
    try {
      const outcome = await gateway.buildStudioProject(selected.appId);
      setLastBuild(outcome);
      await refreshProjects();
    } catch (err) {
      setError(typeof err === "string" ? err : err instanceof Error ? err.message : "构建失败");
    } finally {
      setBusy(false);
    }
  }

  async function install() {
    if (!selected) return;
    setBusy(true);
    setError(undefined);
    try {
      await gateway.installStudioProject(selected.appId);
      setError(undefined);
    } catch (err) {
      setError(typeof err === "string" ? err : typeof err === "string" ? err : err instanceof Error ? err.message : "安装失败");
    } finally {
      setBusy(false);
    }
  }

  async function reload() {
    if (!selected) return;
    setBusy(true);
    setError(undefined);
    try {
      await gateway.reloadStudioProject(selected.appId);
    } catch (err) {
      setError(typeof err === "string" ? err : err instanceof Error ? err.message : "重载失败");
    } finally {
      setBusy(false);
    }
  }

  async function publish() {
    if (!selected || !publishProfile) return;
    setPublishing(true);
    setPublishError(undefined);
    setPublishResult(undefined);
    try {
      setPublishResult(await gateway.publishStudioProject(selected.appId, publishProfile));
    } catch (err) {
      setPublishError(typeof err === "string" ? err : err instanceof Error ? err.message : "发布失败");
    } finally {
      setPublishing(false);
    }
  }

  async function deleteProject() {
    if (!selected) return;
    if (!confirm(`确定删除源码项目「${selected.name}」？已安装的应用版本不会被删除。`)) return;
    setBusy(true);
    try {
      await gateway.deleteStudioProject(selected.appId);
      setSelectedAppId(undefined);
      await refreshProjects();
    } catch (err) {
      setError(typeof err === "string" ? err : err instanceof Error ? err.message : "删除项目失败");
    } finally {
      setBusy(false);
    }
  }

  const isAgentRunning = activeSession?.status === "running" || activeSession?.status === "pending";

  return (
    <div className="studio-view">
      <aside className="studio-sidebar">
        <header className="studio-sidebar-header">
          <h2>项目</h2>
          <button
            className="studio-icon-button"
            onClick={() => setCreating((v) => !v)}
            title="新建项目"
            type="button"
          >
            <FolderPlus size={16} strokeWidth={1.8} />
          </button>
        </header>
        {creating ? (
          <div className="studio-create">
            <input
              autoFocus
              className="studio-input"
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void createProject();
                if (e.key === "Escape") setCreating(false);
              }}
              placeholder="应用名称（如：请假表单）"
              value={newName}
            />
            <button
              className="studio-button is-primary"
              disabled={!newName.trim() || busy}
              onClick={() => void createProject()}
              type="button"
            >
              创建
            </button>
          </div>
        ) : null}
        <ul className="studio-project-list">
          {projects.length === 0 ? (
            <li className="studio-empty">暂无项目。点击 + 创建第一个应用。</li>
          ) : (
            projects.map((project) => (
              <li key={project.appId}>
                <button
                  className={`studio-project-item${selectedAppId === project.appId ? " is-active" : ""}`}
                  onClick={() => setSelectedAppId(project.appId)}
                  type="button"
                >
                  <span className="studio-project-name">{project.name}</span>
                  <small className="studio-project-meta">
                    {project.appId}
                    {!project.presentOnDisk ? " · 源码缺失" : ""}
                  </small>
                </button>
              </li>
            ))
          )}
        </ul>
      </aside>

      <section className="studio-workspace">
        {!selected ? (
          <div className="studio-placeholder">
            <p>选择左侧项目，或创建一个新项目开始。</p>
          </div>
        ) : (
          <>
            <header className="studio-header">
              <div>
                <h2>{selected.name}</h2>
                <small>{selected.sourcePath}</small>
              </div>
              <div className="studio-actions">
                <button
                  className="studio-button"
                  disabled={busy}
                  onClick={() => void build()}
                  title="构建 .localapp 包"
                  type="button"
                >
                  <Package size={15} strokeWidth={1.8} /> 构建
                </button>
                <button
                  className="studio-button"
                  disabled={busy}
                  onClick={() => void install()}
                  title="安装到本地应用库"
                  type="button"
                >
                  <Play size={15} strokeWidth={1.8} /> 安装
                </button>
                <button
                  className="studio-button"
                  disabled={busy}
                  onClick={() => void reload()}
                  title="构建 + 安装 + 打开预览"
                  type="button"
                >
                  <RefreshCw size={15} strokeWidth={1.8} /> 重载预览
                </button>
                <button
                  className="studio-button"
                  disabled={busy || profiles.length === 0}
                  onClick={() => setPublishOpen(true)}
                  title="发布到远程 server"
                  type="button"
                >
                  <UploadCloud size={15} strokeWidth={1.8} /> 发布
                </button>
                <button
                  className="studio-icon-button"
                  disabled={busy}
                  onClick={() => void deleteProject()}
                  title="删除源码项目"
                  type="button"
                >
                  <Trash2 size={15} strokeWidth={1.8} />
                </button>
              </div>
            </header>

            {error ? <div className="studio-error">{error}</div> : null}
            {lastBuild ? (
              <div className="studio-info">
                构建成功：{lastBuild.appId} v{lastBuild.version}（{(lastBuild.size / 1024).toFixed(1)} KB）
              </div>
            ) : null}

            <div className="studio-prompt-area">
              <div className="studio-agent-picker">
                <label htmlFor="studio-agent-select">Agent</label>
                <select
                  className="studio-agent-select"
                  disabled={availableAgents.length === 0}
                  id="studio-agent-select"
                  onChange={(e) => {
                    setSelectedAgentKind(e.target.value);
                    localStorage.setItem("studio.selectedAgentKind", e.target.value);
                  }}
                  value={selectedAgentKind}
                >
                  {availableAgents.length === 0 ? (
                    <option value="">未检测到 agent（需装 OpenCode/Claude/Codex）</option>
                  ) : (
                    availableAgents.map((agent) => (
                      <option key={agent.kind} value={agent.kind}>
                        {agent.kind}
                        {agent.isDefault ? "（推荐）" : ""}
                      </option>
                    ))
                  )}
                </select>
                {availableAgents.length === 0 ? (
                  <button
                    className="studio-button"
                    onClick={() => void gateway.listAvailableAgents().then(setAvailableAgents)}
                    title="重新探测"
                    type="button"
                  >
                    <RefreshCw size={13} strokeWidth={1.8} /> 重新探测
                  </button>
                ) : null}
              </div>
              <textarea
                className="studio-prompt-input"
                disabled={busy}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    void runAgent();
                  }
                }}
                placeholder={`描述你想要的 ${selected.name} 功能…（⌘/Ctrl+Enter 运行）`}
                rows={3}
                value={prompt}
              />
              <div className="studio-prompt-actions">
                <button
                  className="studio-button is-primary"
                  disabled={busy || !prompt.trim()}
                  onClick={() => void runAgent()}
                  type="button"
                >
                  <Play size={14} strokeWidth={1.8} /> {canContinue ? "发送" : "运行 agent"}
                </button>
                {isAgentRunning ? (
                  <button
                    className="studio-button is-danger"
                    onClick={() => void cancelAgent()}
                    type="button"
                  >
                    <Square size={14} strokeWidth={1.8} /> 停止
                  </button>
                ) : null}
              </div>
            </div>

            <div className="studio-log-area">
              <header className="studio-log-header">
                <h3>Agent 输出</h3>
                {activeSession ? (
                  <span className={`studio-session-status is-${activeSession.status}`}>
                    {activeSession.agentKind} · {statusLabel(activeSession.status)}
                    {activeSession.status === "running" ? (
                      <Loader2 className="studio-spinner" size={12} strokeWidth={2} />
                    ) : null}
                  </span>
                ) : null}
              </header>
              <pre className="studio-log">
                {stripAnsi(stdout) || "运行 agent 后，输出会实时显示在这里。"}
                <div ref={logEndRef} />
              </pre>
              {activeSession &&
              (activeSession.status === "failed" ||
                activeSession.status === "cancelled" ||
                activeSession.status === "timedOut") ? (
                <div className={`studio-session-error is-${activeSession.status}`}>
                  {activeSession.error
                    ? activeSession.error
                    : activeSession.exitCode != null
                      ? `进程退出码 ${activeSession.exitCode}`
                      : statusLabel(activeSession.status)}
                </div>
              ) : null}
              {sessions.length > 1 ? (
                <details className="studio-history">
                  <summary>历史会话（{sessions.length}）</summary>
                  <ul>
                    {sessions.map((session) => (
                      <li key={session.id}>
                        <button
                          className={`studio-history-item${activeSessionId === session.id ? " is-active" : ""}`}
                          onClick={() => {
                            setActiveSessionId(session.id);
                            // 若内存里没有这个 session 的日志，从后端拉
                            if (!stdoutBySession[session.id]) {
                              void gateway
                                .readStudioAgentLogs(session.id)
                                .then((logs) =>
                                  setStdoutBySession((prev) => ({
                                    ...prev,
                                    [session.id]: logs.stdout,
                                  })),
                                );
                            }
                          }}
                          type="button"
                        >
                          {session.agentKind} · {statusLabel(session.status)}
                        </button>
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </div>
          </>
        )}
      </section>

      {publishOpen && selected ? (
        <div className="studio-modal-backdrop" onClick={() => setPublishOpen(false)}>
          <div className="studio-modal" onClick={(e) => e.stopPropagation()}>
            <h3>发布「{selected.name}」</h3>
            <p className="studio-modal-hint">应用必须先安装，才能发布到远程 server。</p>
            <label className="studio-field">
              <span>Server profile</span>
              <select
                onChange={(e) => setPublishProfile(e.target.value)}
                value={publishProfile}
              >
                {profiles.map((profile) => (
                  <option key={profile.name} value={profile.name}>
                    {profile.name}（{profile.serverUrl}）
                  </option>
                ))}
              </select>
            </label>
            {publishResult ? (
              <div className="studio-success">
                发布成功：<a href={publishResult.url} rel="noreferrer" target="_blank">{publishResult.url}</a>
              </div>
            ) : null}
            {publishError ? <div className="studio-error">{publishError}</div> : null}
            <div className="studio-modal-actions">
              <button onClick={() => setPublishOpen(false)} type="button">关闭</button>
              <button
                className="is-primary"
                disabled={publishing || !publishProfile}
                onClick={() => void publish()}
                type="button"
              >
                {publishing ? "发布中…" : "发布"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/// 剥离 ANSI 终端转义码（颜色/光标等），让 agent 输出在网页里干净显示。
const ANSI_RE =
  // eslint-disable-next-line no-control-regex
  /\x1b\[[0-9;]*[A-Za-z]|\x1b\][^\x07]*\x07|\x1b[()][AB012]|\x1b[=>]/g;
function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, "");
}

function statusLabel(status: AgentSession["status"]): string {
  switch (status) {
    case "pending":
      return "等待中";
    case "running":
      return "运行中";
    case "completed":
      return "已完成";
    case "failed":
      return "失败";
    case "cancelled":
      return "已取消";
    case "timedOut":
      return "超时";
  }
}
