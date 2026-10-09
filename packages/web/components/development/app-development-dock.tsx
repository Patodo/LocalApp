"use client";
import { useEffect, useRef, useState } from "react";
import {
  ArrowUp,
  Square,
  Minus,
  Plus,
  ChevronDown,
  Code2,
  Hammer,
  Eye,
  Rocket,
  LoaderCircle,
  GitCompareArrows,
  FolderUp,
  Paperclip,
  X,
  MessageSquare,
  Check,
} from "lucide-react";
import type { DevelopmentShellProps } from "./dsh-development-shell";
import { DshDiff, DshMarkdown, DshMessages, DshTerminal } from "./dsh-view";
import "./app-development-dock.css";

export function AppDevelopmentDock(
  p: DevelopmentShellProps & {
    application?: { owner: string; name: string };
    importSource?: (files: Record<string, string>) => Promise<void>;
  },
) {
  const [expanded, setExpanded] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const history = useRef<HTMLDivElement>(null);
  const historyTrigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!historyOpen) return;
    history.current
      ?.querySelector<HTMLButtonElement>('[aria-checked="true"]')
      ?.focus();
    const outside = (event: PointerEvent) => {
      if (!history.current?.contains(event.target as Node))
        setHistoryOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [historyOpen]);
  const [panel, setPanel] = useState<"chat" | "changes" | "build">("chat");
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState("");
  const transcript = useRef<HTMLDivElement>(null);
  const sourceInput = useRef<HTMLInputElement>(null);
  const attachmentInput = useRef<HTMLInputElement>(null);
  const draft = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (p.running && panel === "chat")
      transcript.current?.scrollTo({ top: transcript.current.scrollHeight });
  }, [p.live, p.messages, p.running, panel]);
  useEffect(() => {
    if (!draft.current) return;
    draft.current.style.height = "auto";
    draft.current.style.height =
      Math.min(draft.current.scrollHeight, 160) + "px";
  }, [p.prompt]);
  const building = ["queued", "running"].includes(p.build?.status);
  const ready = p.build?.status === "succeeded";
  async function importDirectory(list: FileList | null) {
    if (!list?.length || !p.importSource) return;
    setImportError("");
    setImporting(true);
    try {
      const files: Record<string, string> = Object.create(null);
      let total = 0;
      for (const file of Array.from(list)) {
        const relative = file.webkitRelativePath.split("/").slice(1).join("/");
        if (
          !relative ||
          relative.endsWith(".localapp") ||
          relative.endsWith(".tsbuildinfo") ||
          relative
            .split("/")
            .some(
              (part) =>
                [
                  "node_modules",
                  ".git",
                  "dist",
                  ".next",
                  ".cache",
                  ".npm",
                  ".localapp",
                  "coverage",
                ].includes(part) ||
                part === ".env" ||
                part.startsWith(".env.") ||
                part === ".npmrc" ||
                part.endsWith(".key") ||
                part.endsWith(".pem"),
            )
        )
          continue;
        total += file.size;
        if (file.size > 2 * 1024 * 1024 || total > 32 * 1024 * 1024)
          throw new Error("源码超过大小限制（单文件 2MB、总计 32MB）");
        const bytes = await file.arrayBuffer();
        try {
          files[relative] = new TextDecoder("utf-8", { fatal: true }).decode(
            bytes,
          );
        } catch {
          throw new Error(`暂不支持导入二进制文件：${relative}`);
        }
        if (files[relative].includes("\0"))
          throw new Error(`暂不支持导入二进制文件：${relative}`);
      }
      await p.importSource(files);
    } catch (e) {
      setImportError((e as Error).message);
    } finally {
      setImporting(false);
      if (sourceInput.current) sourceInput.current.value = "";
    }
  }
  return (
    <section
      className={`app-development-dock dsh-development ${expanded ? "is-expanded" : ""} ${p.running ? "is-running" : ""}`}
      aria-label="应用开发对话"
    >
      <header className="development-dock-header">
        {p.running && <LoaderCircle className="dock-spinner" size={15} />}
        <div
          className="dock-history"
          ref={history}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node))
              setHistoryOpen(false);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setHistoryOpen(false);
              historyTrigger.current?.focus();
            }
            if (
              historyOpen &&
              ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)
            ) {
              event.preventDefault();
              const items = Array.from(
                history.current?.querySelectorAll<HTMLButtonElement>(
                  '[role="menuitemradio"]',
                ) ?? [],
              );
              const index = items.indexOf(
                document.activeElement as HTMLButtonElement,
              );
              const next =
                event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? items.length - 1
                    : (index +
                        (event.key === "ArrowUp" ? -1 : 1) +
                        items.length) %
                      items.length;
              items[next]?.focus();
            }
          }}
        >
          <button
            ref={historyTrigger}
            className="dock-title"
            aria-label="切换历史对话"
            aria-haspopup="menu"
            aria-expanded={historyOpen}
            disabled={p.running || p.pending || !p.project}
            onClick={() => setHistoryOpen(!historyOpen)}
          >
            编辑 {p.application?.name ?? p.project?.name}
            <ChevronDown size={14} />
          </button>
          {historyOpen && (
            <div
              className="dock-history-menu"
              role="menu"
              aria-label="开发历史对话"
            >
              <button
                role="menuitemradio"
                aria-checked={!p.selectedSession}
                onClick={() => {
                  p.actions.newSession();
                  setPanel("chat");
                  setHistoryOpen(false);
                  historyTrigger.current?.focus();
                }}
              >
                <Plus size={16} />
                <span>新对话</span>
                {!p.selectedSession && <Check size={15} />}
              </button>
              {[...p.sessions]
                .sort(
                  (a, b) =>
                    new Date(b.createdAt).getTime() -
                    new Date(a.createdAt).getTime(),
                )
                .map((session) => (
                  <button
                    key={session.id}
                    role="menuitemradio"
                    aria-checked={p.selectedSession === session.id}
                    onClick={() => {
                      p.actions.selectSession(session.id);
                      setPanel("chat");
                      setHistoryOpen(false);
                      historyTrigger.current?.focus();
                    }}
                  >
                    <MessageSquare size={16} />
                    <span>
                      {new Date(session.createdAt).toLocaleString("zh-CN", {
                        month: "numeric",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}{" "}
                      · {session.id.slice(0, 8)}
                    </span>
                    {p.selectedSession === session.id && <Check size={15} />}
                  </button>
                ))}
              {!p.sessions.length && <p>暂无历史对话</p>}
            </div>
          )}
        </div>
        <a
          href={
            p.project
              ? `/my/development?projectId=${encodeURIComponent(p.project.id)}`
              : "/my/development"
          }
          title="打开完整开发页"
          aria-label="打开完整开发页"
        >
          <Code2 size={17} />
        </a>
        <button
          aria-label={expanded ? "收起开发对话" : "展开开发对话"}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? <Minus size={16} /> : <Plus size={16} />}
        </button>
      </header>
      {expanded && (
        <>
          {p.project ? (
            <nav className="development-dock-tools" aria-label="开发操作">
              <button
                aria-pressed={panel === "chat"}
                onClick={() => setPanel("chat")}
              >
                对话
              </button>
              <button
                onClick={() => {
                  setPanel("changes");
                  p.actions.diff();
                }}
              >
                <GitCompareArrows size={15} />
                改动
              </button>
              <button
                disabled={p.pending || p.running || building}
                onClick={() => {
                  setPanel("build");
                  p.actions.build();
                }}
              >
                <Hammer size={15} />
                检查与构建
              </button>
              <button
                disabled={!ready || p.pending || p.running}
                onClick={p.actions.preview}
              >
                <Eye size={15} />
                预览
              </button>
              <button
                disabled={!ready || p.pending || p.running}
                onClick={p.actions.publish}
              >
                <Rocket size={15} />
                上线
              </button>
            </nav>
          ) : null}
          <div
            className="development-dock-transcript"
            ref={transcript}
            role="log"
            aria-label="开发对话记录"
          >
            {!p.project && !p.pending && (
              <div className="development-source-empty">
                <FolderUp size={25} />
                <strong>接入这个应用的源码</strong>
                <p>
                  安装包只有构建产物。选择原项目目录后，即可在这里对话修改、检查、预览并上线。
                </p>
                <button
                  disabled={importing}
                  onClick={() => sourceInput.current?.click()}
                >
                  {importing ? "正在导入…" : "选择源码目录"}
                </button>
                <p>
                  包含 manifest.json、package.json；应用名称需与当前应用相同。
                </p>
              </div>
            )}
            {panel === "chat" && (
              <>
                <DshMessages messages={p.messages} />
                {p.live && <DshMarkdown text={p.live} />}
                {p.running && (
                  <p className="dock-run-status">
                    <LoaderCircle className="dock-spinner" size={14} />
                    正在处理…
                  </p>
                )}
                {p.project && !p.messages.length && !p.running && (
                  <p className="dock-hint">
                    描述你想修改的功能。修改先保存在源码中，检查和预览后再上线。
                  </p>
                )}
              </>
            )}
            {panel === "changes" && (
              <>
                {p.changes.length ? (
                  <DshDiff changes={p.changes} />
                ) : (
                  <p className="dock-hint">没有改动</p>
                )}
              </>
            )}
            {panel === "build" && (
              <>
                <p className="dock-run-status">
                  {building
                    ? "正在检查与构建…"
                    : ready
                      ? "构建通过，可以预览或上线"
                      : p.build?.status === "failed"
                        ? "构建失败，请查看日志"
                        : "尚未构建"}
                  {building && (
                    <button onClick={p.actions.cancelBuild}>取消构建</button>
                  )}
                </p>
                <DshTerminal
                  command="应用检查与构建"
                  output={p.log}
                  running={building}
                />
              </>
            )}
            {(p.error || importError) && (
              <p className="dock-error" role="alert">
                {p.error || importError}
              </p>
            )}
            {p.interaction && (
              <div className="dock-interaction">
                {p.interaction.kind === "approval" ? (
                  <>
                    <p>
                      {p.interaction.toolName}：{p.interaction.reason}
                    </p>
                    <button onClick={() => p.actions.respond("allowed-once")}>
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
                    <textarea
                      aria-label="回答 Agent"
                      value={p.answer}
                      onChange={(e) => p.actions.setAnswer(e.target.value)}
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
                      提交回答
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        </>
      )}
      {p.attachments?.length ? (
        <div className="dock-attachments" aria-label="待发送附件">
          {p.attachments.map((file) => (
            <span key={file.id}>
              <Paperclip size={14} />
              <span>{file.name}</span>
              <button
                aria-label={`移除附件 ${file.name}`}
                disabled={p.running || p.pending}
                onClick={() => p.actions.removeAttachment?.(file.id)}
              >
                <X size={13} />
              </button>
            </span>
          ))}
        </div>
      ) : null}
      {!expanded && p.error && (
        <p className="dock-error dock-collapsed-error" role="alert">
          {p.error}
        </p>
      )}
      <input
        ref={attachmentInput}
        type="file"
        hidden
        multiple
        aria-label="选择对话附件"
        onChange={(event) => {
          p.actions.upload?.(event.currentTarget.files);
          event.currentTarget.value = "";
        }}
      />
      <div className="development-dock-composer">
        <button
          aria-label="上传文件"
          disabled={p.running || p.pending || !p.project || !p.actions.upload}
          onClick={() => attachmentInput.current?.click()}
        >
          <Plus size={20} />
        </button>
        <textarea
          ref={draft}
          rows={1}
          aria-label="应用修改需求"
          placeholder={
            p.project ? "描述你想修改的功能…" : "与 Agent 一起编辑应用…"
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
              if (p.prompt.trim() && p.provider && !p.pending) {
                setPanel("chat");
                p.actions.run();
              }
            }
          }}
        />
        <select
          aria-label="开发模型"
          value={p.provider}
          disabled={p.running || p.pending}
          onChange={(e) => p.actions.setProvider(e.target.value)}
        >
          {!p.providers.length && <option value="">先配置模型</option>}
          {p.providers.map((model) => (
            <option key={model.id} value={model.id}>
              {model.name} · {model.model}
            </option>
          ))}
        </select>
        {!p.providers.length && <a href="/my/models">配置模型</a>}
        {p.running ? (
          <button
            className="dock-send"
            aria-label="停止开发"
            onClick={p.actions.stop}
          >
            <Square size={14} fill="currentColor" />
          </button>
        ) : (
          <button
            className="dock-send"
            aria-label="发送修改需求"
            disabled={
              !p.project || !p.provider || !p.prompt.trim() || p.pending
            }
            onClick={() => {
              setPanel("chat");
              p.actions.run();
            }}
          >
            <ArrowUp size={18} />
          </button>
        )}
      </div>
      <input
        ref={sourceInput}
        type="file"
        hidden
        multiple
        {...{ webkitdirectory: "", directory: "" }}
        onChange={(e) => void importDirectory(e.target.files)}
        aria-label="导入应用源码目录"
      />
    </section>
  );
}
