"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Rocket } from "lucide-react";

interface StatsData {
  users: { total: number };
  pages: { total: number; totalSize: string };
  schemas: { total: number };
  recentDeploys: Array<{ pageName: string; userId: string; version: number; createdAt: string }>;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "刚刚";
  if (mins < 60) return `${mins}分钟前`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}小时前`;
  return `${Math.floor(hours / 24)}天前`;
}

export default function AdminDashboard() {
  const [stats, setStats] = useState<StatsData | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/admin/stats", { credentials: "include" })
      .then((r) => r.json())
      .then((r) => setStats(r.data))
      .catch((e) => setError(e.message));
  }, []);

  if (error) return <p className="text-destructive">加载失败：{error}</p>;

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">系统概览</h1>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {stats ? (
          <>
            <StatCard label="用户" value={String(stats.users.total)} />
            <StatCard label="应用" value={String(stats.pages.total)} />
            <StatCard label="数据模型" value={String(stats.schemas.total)} />
            <StatCard label="存储量" value={stats.pages.totalSize} />
          </>
        ) : (
          Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}>
              <CardHeader className="pb-2"><Skeleton className="h-4 w-16" /></CardHeader>
              <CardContent><Skeleton className="h-8 w-12" /></CardContent>
            </Card>
          ))
        )}
      </div>

      <h2 className="text-lg font-semibold mb-4">最近部署</h2>
      {!stats ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3">
              <Skeleton className="h-2 w-2 rounded-full" />
              <Skeleton className="h-4 flex-1" />
              <Skeleton className="h-4 w-24" />
            </div>
          ))}
        </div>
      ) : stats.recentDeploys.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center py-12 text-center">
            <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
              <Rocket className="h-6 w-6 text-muted-foreground" />
            </div>
            <p className="text-sm font-medium">暂无部署</p>
            <p className="text-xs text-muted-foreground mt-1">上传您的第一个应用后将在此处显示。</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-0 rounded-lg border">
          {stats.recentDeploys.map((d, i) => (
            <div
              key={i}
              className="flex items-center gap-3 border-b px-4 py-3 last:border-0 hover:bg-muted/30 transition-colors"
            >
              <div className="flex h-2 w-2 shrink-0 rounded-full bg-primary" />
              <div className="flex-1 min-w-0">
                <span className="font-mono text-sm font-medium">{d.pageName}</span>
                <span className="text-muted-foreground text-sm ml-2">由 {d.userId}</span>
              </div>
              <span className="text-xs text-muted-foreground whitespace-nowrap">v{d.version}</span>
              <span className="text-xs text-muted-foreground whitespace-nowrap">{timeAgo(d.createdAt)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-bold">{value}</p>
      </CardContent>
    </Card>
  );
}
