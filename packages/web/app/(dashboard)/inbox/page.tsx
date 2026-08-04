"use client";

import { useEffect, useState, useCallback } from "react";
import { Check, CheckCheck, Trash2, ArrowLeft, BellOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import Link from "next/link";

interface NotificationItem {
  id: string;
  app_owner: string;
  app_name: string;
  title: string;
  body: string | null;
  url: string | null;
  priority: string;
  data: string | null;
  created_at: string;
  read_at: string | null;
}

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "刚刚";
  if (mins < 60) return `${mins} 分钟前`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  return `${days} 天前`;
}

export default function InboxPage() {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [unread, setUnread] = useState(0);

  const refreshUnread = useCallback(async () => {
    try {
      const r = await fetch("/api/inbox/unread-count", { credentials: "include" });
      const d = await r.json();
      if (d.success) setUnread(d.data?.count ?? 0);
    } catch {}
  }, []);

  useEffect(() => {
    fetch("/api/inbox?limit=20", { credentials: "include" })
      .then((r) => r.json())
      .then((d) => {
        if (d.success) {
          setItems(d.data.items ?? []);
          setCursor(d.data.cursor ?? null);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
    refreshUnread();
  }, [refreshUnread]);

  const loadMore = async () => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const r = await fetch(`/api/inbox?limit=20&cursor=${encodeURIComponent(cursor)}`, { credentials: "include" });
      const d = await r.json();
      if (d.success) {
        setItems((prev) => [...prev, ...(d.data.items ?? [])]);
        setCursor(d.data.cursor ?? null);
      }
    } catch {}
    setLoadingMore(false);
  };

  const markRead = async (id: string, url?: string | null) => {
    try {
      const r = await fetch(`/api/inbox/${id}`, { method: "PATCH", credentials: "include" });
      const d = await r.json();
      if (d.success) {
        setItems((prev) => prev.map((it) => (it.id === id ? { ...it, read_at: d.data.read_at } : it)));
        refreshUnread();
        if (url) {
          window.location.href = url.startsWith("/") ? url : `/${url}`;
        }
      }
    } catch {}
  };

  const remove = async (id: string) => {
    try {
      const r = await fetch(`/api/inbox/${id}`, { method: "DELETE", credentials: "include" });
      const d = await r.json();
      if (d.success) {
        setItems((prev) => prev.filter((it) => it.id !== id));
        refreshUnread();
      }
    } catch {}
  };

  const markAllRead = async () => {
    try {
      const r = await fetch("/api/inbox/read-all", { method: "POST", credentials: "include" });
      const d = await r.json();
      if (d.success) {
        const now = new Date().toISOString();
        setItems((prev) => prev.map((it) => ({ ...it, read_at: it.read_at ?? now })));
        setUnread(0);
      }
    } catch {}
  };

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/" className="text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <h1 className="text-xl font-semibold">
            收件箱
            {unread > 0 && <span className="ml-2 text-sm font-normal text-muted-foreground">{unread} 条未读</span>}
          </h1>
        </div>
        {unread > 0 && (
          <Button variant="ghost" size="sm" className="gap-1.5" onClick={markAllRead}>
            <CheckCheck className="h-4 w-4" />
            全部标为已读
          </Button>
        )}
      </div>

      {loading ? (
        <div className="text-muted-foreground">加载中...</div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <BellOff className="mb-3 h-12 w-12 text-muted-foreground/40" />
          <div className="text-muted-foreground">收件箱空空如也</div>
          <div className="mt-1 text-sm text-muted-foreground/70">订阅的应用发布通知后会出现在这里</div>
        </div>
      ) : (
        <ul className="space-y-2">
          {items.map((it) => (
            <li
              key={it.id}
              className={`rounded-md border p-3 transition ${it.read_at ? "bg-card" : "bg-primary/5 border-primary/30"}`}
            >
              <div className="flex items-start gap-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    {!it.read_at && <span className="h-2 w-2 rounded-full bg-primary" />}
                    <strong className="text-sm">{it.title}</strong>
                    {it.priority === "high" && (
                      <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-700">高优先级</span>
                    )}
                  </div>
                  {it.body && <div className="mt-1 text-sm text-muted-foreground">{it.body}</div>}
                  <div className="mt-1.5 text-xs text-muted-foreground/70">
                    来自 <Link prefetch={false} href={`/${it.app_owner}/${it.app_name}`} className="hover:underline">{it.app_owner}/{it.app_name}</Link>
                    <span className="mx-1">·</span>
                    {relativeTime(it.created_at)}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  {it.url && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      title="查看并标记已读"
                      onClick={() => markRead(it.id, it.url!)}
                    >
                      查看
                    </Button>
                  )}
                  {!it.read_at && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      title="标记已读"
                      onClick={() => markRead(it.id)}
                    >
                      <Check className="h-3.5 w-3.5" />
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground hover:text-red-500"
                    title="删除"
                    onClick={() => remove(it.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {cursor && (
        <div className="mt-4 flex justify-center">
          <Button variant="outline" size="sm" onClick={loadMore} disabled={loadingMore}>
            {loadingMore ? "加载中..." : "加载更多"}
          </Button>
        </div>
      )}
    </div>
  );
}
