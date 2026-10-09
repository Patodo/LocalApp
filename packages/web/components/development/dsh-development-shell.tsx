"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUp,
  Square,
  Code2,
  GitCompareArrows,
  Hammer,
  Eye,
  Rocket,
  X,
  FolderPlus,
  Settings,
  House,
  ChevronDown,
  FileCode2,
  Plus,
  Save,
  RotateCcw,
} from "lucide-react";
import {
  Modal,
  Button as DshButton,
} from "@deepseek-ai/dsh-client-ui-primitives";
import { AppFrame } from "./upstream/AppFrame";
import { SidebarRoot } from "./upstream/SidebarRoot";
import { HeroShell } from "./upstream/EmptyHero";
import {
  SIDEBAR_DEFAULT,
  clampWidth,
  SIDEBAR_MIN,
  SIDEBAR_MAX,
} from "./upstream/columns";
import type { LayoutInfo, RenderSlot } from "./upstream/bridge-types";
import conversationCss from "./upstream/ConversationRoot.module.css";
import composerCss from "./upstream/InputBar.module.css";
import sidebarCss from "./upstream/SidebarRoot.module.css";
import { DshDiff, DshMarkdown, DshMessages, DshTerminal } from "./dsh-view";
import "./dsh-development-shell.css";
import "./upstream/brand-font.css";
interface Project {
  id: string;
  name: string;
}
export interface DevelopmentShellProps {
  attachments?: Array<{ id: string; name: string; size: number }>;
  sessions: Array<{ id: string; createdAt: string }>;
  selectedSession: string;
  projects: Project[];
  project: Project | null;
  files: string[];
  file: { path: string; content: string } | null;
  text: string;
  prompt: string;
  messages: any[];
  live: string;
  running: boolean;
  pending: boolean;
  error: string;
  versions: Array<{ id: string; message: string }>;
  version: string;
  changes: any[];
  providers: Array<{ id: string; name: string; model: string }>;
  provider: string;
  build: any;
  log: string;
  interaction: any;
  answer: string;
  actions: {
    upload?: (files: FileList | null) => void;
    removeAttachment?: (id: string) => void;
    select: (p: Project) => void;
    selectSession: (id: string) => void;
    create: (name: string) => void;
    open: (path: string) => void;
    setText: (s: string) => void;
    save: () => void;
    setPrompt: (s: string) => void;
    run: () => void;
    stop: () => void;
    setProvider: (id: string) => void;
    newSession: () => void;
    setVersion: (id: string) => void;
    diff: () => void;
    restore: () => void;
    build: () => void;
    preview: () => void;
    publish: () => void;
    cancelBuild: () => void;
    newFile: (path: string) => void;
    respond: (r: unknown) => void;
    setAnswer: (s: string) => void;
  };
}
const labels: Record<string, string> = {
  "brand.localBuild": "DeepSeek Harness",
  "session.new": "新对话",
  "session.new.label": "新对话",
  "toggle.open": "展开侧栏",
  "toggle.collapse": "收起侧栏",
  "panels.label": "导航",
  "hero.headline": "探索未至之境",
  "hero.preview": "预览版",
};
const t = (key: string) => labels[key] ?? key;
export function DshDevelopmentShell(p: DevelopmentShellProps) {
  const [mounted, setMounted] = useState(false),
    [panel, setPanel] = useState<"files" | "changes" | "build">("files"),
    [right, setRight] = useState(false),
    [creating, setCreating] = useState(false),
    [name, setName] = useState(""),
    [newPath, setNewPath] = useState("");
  const [layout, setLayout] = useState<LayoutInfo>({
    viewportWidth: 1280,
    sidebar: SIDEBAR_DEFAULT,
    rightbar: null,
    narrowExpanded: false,
    rightbarShown: false,
    rightbarTrack: false,
    rightbarFullscreen: false,
    rightbarInstant: false,
  });
  const transcript = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // dsh portals render under body; apply its theme only while this workspace is mounted.
    document.body.classList.add("dsh-development");
    setMounted(true);
    return () => document.body.classList.remove("dsh-development");
  }, []);
  useEffect(
    () =>
      setLayout((s) => ({ ...s, rightbarShown: right, rightbarTrack: right })),
    [right],
  );
  useEffect(() => {
    const el = transcript.current;
    if (p.running && el) el.scrollTop = el.scrollHeight;
  }, [p.messages, p.live, p.running]);
  const actions = useMemo(
    () => ({
      setViewportWidth: (width: number) =>
        setLayout((s) =>
          s.viewportWidth === width ? s : { ...s, viewportWidth: width },
        ),
      setSidebar: (width: number) =>
        setLayout((s) => ({
          ...s,
          sidebar: clampWidth(width, SIDEBAR_MIN, SIDEBAR_MAX),
        })),
      setRightbar: (width: number) =>
        setLayout((s) => ({ ...s, rightbar: width })),
    }),
    [],
  );
  const toggleSidebar = () =>
    setLayout((s) =>
      s.viewportWidth < 1024
        ? { ...s, narrowExpanded: !s.narrowExpanded }
        : { ...s, sidebar: s.sidebar ? 0 : SIDEBAR_DEFAULT },
    );
  const show = (tab: typeof panel) => {
    setPanel(tab);
    setRight(true);
    if (tab === "changes") p.actions.diff();
  };
  const hero = p.messages.length === 0 && !p.running;
  const iconButton = (
    label: string,
    Icon: typeof Code2,
    onClick: () => void,
    disabled = false,
  ) => (
    <button
      className="dsh-icon-button"
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
    >
      <Icon size={17} />
    </button>
  );
  const renderSlot: RenderSlot = (slot, owner, options) => {
    if (slot === "sidebar")
      return (
        <SidebarRoot
          collapsed={Boolean(owner.collapsed)}
          width={Number(owner.width)}
          startSession={p.actions.newSession}
          toggleSidebar={toggleSidebar}
          selectPanel={() => {}}
          usePanels={(select) => select([])}
          useShortcuts={(select) => select([])}
          usePanelInfo={(select) => select({ activePanelId: null })}
          t={t}
          renderSlot={renderSlot}
        />
      );
    if (slot === "sidebar.brand.name")
      return <span className="dsh-brand-name">DeepSeek Harness</span>;
    if (slot === "sidebar.workspaces")
      return owner.wide ? (
        <div className="dsh-projects">
          <div className="dsh-section-label">
            <span>项目</span>
            {iconButton(
              "创建项目",
              FolderPlus,
              () => setCreating(true),
              p.running,
            )}
          </div>
          {p.projects.map((project) => (
            <div key={project.id} className="dsh-project-group">
              <button
                className={
                  "dsh-project-row " +
                  (p.project?.id === project.id ? "is-selected" : "")
                }
                disabled={p.running || p.pending}
                onClick={() => p.actions.select(project)}
              >
                <ChevronDown size={13} />
                <span>{project.name}</span>
              </button>
              {p.project?.id === project.id && (
                <>
                  <button
                    className="dsh-session-row"
                    onClick={p.actions.newSession}
                    disabled={p.running}
                  >
                    <Plus size={13} />
                    <span>新对话</span>
                  </button>
                  {p.sessions
                    .slice()
                    .reverse()
                    .map((item) => (
                      <button
                        className={
                          "dsh-session-row " +
                          (p.selectedSession === item.id ? "is-active" : "")
                        }
                        key={item.id}
                        disabled={p.running}
                        onClick={() => p.actions.selectSession(item.id)}
                      >
                        <span>
                          {new Date(item.createdAt).toLocaleString("zh-CN", {
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      </button>
                    ))}{" "}
                </>
              )}
            </div>
          ))}
          {!p.projects.length && (
            <button
              className="dsh-create-empty"
              onClick={() => setCreating(true)}
            >
              创建第一个项目
            </button>
          )}
        </div>
      ) : (
        iconButton("项目", Code2, toggleSidebar)
      );
    if (slot === "sidebar.settings")
      return (
        <a className={sidebarCss.panelRow} href="/my/models">
          <Settings size={17} />
          {Boolean(owner.wide) && <span>模型设置</span>}
        </a>
      );
    if (slot === "sidebar.footer.action")
      return (
        <a className={sidebarCss.panelRow} href="/">
          <House size={17} />
          {Boolean(owner.wide) && <span>返回 LocalApp</span>}
        </a>
      );
    if (slot === "rightbar")
      return right ? (
        <aside
          className="dsh-project-panel"
          style={{
            width:
              Number(owner.width) ||
              Math.max(260, Number(owner.viewportWidth) - 56),
          }}
        >
          <div className="dsh-panel-tabs">
            {(["files", "changes", "build"] as const).map((tab) => (
              <button
                aria-pressed={panel === tab}
                className={panel === tab ? "active" : ""}
                key={tab}
                onClick={() => show(tab)}
              >
                {tab === "files" ? "源码" : tab === "changes" ? "改动" : "构建"}
              </button>
            ))}
            {iconButton("关闭面板", X, () => setRight(false))}
          </div>
          {panel === "files" ? (
            <>
              <div className="dsh-panel-heading">
                <span>{p.file?.path ?? "项目文件"}</span>
                {iconButton(
                  "保存文件",
                  Save,
                  p.actions.save,
                  !p.file ||
                    p.running ||
                    p.pending ||
                    p.text === p.file.content,
                )}
              </div>
              <div className="dsh-file-workspace">
                <div className="dsh-file-tree">
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      p.actions.newFile(newPath);
                      setNewPath("");
                    }}
                  >
                    <input
                      aria-label="新文件路径"
                      value={newPath}
                      placeholder="新文件路径"
                      onChange={(e) => setNewPath(e.target.value)}
                      disabled={p.running}
                    />
                    <button
                      aria-label="新建文件"
                      disabled={!newPath || p.running}
                    >
                      <Plus size={14} />
                    </button>
                  </form>
                  {p.files.map((file) => (
                    <button
                      key={file}
                      className={p.file?.path === file ? "selected" : ""}
                      onClick={() => p.actions.open(file)}
                    >
                      <FileCode2 size={13} />
                      <span>{file}</span>
                    </button>
                  ))}
                </div>
                <textarea
                  aria-label="源码编辑器"
                  spellCheck={false}
                  readOnly={p.running || !p.file}
                  value={p.text}
                  onChange={(e) => p.actions.setText(e.target.value)}
                />
              </div>
            </>
          ) : panel === "changes" ? (
            <>
              <div className="dsh-panel-heading">
                <select
                  aria-label="源码版本"
                  value={p.version}
                  onChange={(e) => {
                    p.actions.setVersion(e.target.value);
                  }}
                >
                  {p.versions.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.message} · {v.id.slice(0, 8)}
                    </option>
                  ))}
                </select>
                {iconButton("查看改动", GitCompareArrows, p.actions.diff)}
                {iconButton(
                  "恢复源码",
                  RotateCcw,
                  p.actions.restore,
                  p.running || !p.version,
                )}
              </div>
              <div className="dsh-panel-body">
                {p.changes.length ? (
                  <DshDiff changes={p.changes} />
                ) : (
                  <p className="dsh-muted">当前没有改动</p>
                )}
              </div>
            </>
          ) : (
            <>
              <div className="dsh-panel-heading">
                <span>构建状态：{p.build?.status ?? "尚未构建"}</span>
                {p.build?.status === "running" &&
                  iconButton("停止构建", Square, p.actions.cancelBuild)}
              </div>
              <div className="dsh-panel-body">
                <DshTerminal
                  command="localapp check / build"
                  output={p.log}
                  running={p.build?.status === "running"}
                />
              </div>
            </>
          )}
        </aside>
      ) : null;
    if (slot === "main")
      return (
        <div
          className={conversationCss.root}
          data-phase={hero ? "hero" : "active"}
        >
          <header className={conversationCss.header}>
            <div className={conversationCss.headerLeading}>
              {iconButton("切换侧栏", Code2, toggleSidebar)}
            </div>
            <div className="dsh-conversation-heading">
              <span>{p.project?.name ?? "应用开发"}</span>
              <div className="dsh-header-actions">
                {iconButton("源码", Code2, () => show("files"), !p.project)}
                {iconButton(
                  "改动",
                  GitCompareArrows,
                  () => show("changes"),
                  !p.project,
                )}
                {iconButton(
                  "构建",
                  Hammer,
                  () => {
                    p.actions.build();
                    show("build");
                  },
                  !p.project || p.running || p.pending,
                )}
                {iconButton(
                  "预览",
                  Eye,
                  p.actions.preview,
                  p.build?.status !== "succeeded",
                )}
                {iconButton(
                  "发布",
                  Rocket,
                  p.actions.publish,
                  p.running || p.build?.status !== "succeeded",
                )}
              </div>
            </div>
          </header>
          <div
            className={conversationCss.body}
            data-conversation-content
            data-content-phase={hero ? "hero" : "active"}
          >
            <div
              className={conversationCss.scrollBody}
              ref={transcript}
              data-conversation-scroll
            >
              {!hero && (
                <div className="dsh-transcript">
                  <DshMessages messages={p.messages} />
                  {p.live && <DshMarkdown text={p.live} streaming />}
                  {p.running && (
                    <div className="dsh-running">
                      <span />
                      正在工作…
                    </div>
                  )}
                </div>
              )}
              <div className={conversationCss.composerSeat} data-composer-seat>
                <div
                  className={
                    conversationCss.composerStack +
                    " " +
                    (hero ? conversationCss.composerHero : "")
                  }
                >
                  {hero && (
                    <>
                      <HeroShell t={t} renderSlot={renderSlot} />
                      <div className={conversationCss.heroWorkspaceRow}>
                        <select
                          aria-label="开发项目"
                          value={p.project?.id ?? ""}
                          disabled={p.running || p.pending}
                          onChange={(e) => {
                            const project = p.projects.find(
                              (item) => item.id === e.target.value,
                            );
                            if (project) p.actions.select(project);
                          }}
                        >
                          <option value="">选择项目</option>
                          {p.projects.map((project) => (
                            <option value={project.id} key={project.id}>
                              {project.name}
                            </option>
                          ))}
                        </select>
                        <button
                          className="dsh-quiet-button"
                          onClick={() => setCreating(true)}
                        >
                          <FolderPlus size={14} />
                          创建项目
                        </button>
                      </div>
                    </>
                  )}
                  {p.error && (
                    <div role="alert" className="dsh-error">
                      {p.error}
                    </div>
                  )}
                  {p.interaction && (
                    <div className="dsh-interaction">
                      {p.interaction.kind === "approval" ? (
                        <>
                          <p>
                            {p.interaction.toolName}：{p.interaction.reason}
                          </p>
                          <button
                            onClick={() => p.actions.respond("allowed-once")}
                          >
                            允许本次
                          </button>
                          <button onClick={() => p.actions.respond("rejected")}>
                            拒绝
                          </button>
                        </>
                      ) : (
                        <>
                          <p>
                            {p.interaction.questions
                              ?.map((q: any) => q.question)
                              .join("\n")}
                          </p>
                          <input
                            aria-label="回答 Agent"
                            value={p.answer}
                            onChange={(e) =>
                              p.actions.setAnswer(e.target.value)
                            }
                          />
                          <button
                            onClick={() =>
                              p.actions.respond(
                                Object.fromEntries(
                                  p.interaction.questions.map((q: any) => [
                                    q.id,
                                    p.answer,
                                  ]),
                                ),
                              )
                            }
                          >
                            回答
                          </button>
                        </>
                      )}
                    </div>
                  )}
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      p.actions.run();
                    }}
                    className={
                      composerCss.root + " " + (hero ? composerCss.hero : "")
                    }
                  >
                    <div className={composerCss.card} data-composer-card>
                      <div className={composerCss.scroll}>
                        <textarea
                          className={composerCss.input + " dsh-draft"}
                          aria-label="开发需求"
                          placeholder={
                            p.project
                              ? "描述你希望应用实现的功能…"
                              : "先选择一个项目"
                          }
                          value={p.prompt}
                          disabled={p.running || !p.project}
                          onChange={(e) => p.actions.setPrompt(e.target.value)}
                          onKeyDown={(e) => {
                            if (
                              e.key === "Enter" &&
                              !e.shiftKey &&
                              !e.nativeEvent.isComposing
                            ) {
                              e.preventDefault();
                              if (!p.running && p.prompt.trim() && p.provider)
                                p.actions.run();
                            }
                          }}
                        />
                      </div>
                      <div className={composerCss.row}>
                        <div className={composerCss.tools}>
                          {iconButton(
                            "源码",
                            Code2,
                            () => show("files"),
                            !p.project,
                          )}
                          <span className="dsh-muted">应用开发</span>
                        </div>
                        <div className={composerCss.trailing}>
                          <div className={composerCss.standardControls}>
                            <select
                              aria-label="模型供应商"
                              value={p.provider}
                              disabled={p.running}
                              onChange={(e) =>
                                p.actions.setProvider(e.target.value)
                              }
                            >
                              {p.providers.map((provider) => (
                                <option key={provider.id} value={provider.id}>
                                  {provider.name} · {provider.model}
                                </option>
                              ))}
                            </select>
                          </div>
                          {p.running ? (
                            <button
                              className={composerCss.primary}
                              type="button"
                              aria-label="停止"
                              onClick={p.actions.stop}
                            >
                              <Square size={15} />
                            </button>
                          ) : (
                            <button
                              className={composerCss.primary}
                              aria-label="开始开发"
                              disabled={
                                !p.project || !p.provider || !p.prompt.trim()
                              }
                            >
                              <ArrowUp size={18} />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  </form>
                </div>
              </div>
            </div>
          </div>
        </div>
      );
    if (slot === "shell.overlay")
      return (
        <Modal
          open={creating}
          onClose={() => setCreating(false)}
          title="创建项目"
          closeLabel="关闭"
          description="从 LocalApp builtin 模板开始。"
          className="dsh-development"
          footer={
            <DshButton
              variant="primary"
              disabled={!name || p.pending}
              onClick={() => {
                p.actions.create(name);
                setCreating(false);
                setName("");
              }}
            >
              创建
            </DshButton>
          }
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (name && !p.pending) {
                p.actions.create(name);
                setCreating(false);
                setName("");
              }
            }}
          >
            <label className="dsh-create-project-label">
              项目名称
              <input
                data-modal-autofocus
                aria-label="新项目名称"
                placeholder="my-app"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
          </form>
        </Modal>
      );
    return options?.fallback ?? null;
  };
  return (
    <div className="dsh-development dsh-full-workbench">
      {mounted && (
        <AppFrame
          useStore={(select) => select({ layoutInfo: layout })}
          useSessions={(select) => select({ byId: {} })}
          usePanelInfo={(select) => select({ activePanelId: null })}
          actions={actions}
          renderSlot={renderSlot}
          t={t}
        />
      )}
    </div>
  );
}
