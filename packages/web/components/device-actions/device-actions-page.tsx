"use client";

import { useCallback, useEffect, useState } from "react";
import { ShieldCheck, Square, RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type PermissionSet = { filesystemRead?: string[]; filesystemWrite?: string[]; network?: boolean; childProcess?: boolean };
type DeviceAction = {
  requestId: string;
  status: string;
  sourceOrigin: string;
  appOwner: string;
  appName: string;
  appVersion: string | null;
  publisherUserId: string;
  publisherDisplayName: string | null;
  title: string;
  description: string | null;
  permissions: PermissionSet;
  permissionsDigest: string;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  error: { message: string; code?: string } | null;
};
type TrustGrant = { sourceOrigin: string; appOwner: string; appName: string; publisherUserId: string; publisherDisplayName: string | null; permissions: PermissionSet; trustedAt: string };

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...options, credentials: "include" });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.success === false) throw new Error(body.error ?? `HTTP ${response.status}`);
  return body.data as T;
}

export function DeviceActionsPage() {
  const [actions, setActions] = useState<DeviceAction[]>([]);
  const [trusts, setTrusts] = useState<TrustGrant[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await request<{ actions: DeviceAction[]; trusts: TrustGrant[] }>("/api/device-actions/local");
      setActions(data.actions);
      setTrusts(data.trusts);
      setMessage(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "加载本机设备动作失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const trust = async (requestId: string) => {
    await request(`/api/device-actions/local/${encodeURIComponent(requestId)}/trust`, { method: "POST" });
    await refresh();
  };

  const cancel = async (requestId: string) => {
    await request(`/api/device-actions/local/${encodeURIComponent(requestId)}/cancel`, { method: "POST" });
    await refresh();
  };

  const revoke = async (grant: TrustGrant) => {
    await request("/api/device-actions/local/trust/revoke", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(grant),
    });
    await refresh();
  };

  if (loading) return <p className="text-muted-foreground">加载本机设备动作...</p>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">本机设备动作</h1>
          <p className="mt-1 text-sm text-muted-foreground">由本机 Server 执行来自应用的受限脚本；信任按来源、应用、发布者和权限集合保存。</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void refresh()}><RotateCcw />刷新</Button>
      </div>
      {message ? <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{message}</p> : null}

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><ShieldCheck className="h-4 w-4" />待确认与执行历史</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {actions.length === 0 ? <p className="text-sm text-muted-foreground">暂无本机设备动作。</p> : actions.map((action) => (
            <div key={action.requestId} className="rounded-md border p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-medium">{action.title}</p>
                  <p className="text-xs text-muted-foreground">{action.appOwner}/{action.appName} · {action.publisherDisplayName || action.publisherUserId}</p>
                  {action.description ? <p className="mt-2 text-sm text-muted-foreground">{action.description}</p> : null}
                </div>
                <span className="rounded-full bg-muted px-2 py-1 text-xs">{action.status}</span>
              </div>
              <PermissionSummary permissions={action.permissions} />
              {action.error ? <p className="mt-2 text-sm text-destructive">{action.error.message}</p> : null}
              <div className="mt-3 flex gap-2">
                {action.status === "awaiting_trust" ? <Button size="sm" onClick={() => void trust(action.requestId)}>信任并执行</Button> : null}
                {["claimed", "awaiting_trust", "preparing", "running"].includes(action.status) ? <Button size="sm" variant="outline" onClick={() => void cancel(action.requestId)}><Square />取消</Button> : null}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>已信任来源</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {trusts.length === 0 ? <p className="text-sm text-muted-foreground">暂无持久化信任。</p> : trusts.map((grant) => (
            <div key={`${grant.sourceOrigin}:${grant.appOwner}:${grant.appName}:${grant.publisherUserId}`} className="flex items-start justify-between gap-3 rounded-md border p-3">
              <div><p className="text-sm font-medium">{grant.appOwner}/{grant.appName}</p><p className="text-xs text-muted-foreground">{grant.publisherDisplayName || grant.publisherUserId} · {grant.sourceOrigin}</p><PermissionSummary permissions={grant.permissions} /></div>
              <Button variant="ghost" size="icon" aria-label={`撤销 ${grant.appOwner}/${grant.appName} 信任`} onClick={() => void revoke(grant)}><Trash2 /></Button>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function PermissionSummary({ permissions }: { permissions: PermissionSet }) {
  const items = [
    ...(permissions.filesystemRead ?? []).map((root) => `读取 ${root}`),
    ...(permissions.filesystemWrite ?? []).map((root) => `写入 ${root}`),
    ...(permissions.network ? ["网络"] : []),
    ...(permissions.childProcess ? ["子进程"] : []),
  ];
  return <p className="mt-3 text-xs text-muted-foreground">权限：{items.length > 0 ? items.join("、") : "无额外权限"}</p>;
}
