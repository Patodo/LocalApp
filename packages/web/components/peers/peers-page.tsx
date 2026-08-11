"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { Ban, Cable, RefreshCw, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Peer = {
  id: string;
  name: string;
  baseUrl: string;
  acceptInsecureHttp: boolean;
  verifiedUser: { id: string; name: string; displayName: string | null } | null;
  protocolVersion: number | null;
  transferLimits: Record<string, number> | null;
  verifiedAt: string | null;
};
type SyncJob = {
  id: string; ownerId: string; appName: string; peerId: string; syncId: string; withData: boolean;
  appVersion?: string | null; packageDigest?: string | null; packageSize?: number | null; dataDigest?: string | null; dataSize?: number | null;
  status: string; history: Array<{ status: string; at: string; error?: string }>; error: string | null;
  createdAt: string; updatedAt: string; completedAt: string | null;
};
const TERMINAL = new Set(["completed", "rolled-back", "failed", "recovery-required"]);
const CANCELLABLE = new Set(["queued", "staging", "validating", "backing-up", "installing", "activating"]);

async function requestJson<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...options, credentials: "include" });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.success) throw new Error(body.error || `HTTP ${response.status}`);
  return body.data as T;
}

export function PeersPage() {
  const [peers, setPeers] = useState<Peer[]>([]);
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [acceptInsecureHttp, setAcceptInsecureHttp] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [jobs, setJobs] = useState<SyncJob[]>([]);
  const [appNames, setAppNames] = useState<Record<string, string>>({});
  const [dataConfirmations, setDataConfirmations] = useState<Record<string, string>>({});
  const streams = useRef(new Map<string, EventSource>());

  const load = useCallback(async () => {
    try {
      const [loadedPeers, loadedJobs] = await Promise.all([requestJson<Peer[]>("/api/peers"), requestJson<SyncJob[]>("/api/sync-jobs")]);
      setPeers(loadedPeers);
      setJobs(loadedJobs);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "加载对端失败");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const activeJobIds = jobs.filter((job) => !TERMINAL.has(job.status)).map((job) => job.id).sort().join("\0");
  useEffect(() => {
    const active = new Set(jobs.filter((job) => !TERMINAL.has(job.status)).map((job) => job.id));
    for (const job of jobs) {
      if (TERMINAL.has(job.status) || streams.current.has(job.id)) continue;
      const stream = new EventSource(`/api/sync-jobs/${encodeURIComponent(job.id)}/events`);
      stream.addEventListener("status", (event) => {
        const updated = JSON.parse(event.data) as SyncJob;
        setJobs((current) => current.map((item) => item.id === updated.id ? updated : item));
      });
      streams.current.set(job.id, stream);
    }
    for (const [jobId, stream] of streams.current) {
      if (active.has(jobId)) continue;
      stream.close();
      streams.current.delete(jobId);
    }
  }, [activeJobIds]);

  useEffect(() => () => {
    for (const stream of streams.current.values()) stream.close();
    streams.current.clear();
  }, []);

  const addPeer = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const credential = apiKey;
    setSaving(true);
    setError("");
    try {
      const peer = await requestJson<Peer>("/api/peers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, baseUrl, apiKey: credential, acceptInsecureHttp }),
      });
      setPeers((current) => [...current, peer]);
      setName("");
      setBaseUrl("");
      setAcceptInsecureHttp(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "添加对端失败");
    } finally {
      setApiKey("");
      setSaving(false);
    }
  };

  const check = async (id: string) => {
    try {
      const peer = await requestJson<Peer>(`/api/peers/${encodeURIComponent(id)}/check`, { method: "POST" });
      setPeers((current) => current.map((item) => item.id === peer.id ? peer : item));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "验证对端失败");
    }
  };

  const startSync = async (peer: Peer, withData: boolean) => {
    const appName = appNames[peer.id]?.trim();
    if (!appName) return;
    const confirmation = dataConfirmations[peer.id]?.trim() ?? "";
    if (withData && confirmation !== appName) return;
    setError("");
    try {
      const job = await requestJson<SyncJob>(`/api/me/apps/${encodeURIComponent(appName)}/sync`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ peerId: peer.id, withData, ...(withData ? { confirmation } : {}) }),
      });
      setJobs((current) => [job, ...current.filter((item) => item.id !== job.id)]);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "启动同步失败"); }
  };

  const cancelSync = async (id: string) => {
    try {
      const job = await requestJson<SyncJob>(`/api/sync-jobs/${encodeURIComponent(id)}/cancel`, { method: "POST" });
      setJobs((current) => current.map((item) => item.id === id ? job : item));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "取消同步失败"); }
  };

  return <div className="max-w-3xl space-y-6"><header><h1 className="text-2xl font-bold">对端连接</h1><p className="mt-1 text-sm text-muted-foreground">保存目标 Server 用户的 API Key。该密钥仅加密保存在本机，不会再次显示或同步。</p></header>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <form onSubmit={addPeer} className="space-y-4 rounded-xl border bg-card p-5"><h2 className="flex items-center gap-2 font-semibold"><Cable className="size-4" />添加对端</h2><div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="peer-name">名称</Label><Input id="peer-name" value={name} onChange={(event) => setName(event.target.value)} required /></div><div className="space-y-2"><Label htmlFor="peer-url">目标地址</Label><Input id="peer-url" type="url" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="https://server.example" required /></div></div><div className="space-y-2"><Label htmlFor="peer-api-key">目标 API Key</Label><Input id="peer-api-key" type="password" autoComplete="off" value={apiKey} onChange={(event) => setApiKey(event.target.value)} required /></div><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={acceptInsecureHttp} onChange={(event) => setAcceptInsecureHttp(event.target.checked)} />此私有局域网/回环对端明确允许 HTTP</label><Button type="submit" disabled={saving}>{saving ? "添加中..." : "添加对端"}</Button></form>
    <section className="space-y-3"><h2 className="text-lg font-semibold">已连接的对端</h2>{peers.length === 0 ? <p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">暂无对端连接</p> : peers.map((peer) => <article key={peer.id} className="space-y-4 rounded-lg border bg-card p-4"><div className="flex flex-wrap items-center justify-between gap-4"><div><p className="font-medium">{peer.name}</p><p className="text-sm text-muted-foreground">{peer.baseUrl}</p>{peer.verifiedUser ? <p className="mt-1 text-xs text-muted-foreground">已验证为 {peer.verifiedUser.displayName || peer.verifiedUser.name} · 协议 v{peer.protocolVersion}</p> : <p className="mt-1 text-xs text-muted-foreground">尚未验证</p>}</div><Button variant="outline" size="sm" onClick={() => void check(peer.id)}><RefreshCw className="mr-1 size-4" />验证能力</Button></div><div className="flex flex-wrap gap-2"><Input aria-label={`同步应用 ${peer.name}`} placeholder="应用名称" value={appNames[peer.id] ?? ""} onChange={(event) => setAppNames((current) => ({ ...current, [peer.id]: event.target.value }))} /><Button size="sm" onClick={() => void startSync(peer, false)} disabled={!appNames[peer.id]?.trim()} aria-label={`同步应用到 ${peer.name}`}><Send className="mr-1 size-4" />仅同步应用</Button></div>{peer.verifiedUser && <div className="flex flex-wrap gap-2"><Input aria-label={`确认同步数据 ${peer.name}`} placeholder={`输入 ${appNames[peer.id]?.trim() || "应用名称"} 以确认`} value={dataConfirmations[peer.id] ?? ""} onChange={(event) => setDataConfirmations((current) => ({ ...current, [peer.id]: event.target.value }))} /><Button size="sm" variant="secondary" onClick={() => void startSync(peer, true)} disabled={!appNames[peer.id]?.trim() || (dataConfirmations[peer.id]?.trim() ?? "") !== appNames[peer.id]?.trim()} aria-label={`同步应用和数据到 ${peer.name}`}><Send className="mr-1 size-4" />应用 + 数据</Button></div>}</article>)}</section>
    <section className="space-y-3"><h2 className="text-lg font-semibold">同步任务</h2>{jobs.length === 0 ? <p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">暂无同步任务</p> : jobs.map((job) => <article key={job.id} className="rounded-lg border bg-card p-4"><div className="flex items-center justify-between gap-3"><div><p className="font-mono text-sm">{job.id}</p><p className="text-sm text-muted-foreground">{job.appName} · {job.status}</p></div>{CANCELLABLE.has(job.status) && <Button variant="outline" size="sm" onClick={() => void cancelSync(job.id)} aria-label={`取消同步 ${job.id}`}><Ban className="mr-1 size-4" />取消</Button>}</div><ol aria-label={`同步历史 ${job.id}`} className="mt-3 space-y-1 border-l pl-3 text-xs text-muted-foreground">{job.history.map((entry, index) => <li key={`${entry.at}-${entry.status}-${index}`}><span>{entry.status}</span><time className="ml-2" dateTime={entry.at}>{entry.at}</time>{entry.error && <span className="ml-2 text-destructive">{entry.error}</span>}</li>)}</ol>{job.error && <p className="mt-2 text-sm text-destructive">{job.error}</p>}</article>)}</section>
  </div>;
}
