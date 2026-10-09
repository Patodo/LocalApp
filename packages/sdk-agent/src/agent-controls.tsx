import { useEffect, useState } from "react";
import type { AgentInteraction, HarnessAgent } from "./harness-client.js";

/** Shared Agent controls for the platform Shell and application chat frontends. */
export function AgentControls({ agent }: { agent: HarnessAgent | null }) {
  const [providers, setProviders] = useState<Array<{ id: string; name: string; model: string }>>([]);
  const [sessions, setSessions] = useState<Array<{ id: string; createdAt: number }>>([]);
  const [settingsUrl, setSettingsUrl] = useState("/my/models");
  const [error, setError] = useState("");
  const [, render] = useState(0);
  useEffect(() => {
    if (!agent) return;
    let live = true;
    const refresh = () => { agent.listSessions().then((rows) => { if (live) setSessions(rows); }).catch(() => {}); };
    agent.settings().then((settings) => { if (live) { setProviders(settings.providers); if (settings.settingsUrl) setSettingsUrl(settings.settingsUrl); agent.providerId ??= settings.defaultProviderId; refresh(); if (settings.providers.length) agent.startBackgroundEvents(); render((n) => n + 1); } }).catch((e) => { if (live) setError(e.message); });
    const unsubscribe = agent.subscribe((event) => { if (live) { render((n) => n + 1); if (event.type === "agent_end") refresh(); } });
    return () => { live = false; unsubscribe(); };
  }, [agent]);
  const act = (operation: Promise<unknown>) => { setError(""); operation.catch((e) => setError(e.message)); };
  return <div className="space-y-2 border-b p-2 text-xs">
    <div className="flex flex-wrap items-center gap-2">
      {agent && agent.appId !== "platform" && <a href={`${settingsUrl.replace(/\/my\/models\/?$/, "/my/agent")}?${new URLSearchParams({ appId: agent.appId })}`} target="_blank" rel="noreferrer">应用 Agent 设置</a>}
      <a href={settingsUrl} target="_blank" rel="noreferrer">模型与 Agent 设置</a>
      <select aria-label="模型供应商" value={agent?.providerId ?? ""} disabled={!agent || agent.state.isStreaming} onChange={(e) => { if (agent) { agent.providerId = e.target.value; agent.newSession(); agent.startBackgroundEvents(); act(agent.listSessions().then(setSessions)); render((n) => n + 1); } }}>
        <option value="">选择模型</option>{providers.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.model}</option>)}
      </select>
      <button type="button" disabled={!agent || agent.state.isStreaming} onClick={() => agent?.newSession()}>新对话</button>
      <select aria-label="历史对话" value="" disabled={!agent || agent.state.isStreaming} onChange={(e) => { if (agent && e.target.value) act(agent.selectSession(e.target.value)); }}>
        <option value="">历史对话</option>{sessions.map((session) => <option key={session.id} value={session.id}>{new Date(session.createdAt).toLocaleString()} · {session.id.slice(0, 8)}</option>)}
      </select>
      {agent?.state.isStreaming && <button type="button" onClick={() => agent.abort()}>停止</button>}
    </div>
    {error && <p role="alert">{error}</p>}
    {agent?.state.interactions.map((interaction) => <InteractionCard key={interaction.token} interaction={interaction} answer={(result) => act(agent.answerInteraction(interaction.token, result))} />)}
  </div>;
}

export function InteractionCard({ interaction, answer }: { interaction: AgentInteraction; answer: (result: unknown) => void }) {
  const [answers, setAnswers] = useState<Record<string, { selected: string[]; custom: string }>>({});
  if (interaction.kind === "approval") return <div role="group" aria-label="操作确认" className="space-y-2 rounded border p-2">
    <p>{interaction.toolName}: {interaction.reason || "此操作需要确认"}</p>
    <button type="button" onClick={() => answer("allowed-once")}>允许本次操作</button>{" "}<button type="button" onClick={() => answer("rejected")}>拒绝</button>
  </div>;
  const questions = interaction.questions ?? [];
  return <form className="space-y-2 rounded border p-2" onSubmit={(event) => { event.preventDefault(); answer({ answers: questions.map((q) => ({ id: q.id, selected: answers[q.id]?.selected ?? [], custom: answers[q.id]?.custom ?? "" })) }); }}>
    {questions.map((question) => <fieldset key={question.id}><legend>{question.question}</legend>{question.detail && <p className="whitespace-pre-wrap">{question.detail}</p>}
      {question.options?.map((option) => <label key={option.label} className="block"><input type={question.multiSelect ? "checkbox" : "radio"} name={question.id} checked={answers[question.id]?.selected.includes(option.label) ?? false} onChange={(event) => setAnswers((previous) => ({ ...previous, [question.id]: { custom: previous[question.id]?.custom ?? "", selected: question.multiSelect ? event.target.checked ? [...(previous[question.id]?.selected ?? []), option.label] : (previous[question.id]?.selected ?? []).filter((label) => label !== option.label) : [option.label] } }))} /> {option.label}</label>)}
      <input aria-label={`${question.question} 自定义回答`} value={answers[question.id]?.custom ?? ""} onChange={(event) => setAnswers((previous) => ({ ...previous, [question.id]: { selected: previous[question.id]?.selected ?? [], custom: event.target.value } }))} />
    </fieldset>)}
    <button type="submit" disabled={questions.some((q) => !answers[q.id]?.selected.length && !answers[q.id]?.custom.trim())}>提交回答</button>
  </form>;
}
