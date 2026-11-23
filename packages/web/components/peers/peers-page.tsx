"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { Ban, Cable, PackageOpen, RefreshCw, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
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

type PeerApplication = { name: string; owner: string; description: string; version: string; digest: string };

function PeerApplications({ peer }: { peer: Peer }) {
  const [apps, setApps] = useState<PeerApplication[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [copying, setCopying] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const onDesktop = typeof navigator !== "undefined" && /Electron\//.test(navigator.userAgent);
  const endpoint = `/api/peers/${encodeURIComponent(peer.id)}/apps`;

  async function browse() {
    setLoading(true);
    setMessage("");
    try {
      setApps(await requestJson<PeerApplication[]>(endpoint));
    } catch (error) {
      setApps(null);
      setFailed(true);
      setMessage(error instanceof Error ? error.message : "无法浏览对端应用");
    } finally {
      setLoading(false);
    }
  }

  async function copy(app: PeerApplication) {
    setCopying(app.name);
    setMessage("");
    try {
      await requestJson(`${endpoint}/${encodeURIComponent(app.name)}/copy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ digest: app.digest }),
      });
      setFailed(false);
      setMessage(`已复制 ${app.name} ${app.version}，可从「我的应用」打开。`);
    } catch (error) {
      setFailed(true);
      setMessage(error instanceof Error ? error.message : "复制失败");
    } finally {
      setCopying(null);
    }
  }

  return <Dialog onOpenChange={open => { if (open && !loading && !copying) void browse(); }}>
    <DialogTrigger asChild>
      <Button size="sm"><PackageOpen className="mr-1 size-4" />浏览对端应用</Button>
    </DialogTrigger>
    <DialogContent closeLabel="关闭" className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
      <div className="space-y-1 pr-8">
        <DialogTitle>{peer.name} 的应用</DialogTitle>
        <DialogDescription>选择影子模式打开远端应用，或复制应用包到本机。</DialogDescription>
      </div>
      {loading && <p role="status" className="text-sm text-muted-foreground">正在加载应用…</p>}
      {!loading && failed && !apps && <Button variant="outline" size="sm" onClick={() => void browse()}>重试</Button>}
      {message && <p role={failed ? "alert" : "status"} className={failed ? "text-sm text-destructive" : "text-sm text-muted-foreground"}>{message}</p>}
      {apps?.length === 0 && <p className="text-sm text-muted-foreground">对端账号暂无可复制的应用。</p>}
      {apps && apps.length > 0 && <ul className="divide-y rounded-md border">
        {apps.map(app => <li key={app.name} className="flex flex-wrap items-center justify-between gap-3 p-3">
          <div className="min-w-0">
            <p className="break-words font-medium">{app.owner}/{app.name} <span className="text-sm text-muted-foreground">{app.version}</span></p>
            {app.description && <p className="break-words text-sm text-muted-foreground">{app.description}</p>}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={!onDesktop || !peer.baseUrl.startsWith("https://")}
              title={onDesktop ? "使用远端业务数据" : "请在 LocalApp 桌面版打开影子应用"}
              onClick={() => window.location.assign(`${endpoint}/${encodeURIComponent(app.name)}/shadow`)}>影子</Button>
            <Button size="sm" disabled={copying !== null} title="复制应用包到本机"
              onClick={() => void copy(app)}>{copying === app.name ? "复制中…" : "复制"}</Button>
          </div>
        </li>)}
      </ul>}
    </DialogContent>
  </Dialog>;
}

function PushApplication({ peer, onSync }: {
  peer: Peer;
  onSync(name: string, confirmation?: string): Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [apps, setApps] = useState<Array<{ name: string }> | null>(null);
  const [selected, setSelected] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function loadApps() {
    setApps(null);
    setError("");
    try {
      const pages = await requestJson<Array<{ name: string; currentVersion: number }>>("/api/me/pages");
      setApps(pages.filter(page => page.currentVersion > 0));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法加载本机应用");
    }
  }

  async function submit(withData: boolean) {
    if (!selected || pending || (withData && confirmation.trim() !== selected)) return;
    setPending(true);
    try {
      if (await onSync(selected, withData ? confirmation.trim() : undefined)) setOpen(false);
      else setError("启动同步失败，请查看对端连接页面的错误信息。");
    } finally {
      setPending(false);
    }
  }

  return <Dialog open={open} onOpenChange={next => {
    setOpen(next);
    if (!next) return;
    setSelected("");
    setConfirmation("");
    void loadApps();
  }}>
    <DialogTrigger asChild>
      <Button variant="outline" size="sm"><Send className="mr-1 size-4" />推送本机应用</Button>
    </DialogTrigger>
    <DialogContent closeLabel="关闭" className="max-h-[85vh] overflow-y-auto">
      <div className="space-y-1 pr-8">
        <DialogTitle>推送本机应用到 {peer.name}</DialogTitle>
        <DialogDescription>从已发布的本机应用中选择要推送的应用。</DialogDescription>
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {!apps && !error && <p role="status" className="text-sm text-muted-foreground">正在加载应用…</p>}
      {apps?.length === 0 && <p className="text-sm text-muted-foreground">本机暂无已发布的应用。</p>}
      {apps && apps.length > 0 && <ul className="grid gap-2">
        {apps.map(app => <li key={app.name}><Button size="sm" className="w-full justify-start"
          aria-pressed={selected === app.name} variant={selected === app.name ? "default" : "outline"}
          onClick={() => { setSelected(app.name); setConfirmation(""); }}>{app.name}</Button></li>)}
      </ul>}
      <Button size="sm" disabled={!selected || pending} onClick={() => void submit(false)}
        aria-label={`同步应用到 ${peer.name}`}>仅同步应用</Button>
      {peer.verifiedUser && selected && <div className="space-y-2 border-t pt-3">
        <Label htmlFor={`confirm-data-${peer.id}`}>同步数据会替换目标数据库和文件。输入 {selected} 确认。</Label>
        <Input id={`confirm-data-${peer.id}`} value={confirmation} onChange={event => setConfirmation(event.target.value)} />
        <Button size="sm" variant="secondary" disabled={pending || confirmation.trim() !== selected}
          onClick={() => void submit(true)}>应用 + 数据</Button>
      </div>}
    </DialogContent>
  </Dialog>;
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

  const startSync = async (peer: Peer, appName: string, confirmation?: string) => {
    setError("");
    try {
      const job = await requestJson<SyncJob>(`/api/me/apps/${encodeURIComponent(appName)}/sync`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ peerId: peer.id, withData: confirmation !== undefined, ...(confirmation !== undefined ? { confirmation } : {}) }),
      });
      setJobs((current) => [job, ...current.filter((item) => item.id !== job.id)]);
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "启动同步失败");
      return false;
    }
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
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">已连接的对端</h2>
      {peers.length === 0 ? <p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">暂无对端连接</p> : peers.map(peer => (
        <article key={peer.id} className="space-y-4 rounded-lg border bg-card p-4">
          <div>
            <p className="font-medium">{peer.name}</p>
            <p className="break-all text-sm text-muted-foreground">{peer.baseUrl}</p>
            <p className="mt-1 text-xs text-muted-foreground">{peer.verifiedUser
              ? `已验证为 ${peer.verifiedUser.displayName || peer.verifiedUser.name} · 协议 v${peer.protocolVersion}`
              : "尚未验证"}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <PeerApplications peer={peer} />
            <Button variant="outline" size="sm" onClick={() => void check(peer.id)}><RefreshCw className="mr-1 size-4" />验证能力</Button>
            <PushApplication peer={peer} onSync={(name, confirmation) => startSync(peer, name, confirmation)} />
          </div>
        </article>
      ))}
    </section>
    <section className="space-y-3"><h2 className="text-lg font-semibold">同步任务</h2>{jobs.length === 0 ? <p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">暂无同步任务</p> : jobs.map((job) => <article key={job.id} className="rounded-lg border bg-card p-4"><div className="flex items-center justify-between gap-3"><div><p className="font-mono text-sm">{job.id}</p><p className="text-sm text-muted-foreground">{job.appName} · {job.status}</p></div>{CANCELLABLE.has(job.status) && <Button variant="outline" size="sm" onClick={() => void cancelSync(job.id)} aria-label={`取消同步 ${job.id}`}><Ban className="mr-1 size-4" />取消</Button>}</div><ol aria-label={`同步历史 ${job.id}`} className="mt-3 space-y-1 border-l pl-3 text-xs text-muted-foreground">{job.history.map((entry, index) => <li key={`${entry.at}-${entry.status}-${index}`}><span>{entry.status}</span><time className="ml-2" dateTime={entry.at}>{entry.at}</time>{entry.error && <span className="ml-2 text-destructive">{entry.error}</span>}</li>)}</ol>{job.error && <p className="mt-2 text-sm text-destructive">{job.error}</p>}</article>)}</section>
  </div>;
}
