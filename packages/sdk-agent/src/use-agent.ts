import { useState, useRef, useCallback, useEffect } from "react";
import { Agent } from "@earendil-works/pi-agent-core";
import type { AgentMessage, AgentEvent } from "@earendil-works/pi-agent-core";
import { createStreamFn } from "./llm-adapter.js";
import { createSystemTools, convertUserTool } from "./tools.js";
import { fetchSchemaContext, buildSystemPrompt, buildSystemContext } from "./context.js";
import { postToParent, isToggleChatMessage } from "./postmessage-types.js";
import type { UseAgentOptions, UseAgentReturn, UserToolDef } from "./types.js";

export function parseAppName(): string | null {
  const pathname = window.location.pathname;
  const match = pathname.match(/^\/serve\/[^/]+\/([^/]+)/);
  return match ? match[1] : null;
}

export async function fetchUser(): Promise<{ name: string } | null> {
  try {
    const res = await fetch("/api/me", { credentials: "include" });
    if (!res.ok) return { name: "未知" };
    const body = await res.json();
    if (!body.success || !body.data) return null;
    return { name: body.data.name };
  } catch {
    return { name: "未知" };
  }
}

export function useAgent(options?: UseAgentOptions): UseAgentReturn {
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [chatOpen, setChatOpen] = useState(false);

  const agentRef = useRef<Agent | null>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    let cancelled = false;

    async function init() {
      const proxyUrl = window.location.origin;
      const streamFn = createStreamFn({ proxyUrl });
      const appName = parseAppName();

      const [user, schemaCtx] = await Promise.all([
        fetchUser(),
        fetchSchemaContext(),
      ]);
      if (cancelled) return;

      const systemContext = buildSystemContext(user, appName);
      const systemPrompt = buildSystemPrompt(systemContext, schemaCtx, optionsRef.current?.systemHint);
      const tools = [...createSystemTools()];
      for (const name of Object.keys(optionsRef.current?.tools ?? {})) {
        tools.push(convertUserTool(name, () => (optionsRef.current?.tools ?? {})[name] as UserToolDef));
      }

      const agent = new Agent({
        streamFn,
        initialState: { systemPrompt },
      });
      agent.state.tools = tools;

      agent.subscribe((event: AgentEvent) => {
        if (cancelled) return;
        handleEvent(event);
      });

      agentRef.current = agent;
    }

    function handleEvent(event: AgentEvent) {
      switch (event.type) {
        case "agent_start":
          setIsRunning(true);
          setError(null);
          break;
        case "agent_end":
          setIsRunning(false);
          setMessages([...agentRef.current!.state.messages]);
          break;
        case "message_end":
          setMessages([...agentRef.current!.state.messages]);
          break;
        case "message_update":
          setMessages([...agentRef.current!.state.messages]);
          break;
        case "tool_execution_start":
        case "tool_execution_end":
          setMessages([...agentRef.current!.state.messages]);
          break;
      }

      if (event.type === "message_end" || event.type === "agent_end") {
        const errMsg = agentRef.current?.state.errorMessage;
        if (errMsg) setError(errMsg);
      }
    }

    init();

    return () => {
      cancelled = true;
      if (agentRef.current) {
        agentRef.current.abort();
      }
    };
  }, []);

  const send = useCallback((text: string) => {
    if (!agentRef.current) return;
    if (agentRef.current.state.isStreaming) return;
    setError(null);
    agentRef.current.prompt(text);
  }, []);

  // Shell integration: listen for toggle_chat from parent
  useEffect(() => {
    if (!optionsRef.current?.shellIntegration) return;

    // Declare custom mode to Shell
    postToParent({ type: "localapp:ai_custom_mode" });

    function onMessage(event: MessageEvent) {
      if (isToggleChatMessage(event.data)) {
        setChatOpen((prev) => !prev);
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const result: UseAgentReturn = { send, messages, isRunning, error };
  if (options?.shellIntegration) {
    result.chatOpen = chatOpen;
  }
  return result;
}
