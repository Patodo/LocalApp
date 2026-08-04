"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface RecentItem { pagePath: string; lastVisitedAt: string; }

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

export default function RecentPage() {
  const [recent, setRecent] = useState<RecentItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/me/recent", { credentials: "include" })
      .then((r) => r.json())
      .then((d) => { if (d.success) setRecent(d.data); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">浏览历史</h1>
      {loading ? (
        <p className="text-muted-foreground">加载中...</p>
      ) : recent.length === 0 ? (
        <p className="py-12 text-center text-muted-foreground">暂无浏览记录</p>
      ) : (
        <ul className="space-y-1 rounded-lg border">
          {recent.map((r) => (
            <li key={r.pagePath} className="border-b last:border-0 px-4 py-3 hover:bg-muted/30 transition-colors">
              <Link
                prefetch={false}
                href={r.pagePath.startsWith("/") ? r.pagePath : `/${r.pagePath}`}
                className="flex items-center justify-between"
              >
                <span className="text-sm font-medium">{r.pagePath.replace(/^\//, "")}</span>
                <span className="text-xs text-muted-foreground ml-2 flex-shrink-0">{relativeTime(r.lastVisitedAt)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
