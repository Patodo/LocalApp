"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

interface TrendPoint { date: string; requests: number; pageViews: number; newUsers: number; }
interface OverviewData { totalRequests: number; uniqueVisitors: number; pageViews: number; avgResponseMs: number; }
interface PageRankItem { pagePath: string; pageName: string; userId: string; views: number; uniqueVisitors: number; }

const periods = [{ value: "1d", label: "1 天" }, { value: "7d", label: "7 天" }, { value: "30d", label: "30 天" }];

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export default function AdminAnalytics() {
  const [period, setPeriod] = useState("7d");
  const [overview, setOverview] = useState<OverviewData | null>(null);
  const [trends, setTrends] = useState<TrendPoint[]>([]);
  const [pages, setPages] = useState<PageRankItem[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([
      fetchJson<{ data: OverviewData }>(`/api/admin/analytics/overview?period=${period}`),
      fetchJson<{ data: TrendPoint[] }>(`/api/admin/analytics/trends?range=${period}`),
      fetchJson<{ data: PageRankItem[] }>(`/api/admin/analytics/pages?period=${period}&limit=20`),
    ])
      .then(([ov, tr, pg]) => { setOverview(ov.data); setTrends(tr.data); setPages(pg.data); })
      .catch((e) => setError(e.message));
  }, [period]);

  if (error) return <p className="text-destructive">加载失败：{error}</p>;
  if (!overview) return <p className="text-muted-foreground">加载中...</p>;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">数据分析</h1>
        <div className="flex gap-2">
          {periods.map((p) => (
            <Button
              key={p.value}
              variant={period === p.value ? "default" : "outline"}
              size="sm"
              onClick={() => setPeriod(p.value)}
            >
              {p.label}
            </Button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard label="总请求数" value={overview.totalRequests.toLocaleString()} />
        <StatCard label="独立访客" value={overview.uniqueVisitors.toLocaleString()} />
        <StatCard label="页面浏览" value={overview.pageViews.toLocaleString()} />
        <StatCard label="平均响应" value={`${overview.avgResponseMs}ms`} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <ChartCard title="请求趋势">
          <div className="h-60 flex flex-col gap-2 overflow-y-auto">
            {trends.slice(-20).map((t, i) => (
              <div key={i} className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">{t.date}</span>
                <div className="flex items-center gap-4">
                  <span>请求：<strong>{t.requests}</strong></span>
                  <span>浏览：<strong>{t.pageViews}</strong></span>
                </div>
              </div>
            ))}
          </div>
        </ChartCard>

        <ChartCard title="新用户趋势">
          <div className="h-60 flex flex-col gap-2 overflow-y-auto">
            {trends.slice(-20).map((t, i) => (
              <div key={i} className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">{t.date}</span>
                <span>新用户：<strong>{t.newUsers}</strong></span>
              </div>
            ))}
          </div>
        </ChartCard>

        <ChartCard title="页面浏览趋势">
          <div className="h-60 flex flex-col gap-2 overflow-y-auto">
            {trends.slice(-20).map((t, i) => (
              <div key={i} className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">{t.date}</span>
                <div className="w-48 bg-muted rounded-full h-4 overflow-hidden">
                  <div className="bg-primary h-full rounded-full" style={{ width: `${Math.min(100, (t.pageViews / Math.max(...trends.map(x => x.pageViews))) * 100)}%` }} />
                </div>
                <span className="text-xs">{t.pageViews}</span>
              </div>
            ))}
          </div>
        </ChartCard>

        <ChartCard title="热门页面">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-1 font-medium">页面</th>
                  <th className="text-left py-1 font-medium">用户</th>
                  <th className="text-right py-1 font-medium">浏览</th>
                  <th className="text-right py-1 font-medium">访客</th>
                </tr>
              </thead>
              <tbody>
                {pages.slice(0, 10).map((p, i) => (
                  <tr key={i} className="border-b last:border-0">
                    <td className="py-1 font-mono">{p.pageName || p.pagePath}</td>
                    <td className="py-1 text-muted-foreground">{p.userId}</td>
                    <td className="py-1 text-right">{p.views}</td>
                    <td className="py-1 text-right">{p.uniqueVisitors}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </ChartCard>
      </div>
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
        <p className="text-xl font-bold">{value}</p>
      </CardContent>
    </Card>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="lg:col-span-1">
      <CardHeader>
        <CardTitle className="text-sm font-semibold">{title}</CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}
