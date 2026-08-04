"use client";

import { useEffect, useState } from "react";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { OneTimeCredentialsDialog } from "@/components/admin/one-time-credentials-dialog";
import { toast } from "sonner";

const PROTECTED_USER_IDS = ["localadmin"];

interface UserInfo {
  id: string; name: string; role: string; createdAt: string;
  pages: number; storageUsed: string; mustChangePassword: boolean;
}

interface OneTimeCredentials {
  username?: string;
  temporaryPassword: string;
  apiKey?: string;
}

export default function AdminUsers() {
  const [users, setUsers] = useState<UserInfo[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [resetId, setResetId] = useState<string | null>(null);
  const [roleToggleId, setRoleToggleId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createUsername, setCreateUsername] = useState("");
  const [createLoading, setCreateLoading] = useState(false);
  const [createError, setCreateError] = useState("");
  const [oneTimeCredentials, setOneTimeCredentials] = useState<OneTimeCredentials | null>(null);
  const limit = 20;

  useEffect(() => {
    setLoading(true);
    fetch(`/api/admin/users?page=${page}&limit=${limit}`, { credentials: "include" })
      .then((r) => r.json())
      .then((res) => { setUsers(res.data); setTotal(res.pagination.total); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [page]);

  const handleDelete = async (id: string) => {
    try {
      await fetch(`/api/admin/users/${id}`, { method: "DELETE", credentials: "include" });
      setConfirmId(null);
      setUsers((prev) => prev.filter((u) => u.id !== id));
      setTotal((t) => t - 1);
      toast.success("用户已删除");
    } catch (e) { toast.error((e as Error).message); }
  };

  const handleResetPassword = async (id: string) => {
    try {
      const res = await fetch("/api/admin/reset-password", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: id }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      setResetId(null);
      setUsers((prev) => prev.map((u) => u.id === id ? { ...u, mustChangePassword: true } : u));
      setOneTimeCredentials({
        username: id,
        temporaryPassword: body.data.temporaryPassword,
      });
      toast.success("密码已重置");
    } catch (e) { toast.error((e as Error).message); setResetId(null); }
  };

  const handleCreateUser = async () => {
    setCreateError("");
    setCreateLoading(true);
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: createUsername.trim() }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setCreateError(body.error || `HTTP ${res.status}`);
        return;
      }
      const created = createUsername.trim();
      setCreateOpen(false);
      setCreateUsername("");
      setOneTimeCredentials({
        username: created,
        temporaryPassword: body.data.credentials.temporaryPassword,
        apiKey: body.data.credentials.apiKey,
      });
      toast.success(`用户 ${created} 已创建`);
      setLoading(true);
      fetch(`/api/admin/users?page=${page}&limit=${limit}`, { credentials: "include" })
        .then((r) => r.json())
        .then((res) => { setUsers(res.data); setTotal(res.pagination.total); })
        .catch((e) => setError(e.message))
        .finally(() => setLoading(false));
    } catch (e) {
      setCreateError((e as Error).message);
    } finally {
      setCreateLoading(false);
    }
  };

  const handleToggleRole = async (id: string, currentRole: string) => {
    const targetRole = currentRole === "admin" ? "user" : "admin";
    try {
      const res = await fetch(`/api/admin/users/${id}/role`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: targetRole }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(body.error || `HTTP ${res.status}`);
        setRoleToggleId(null);
        return;
      }
      setRoleToggleId(null);
      const target = users.find((u) => u.id === id);
      const name = target?.name ?? id;
      toast.success(`已将 ${name} 切换为${targetRole === "admin" ? "管理员" : "普通用户"}`);
      setLoading(true);
      fetch(`/api/admin/users?page=${page}&limit=${limit}`, { credentials: "include" })
        .then((r) => r.json())
        .then((res) => { setUsers(res.data); setTotal(res.pagination.total); })
        .catch((e) => setError(e.message))
        .finally(() => setLoading(false));
    } catch (e) {
      toast.error((e as Error).message);
      setRoleToggleId(null);
    }
  };

  const totalPages = Math.ceil(total / limit);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">用户管理</h1>
        <Button size="sm" onClick={() => { setCreateOpen(true); setCreateError(""); }}>创建用户</Button>
      </div>
      {error && <p className="text-destructive mb-4">{error}</p>}
      {loading && <p className="text-muted-foreground">加载中...</p>}
      {!loading && (
        <>
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="px-4 py-3 text-left">ID</th><th className="px-4 py-3 text-left">名称</th>
                  <th className="px-4 py-3 text-left">角色</th><th className="px-4 py-3 text-left">应用</th>
                  <th className="px-4 py-3 text-left">存储量</th><th className="px-4 py-3 text-left">状态</th>
                  <th className="px-4 py-3 text-left">注册时间</th><th className="px-4 py-3 text-left">操作</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => {
                  const isProtected = PROTECTED_USER_IDS.includes(u.id);
                  return (
                    <tr key={u.id} className="border-b last:border-0 hover:bg-muted/30">
                      <td className="px-4 py-3 font-mono text-xs">{u.id}</td>
                      <td className="px-4 py-3">{u.name}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${u.role === "admin" ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>{u.role}</span>
                        {isProtected && (
                          <Lock className="inline-block ml-1 h-3 w-3 text-muted-foreground align-middle" aria-label="系统保护账户" />
                        )}
                        {isProtected && (
                          <span className="ml-1 text-xs text-muted-foreground" title="系统保护账户，不可降级或删除">受保护</span>
                        )}
                      </td>
                      <td className="px-4 py-3">{u.pages}</td>
                      <td className="px-4 py-3 text-muted-foreground">{u.storageUsed}</td>
                      <td className="px-4 py-3">
                        {u.mustChangePassword && <span className="inline-flex items-center rounded-full bg-yellow-100 px-2 py-0.5 text-xs font-medium text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-500">需改密</span>}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{new Date(u.createdAt).toLocaleDateString()}</td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1">
                          {resetId === u.id ? (
                            <>
                              <Button size="sm" variant="default" onClick={() => handleResetPassword(u.id)}>确认</Button>
                              <Button size="sm" variant="ghost" onClick={() => setResetId(null)}>取消</Button>
                            </>
                          ) : (
                            <Button size="sm" variant="ghost" className="text-primary" onClick={() => setResetId(u.id)}>重置密码</Button>
                          )}
                          {!isProtected && (
                            <>
                            {roleToggleId === u.id ? (
                              <>
                                <Button size="sm" variant="default" onClick={() => handleToggleRole(u.id, u.role)}>确认</Button>
                                <Button size="sm" variant="ghost" onClick={() => setRoleToggleId(null)}>取消</Button>
                              </>
                            ) : (
                              <Button size="sm" variant="ghost" className="text-primary" onClick={() => setRoleToggleId(u.id)}>
                                {u.role === "user" ? "提升为管理员" : "降级为用户"}
                              </Button>
                            )}
                            {confirmId === u.id ? (
                              <>
                                <Button size="sm" variant="destructive" onClick={() => handleDelete(u.id)}>确认</Button>
                                <Button size="sm" variant="ghost" onClick={() => setConfirmId(null)}>取消</Button>
                              </>
                            ) : (
                              <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setConfirmId(u.id)}>删除</Button>
                            )}
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-4 mt-4">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>上一页</Button>
              <span className="text-sm text-muted-foreground">{page} / {totalPages}</span>
              <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>下一页</Button>
            </div>
          )}
        </>
      )}
      {createOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <Card className="w-full max-w-md">
            <CardHeader><CardTitle>创建用户</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1">
                <Label>用户名</Label>
                <Input
                  value={createUsername}
                  onChange={(e) => setCreateUsername(e.target.value)}
                  placeholder="输入用户名"
                  autoFocus
                  onKeyDown={(e) => { if (e.key === "Enter" && createUsername.trim() && !createLoading) handleCreateUser(); }}
                />
              </div>
              {createError && <p className="text-sm text-destructive">{createError}</p>}
              <p className="text-xs text-muted-foreground">创建后将显示一次性临时密码和 API Key</p>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={() => { setCreateOpen(false); setCreateUsername(""); setCreateError(""); }}>取消</Button>
                <Button onClick={handleCreateUser} disabled={createLoading || !createUsername.trim()}>
                  {createLoading ? "创建中..." : "创建"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
      {oneTimeCredentials && (
        <OneTimeCredentialsDialog
          {...oneTimeCredentials}
          onClose={() => setOneTimeCredentials(null)}
        />
      )}
    </div>
  );
}
