import React, { useEffect, useMemo, useState } from "react";
import {
  useExternalStoreRuntime,
  AssistantRuntimeProvider,
  ThreadPrimitive,
  ComposerPrimitive,
  MessagePrimitive,
} from "@assistant-ui/react";
import type { ThreadMessageLike } from "@assistant-ui/react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { UseAgentReturn } from "./types.js";
import { convertMessages } from "./assistant-ui-adapter.js";

interface AgentChatProps {
  agent: UseAgentReturn;
}

export function AgentChat({ agent }: AgentChatProps) {
  const { send, messages, isRunning, error } = agent;
  const threadMessages = useMemo(() => {
    const converted = convertMessages(messages);
    if (isRunning && converted.length > 0 && converted[converted.length - 1].role === "assistant") {
      const last = converted[converted.length - 1];
      converted[converted.length - 1] = { ...last, status: { type: "running" } };
    }
    return converted;
  }, [messages, isRunning]);

  const runtime = useExternalStoreRuntime<ThreadMessageLike>({
    messages: threadMessages,
    isRunning,
    onNew: async (msg) => {
      const text = msg.content
        .filter((p: any) => p.type === "text")
        .map((p: any) => p.text)
        .join("");
      if (text) send(text);
    },
    convertMessage: (msg) => msg,
  });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <div style={{ display: "flex", flexDirection: "column", height: "100%", fontSize: 14 }}>
        {error && (
          <div style={{ padding: "8px 12px", background: "#fff3e0", color: "#d84315", borderBottom: "1px solid #ffe0b2", fontSize: 13 }}>
            {error}
          </div>
        )}
        <ThreadPrimitive.Root style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <ThreadPrimitive.Viewport style={{ flex: 1, overflowY: "auto", padding: 12 }}>
            <ThreadPrimitive.Messages>
              {({ message }) => {
                if (message.role === "user") return <UserMessage />;
                return <AssistantMessage isRunning={isRunning} />;
              }}
            </ThreadPrimitive.Messages>
          </ThreadPrimitive.Viewport>
          <ThreadPrimitive.ViewportFooter>
            <Composer />
          </ThreadPrimitive.ViewportFooter>
        </ThreadPrimitive.Root>
      </div>
    </AssistantRuntimeProvider>
  );
}

function UserMessage() {
  return (
    <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
      <div style={{ maxWidth: "70%", padding: "8px 12px", background: "#1976d2", color: "white", borderRadius: "12px 12px 2px 12px", whiteSpace: "pre-wrap" }}>
        <MessagePrimitive.Root>
          <MessagePrimitive.Parts>
            {({ part }) => {
              if (part.type === "text" && part.text) return <>{part.text}</>;
              return null;
            }}
          </MessagePrimitive.Parts>
        </MessagePrimitive.Root>
      </div>
    </div>
  );
}

function AssistantMessage({ isRunning }: { isRunning: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "flex-start", marginBottom: 8 }}>
      <div style={{ maxWidth: "70%", display: "flex", flexDirection: "column", gap: 4 }}>
        <MessagePrimitive.Root>
          <MessagePrimitive.Parts>
            {({ part }) => {
              if (part.type === "text") {
                return (
                  <div style={{ padding: "8px 12px", background: "#f5f5f5", borderRadius: "12px 12px 12px 2px", lineHeight: 1.6 }}>
                    <div className="markdown-body">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{part.text}</ReactMarkdown>
                    </div>
                  </div>
                );
              }
              if (part.type === "tool-call") {
                return <ToolCallDisplay toolName={part.toolName} args={part.args} result={part.result} isRunning={isRunning} />;
              }
              return null;
            }}
          </MessagePrimitive.Parts>
        </MessagePrimitive.Root>
      </div>
    </div>
  );
}

function ToolCallDisplay({ toolName, args, result, isRunning }: { toolName: string; args?: any; result?: any; isRunning?: boolean }) {
  const hasResult = result !== undefined;
  const hasArgs = args && Object.keys(args).length > 0;
  const [expanded, setExpanded] = useState(!hasResult);

  useEffect(() => {
    if (hasResult && !isRunning) setExpanded(false);
  }, [hasResult, isRunning]);

  const fullResult = hasResult
    ? (typeof result === "string" ? result : JSON.stringify(result))
    : "";
  const summary = fullResult.slice(0, 60);

  const toggle = () => setExpanded((prev) => !prev);

  return (
    <div
      onClick={hasResult ? toggle : undefined}
      style={{
        padding: "6px 10px",
        background: "#e3f2fd",
        borderRadius: 6,
        fontSize: 12,
        cursor: hasResult ? "pointer" : "default",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6, color: "#1565c0", fontWeight: 500 }}>
        <span>{hasResult ? "✓" : "⏳"}</span>
        <span>{toolName}</span>
        {!expanded && summary && (
          <span style={{ fontWeight: 400, color: "#666", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
            {summary}{fullResult.length > 60 ? "…" : ""}
          </span>
        )}
        {hasResult && (
          <span style={{ marginLeft: "auto", fontSize: 11, fontWeight: 400, color: "#1976d2", flexShrink: 0 }}>
            {expanded ? "▲ 折叠" : "▼ 展开"}
          </span>
        )}
      </div>

      {expanded && (
        <>
          {hasArgs && (
            <pre style={{ margin: "4px 0 0", fontSize: 11, color: "#666", whiteSpace: "pre-wrap" }}>
              {JSON.stringify(args, null, 2)}
            </pre>
          )}
          {hasResult && (
            <pre style={{ margin: "4px 0 0", fontSize: 11, color: "#2e7d32", whiteSpace: "pre-wrap" }}>
              {typeof result === "string" ? result : JSON.stringify(result, null, 2)}
            </pre>
          )}
        </>
      )}
    </div>
  );
}

function Composer() {
  return (
    <ComposerPrimitive.Root style={{ display: "flex", borderTop: "1px solid #e0e0e0", padding: 8, gap: 8, background: "#fafafa" }}>
      <ComposerPrimitive.Input
        placeholder="输入消息..."
        style={{ flex: 1, padding: "8px 12px", border: "1px solid #ddd", borderRadius: 6, outline: "none", fontSize: 14 }}
      />
      <ComposerPrimitive.Send
        style={{ padding: "8px 16px", background: "#1976d2", color: "white", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 14 }}
      >
        发送
      </ComposerPrimitive.Send>
    </ComposerPrimitive.Root>
  );
}
