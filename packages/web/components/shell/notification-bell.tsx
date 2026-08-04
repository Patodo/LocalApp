"use client";

import { useState, useEffect, useCallback } from "react";
import { Bell } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { useAuthModals } from "@/components/auth-modals/auth-provider";

interface PageMeta { notify?: { enabled?: boolean } }
interface UserData { id: string; name: string }

interface Props {
  pagePath: string;
  pageName: string;
  ownerName: string;
  user: UserData | null;
  meta: PageMeta | null;
}

type Level = "all" | "important" | "muted";
const LEVEL_LABEL: Record<Level, string> = {
  all: "全部",
  important: "仅重要",
  muted: "静音",
};

export function NotificationBell({ pagePath, pageName, ownerName, user, meta }: Props) {
  const { openLogin } = useAuthModals();
  const [level, setLevel] = useState<Level | null>(null);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);

  // 仅当 manifest.notify.enabled 时渲染
  if (meta?.notify?.enabled !== true) return null;

  // 拉取订阅状态 + 未读数
  const fetchState = useCallback(async () => {
    if (!user) {
      setLevel(null);
      setUnread(0);
      return;
    }
    try {
      const [statusRes, unreadRes] = await Promise.all([
        fetch(`/api/subscriptions/${ownerName}/${pageName}/status`, { credentials: "include" }).then((r) => r.json()),
        fetch(`/api/inbox/unread-count`, { credentials: "include" }).then((r) => r.json()),
      ]);
      if (statusRes.success) setLevel(statusRes.data?.level ?? null);
      if (unreadRes.success) setUnread(unreadRes.data?.count ?? 0);
    } catch {}
  }, [user, ownerName, pageName]);

  useEffect(() => {
    fetchState();
  }, [fetchState]);

  const subscribe = async (newLevel: Level) => {
    if (!user) { openLogin(); return; }
    try {
      const res = await fetch("/api/subscriptions", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ app_owner: ownerName, app_name: pageName, level: newLevel }),
      });
      const d = await res.json();
      if (d.success) setLevel(newLevel);
    } catch {}
    setOpen(false);
  };

  const unsubscribe = async () => {
    try {
      const res = await fetch(`/api/subscriptions/${ownerName}/${pageName}`, {
        method: "DELETE",
        credentials: "include",
      });
      const d = await res.json();
      if (d.success) setLevel(null);
    } catch {}
    setOpen(false);
  };

  const onBellClick = () => {
    if (!user) { openLogin(); return; }
    if (level) {
      // 已订阅：跳收件箱
      window.location.href = "/inbox";
    } else {
      setOpen((v) => !v);
    }
  };

  const title = !user
    ? "登录后订阅此应用通知"
    : level
      ? `已订阅（${LEVEL_LABEL[level]}）· 点击查看收件箱`
      : "订阅此应用通知";

  return (
    <div className="relative">
      <Button
        variant="ghost"
        size="icon"
        className={`h-7 w-7 ${level ? "text-primary" : "text-muted-foreground"}`}
        title={title}
        onClick={onBellClick}
      >
        <Bell className="h-4 w-4" />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-bold text-white">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </Button>

      {open && user && (
        <div className="absolute right-0 top-9 z-50 w-44 rounded-md border bg-popover p-1 text-sm shadow-md">
          <div className="px-2 py-1.5 text-xs text-muted-foreground">选择订阅等级</div>
          {(["all", "important", "muted"] as Level[]).map((lv) => (
            <button
              key={lv}
              className="flex w-full items-center justify-between rounded px-2 py-1.5 hover:bg-accent"
              onClick={() => subscribe(lv)}
            >
              <span>{LEVEL_LABEL[lv]}</span>
              {level === lv && <span className="text-xs text-primary">✓</span>}
            </button>
          ))}
          <div className="my-1 border-t" />
          <Link href="/inbox" className="block rounded px-2 py-1.5 hover:bg-accent">
            查看收件箱
          </Link>
        </div>
      )}
    </div>
  );
}
