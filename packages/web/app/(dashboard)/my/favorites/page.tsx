"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Star } from "lucide-react";

interface FavItem { pagePath: string; pageName: string | null; ownerName: string | null; createdAt: string; }

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

export default function FavoritesPage() {
  const [favs, setFavs] = useState<FavItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/me/favorites", { credentials: "include" })
      .then((r) => r.json())
      .then((d) => { if (d.success) setFavs(d.data); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleUnfavorite = async (pagePath: string) => {
    try {
      const r = await fetch(`/api/favorites/${encodeURIComponent(pagePath)}`, { method: "DELETE", credentials: "include" });
      const d = await r.json();
      if (d.success) setFavs((prev) => prev.filter((f) => f.pagePath !== pagePath));
    } catch {}
  };

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">我的收藏</h1>
      {loading ? (
        <p className="text-muted-foreground">加载中...</p>
      ) : favs.length === 0 ? (
        <p className="py-12 text-center text-muted-foreground">暂无收藏</p>
      ) : (
        <ul className="space-y-1 rounded-lg border">
          {favs.map((fav) => (
            <li key={fav.pagePath} className="flex items-center justify-between border-b last:border-0 px-4 py-3 hover:bg-muted/30 transition-colors">
              <Link
                prefetch={false}
                href={fav.pagePath.startsWith("/") ? fav.pagePath : `/${fav.pagePath}`}
                className="flex-1 min-w-0"
              >
                <span className="text-sm font-medium">{fav.pageName || fav.pagePath}</span>
                <span className="text-xs text-muted-foreground ml-2">{relativeTime(fav.createdAt)}</span>
              </Link>
              <button
                onClick={() => handleUnfavorite(fav.pagePath)}
                className="text-muted-foreground hover:text-foreground ml-4"
                title="取消收藏"
              >
                <Star className="h-4 w-4 fill-amber-400 text-amber-400" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
