import { useCallback, useRef, useState } from "react";

// ---- System tools ----

const SYSTEM_TOOLS = [
  {
    name: "getCurrentUser",
    description: "Return the current signed-in user id and name, or null when unauthenticated.",
    parameters: { type: "object", properties: {} },
  },
];

const SYSTEM_TOOL_NAMES = new Set(SYSTEM_TOOLS.map((t) => t.name));

const MAX_TOOL_ROUNDS = 5;

async function executeSystemTool(
  toolName: string,
  _args: Record<string, unknown>,
  _pagePath: string,
): Promise<{ result: unknown; isError?: boolean }> {
  try {
    if (toolName === "getCurrentUser") {
      const res = await fetch("/api/me", { credentials: "include" });
      const body = await res.json();
      if (!body.success || !body.data) return { result: null };
      return { result: { id: body.data.id, name: body.data.name } };
    }
    return { result: `Unknown system tool: ${toolName}`, isError: true };
  } catch (e: unknown) {
    return { result: e instanceof Error ? e.message : String(e), isError: true };
  }
}

// ---- Types ----

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  toolCalls?: Array<{
    id: string;
    name: string;
    args: Record<string, unknown>;
    result?: unknown;
    isError?: boolean;
    status: "running" | "completed" | "timeout";
  }>;
}

interface ToolCallPending {
  resolve: (result: unknown, isError?: boolean) => void;
  timeout: ReturnType<typeof setTimeout>;
}

// ---- SSE stream parser ----

async function parseSSEStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  onDelta: (content: string, toolCalls: Array<{ id: string; name: string; args: string }>) => void,
): Promise<{ content: string; toolCalls: Array<{ id: string; name: string; args: string }> }> {
  const decoder = new TextDecoder();
  let content = "";
  const toolCalls: Array<{ id: string; name: string; args: string }> = [];
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const data = line.slice(6).trim();
      if (data === "[DONE]") continue;
      try {
        const parsed = JSON.parse(data);
        const delta = parsed.choices?.[0]?.delta;
        if (!delta) continue;
        if (delta.content) content += delta.content;
        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            if (tc.id) {
              toolCalls.push({ id: tc.id, name: tc.function?.name || "", args: tc.function?.arguments || "" });
            } else if (toolCalls.length > 0) {
              const last = toolCalls[toolCalls.length - 1];
              if (tc.function?.arguments) last.args += tc.function.arguments;
              if (tc.function?.name) last.name = tc.function.name;
            }
          }
        }
        onDelta(content, toolCalls);
      } catch {
        // Skip unparseable chunks
      }
    }
  }

  return { content, toolCalls };
}

// ---- Hook ----

interface UsePlatformAgentOptions {
  appName: string;
  userName: string | undefined;
  pagePath: string;
  postToolCall: (message: { type: "localapp:tool_call"; callId: string; toolName: string; args: Record<string, unknown> }) => void;
  registeredToolsRef: React.RefObject<Array<{ name: string; description: string; parameters: { type: "object"; properties: Record<string, unknown>; required?: string[] } }>>;
  systemHintRef: React.RefObject<string>;
}

export function usePlatformAgent({
  appName, userName, pagePath, postToolCall, registeredToolsRef, systemHintRef,
}: UsePlatformAgentOptions) {
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const pendingToolCalls = useRef(new Map<string, ToolCallPending>());

  // Send a tool_call to the app registry and wait for result
  const sendToolCallToApp = useCallback((callId: string, toolName: string, args: Record<string, unknown>): Promise<{ result: unknown; isError?: boolean }> => {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        pendingToolCalls.current.delete(callId);
        resolve({ result: "工具执行超时", isError: true });
        setChatMessages((prev) =>
          prev.map((msg) => {
            if (msg.role !== "assistant" || !msg.toolCalls) return msg;
            return {
              ...msg,
              toolCalls: msg.toolCalls.map((tc) =>
                tc.id === callId
                  ? { ...tc, result: "工具执行超时", isError: true, status: "timeout" as const }
                  : tc
              ),
            };
          })
        );
      }, 30_000);

      pendingToolCalls.current.set(callId, { resolve: (result, isError) => resolve({ result, isError }), timeout });
      postToolCall({ type: "localapp:tool_call", callId, toolName, args });
    });
  }, [postToolCall]);

  // Handle tool_result from the app runtime
  const handleToolResult = useCallback((callId: string, result: unknown, isError?: boolean) => {
    const pending = pendingToolCalls.current.get(callId);
    if (pending) {
      clearTimeout(pending.timeout);
      pendingToolCalls.current.delete(callId);
      pending.resolve(result, isError);
      setChatMessages((prev) =>
        prev.map((msg) => {
          if (msg.role !== "assistant" || !msg.toolCalls) return msg;
          return {
            ...msg,
            toolCalls: msg.toolCalls.map((tc) =>
              tc.id === callId
                ? { ...tc, result, isError, status: "completed" as const }
                : tc
            ),
          };
        })
      );
    }
  }, []);

  // Execute a batch of tool calls
  const executeTools = useCallback(async (
    rawToolCalls: Array<{ id: string; name: string; args: string }>,
  ): Promise<Array<{ id: string; name: string; result: string; isError?: boolean }>> => {
    const results = await Promise.all(
      rawToolCalls.map(async (tc) => {
        let args: Record<string, unknown> = {};
        try { args = JSON.parse(tc.args); } catch {}

        let execResult: { result: unknown; isError?: boolean };
        if (SYSTEM_TOOL_NAMES.has(tc.name)) {
          execResult = await executeSystemTool(tc.name, args, pagePath);
        } else {
          execResult = await sendToolCallToApp(tc.id, tc.name, args);
        }
        return { id: tc.id, name: tc.name, result: String(execResult.result), isError: execResult.isError };
      })
    );

    // Update status for system tools; app tools are updated via handleToolResult.
    for (const r of results) {
      if (SYSTEM_TOOL_NAMES.has(r.name)) {
        setChatMessages((prev) =>
          prev.map((msg) => {
            if (msg.role !== "assistant" || !msg.toolCalls) return msg;
            return {
              ...msg,
              toolCalls: msg.toolCalls.map((tc) =>
                tc.id === r.id
                  ? { ...tc, result: r.result, isError: r.isError, status: "completed" as const }
                  : tc
              ),
            };
          })
        );
      }
    }

    return results;
  }, [pagePath, sendToolCallToApp]);

  // Main agent send — multi-round tool execution
  const agentSend = useCallback(async (text: string) => {
    setChatMessages((prev) => [...prev, { role: "user", content: text }]);
    setIsRunning(true);
    setAiError(null);

    const messages: Array<Record<string, unknown>> = [{ role: "user", content: text }];

    const tools = [
      ...SYSTEM_TOOLS.map((t) => ({ type: "function" as const, function: { name: t.name, description: t.description, parameters: t.parameters } })),
      ...(registeredToolsRef.current ?? []).map((t) => ({
        type: "function" as const,
        function: { name: t.name, description: t.description, parameters: t.parameters },
      })),
    ];

    const systemPrompt = [
      "你是一个运行在 LocalApp 应用中的 AI 助手。",
      `当前应用: ${appName}`,
      `当前用户: ${userName ?? "未登录"}`,
      systemHintRef.current,
      "当用户的需求可以映射到工具操作时，必须调用工具执行。",
      "请用中文回复用户。",
    ].filter(Boolean).join("\n");

    try {
      let round = 0;

      while (round < MAX_TOOL_ROUNDS) {
        // Call LLM API
        const res = await fetch("/api/llm/chat", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: [
              { role: "system", content: systemPrompt },
              ...messages,
            ],
            ...(tools.length > 0 ? { tools } : {}),
          }),
        });

        if (!res.ok) throw new Error(`LLM 请求失败: ${res.status}`);

        const reader = res.body?.getReader();
        if (!reader) throw new Error("无响应体");

        // For round > 0, we add a placeholder assistant message that gets updated
        if (round > 0) {
          setChatMessages((prev) => [...prev, { role: "assistant", content: "", toolCalls: [] }]);
        }

        const { content: assistantContent, toolCalls: rawToolCalls } = await parseSSEStream(
          reader,
          round === 0
            ? (content) => {
                setChatMessages((prev) => {
                  const last = prev[prev.length - 1];
                  if (last?.role === "assistant") {
                    return [...prev.slice(0, -1), { ...last, content }];
                  }
                  return [...prev, { role: "assistant", content, toolCalls: [] }];
                });
              }
            : (content) => {
                setChatMessages((prev) => {
                  const last = prev[prev.length - 1];
                  if (last?.role === "assistant") {
                    return [...prev.slice(0, -1), { ...last, content }];
                  }
                  return prev;
                });
              },
        );

        // Parse tool calls for display
        const parsedToolCalls = rawToolCalls.map((tc) => {
          let args: Record<string, unknown> = {};
          try { args = JSON.parse(tc.args); } catch {}
          return { id: tc.id, name: tc.name, args, status: "running" as const };
        });

        // Update the last assistant message with tool call info
        setChatMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last?.role === "assistant") {
            return [...prev.slice(0, -1), { ...last, content: assistantContent, toolCalls: parsedToolCalls.length > 0 ? parsedToolCalls : last.toolCalls }];
          }
          return [...prev, { role: "assistant", content: assistantContent, toolCalls: parsedToolCalls }];
        });

        // No tool calls → done
        if (rawToolCalls.length === 0) break;

        // Execute tools
        const results = await executeTools(rawToolCalls);

        // Append to message history for next round
        messages.push({
          role: "assistant",
          content: assistantContent || "",
          tool_calls: rawToolCalls.map((tc) => ({
            id: tc.id,
            type: "function" as const,
            function: { name: tc.name, arguments: tc.args },
          })),
        });
        for (const r of results) {
          messages.push({ role: "tool", content: JSON.stringify(r), tool_call_id: r.id });
        }

        round++;
      }

      // Ensure at least one assistant message exists
      if (round === 0) {
        setChatMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last?.role === "assistant") return prev;
          return [...prev, { role: "assistant", content: "", toolCalls: [] }];
        });
      }
    } catch (e: unknown) {
      setAiError(e instanceof Error ? e.message : "未知错误");
    } finally {
      setIsRunning(false);
    }
  }, [appName, userName, registeredToolsRef, systemHintRef, executeTools]);

  return { chatMessages, setChatMessages, isRunning, aiError, agentSend, handleToolResult };
}
