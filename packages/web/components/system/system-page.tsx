"use client";

import { FormEvent, useEffect, useState } from "react";
import { Network } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Settings = { listenHost: string; listenPort: number; publicUrl: string; workspaceDir: string; allowInsecureLan: boolean };

export function SystemPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    fetch("/api/system/settings", { credentials: "include" }).then(async (response) => {
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !body.success) throw new Error(body.error || `HTTP ${response.status}`);
      setSettings(body.data);
    }).catch((cause) => setError(cause instanceof Error ? cause.message : "加载系统设置失败"));
  }, []);
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!settings) return; setSaving(true); setError("");
    try {
      const response = await fetch("/api/system/settings/network", { method: "PUT", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ listenHost: settings.listenHost, listenPort: Number(settings.listenPort), allowInsecureLan: settings.allowInsecureLan }) });
      const body = await response.json().catch(() => ({})); if (!response.ok || !body.success) throw new Error(body.error || `HTTP ${response.status}`);
      setMessage("已请求重启以应用网络设置");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "保存系统设置失败"); }
    finally { setSaving(false); }
  };
  if (!settings) return <p className="text-muted-foreground">加载中...</p>;
  return <div className="max-w-2xl space-y-6"><header><h1 className="text-2xl font-bold">系统设置</h1><p className="mt-1 text-sm text-muted-foreground">网络变更会由 Server 安全地暂存并请求受监督的重启。</p></header><form onSubmit={save} className="space-y-4 rounded-xl border bg-card p-5"><h2 className="flex items-center gap-2 font-semibold"><Network className="size-4" />网络</h2><div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="listen-host">监听主机</Label><Input id="listen-host" value={settings.listenHost} onChange={(event) => setSettings({ ...settings, listenHost: event.target.value })} /></div><div className="space-y-2"><Label htmlFor="listen-port">监听端口</Label><Input id="listen-port" type="number" value={settings.listenPort} onChange={(event) => setSettings({ ...settings, listenPort: Number(event.target.value) })} /></div></div><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={settings.allowInsecureLan} onChange={(event) => setSettings({ ...settings, allowInsecureLan: event.target.checked })} />允许不安全的局域网访问</label><p className="text-xs text-muted-foreground">工作区目录：{settings.workspaceDir}</p>{error && <p role="alert" className="text-sm text-destructive">{error}</p>}{message && <p className="text-sm text-emerald-700">{message}</p>}<Button type="submit" disabled={saving}>{saving ? "保存中..." : "保存并重启"}</Button></form></div>;
}
