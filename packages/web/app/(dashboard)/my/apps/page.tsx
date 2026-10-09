"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CircleCheck, CircleOff, ExternalLink, Settings, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {CreateApplicationDialog} from "@/components/development/create-application-dialog";
import { toast } from "sonner";

interface PageInfo { userId: string; name: string; currentVersion: number; updatedAt: string; lifecycleStatus: "online" | "offline" }

export default function ProfileApps() {
  const [creating, setCreating] = useState(false);
  const [pages, setPages] = useState<PageInfo[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/me/pages", { credentials: "include" })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then((response) => setPages(response.data))
      .catch(() => toast.error("加载应用失败"))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p className="text-muted-foreground">加载中...</p>;

  return <div>
    <div className="mb-6 flex items-center justify-between"><h1 className="text-2xl font-bold">我的应用</h1><Button onClick={() => setCreating(true)}><Plus/>创建应用</Button></div>
    <CreateApplicationDialog open={creating} onOpenChange={setCreating}/>
    {pages.length === 0 ? <Card><CardContent className="flex flex-col items-center py-12 text-center"><p className="text-lg font-medium">暂无应用</p><p className="mt-1 text-sm text-muted-foreground">点击「创建应用」，和 Agent 一起把想法变成应用。</p></CardContent></Card> :
      <div className="divide-y border-y">{pages.map((page) => <div key={page.name} className="flex min-h-16 items-center justify-between gap-4 py-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate font-medium">{page.name}</span>
            <span className="text-xs text-muted-foreground">v{page.currentVersion}</span>
            <span className={`inline-flex items-center gap-1 text-xs ${page.lifecycleStatus === "online" ? "text-emerald-700" : "text-muted-foreground"}`}>
              {page.lifecycleStatus === "online" ? <CircleCheck className="size-3.5" /> : <CircleOff className="size-3.5" />}
              {page.lifecycleStatus === "online" ? "已上线" : "已下线"}
            </span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">更新于 {new Date(page.updatedAt).toLocaleString()}</p>
        </div>
        <div className="flex shrink-0 gap-1">
          {page.lifecycleStatus === "online"
            ? <Button asChild variant="ghost" size="icon"><Link href={`/${page.userId}/${page.name}/`} title="打开应用" aria-label={`打开 ${page.name}`}><ExternalLink /></Link></Button>
            : <Button asChild variant="ghost" size="icon"><Link href={`/${page.userId}/${page.name}/`} title="查看下线页" aria-label={`查看 ${page.name} 下线页`}><CircleOff /></Link></Button>}
          <Button asChild variant="ghost" size="icon"><Link href={`/my/apps/${encodeURIComponent(page.name)}/settings`} title="应用设置" aria-label={`${page.name} 设置`}><Settings /></Link></Button>
        </div>
      </div>)}</div>}
  </div>;
}
