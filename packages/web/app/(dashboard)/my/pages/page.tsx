"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

interface PageListItem {
  name: string; userId: string; description: string;
  currentVersion: number; totalSize: number; createdAt: string; updatedAt: string;
}

export default function AdminPages() {
  const [pages, setPages] = useState<PageListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [filterUser, setFilterUser] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [confirmTarget, setConfirmTarget] = useState<{ userId: string; name: string } | null>(null);
  const limit = 20;

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), limit: String(limit) });
    if (filterUser) params.set("userId", filterUser);
    fetch(`/api/admin/pages?${params}`, { credentials: "include" })
      .then((r) => r.json())
      .then((res) => { setPages(res.data); setTotal(res.pagination.total); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [page, filterUser]);

  const handleDelete = async (userId: string, name: string) => {
    try {
      await fetch(`/api/admin/pages/${userId}/${name}`, { method: "DELETE", credentials: "include" });
      setConfirmTarget(null);
      setPages((prev) => prev.filter((p) => !(p.userId === userId && p.name === name)));
      setTotal((t) => t - 1);
      toast.success("应用已删除");
    } catch (e) { toast.error((e as Error).message); }
  };

  const totalPages = Math.ceil(total / limit);

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">应用管理</h1>
      <div className="flex gap-2 mb-4">
        <Input
          placeholder="按用户 ID 筛选..."
          value={filterUser}
          onChange={(e) => { setFilterUser(e.target.value); setPage(1); }}
          className="max-w-56"
        />
        {filterUser && (
          <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => { setFilterUser(""); setPage(1); }}>清除</Button>
        )}
      </div>
      {error && <p className="text-destructive mb-4">{error}</p>}
      {loading && <p className="text-muted-foreground">加载中...</p>}
      {!loading && (
        <>
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="px-4 py-3 text-left">名称</th><th className="px-4 py-3 text-left">所有者</th>
                  <th className="px-4 py-3 text-left">版本</th><th className="px-4 py-3 text-left">更新时间</th>
                  <th className="px-4 py-3 text-left">操作</th>
                </tr>
              </thead>
              <tbody>
                {pages.map((p) => (
                  <tr key={`${p.userId}/${p.name}`} className="border-b last:border-0 hover:bg-muted/30">
                    <td className="px-4 py-3 font-mono text-xs">{p.name}</td>
                    <td className="px-4 py-3">{p.userId}</td>
                    <td className="px-4 py-3">v{p.currentVersion}</td>
                    <td className="px-4 py-3 text-muted-foreground">{new Date(p.updatedAt).toLocaleString()}</td>
                    <td className="px-4 py-3">
                      {confirmTarget?.userId === p.userId && confirmTarget?.name === p.name ? (
                        <div className="flex gap-1">
                          <Button size="sm" variant="destructive" onClick={() => handleDelete(p.userId, p.name)}>确认</Button>
                          <Button size="sm" variant="ghost" onClick={() => setConfirmTarget(null)}>取消</Button>
                        </div>
                      ) : (
                        <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setConfirmTarget({ userId: p.userId, name: p.name })}>删除</Button>
                      )}
                    </td>
                  </tr>
                ))}
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
    </div>
  );
}
