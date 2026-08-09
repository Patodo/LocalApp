"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { Cable, RefreshCw } from "lucide-react";
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

  const load = useCallback(async () => {
    try {
      setPeers(await requestJson<Peer[]>("/api/peers"));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "加载对端失败");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

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

  return <div className="max-w-3xl space-y-6"><header><h1 className="text-2xl font-bold">对端连接</h1><p className="mt-1 text-sm text-muted-foreground">保存目标 Server 用户的 API Key。该密钥仅加密保存在本机，不会再次显示或同步。</p></header>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <form onSubmit={addPeer} className="space-y-4 rounded-xl border bg-card p-5"><h2 className="flex items-center gap-2 font-semibold"><Cable className="size-4" />添加对端</h2><div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="peer-name">名称</Label><Input id="peer-name" value={name} onChange={(event) => setName(event.target.value)} required /></div><div className="space-y-2"><Label htmlFor="peer-url">目标地址</Label><Input id="peer-url" type="url" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="https://server.example" required /></div></div><div className="space-y-2"><Label htmlFor="peer-api-key">目标 API Key</Label><Input id="peer-api-key" type="password" autoComplete="off" value={apiKey} onChange={(event) => setApiKey(event.target.value)} required /></div><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={acceptInsecureHttp} onChange={(event) => setAcceptInsecureHttp(event.target.checked)} />此私有局域网/回环对端明确允许 HTTP</label><Button type="submit" disabled={saving}>{saving ? "添加中..." : "添加对端"}</Button></form>
    <section className="space-y-3"><h2 className="text-lg font-semibold">已连接的对端</h2>{peers.length === 0 ? <p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">暂无对端连接</p> : peers.map((peer) => <article key={peer.id} className="flex flex-wrap items-center justify-between gap-4 rounded-lg border bg-card p-4"><div><p className="font-medium">{peer.name}</p><p className="text-sm text-muted-foreground">{peer.baseUrl}</p>{peer.verifiedUser ? <p className="mt-1 text-xs text-muted-foreground">已验证为 {peer.verifiedUser.displayName || peer.verifiedUser.name} · 协议 v{peer.protocolVersion}</p> : <p className="mt-1 text-xs text-muted-foreground">尚未验证</p>}</div><Button variant="outline" size="sm" onClick={() => void check(peer.id)}><RefreshCw className="mr-1 size-4" />验证能力</Button></article>)}</section>
  </div>;
}
