"use client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowUp,
  Minus,
  CircleAlert,
  UserRound,
  ArrowLeftRight,
  Settings,
  Square,
  Maximize2,
  Minimize2,
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import "./app-development-dock.css";

export interface DockIdentityProps {
  identity?: "developer" | "user";
  onIdentityChange?: (identity: "developer" | "user") => void;
  userConversation?: DevelopmentShellProps;
  reveal?: number;
  userInteractions?: ReactNode;
  minimize?: number;
  onVisibilityChange?: (visible: boolean) => void;
}
export function AppDevelopmentDock(
  input: DevelopmentShellProps & DockIdentityProps & {
    application?: { owner: string; name: string };
    importSource?: (files: Record<string, string>) => Promise<void>;
  },
) {
  const userMode = input.identity === "user";
  const p = userMode && input.userConversation ? { ...input, ...input.userConversation } : input;
  const [expanded, setExpanded] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [previewVisible, setPreviewVisible] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const historyTrigger = useRef<HTMLButtonElement>(null);
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
  const conversationTitle = p.sessions.find(item => item.id === p.selectedSession)?.title || (p.selectedSession ? "未命名对话" : "新对话");
  useEffect(() => {
    if (input.reveal) { setMinimized(false); setExpanded(true); setPanel("chat"); }
  }, [input.reveal]);
  useEffect(() => { if (input.minimize) setMinimized(true); }, [input.minimize]);
  useEffect(() => { setPanel("chat"); }, [input.identity]);
  const switchIdentity = input.onIdentityChange ? (
    <Button variant="unstyled" size="none" type="button" className="dock-identity"
      disabled={p.running || p.pending || !!input.userConversation?.running || !!input.running || ["queued", "running"].includes(input.build?.status)}
      aria-label="切换对话身份" title={userMode ? "切换为开发者" : "切换为用户"}
      onClick={() => input.onIdentityChange?.(userMode ? "developer" : "user")}>
      {userMode ? <UserRound size={15} /> : <Code2 size={15} />}
      {userMode ? "用户" : "开发者"}<ArrowLeftRight size={13} />
    </Button>
  ) : null;
  const building = ["queued", "running"].includes(p.build?.status);
  const ready = p.build?.status === "succeeded";
  const working = p.running || building || importing;
  let finalReply = "";
  for (let i = p.messages.length - 1; i >= 0; i--) {
    const message = p.messages[i];
    if (message.role === "user") break;
    if (message.role !== "assistant") continue;
    if (
      Array.isArray(message.content) &&
      message.content.some(
        (block: any) => block.type === "toolCall" || block.type === "tool-call",
      )
    )
      continue;
    const text =
      typeof message.content === "string"
        ? message.content
        : (message.content ?? [])
            .filter((block: any) => block.type === "text")
            .map((block: any) => block.text ?? "")
            .join("\n");
    if (text.trim()) {
      finalReply = text;
      break;
    }
  }
  const completion = p.error || (working ? "" : p.live || finalReply);
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
  if (minimized)
    return (
      <section
        className="development-mini dsh-development"
        aria-label={userMode ? "已最小化的应用对话" : "已最小化的开发对话"}
        onMouseEnter={() => setPreviewVisible(true)}
        onMouseLeave={() => setPreviewVisible(false)}
        onFocusCapture={() => setPreviewVisible(true)}
        onBlurCapture={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node))
            setPreviewVisible(false);
        }}
      >
        {!working && completion && previewVisible && (
          <div
            className="development-mini-preview"
            role="tooltip"
            id="development-mini-reply"
          >
            <Button variant="unstyled" size="none"
              className="development-mini-dismiss"
              aria-label="关闭消息预览"
              onClick={() => setPreviewVisible(false)}
            >
              <X size={14} />
            </Button>
            <strong>
              {p.error ? <CircleAlert size={17} /> : <Check size={17} />}
              {conversationTitle}
            </strong>
            <div className="development-mini-message">
              <DshMarkdown text={completion} />
            </div>
          </div>
        )}
        <Button variant="unstyled" size="none"
          className="development-mini-restore"
          aria-label={working ? "任务进行中，恢复对话" : userMode ? "恢复应用对话" : "恢复开发对话"}
          aria-describedby={
            !working && completion && previewVisible
              ? "development-mini-reply"
              : undefined
          }
          onClick={() => {
            setMinimized(false);
            input.onVisibilityChange?.(true);
            setPreviewVisible(false);
          }}
        >
          {working ? (
            <LoaderCircle className="dock-spinner" size={23} />
          ) : (
            <MessageSquare size={23} />
          )}
          {!working && completion && (
            <span className="development-mini-dot" aria-hidden="true" />
          )}
        </Button>
        {working && (
          <span className="sr-only" role="status">
            {p.interaction ? "Agent 等待回复" : "开发任务进行中"}
          </span>
        )}
      </section>
    );
  return (
    <section
      className={`app-development-dock dsh-development ${expanded ? "is-expanded" : ""} ${p.running ? "is-running" : ""}`}
      aria-label={userMode ? "应用 AI 对话" : "应用开发对话"}
    >
      <header className="development-dock-header">
        <Button variant="unstyled" size="none"
          aria-label={userMode ? "最小化应用对话" : "最小化开发对话"}
          title="最小化"
          onClick={() => {
            setHistoryOpen(false);
            setMinimized(true);
            input.onVisibilityChange?.(false);
          }}
        >
          <Minus size={16} />
        </Button>
        {p.running && <LoaderCircle className="dock-spinner" size={15} />}
        <DropdownMenu open={historyOpen} onOpenChange={setHistoryOpen}>
          <DropdownMenuTrigger asChild>
          <Button variant="unstyled" size="none"
            ref={historyTrigger}
            className="dock-title"
            aria-label="切换历史对话"
            aria-haspopup="menu"
            aria-expanded={historyOpen}
            disabled={p.running || p.pending || (!p.project && !input.onIdentityChange)}
          >
            {conversationTitle}
            <ChevronDown size={14} />
          </Button>
          </DropdownMenuTrigger>
            <DropdownMenuContent
              className="dock-history-menu"
              aria-labelledby=""
              side={expanded ? "bottom" : "top"}
              align="start"
              aria-label={userMode ? "应用历史对话" : "开发历史对话"}
            >
              {switchIdentity && <DropdownMenuItem asChild onSelect={event => event.preventDefault()}>{switchIdentity}</DropdownMenuItem>}
              <DropdownMenuRadioGroup value={p.selectedSession || "new"}>
              <DropdownMenuRadioItem asChild value="new"><Button variant="unstyled" size="none"
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
              </Button></DropdownMenuRadioItem>
              {[...p.sessions]
                .sort(
                  (a, b) =>
                    new Date(b.createdAt).getTime() -
                    new Date(a.createdAt).getTime(),
                )
                .map((session) => (
                  <DropdownMenuRadioItem key={session.id} asChild value={session.id}><Button variant="unstyled" size="none"
                    onClick={() => {
                      p.actions.selectSession(session.id);
                      setPanel("chat");
                      setHistoryOpen(false);
                      historyTrigger.current?.focus();
                    }}
                  >
                    <MessageSquare size={16} />
                    <span>
                      {session.title || "未命名对话"}
                    </span>
                    {p.selectedSession === session.id && <Check size={15} />}
                  </Button></DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
              {!p.sessions.length && <p>暂无历史对话</p>}
            </DropdownMenuContent>
        </DropdownMenu>
        {!userMode && <a
          href={
            p.project
              ? `/my/development?projectId=${encodeURIComponent(p.project.id)}`
              : "/my/development"
          }
          title="打开完整开发页"
          aria-label="打开完整开发页"
        >
          <Code2 size={17} />
        </a>}
        {userMode && <a href={`/my/agent?${new URLSearchParams({ appId: `${p.application?.owner}/${p.application?.name}` })}`}
          title="应用 Agent 设置" aria-label="应用 Agent 设置"><Settings size={17} /></a>}
        <Button variant="unstyled" size="none"
          aria-label={userMode ? expanded ? "收起应用对话" : "展开应用对话" : expanded ? "收起开发对话" : "展开开发对话"}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
        </Button>
      </header>
      {expanded && (
        <>
          {!userMode && p.project ? (
            <nav className="development-dock-tools" aria-label="开发操作">
              <Button variant="unstyled" size="none"
                aria-pressed={panel === "chat"}
                onClick={() => setPanel("chat")}
              >
                对话
              </Button>
              <Button variant="unstyled" size="none"
                onClick={() => {
                  setPanel("changes");
                  p.actions.diff();
                }}
              >
                <GitCompareArrows size={15} />
                改动
              </Button>
              <Button variant="unstyled" size="none"
                disabled={p.pending || p.running || building}
                onClick={() => {
                  setPanel("build");
                  p.actions.build();
                }}
              >
                <Hammer size={15} />
                检查与构建
              </Button>
              <Button variant="unstyled" size="none"
                disabled={!ready || p.pending || p.running}
                onClick={p.actions.preview}
              >
                <Eye size={15} />
                预览
              </Button>
              <Button variant="unstyled" size="none"
                disabled={!ready || p.pending || p.running}
                onClick={p.actions.publish}
              >
                <Rocket size={15} />
                上线
              </Button>
            </nav>
          ) : null}
          <div
            className="development-dock-transcript"
            ref={transcript}
            role="log"
            aria-label={userMode ? "应用对话记录" : "开发对话记录"}
          >
            {!p.project && !p.pending && (
              <div className="development-source-empty">
                <FolderUp size={25} />
                <strong>接入这个应用的源码</strong>
                <p>
                  安装包只有构建产物。选择原项目目录后，即可在这里对话修改、检查、预览并上线。
                </p>
                <Button variant="unstyled" size="none"
                  disabled={importing}
                  onClick={() => sourceInput.current?.click()}
                >
                  {importing ? "正在导入…" : "选择源码目录"}
                </Button>
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
                    {userMode ? "告诉 AI 你想在应用中完成什么，它会使用应用提供的工具。" : "描述你想修改的功能。修改先保存在源码中，检查和预览后再上线。"}
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
                    <Button variant="unstyled" size="none" onClick={p.actions.cancelBuild}>取消构建</Button>
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
            {userMode && input.userInteractions}
            {!userMode && p.interaction && (
              <div className="dock-interaction">
                {p.interaction.kind === "approval" ? (
                  <>
                    <p>
                      {p.interaction.toolName}：{p.interaction.reason}
                    </p>
                    <Button variant="unstyled" size="none" onClick={() => p.actions.respond("allowed-once")}>
                      允许本次
                    </Button>
                    <Button variant="unstyled" size="none" onClick={() => p.actions.respond("rejected")}>
                      拒绝
                    </Button>
                  </>
                ) : (
                  <>
                    <p>
                      {p.interaction.questions
                        ?.map((q: any) => q.question)
                        .join("\n")}
                    </p>
                    <Textarea
                      aria-label="回答 Agent"
                      value={p.answer}
                      onChange={(e) => p.actions.setAnswer(e.target.value)}
                    />
                    <Button variant="unstyled" size="none"
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
                    </Button>
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
              <Button variant="unstyled" size="none"
                aria-label={`移除附件 ${file.name}`}
                disabled={p.running || p.pending}
                onClick={() => p.actions.removeAttachment?.(file.id)}
              >
                <X size={13} />
              </Button>
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
        <Button variant="unstyled" size="none"
          aria-label="上传文件"
          disabled={p.running || p.pending || !p.project || !p.actions.upload}
          onClick={() => attachmentInput.current?.click()}
        >
          <Plus size={20} />
        </Button>
        <Textarea
          ref={draft}
          rows={1}
          aria-label={userMode ? "应用对话消息" : "应用修改需求"}
          placeholder={
            userMode ? "向应用 AI 提问…" : p.project ? "描述你想修改的功能…" : "与 Agent 一起编辑应用…"
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
        <Select value={p.provider || undefined} disabled={p.running || p.pending || !p.providers.length} onValueChange={p.actions.setProvider}>
          <SelectTrigger className="dock-model-trigger" aria-label={userMode ? "对话模型" : "开发模型"}>
            <SelectValue placeholder="先配置模型" />
          </SelectTrigger>
          <SelectContent side="top" align="end" sideOffset={8}>
            {p.providers.map((model) => (
              <SelectItem key={model.id} value={model.id}>{model.name} · {model.model}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {!p.providers.length && <a href="/my/models">配置模型</a>}
        {p.running ? (
          <Button variant="unstyled" size="none"
            className="dock-send"
            aria-label={userMode ? "停止对话" : "停止开发"}
            onClick={p.actions.stop}
          >
            <Square size={14} fill="currentColor" />
          </Button>
        ) : (
          <Button variant="unstyled" size="none"
            className="dock-send"
            aria-label={userMode ? "发送对话消息" : "发送修改需求"}
            disabled={
              !p.project || !p.provider || !p.prompt.trim() || p.pending
            }
            onClick={() => {
              setPanel("chat");
              p.actions.run();
            }}
          >
            <ArrowUp size={18} />
          </Button>
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
