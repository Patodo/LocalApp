"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Bell, ExternalLink, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Subscription {
  user_id: string;
  app_owner: string;
  app_name: string;
  level: "all" | "important" | "muted";
  created_at: string;
}

const LEVEL_LABEL: Record<Subscription["level"], string> = {
  all: "全部",
  important: "仅重要",
  muted: "静音",
};

const LEVEL_NEXT: Record<Subscription["level"], Subscription["level"]> = {
  all: "important",
  important: "muted",
  muted: "all",
};

export default function SubscriptionsPage() {
  const [subs, setSubs] = useState<Subscription[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/subscriptions", { credentials: "include" })
      .then((r) => r.json())
      .then((d) => { if (d.success) setSubs(d.data ?? []); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const changeLevel = async (sub: Subscription) => {
    const next = LEVEL_NEXT[sub.level];
    try {
      const r = await fetch("/api/subscriptions", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ app_owner: sub.app_owner, app_name: sub.app_name, level: next }),
      });
      const d = await r.json();
      if (d.success) {
        setSubs((prev) =>
          prev.map((s) => (s.app_owner === sub.app_owner && s.app_name === sub.app_name ? { ...s, level: next } : s)),
        );
      }
    } catch {}
  };

  const unsubscribe = async (sub: Subscription) => {
    if (!confirm(`确定退订 ${sub.app_owner}/${sub.app_name} 的通知？`)) return;
    try {
      const r = await fetch(`/api/subscriptions/${sub.app_owner}/${sub.app_name}`, {
        method: "DELETE",
        credentials: "include",
      });
      const d = await r.json();
      if (d.success) {
        setSubs((prev) =>
          prev.filter((s) => !(s.app_owner === sub.app_owner && s.app_name === sub.app_name)),
        );
      }
    } catch {}
  };

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <h1 className="mb-4 text-xl font-semibold">订阅管理</h1>

      {loading ? (
        <div className="text-muted-foreground">加载中...</div>
      ) : subs.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Bell className="mb-3 h-12 w-12 text-muted-foreground/40" />
          <div className="text-muted-foreground">尚未订阅任何应用</div>
          <div className="mt-1 text-sm text-muted-foreground/70">
            打开任意支持通知的应用，点击右上角 🔔 按钮即可订阅
          </div>
        </div>
      ) : (
        <ul className="space-y-2">
          {subs.map((sub) => (
            <li key={`${sub.app_owner}/${sub.app_name}`} className="rounded-md border p-3">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <Link
                    href={`/${sub.app_owner}/${sub.app_name}`}
                    prefetch={false}
                    className="inline-flex items-center gap-1.5 text-sm font-medium hover:underline"
                  >
                    {sub.app_owner}/{sub.app_name}
                    <ExternalLink className="h-3 w-3 text-muted-foreground" />
                  </Link>
                  <div className="mt-1 text-xs text-muted-foreground">
                    订阅于 {new Date(sub.created_at).toLocaleDateString("zh-CN")}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    title="点击切换等级（全部 → 仅重要 → 静音 → 全部）"
                    onClick={() => changeLevel(sub)}
                  >
                    {LEVEL_LABEL[sub.level]}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground hover:text-red-500"
                    title="退订"
                    onClick={() => unsubscribe(sub)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
