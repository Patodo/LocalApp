"use client";
import { useEffect, useState } from "react";
import type { HarnessAgent } from "@localapp/sdk-agent/harness-client";
import { InteractionCard } from "@localapp/sdk-agent/agent-controls";
import { DevelopmentPage } from "./development-page";
import { AppDevelopmentDock } from "./app-development-dock";
import type { DevelopmentShellProps } from "./dsh-development-shell";

/** Both identities retain their own transport, messages, draft and history. */
export function AppConversationDock({ application, isOwner, agent, onSend, reveal = 0, minimize = 0, onVisibilityChange }: {
  application: { owner: string; name: string };
  isOwner: boolean;
  agent: HarnessAgent | null;
  onSend: (text: string) => Promise<void>;
  reveal?: number;
  minimize?: number;
  onVisibilityChange?: (visible: boolean) => void;
}) {
  const [identity, setIdentity] = useState<"developer" | "user">(isOwner ? "developer" : "user");
  const [prompt, setPrompt] = useState("");
  const [providers, setProviders] = useState<DevelopmentShellProps["providers"]>([]);
  const [sessions, setSessions] = useState<DevelopmentShellProps["sessions"]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [, update] = useState(0);
  useEffect(() => {
    if (!agent) return;
    let active = true;
    const refresh = async () => {
      try {
        const rows = await agent.listSessions();
        if (active) setSessions(rows.map(row => ({ ...row, createdAt: new Date(row.createdAt).toISOString() })));
      } catch (error) { if (active) setError((error as Error).message); }
    };
    void agent.settings().then(settings => {
      if (!active) return;
      setProviders(settings.providers);
      agent.providerId ??= settings.defaultProviderId;
      if (settings.providers.length) { agent.startBackgroundEvents(); void refresh(); }
      update(n => n + 1);
    }).catch(error => { if (active) setError(error.message); });
    const unsubscribe = agent.subscribe(event => {
      if (!active) return;
      update(n => n + 1);
      if (event.type === "agent_end" || event.type === "session_title") void refresh();
    });
    return () => { active = false; unsubscribe(); };
  }, [agent]);
  useEffect(() => { if (reveal) setIdentity("user"); }, [reveal]);
  const act = async (operation: () => Promise<void>) => {
    setPending(true); setError("");
    try { await operation(); } catch (error) { setError((error as Error).message); }
    finally { setPending(false); update(n => n + 1); }
  };
  const noop = () => {};
  const conversation: DevelopmentShellProps = {
    project: { id: agent?.appId ?? "application", name: application.name }, projects: [],
    files: [], file: null, text: "", prompt, sessions,
    selectedSession: agent && sessions.some(row => row.id === agent.sessionId) ? agent.sessionId : "",
    messages: agent?.state.messages ?? [], live: "", running: agent?.state.isStreaming ?? false,
    pending, error: error || agent?.state.errorMessage || "", versions: [], version: "", changes: [],
    providers, provider: agent?.providerId ?? "", build: null, log: "",
    interaction: null, answer: "",
    actions: {
      select: noop, create: noop, open: noop, setText: noop, save: noop,
      setPrompt, run: () => { const text = prompt.trim(); if (!text || !agent) return; setPrompt(""); void act(() => onSend(text)); },
      stop: () => agent?.abort(),
      setProvider: value => { if (!agent || agent.state.isStreaming) return; agent.providerId = value; agent.newSession(); setSessions([]); setError(""); void act(async () => { setSessions((await agent.listSessions()).map(row => ({ ...row, createdAt: new Date(row.createdAt).toISOString() }))); }); },
      newSession: () => { agent?.newSession(); setPrompt(""); setError(""); update(n => n + 1); },
      selectSession: id => { if (agent) void act(() => agent.selectSession(id)); },
      setVersion: noop, diff: noop, restore: noop, build: noop, preview: noop, publish: noop, cancelBuild: noop, newFile: noop,
      setAnswer: noop, respond: noop,
    },
  };
  const dock = { identity: isOwner ? identity : "user" as const, userConversation: conversation,
    onIdentityChange: isOwner ? setIdentity : undefined, reveal, minimize, onVisibilityChange,
    userInteractions: agent?.state.interactions.map(interaction => <InteractionCard key={interaction.token} interaction={interaction}
      answer={result => void act(() => agent.answerInteraction(interaction.token, result))} />) };
  return isOwner
    ? <DevelopmentPage application={application} dock={dock} />
    : <AppDevelopmentDock {...conversation} {...dock} application={application} />;
}
