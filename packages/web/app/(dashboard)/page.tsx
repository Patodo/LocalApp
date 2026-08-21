"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Check,
  Clock,
  Code2,
  Copy,
  Database,
  Download,
  Globe,
  Layers3,
  LogIn,
  MonitorDown,
  Package,
  Rocket,
  ShieldCheck,
  Star,
  Terminal,
  UploadCloud,
} from "lucide-react";
import { useAuthModals } from "@/components/auth-modals/auth-provider";
import { AgentStarterHint } from "@/components/agent-starter-hint";

interface UserData {
  id: string;
  name: string;
  displayName?: string | null;
}

interface AppItem {
  name: string;
  currentVersion: number;
  updatedAt: string;
}

interface FavoriteItem {
  pagePath: string;
  pageName: string | null;
  ownerName: string | null;
  createdAt: string;
}

interface RecentItem {
  pagePath: string;
  lastVisitedAt: string;
}

type LoadState<T> = {
  data: T[];
  loading: boolean;
  error: boolean;
};

interface CliVersionInfo {
  latest: string;
  min: string;
  versions: Record<string, { platforms: Record<string, string> }>;
}

type PlatformInfo = { os: string; arch: string; label: string };

const PLATFORM_LABELS: Record<string, string> = {
  "windows/x86_64": "Windows x64",
  "linux/x86_64": "Linux x64",
  "macos/aarch64": "macOS ARM",
  "macos/x86_64": "macOS x64",
};

function detectPlatform(): string | null {
  const ua = navigator.platform || "";
  if (ua.includes("Win")) return "windows/x86_64";
  if (ua.includes("Mac") && (ua.includes("arm") || ua.includes("ARM"))) return "macos/aarch64";
  if (ua.includes("Mac")) return "macos/x86_64";
  if (ua.includes("Linux")) return "linux/x86_64";
  return null;
}

interface HomeStats {
  users: number;
  pages: number;
  schemas: number;
  deploys: number;
  monthDeploys: number;
}

function relativeTime(dateStr: string): string {
  const time = new Date(dateStr).getTime();
  if (Number.isNaN(time)) return "刚刚";

  const diff = Date.now() - time;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "刚刚";
  if (mins < 60) return `${mins} 分钟前`;

  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} 小时前`;

  const days = Math.floor(hours / 24);
  return `${days} 天前`;
}

async function loadList<T>(url: string): Promise<T[]> {
  const response = await fetch(url, { credentials: "include" });
  const body = await response.json();
  if (!response.ok || !body.success) {
    throw new Error(body.error || "请求失败");
  }
  return body.data ?? [];
}

function appTitleFromPath(path: string): string {
  return path.replace(/^\//, "").split("/").join(" / ");
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed bg-card p-6 text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}

function LoadingState() {
  return (
    <div className="rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground">
      加载中...
    </div>
  );
}

function PublicHome() {
  const { openLogin } = useAuthModals();
  const [copied, setCopied] = useState(false);
  const [activeStep, setActiveStep] = useState(0);
  const [homeStats, setHomeStats] = useState<HomeStats | null>(null);
  const [availablePlatforms, setAvailablePlatforms] = useState<PlatformInfo[]>([]);
  const detectedPlatform = typeof window !== "undefined" ? detectPlatform() : null;
  const serverOrigin = typeof window !== "undefined" ? window.location.origin : "";

  const workflow = [
    { command: "localapp --version", title: "下载 CLI", text: "从下方选择对应平台下载命令行工具，并确认安装版本。", icon: Download },
    { command: `localapp login ${serverOrigin}`, title: "连接实例", text: "使用 API Key 将 CLI 绑定到当前 LocalApp 实例。", icon: LogIn },
    { command: "localapp init my-app", title: "创建并开发", text: "从内置模板开始，让 Agent 直接实现可维护的 React 业务应用。", icon: Package },
    { command: "localapp check && localapp app install", title: "检查并发布", text: "一次完成契约、测试、构建、安装和正式路径验收。", icon: UploadCloud },
  ];

  const gates = [
    { num: "01", title: "代码可控", text: "React 与 TypeScript 源码始终属于应用，Agent 和开发者都能直接维护。", icon: Code2 },
    { num: "02", title: "声明式后端", text: "用 migration、Named SQL 和事务 mutation 承载稳定业务逻辑。", icon: Database },
    { num: "03", title: "平台能力", text: "认证、权限、文件、通知、Issue、AI Shell 和运维能力统一托管。", icon: Layers3 },
  ];

  const stats = [
    ["已发布应用", homeStats?.pages, Rocket],
    ["开发者", homeStats?.users, ShieldCheck],
    ["数据模型", homeStats?.schemas, Globe],
    ["本月部署", homeStats?.monthDeploys, UploadCloud],
  ] as const;

  useEffect(() => {
    fetch("/api/home/stats")
      .then((response) => response.json())
      .then((body) => {
        if (body.success) setHomeStats(body.data);
      })
      .catch(() => setHomeStats(null));
  }, []);

  useEffect(() => {
    fetch("/api/cli/version")
      .then((response) => (response.ok ? response.json() : null))
      .then((data: CliVersionInfo | null) => {
        if (!data?.versions) return;
        const latestVer = data.versions[data.latest];
        if (!latestVer?.platforms) return;
        const platforms: PlatformInfo[] = Object.keys(latestVer.platforms).map((key) => ({
          os: key.split("/")[0],
          arch: key.split("/")[1],
          label: PLATFORM_LABELS[key] || key,
        }));
        setAvailablePlatforms(platforms);
      })
      .catch(() => setAvailablePlatforms([]));
  }, []);

  const formatStat = (value: number | undefined) => {
    if (value == null) return "...";
    return new Intl.NumberFormat("zh-CN").format(value);
  };

  const active = workflow[activeStep];
  const ActiveIcon = active.icon;

  return (
    <main className="min-h-screen overflow-hidden bg-[#f8f8f6] text-[#111111]">
      <section className="relative min-h-screen bg-[#f8f8f6]">
        <div className="absolute inset-0 bg-[linear-gradient(rgba(192,0,0,0.052)_1px,transparent_1px),linear-gradient(90deg,rgba(17,17,17,0.045)_1px,transparent_1px)] bg-[size:40px_40px]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_15%_8%,rgba(192,0,0,0.12),transparent_28%),linear-gradient(90deg,#f8f8f6_0%,rgba(248,248,246,0.96)_34%,rgba(248,248,246,0.38)_66%,rgba(248,248,246,0.92)_100%)]" />
        <img
          src="/home/redline-launch-hero.png"
          alt=""
          className="absolute bottom-[7.75rem] right-0 top-16 hidden w-[160vw] -translate-x-[38vw] object-cover object-left opacity-95 min-[960px]:block"
        />
        <div className="absolute inset-x-0 bottom-0 h-56 bg-gradient-to-t from-[#f8f8f6] via-[#f8f8f6]/92 to-transparent" />

        <div className="relative flex min-h-screen w-full flex-col px-5 py-3 sm:px-8 xl:px-12 2xl:px-16">
          <nav className="flex h-11 items-center justify-between gap-5 border-b border-black/10 bg-[#f8f8f6]/84 pb-3 backdrop-blur">
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-[#c00000] text-base font-black text-white shadow-[0_12px_28px_rgba(192,0,0,0.24)]">
                Q
              </span>
              <span className="truncate text-xl font-black tracking-normal">LocalApp</span>
            </div>
            <button
              type="button"
              onClick={() => openLogin()}
              className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-md bg-[#c00000] px-5 text-sm font-semibold text-white shadow-[0_10px_24px_rgba(192,0,0,0.24)] transition hover:bg-[#9f0000]"
            >
              <LogIn className="h-4 w-4" />
              登录
            </button>
          </nav>

          <div className="grid flex-1 gap-5 pt-20 min-[960px]:grid-cols-12 min-[960px]:items-start xl:pt-24">
            <div className="relative z-10 min-[960px]:col-span-5">
              <div className="mb-4 inline-flex items-center gap-2 border-l-4 border-[#c00000] bg-white/72 px-3 py-2 text-xs font-bold uppercase tracking-normal text-[#c00000] shadow-sm">
                Agent application platform
              </div>
              <h1 className="text-6xl font-black leading-[0.9] tracking-normal text-[#c00000] sm:text-8xl min-[960px]:text-[clamp(4.5rem,6vw,8.4rem)]">
                LocalApp
              </h1>
              <h2 className="mt-4 max-w-2xl text-2xl font-black leading-tight tracking-normal text-black sm:text-3xl min-[960px]:text-[clamp(2rem,2.2vw,2.6rem)]">
                <span className="block">让 Agent 交付真正可运行的</span>
                <span className="block">业务应用</span>
              </h2>
              <p className="mt-4 max-w-xl text-base leading-7 text-black/64">
                保留 React / TypeScript 的完整定制能力，由平台承接认证、数据契约、文件、协作和运维，让应用从创建到上线形成一条可验证的交付路径。
              </p>
              <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
                {availablePlatforms.length > 0 ? (
                  availablePlatforms.map((p) => {
                    const isCurrent = detectedPlatform === `${p.os}/${p.arch}`;
                    return (
                      <a
                        key={`${p.os}/${p.arch}`}
                        href={`/api/cli/download?os=${p.os}&arch=${p.arch}`}
                        className={`inline-flex h-12 items-center justify-center gap-2 rounded-md px-5 text-sm font-bold shadow-[0_18px_42px_rgba(192,0,0,0.25)] transition ${
                          isCurrent
                            ? "bg-[#c00000] text-white hover:bg-[#a30000]"
                            : "border border-black/18 bg-white/78 text-black shadow-sm backdrop-blur hover:border-[#c00000]/60 hover:text-[#c00000]"
                        }`}
                      >
                        <Download className="h-4 w-4" />
                        下载 {p.label}
                      </a>
                    );
                  })
                ) : (
                  <span className="text-sm text-black/52">暂无 CLI 可供下载，请联系管理员</span>
                )}
                <button
                  type="button"
                  onClick={() => openLogin()}
                  className="inline-flex h-12 items-center justify-center gap-2 rounded-md border border-black/18 bg-white/78 px-5 text-sm font-semibold text-black shadow-sm backdrop-blur transition hover:border-[#c00000]/60 hover:text-[#c00000]"
                >
                  <LogIn className="h-4 w-4" />
                  登录进入平台
                </button>
              </div>
              <div className="mt-5 flex flex-wrap gap-x-6 gap-y-2 text-sm text-black/62">
                <span className="inline-flex items-center gap-2"><Code2 className="h-4 w-4" /> React 可定制</span>
                <span className="inline-flex items-center gap-2"><Database className="h-4 w-4" /> Named SQL</span>
                <span className="inline-flex items-center gap-2"><ShieldCheck className="h-4 w-4" /> 上传即验收</span>
              </div>
            </div>

            <div className="relative z-10 min-[960px]:col-span-7">
              <div id="workflow" className="ml-auto max-w-[760px] overflow-hidden rounded-xl border border-black/10 bg-white/86 shadow-[0_24px_80px_rgba(17,17,17,0.14)] backdrop-blur">
                <div className="grid grid-cols-2 border-b border-black/10 bg-white/72 min-[640px]:grid-cols-4">
                    {workflow.map((item, index) => {
                      const Icon = item.icon;
                      return (
                        <button
                          key={item.command}
                          type="button"
                          onClick={() => setActiveStep(index)}
                          className={`group relative flex min-h-[5.8rem] items-center gap-3 border-b border-r border-black/10 px-4 py-3 text-left transition [@media(min-width:640px)]:border-b-0 last:border-r-0 ${
                            activeStep === index
                              ? "bg-white text-black"
                              : "bg-white/45 text-black/62 hover:bg-white/80 hover:text-black"
                          }`}
                        >
                          <span
                            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full border ${
                              activeStep === index
                                ? "border-[#c00000] bg-[#c00000] text-white"
                                : "border-black/16 bg-white text-black/48"
                            }`}
                          >
                            <Icon className="h-4 w-4" />
                          </span>
                          <span className="min-w-0">
                            <span className={`block text-sm font-black ${activeStep === index ? "text-[#c00000]" : "text-black/55"}`}>
                              0{index + 1}
                            </span>
                            <span className="block truncate text-sm font-black">{item.title}</span>
                          </span>
                          {activeStep === index && <span className="absolute inset-x-0 bottom-0 h-1 bg-[#c00000]" />}
                        </button>
                      );
                    })}
                </div>

                <div className="p-5">
                  <div className="relative min-h-[18rem] overflow-hidden rounded-lg bg-[#f8f8f6]/72 p-5">
                    <div className="absolute inset-0 bg-[linear-gradient(rgba(192,0,0,0.065)_1px,transparent_1px),linear-gradient(90deg,rgba(17,17,17,0.035)_1px,transparent_1px)] bg-[size:28px_28px]" />
                    <div className="relative flex h-full flex-col justify-between">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <p className="text-xs font-black uppercase tracking-normal text-[#c00000]">active sequence</p>
                          <h2 className="mt-2 text-3xl font-black leading-tight text-black">{active.title}</h2>
                          <p className="mt-3 max-w-xl text-sm leading-6 text-black/58">{active.text}</p>
                        </div>
                        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-[#c00000] text-white shadow-[0_16px_34px_rgba(192,0,0,0.22)]">
                          <ActiveIcon className="h-6 w-6" />
                        </div>
                      </div>

                      <div>
                        <div className="mb-4 h-1.5 overflow-hidden rounded-full bg-black/10">
                          <div
                            className="h-full rounded-full bg-[#c00000] transition-all"
                            style={{ width: `${((activeStep + 1) / workflow.length) * 100}%` }}
                          />
                        </div>
                        <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-center">
                          <code className="min-w-0 break-all rounded-md border border-black/10 bg-white px-4 py-3 font-mono text-sm font-semibold text-black shadow-sm">
                            {active.command}
                          </code>
                          <button
                            type="button"
                            onClick={() => {
                              navigator.clipboard.writeText(active.command).then(() => {
                                setCopied(true);
                                setTimeout(() => setCopied(false), 1500);
                              });
                            }}
                            className={`group inline-flex items-center gap-1.5 rounded-md border px-3 py-2.5 text-xs font-bold transition-all duration-200 ${
                              copied
                                ? "border-[#c00000]/30 bg-[#c00000]/8 text-[#c00000] shadow-sm"
                                : "border-black/10 bg-white text-black/45 hover:border-[#c00000]/40 hover:bg-[#c00000]/5 hover:text-[#c00000] hover:shadow-md active:scale-95"
                            }`}
                          >
                            {copied ? (
                              <>
                                <span>已复制</span>
                                <Check className="h-4 w-4" />
                              </>
                            ) : (
                              <>
                                <span>复制</span>
                                <Copy className="h-4 w-4 transition-transform group-hover:scale-110" />
                              </>
                            )}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="relative z-10 min-[960px]:col-span-7">
              <div className="ml-auto max-w-[760px] rounded-xl border border-black/10 bg-white/86 p-5 shadow-[0_18px_54px_rgba(17,17,17,0.1)] backdrop-blur">
                <AgentStarterHint />
              </div>
            </div>
          </div>

          <div className="mb-3 grid overflow-hidden rounded-xl border border-black/10 bg-white/90 shadow-[0_18px_54px_rgba(17,17,17,0.1)] backdrop-blur min-[960px]:grid-cols-[1.15fr_1.2fr_1.05fr]">
            <div className="border-b border-black/10 p-4 min-[960px]:border-b-0 min-[960px]:border-r">
              <div className="flex items-center gap-3">
                <div className="flex h-16 w-20 items-center justify-center rounded-lg border border-[#c00000]/18 bg-[#c00000]/8">
                  <Terminal className="h-8 w-8 text-[#c00000]" />
                </div>
                <div className="min-w-0 flex-1">
                  <h2 className="text-lg font-black">LocalApp CLI</h2>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {availablePlatforms.length > 0 ? (
                      availablePlatforms.map((p) => {
                        const isCurrent = detectedPlatform === `${p.os}/${p.arch}`;
                        return (
                          <a
                            key={`${p.os}/${p.arch}`}
                            href={`/api/cli/download?os=${p.os}&arch=${p.arch}`}
                            className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-xs font-semibold transition ${
                              isCurrent
                                ? "border-[#c00000]/40 bg-[#c00000]/8 text-[#c00000]"
                                : "border-black/10 bg-white text-black hover:border-[#c00000]/60 hover:text-[#c00000]"
                            }`}
                          >
                            <MonitorDown className="h-4 w-4 shrink-0" />
                            {p.label}
                            <Download className="h-3 w-3 shrink-0 opacity-36" />
                          </a>
                        );
                      })
                    ) : (
                      <span className="text-xs text-black/52">暂无 CLI 可供下载，请联系管理员</span>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-4 border-b border-black/10 min-[960px]:border-b-0 min-[960px]:border-r">
              {stats.map(([label, value, Icon]) => (
                <div key={label} className="border-r border-black/10 px-5 py-4 last:border-r-0">
                  <Icon className="mb-1 h-4 w-4 text-black/42" />
                  <p className="truncate text-xs text-black/48">{label}</p>
                  <strong className="text-3xl font-black text-[#c00000]">{formatStat(value)}</strong>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-3 gap-2">
              {gates.map((item) => {
                const Icon = item.icon;
                return (
                  <div key={item.num} className="p-4">
                    <div className="flex items-center gap-2">
                      <Icon className="h-5 w-5 shrink-0 text-[#c00000]" />
                      <p className="text-xs font-black text-[#c00000]">{item.num}</p>
                    </div>
                    <h3 className="mt-2 truncate text-sm font-black">{item.title}</h3>
                    <p className="mt-1 line-clamp-2 text-xs leading-5 text-black/52">{item.text}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}

function DashboardHome({ user }: { user: UserData }) {
  const [apps, setApps] = useState<LoadState<AppItem>>({ data: [], loading: true, error: false });
  const [favorites, setFavorites] = useState<LoadState<FavoriteItem>>({ data: [], loading: true, error: false });
  const [recent, setRecent] = useState<LoadState<RecentItem>>({ data: [], loading: true, error: false });

  useEffect(() => {
    loadList<AppItem>("/api/me/pages?limit=8")
      .then((data) => setApps({ data, loading: false, error: false }))
      .catch(() => setApps({ data: [], loading: false, error: true }));

    loadList<FavoriteItem>("/api/me/favorites?limit=5")
      .then((data) => setFavorites({ data, loading: false, error: false }))
      .catch(() => setFavorites({ data: [], loading: false, error: true }));

    loadList<RecentItem>("/api/me/recent?limit=5")
      .then((data) => setRecent({ data, loading: false, error: false }))
      .catch(() => setRecent({ data: [], loading: false, error: true }));
  }, []);

  const displayName = user.displayName || user.name || "朋友";

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-normal">欢迎回来，{displayName}</h1>
          <p className="mt-1 text-sm text-muted-foreground">从这里继续管理、访问和回看你的应用。</p>
        </div>
        <Link
          href="/my/apps"
          className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
        >
          管理应用 <ArrowRight className="h-4 w-4" />
        </Link>
      </div>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Package className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">我的应用</h2>
            {apps.data.length > 0 && (
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                {apps.data.length}
              </span>
            )}
          </div>
          <Link href="/my/apps" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
            查看全部 <ArrowRight className="h-3 w-3" />
          </Link>
        </div>

        {apps.loading ? (
          <LoadingState />
        ) : apps.error ? (
          <EmptyState>应用列表暂时加载失败。</EmptyState>
        ) : apps.data.length === 0 ? (
          <EmptyState>
            <div className="space-y-4">
              <p>
                暂无应用。使用 <code className="rounded bg-muted px-1 py-0.5 text-xs">localapp init</code> 创建第一个应用，
                或者直接把下面这句话发给你的 AI Agent：
              </p>
              <AgentStarterHint compact />
            </div>
          </EmptyState>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {apps.data.map((app) => (
              <Link
                key={app.name}
                href={`/${user.name}/${app.name}`}
                prefetch={false}
                className="rounded-lg border bg-card p-4 transition-colors hover:bg-accent/50"
              >
                <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-md bg-muted">
                  <Globe className="h-4 w-4 text-primary" />
                </div>
                <p className="truncate text-sm font-medium">{app.name}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  v{app.currentVersion} · 更新于 {relativeTime(app.updatedAt)}
                </p>
              </Link>
            ))}
          </div>
        )}
      </section>

      <div className="grid gap-6 md:grid-cols-2">
        <section>
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Star className="h-4 w-4 text-amber-500" />
              <h2 className="text-sm font-semibold">收藏应用</h2>
            </div>
            <Link href="/my/favorites" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
              查看全部 <ArrowRight className="h-3 w-3" />
            </Link>
          </div>

          {favorites.loading ? (
            <LoadingState />
          ) : favorites.error ? (
            <EmptyState>收藏应用暂时加载失败。</EmptyState>
          ) : favorites.data.length === 0 ? (
            <EmptyState>暂无收藏应用。</EmptyState>
          ) : (
            <div className="divide-y rounded-lg border bg-card">
              {favorites.data.map((favorite) => (
                <Link
                  key={favorite.pagePath}
                  prefetch={false}
                  href={favorite.pagePath.startsWith("/") ? favorite.pagePath : `/${favorite.pagePath}`}
                  className="flex items-center justify-between gap-3 px-4 py-3 transition-colors first:rounded-t-lg last:rounded-b-lg hover:bg-accent/50"
                >
                  <span className="truncate text-sm">{favorite.pageName || appTitleFromPath(favorite.pagePath)}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{relativeTime(favorite.createdAt)}</span>
                </Link>
              ))}
            </div>
          )}
        </section>

        <section>
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold">最近访问</h2>
            </div>
            <Link href="/my/recent" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
              查看全部 <ArrowRight className="h-3 w-3" />
            </Link>
          </div>

          {recent.loading ? (
            <LoadingState />
          ) : recent.error ? (
            <EmptyState>最近访问暂时加载失败。</EmptyState>
          ) : recent.data.length === 0 ? (
            <EmptyState>暂无最近访问记录。</EmptyState>
          ) : (
            <div className="divide-y rounded-lg border bg-card">
              {recent.data.map((item) => (
                <Link
                  key={item.pagePath}
                  prefetch={false}
                  href={item.pagePath.startsWith("/") ? item.pagePath : `/${item.pagePath}`}
                  className="flex items-center justify-between gap-3 px-4 py-3 transition-colors first:rounded-t-lg last:rounded-b-lg hover:bg-accent/50"
                >
                  <span className="truncate text-sm">{appTitleFromPath(item.pagePath)}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{relativeTime(item.lastVisitedAt)}</span>
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

export default function HomePage() {
  const [user, setUser] = useState<UserData | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);

  useEffect(() => {
    fetch("/api/me", { credentials: "include" })
      .then((response) => response.json())
      .then((body) => {
        setUser(body.success && body.data ? body.data : null);
      })
      .catch(() => setUser(null))
      .finally(() => setCheckingSession(false));
  }, []);

  if (checkingSession) return null;
  if (!user) return <PublicHome />;
  return <DashboardHome user={user} />;
}
