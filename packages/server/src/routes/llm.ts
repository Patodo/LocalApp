import { FastifyInstance } from "fastify";

interface ChatMessage {
  role: string;
  content: string;
}

interface ChatRequest {
  messages?: ChatMessage[] | unknown;
  model?: string;
  tools?: unknown;
}

export async function llmRoutes(app: FastifyInstance) {
  app.post<{ Body: ChatRequest }>("/api/llm/chat", async (req, reply) => {
    if (!app.config.llmApiKey) {
      return reply.status(503).send({ success: false, error: "LLM service not configured" });
    }

    const { messages } = req.body ?? {};
    if (!messages) {
      return reply.status(400).send({ success: false, error: "messages is required" });
    }
    if (!Array.isArray(messages)) {
      return reply.status(400).send({ success: false, error: "messages must be an array" });
    }

    const model = req.body.model || app.config.llmModel;
    const baseUrl = app.config.llmBaseUrl;
    const apiKey = app.config.llmApiKey;

    let llmRes: Response;
    try {
      llmRes = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ model, messages, stream: true, ...(req.body.tools ? { tools: req.body.tools } : {}) }),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.status(502).send({ success: false, error: msg });
    }

    // LLM 返回非 2xx — 尝试以 SSE 格式透传错误
    if (!llmRes.ok) {
      const errText = await llmRes.text().catch(() => "Unknown upstream error");
      return reply.status(502).send({ success: false, error: errText });
    }

    // 切换到 SSE 流式响应
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    if (!llmRes.body) {
      reply.raw.write(`data: ${JSON.stringify({ error: { message: "Empty response body" } })}\n\n`);
      reply.raw.write("data: [DONE]\n\n");
      reply.raw.end();
      return await reply;
    }

    const reader = llmRes.body.getReader();
    const decoder = new TextDecoder();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        reply.raw.write(decoder.decode(value, { stream: true }));
      }
    } catch (streamErr) {
      const msg = streamErr instanceof Error ? streamErr.message : String(streamErr);
      reply.raw.write(`data: ${JSON.stringify({ error: { message: msg } })}\n\n`);
      reply.raw.write("data: [DONE]\n\n");
    }

    reply.raw.end();
    return await reply;
  });
}
