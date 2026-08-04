"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "sonner";
import { Copy, Download, EyeOff, KeyRound, RefreshCw, Terminal } from "lucide-react";

interface ApiKeyInfo { key: string; createdAt: string; revealed?: boolean; }

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...options, credentials: "include" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export default function ProfileKeys() {
  const [keys, setKeys] = useState<ApiKeyInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  useEffect(() => {
    fetchJson<{ success: boolean; data: ApiKeyInfo[] }>("/api/keys")
      .then((r) => setKeys(r.data.map((key) => ({ ...key, revealed: false }))))
      .catch(() => toast.error("加载 API 密钥失败"))
      .finally(() => setLoading(false));
  }, []);

  const handleCreate = async () => {
    setCreating(true);
    try {
      const r = await fetchJson<{ success: boolean; data: ApiKeyInfo }>("/api/keys", { method: "POST" });
      setKeys((prev) => [{ ...r.data, revealed: true }, ...prev]);
      toast.success("API 密钥已创建，请立即保存");
    } catch (e) { toast.error((e as Error).message); }
    finally { setCreating(false); }
  };

  const handleCopy = async (key: string) => {
    try {
      await navigator.clipboard.writeText(key);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 2000);
    } catch { toast.error("复制失败"); }
  };

  if (loading) return <p className="text-muted-foreground">加载中...</p>;

  const firstKey = keys.find((key) => key.revealed)?.key;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">API 密钥</h1>
        <Button size="sm" onClick={handleCreate} disabled={creating}>{creating ? "创建中..." : "创建密钥"}</Button>
      </div>
      {keys.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center py-12 text-center">
            <p className="text-lg font-medium">暂无 API 密钥</p>
            <p className="text-sm text-muted-foreground mt-1">API 密钥用于 CLI 登录和 API 访问</p>
            <Button size="sm" onClick={handleCreate} disabled={creating} className="mt-4">创建第一个密钥</Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {keys.map((item) => (
            <Card key={item.key}>
              <CardContent className="flex items-center justify-between gap-4 p-4">
                <code className="flex-1 break-all text-sm font-mono">{item.key}</code>
                {item.revealed ? (
                  <Button size="sm" variant={copiedKey === item.key ? "default" : "outline"} onClick={() => handleCopy(item.key)}>
                    <Copy className="mr-1 h-3 w-3" />
                    {copiedKey === item.key ? "已复制" : "复制"}
                  </Button>
                ) : (
                  <span className="inline-flex items-center gap-1 text-xs text-muted-foreground" title="完整密钥仅在创建时显示">
                    <EyeOff className="h-3 w-3" />
                    已隐藏
                  </span>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      <section className="mt-8 rounded-lg border bg-card">
        <div className="border-b p-4">
          <div className="flex items-center gap-2">
            <Terminal className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-semibold">CLI 获取与配置</h2>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            CLI 下载、登录和更新都需要在已登录用户上下文中完成。不要复制服务器内部目录，直接使用下面的下载入口和命令。
          </p>
        </div>
        <div className="grid gap-0 md:grid-cols-3">
          <div className="border-b p-4 md:border-b-0 md:border-r">
            <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-md bg-muted">
              <Download className="h-4 w-4 text-primary" />
            </div>
            <h3 className="text-sm font-medium">下载当前 CLI</h3>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              当前发布产物由服务器下载接口提供。Windows x64 可直接下载，其它平台可使用更新命令检查。
            </p>
            <Button asChild size="sm" variant="outline" className="mt-4">
              <a href="/api/cli/download?os=windows&arch=x86_64">下载 Windows x64</a>
            </Button>
          </div>
          <div className="border-b p-4 md:border-b-0 md:border-r">
            <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-md bg-muted">
              <KeyRound className="h-4 w-4 text-primary" />
            </div>
            <h3 className="text-sm font-medium">配置 API Key</h3>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              创建密钥后请立即保存，再在本地终端执行登录命令。
            </p>
            <code className="mt-4 block break-all rounded-md bg-muted px-3 py-2 font-mono text-xs">
              localapp login --key {firstKey ? firstKey : "<KEY>"}
            </code>
          </div>
          <div className="p-4">
            <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-md bg-muted">
              <RefreshCw className="h-4 w-4 text-primary" />
            </div>
            <h3 className="text-sm font-medium">检查更新</h3>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              CLI 会通过版本接口读取可用版本。已有 CLI 的用户可以直接执行更新，不需要知道服务器文件路径。
            </p>
            <code className="mt-4 block rounded-md bg-muted px-3 py-2 font-mono text-xs">
              localapp update
            </code>
          </div>
        </div>
      </section>
    </div>
  );
}
