"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  House,
  LayoutDashboard,
  BarChart3,
  Users,
  Globe,
  Users2,
  Settings,
  Cable,
  UserCircle,
  Package,
  Key,
  Group,
  Star,
  Clock,
  FolderKanban,
  ListChecks,
  ChevronLeft,
  ChevronRight,
  LogOut,
  Menu,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuthModals } from "@/components/auth-modals/auth-provider";

interface UserData {
  id: string;
  name: string;
  displayName?: string | null;
  avatarUrl?: string | null;
  role?: string | null;
}

const homeNavItem = { href: "/", label: "首页", icon: House };

const profileNavItems = [
  { href: "/my/info", label: "个人资料", icon: UserCircle },
  { href: "/my/studio", label: "Studio", icon: FolderKanban },
  { href: "/my/tasks", label: "任务", icon: ListChecks },
  { href: "/my/apps", label: "我的应用", icon: Package },
  { href: "/my/keys", label: "API 密钥", icon: Key },
  { href: "/my/groups", label: "我的群组", icon: Group },
  { href: "/my/favorites", label: "我的收藏", icon: Star },
  { href: "/my/recent", label: "浏览历史", icon: Clock },
];

const adminNavItems = [
  { href: "/my/dashboard", label: "系统概览", icon: LayoutDashboard },
  { href: "/my/analytics", label: "数据分析", icon: BarChart3 },
  { href: "/my/users", label: "用户管理", icon: Users },
  { href: "/my/pages", label: "应用管理", icon: Globe },
  { href: "/my/orgs", label: "组织管理", icon: Users2 },
  { href: "/my/settings", label: "系统配置", icon: Settings },
  { href: "/my/system", label: "系统设置", icon: Settings },
  { href: "/my/peers", label: "对端连接", icon: Cable },
];

function NavItem({ item, pathname, collapsed, onClose }: { item: { href: string; label: string; icon: React.ComponentType<{ className?: string }> }; pathname: string; collapsed: boolean; onClose: () => void }) {
  const active = item.href === "/" ? pathname === "/" : pathname === item.href || pathname.startsWith(item.href + "/");
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      onClick={onClose}
      className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
        active
          ? "bg-primary/10 text-primary font-medium"
          : "text-muted-foreground hover:bg-accent hover:text-foreground"
      }`}
    >
      <Icon className="h-4 w-4 flex-shrink-0" />
      {!collapsed && <span>{item.label}</span>}
    </Link>
  );
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { openLogin } = useAuthModals();
  const isPublicHome = pathname === "/";
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [user, setUser] = useState<UserData | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);

  useEffect(() => {
    fetch("/api/me", { credentials: "include" })
      .then((res) => res.json())
      .then((body) => {
        if (body.success && body.data) {
          setUser(body.data);
        } else if (!isPublicHome) {
          openLogin();
        }
      })
      .catch(() => {
        if (!isPublicHome) {
          openLogin();
        }
      })
      .finally(() => setCheckingSession(false));
  }, [isPublicHome, openLogin]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMobileOpen(false); };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1023px)");
    setCollapsed(mq.matches);
    const handler = (e: MediaQueryListEvent) => setCollapsed(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  const handleLogout = useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    setUser(null);
    openLogin();
  }, [openLogin]);

  const isAdmin = user?.role === "admin";
  const closeMobile = () => setMobileOpen(false);

  if (checkingSession) return null;
  if (!user) return isPublicHome ? <>{children}</> : null;

  const sidebar = (
    <aside
      className={`flex h-full flex-col border-r bg-card transition-all duration-200 ${
        collapsed ? "w-16" : "w-56"
      }`}
    >
      <div className="flex h-14 items-center justify-between px-3">
        {!collapsed ? (
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-gradient-to-br from-indigo-500 via-fuchsia-500 to-orange-400 text-[13px] font-bold text-white">Q</div>
            <span className="text-sm font-semibold">LocalApp</span>
          </div>
        ) : (
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-gradient-to-br from-indigo-500 via-fuchsia-500 to-orange-400 text-[13px] font-bold text-white mx-auto">Q</div>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="hidden h-8 w-8 lg:flex"
          onClick={() => setCollapsed(!collapsed)}
        >
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </Button>
        <Button variant="ghost" size="icon" className="h-8 w-8 lg:hidden" onClick={closeMobile}>
          <X className="h-4 w-4" />
        </Button>
      </div>
      <div className="h-[3px] bg-gradient-to-r from-indigo-500 via-fuchsia-500 to-orange-400" />

      <nav className="flex-1 overflow-y-auto p-2">
        {/* Home — always visible */}
        <NavItem item={homeNavItem} pathname={pathname} collapsed={collapsed} onClose={closeMobile} />

        {/* Personal section */}
        <div className="mt-2 space-y-1">
          {!collapsed && <p className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">个人</p>}
          {profileNavItems.map((item) => (
            <NavItem key={item.href} item={item} pathname={pathname} collapsed={collapsed} onClose={closeMobile} />
          ))}
        </div>

        {/* Admin section — admin only */}
        {isAdmin && (
          <div className="mt-2 space-y-1">
            {!collapsed && <p className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">管理</p>}
            {adminNavItems.map((item) => (
              <NavItem key={item.href} item={item} pathname={pathname} collapsed={collapsed} onClose={closeMobile} />
            ))}
          </div>
        )}
      </nav>

      <div className="border-t p-3">
        <div className={`flex items-center ${collapsed ? "justify-center" : "gap-3"}`}>
          {user.avatarUrl ? (
            <img src={user.avatarUrl} alt="" className="h-8 w-8 flex-shrink-0 rounded-full" />
          ) : (
            <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-medium">
              {(user.displayName || user.name).charAt(0).toUpperCase()}
            </div>
          )}
          {!collapsed && (
            <div className="flex-1 min-w-0">
              <p className="truncate text-sm font-medium">{user.displayName || user.name}</p>
              <p className="truncate text-xs text-muted-foreground">{user.name}</p>
            </div>
          )}
          {!collapsed && (
            <Button variant="ghost" size="icon" className="h-8 w-8 flex-shrink-0" onClick={handleLogout}>
              <LogOut className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    </aside>
  );

  return (
    <div className="flex h-screen bg-background">
      {/* Desktop sidebar */}
      <div className="hidden lg:block h-full">{sidebar}</div>

      {/* Mobile sidebar overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={closeMobile} />
          <div className="absolute left-0 top-0 h-full">{sidebar}</div>
        </div>
      )}

      <main className="flex flex-1 flex-col overflow-hidden">
        {/* Mobile top bar */}
        <div className="flex h-12 items-center gap-3 border-b bg-card px-4 lg:hidden">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setMobileOpen(true)}>
            <Menu className="h-4 w-4" />
          </Button>
          <span className="text-sm font-semibold">LocalApp</span>
        </div>

        <div className="flex-1 overflow-auto">
          <div className="mx-auto max-w-[1600px] p-4 md:p-6">{children}</div>
        </div>
      </main>
    </div>
  );
}
