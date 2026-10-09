"use client";
import { useEffect, useState } from "react";
import { AppAgentSettings } from "@/components/app-settings/agent-settings";
export default function AgentApplicationSettings() {
  const [appId, setAppId] = useState("");
  useEffect(() => { setAppId(new URLSearchParams(window.location.search).get("appId") ?? ""); }, []);
  return <div className="space-y-5"><h1 className="text-2xl font-bold">应用 Agent 设置{appId && ` · ${appId}`}</h1>{appId ? <AppAgentSettings appId={appId} /> : <p>请从应用内打开 Agent 设置。</p>}</div>;
}
