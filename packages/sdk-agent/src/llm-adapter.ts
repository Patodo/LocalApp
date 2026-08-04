import type { AssistantMessage, Context, Model, SimpleStreamOptions, AssistantMessageEventStream } from "@earendil-works/pi-ai";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";

export interface LlmAdapterOptions {
  proxyUrl: string;
}

export function createStreamFn(options: LlmAdapterOptions) {
  return (
    _model: Model<any>,
    context: Context,
    _options?: SimpleStreamOptions,
  ): AssistantMessageEventStream => {
    const stream = createAssistantMessageEventStream();
    const apiBase = options.proxyUrl;

    (async () => {
      try {
        const res = await fetch(`${apiBase}/api/llm/chat`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: [
              ...(context.systemPrompt ? [{ role: "system", content: context.systemPrompt }] : []),
              ...(context.messages ?? []).map((m) => {
              if (m.role === "user") {
                return {
                  role: "user",
                  content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
                };
              }
              if (m.role === "assistant") {
                const text = m.content
                  .filter((c: any) => c.type === "text")
                  .map((c: any) => c.text)
                  .join("");
                const toolCalls = m.content
                  .filter((c: any) => c.type === "toolCall")
                  .map((c: any) => ({
                    id: c.id,
                    type: "function",
                    function: { name: c.name, arguments: typeof c.arguments === "string" ? c.arguments : JSON.stringify(c.arguments) },
                  }));
                const msg: any = { role: "assistant", content: text || null };
                if (toolCalls.length > 0) msg.tool_calls = toolCalls;
                if ((m as any).reasoning_content) msg.reasoning_content = (m as any).reasoning_content;
                return msg;
              }
              if (m.role === "toolResult") {
                const text = m.content
                  .filter((c: any) => c.type === "text")
                  .map((c: any) => c.text)
                  .join("\n");
                return { role: "tool", content: text, tool_call_id: m.toolCallId };
              }
              return null;
            }).filter(Boolean)],
            tools: context.tools?.map((t) => ({
              type: "function",
              function: {
                name: t.name,
                description: t.description,
                parameters: t.parameters,
              },
            })),
          }),
        });

        if (!res.ok) {
          const errText = await res.text().catch(() => "Unknown error");
          const errorMsg = res.status === 401 ? "请先登录" : `LLM 请求失败: ${errText}`;
          stream.push({
            type: "error",
            reason: "error",
            error: {
              role: "assistant",
              content: [{ type: "text", text: errorMsg }],
              api: "openai",
              provider: "proxy",
              model: "unknown",
              usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
              stopReason: "error",
              errorMessage: errorMsg,
              timestamp: Date.now(),
            },
          });
          stream.end();
          return;
        }

        if (!res.body) {
          stream.push({
            type: "error",
            reason: "error",
            error: {
              role: "assistant",
              content: [{ type: "text", text: "Empty response" }],
              api: "openai",
              provider: "proxy",
              model: "unknown",
              usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
              stopReason: "error",
              errorMessage: "Empty response body",
              timestamp: Date.now(),
            },
          });
          stream.end();
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let contentIndex = 0;
        let fullText = "";
        let fullReasoning = "";
        let started = false;
        const toolCallBuffers: Map<number, { id: string; name: string; args: string }> = new Map();

        const partial: AssistantMessage = {
          role: "assistant",
          content: [],
          api: "openai",
          provider: "proxy",
          model: "unknown",
          usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
          stopReason: "stop",
          timestamp: Date.now(),
        };

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("data: ")) continue;
            const data = trimmed.slice(6);
            if (data === "[DONE]") {
              if (started && fullText) {
                stream.push({ type: "text_end", contentIndex, content: fullText, partial });
              }
              for (const [idx, buf] of toolCallBuffers) {
                if (!partial.content.some((c: any) => c.type === "toolCall" && c.id === buf.id)) {
                  let parsedArgs: Record<string, any> = {};
                  try { parsedArgs = JSON.parse(buf.args); } catch { parsedArgs = { raw: buf.args }; }
                  const toolCall = { type: "toolCall" as const, id: buf.id, name: buf.name, arguments: parsedArgs };
                  partial.content.push(toolCall);
                  stream.push({ type: "toolcall_end", contentIndex, toolCall, partial });
                  contentIndex++;
                }
              }
              const reason: "stop" | "toolUse" = toolCallBuffers.size > 0 ? "toolUse" : "stop";
              stream.push({ type: "done", reason, message: { ...partial, stopReason: reason } });
              stream.end();
              return;
            }

            try {
              const chunk = JSON.parse(data);
              if (chunk.error) {
                const errMsg = chunk.error?.message || chunk.error;
                stream.push({
                  type: "error",
                  reason: "error",
                  error: {
                    ...partial,
                    content: [{ type: "text", text: String(errMsg) }],
                    stopReason: "error",
                    errorMessage: String(errMsg),
                  },
                });
                stream.end();
                return;
              }

              const delta = chunk.choices?.[0]?.delta;
              if (delta?.reasoning_content) {
                fullReasoning += delta.reasoning_content;
                (partial as any).reasoning_content = fullReasoning;
              }
              if (delta?.content) {
                if (!started) {
                  stream.push({ type: "start", partial });
                  stream.push({ type: "text_start", contentIndex, partial });
                  started = true;
                }
                fullText += delta.content;
                partial.content = [{ type: "text" as const, text: fullText }];
                stream.push({ type: "text_delta", contentIndex, delta: delta.content, partial });
              }

              if (delta?.tool_calls) {
                for (const tc of delta.tool_calls) {
                  const idx = tc.index ?? 0;
                  if (!toolCallBuffers.has(idx)) {
                    toolCallBuffers.set(idx, { id: tc.id || `tc_${Date.now()}`, name: tc.function?.name || "", args: "" });
                    if (!started) {
                      stream.push({ type: "start", partial });
                      started = true;
                    }
                    stream.push({ type: "toolcall_start", contentIndex, partial });
                  }
                  const buf = toolCallBuffers.get(idx)!;
                  if (tc.function?.name) buf.name = tc.function.name;
                  if (tc.function?.arguments) {
                    buf.args += tc.function.arguments;
                    stream.push({ type: "toolcall_delta", contentIndex, delta: tc.function.arguments, partial });
                  }
                }
              }

              if (chunk.choices?.[0]?.finish_reason === "tool_calls") {
                for (const [idx, buf] of toolCallBuffers) {
                  let parsedArgs: Record<string, any> = {};
                  try { parsedArgs = JSON.parse(buf.args); } catch { parsedArgs = { raw: buf.args }; }
                  const toolCall = { type: "toolCall" as const, id: buf.id, name: buf.name, arguments: parsedArgs };
                  partial.content.push(toolCall);
                  stream.push({ type: "toolcall_end", contentIndex, toolCall, partial });
                  contentIndex++;
                }
              }
            } catch {
              // Skip unparseable lines
            }
          }
        }

        // Stream ended without [DONE]
        if (!started) {
          stream.push({ type: "start", partial });
        }
        stream.push({ type: "done", reason: "stop", message: partial });
        stream.end();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        stream.push({
          type: "error",
          reason: "error",
          error: {
            role: "assistant",
            content: [{ type: "text", text: msg }],
            api: "openai",
            provider: "proxy",
            model: "unknown",
            usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
            stopReason: "error",
            errorMessage: msg,
            timestamp: Date.now(),
          },
        });
        stream.end();
      }
    })();

    return stream;
  };
}
