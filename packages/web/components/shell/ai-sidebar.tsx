"use client";

import React, { useEffect, useRef, useState, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { X, Send, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

const STORAGE_KEY = "localapp-ai-sidebar-width";
const DEFAULT_WIDTH = 380;
const MIN_WIDTH = 280;
const MAX_WIDTH = 600;
const TOOL_TIMEOUT_MS = 30_000;

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  toolCalls?: ToolCallInfo[];
}

interface ToolCallInfo {
  id: string;
  name: string;
  args: Record<string, unknown>;
  result?: unknown;
  isError?: boolean;
  status: "running" | "completed" | "timeout";
}

interface AiSidebarProps {
  open: boolean;
  onClose: () => void;
  messages: ChatMessage[];
  isRunning: boolean;
  error: string | null;
  onSend: (text: string) => void;
}

export function AiSidebar({ open, onClose, messages, isRunning, error, onSend }: AiSidebarProps) {
  const [width, setWidth] = useState(() => {
    if (typeof window === "undefined") return DEFAULT_WIDTH;
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return DEFAULT_WIDTH;
    const parsed = parseInt(stored, 10);
    return Number.isNaN(parsed) ? DEFAULT_WIDTH : Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, parsed));
  });
  const [input, setInput] = useState("");
  const [dragging, setDragging] = useState(false);
  const viewportRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef({ startX: 0, startWidth: 0 });
  const widthRef = useRef(width);
  widthRef.current = width;

  // Auto-scroll on new messages
  useEffect(() => {
    const el = viewportRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  // Drag handling
  const handleDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setDragging(true);
    dragRef.current = { startX: e.clientX, startWidth: width };
  }, [width]);

  useEffect(() => {
    if (!dragging) return;

    function onMouseMove(e: MouseEvent) {
      const delta = dragRef.current.startX - e.clientX;
      const newWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, dragRef.current.startWidth + delta));
      setWidth(newWidth);
    }

    function onMouseUp() {
      setDragging(false);
      document.body.style.userSelect = "";
      localStorage.setItem(STORAGE_KEY, String(widthRef.current));
    }

    document.body.style.userSelect = "none";

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [dragging, width]);

  const handleSend = () => {
    const text = input.trim();
    if (!text || isRunning) return;
    onSend(text);
    setInput("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div
      className="absolute right-0 top-0 bottom-0 z-50 flex flex-col border-l bg-background shadow-lg transition-transform duration-300 ease-in-out"
      style={{ width, transform: open ? "translateX(0)" : "translateX(100%)" }}
    >
      {/* Drag handle */}
      <div
        className="absolute left-0 top-0 bottom-0 cursor-col-resize group"
        style={{ width: 8, marginLeft: -4 }}
        onMouseDown={handleDragStart}
      >
        <div className="h-full w-1 mx-auto rounded-full transition-colors group-hover:bg-primary/30"
          style={dragging ? { backgroundColor: "var(--color-primary)" } : undefined}
        />
      </div>

      {/* Header */}
      <div className="flex items-center justify-between border-b px-3 py-2">
        <span className="text-sm font-medium">AI 助手</span>
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onClose}>
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Error bar */}
      {error && (
        <div className="border-b bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}

      {/* Messages viewport */}
      <div ref={viewportRef} className="flex-1 overflow-y-auto px-3 py-2 space-y-3 text-sm">
        {messages.length === 0 && (
          <p className="py-8 text-center text-muted-foreground text-xs">
            发送消息开始对话
          </p>
        )}
        {messages.map((msg, i) =>
          msg.role === "user" ? (
            <UserBubble key={i} text={msg.content} />
          ) : (
            <AssistantBubble key={i} text={msg.content} toolCalls={msg.toolCalls} />
          ),
        )}
        {isRunning && messages[messages.length - 1]?.role === "user" && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            思考中...
          </div>
        )}
      </div>

      {/* Composer */}
      <div className="border-t px-3 py-2">
        <div className="flex gap-2">
          <input
            className="flex-1 rounded-md border bg-transparent px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-primary"
            placeholder="输入消息..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isRunning}
          />
          <Button
            size="icon"
            className="h-8 w-8 flex-shrink-0"
            onClick={handleSend}
            disabled={!input.trim() || isRunning}
          >
            <Send className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}

function UserBubble({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[80%] rounded-2xl rounded-br-sm bg-primary px-3 py-2 text-sm text-primary-foreground whitespace-pre-wrap">
        {text}
      </div>
    </div>
  );
}

function AssistantBubble({ text, toolCalls }: { text: string; toolCalls?: ToolCallInfo[] }) {
  return (
    <div className="flex justify-start">
      <div className="max-w-[80%] space-y-1.5">
        {text && (
          <div className="rounded-2xl rounded-bl-sm bg-muted px-3 py-2 text-sm leading-relaxed prose prose-sm max-w-none">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
          </div>
        )}
        {toolCalls?.map((tc) => (
          <ToolCallCard key={tc.id} tc={tc} />
        ))}
      </div>
    </div>
  );
}

function ToolCallCard({ tc }: { tc: ToolCallInfo }) {
  const hasResult = tc.status === "completed" || tc.status === "timeout";
  const hasArgs = tc.args && Object.keys(tc.args).length > 0;
  const [expanded, setExpanded] = useState(!hasResult);

  useEffect(() => {
    if (hasResult) setExpanded(false);
  }, [hasResult]);

  const resultText = tc.result !== undefined
    ? (typeof tc.result === "string" ? tc.result : JSON.stringify(tc.result))
    : "";
  const summary = resultText.slice(0, 60);
  const icon = tc.status === "running" ? "⏳" : tc.isError ? "✗" : "✓";
  const iconColor = tc.isError ? "text-destructive" : "text-primary";

  return (
    <div
      className="rounded-md bg-primary/5 px-2.5 py-1.5 text-xs"
      onClick={hasResult ? () => setExpanded((p) => !p) : undefined}
      style={{ cursor: hasResult ? "pointer" : "default" }}
    >
      <div className={`flex items-center gap-1.5 font-medium ${iconColor}`}>
        <span>{icon}</span>
        <span>{tc.name}</span>
        {!expanded && summary && (
          <span className="flex-1 truncate font-normal text-muted-foreground">
            {summary}{resultText.length > 60 ? "…" : ""}
          </span>
        )}
        {hasResult && (
          <span className="ml-auto flex-shrink-0 font-normal text-muted-foreground text-[10px]">
            {expanded ? "▲ 折叠" : "▼ 展开"}
          </span>
        )}
      </div>
      {expanded && (
        <>
          {hasArgs && (
            <pre className="mt-1 text-[11px] text-muted-foreground whitespace-pre-wrap">
              {JSON.stringify(tc.args, null, 2)}
            </pre>
          )}
          {tc.result !== undefined && (
            <pre className={`mt-1 text-[11px] whitespace-pre-wrap ${tc.isError ? "text-destructive" : "text-green-700"}`}>
              {typeof tc.result === "string" ? tc.result : JSON.stringify(tc.result, null, 2)}
            </pre>
          )}
        </>
      )}
    </div>
  );
}
