"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { BellRing, CircleAlert, Clock3, RefreshCw, Send, Server, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DeviceNotificationSettings,
  DeviceNotificationSettingsSnapshot,
  DeviceNotificationSource,
  DeviceNotificationsSnapshot,
  disableDeviceNotificationSource,
  enableDeviceNotificationSource,
  enableLocalDeviceNotificationSource,
  getDeviceNotificationSettings,
  getDeviceNotifications,
  isDeviceNotificationGenerationConflict,
  sendDeviceNotificationTest,
  updateDeviceNotificationSettings,
} from "@/lib/device-notifications-api";

type Feedback = { kind: "alert" | "status"; text: string } | null;

const CONNECTION_LABELS: Record<string, string> = {
  disabled: "已停用",
  pending: "等待连接",
  connecting: "连接中",
  connected: "已连接",
  error: "错误",
};

const PERMISSION_LABELS: Record<string, string> = {
  "not-determined": "尚未请求",
  granted: "已允许",
  denied: "已拒绝",
  unsupported: "不支持",
  unknown: "未知",
};

const SOURCE_ERROR_HELP: Record<string, string> = {
  SOURCE_AUTH_FAILED: "来源认证失败，请重新配置来源。",
  SOURCE_PROTOCOL_INVALID: "来源协议不兼容，请更新对应 Server。",
  SOURCE_CONNECTION_FAILED: "来源连接失败，daemon 将自动重试。",
};

export function DeviceNotificationsPage() {
  const [snapshot, setSnapshot] = useState<DeviceNotificationsSnapshot | null>(null);
  const [settingsSnapshot, setSettingsSnapshot] = useState<DeviceNotificationSettingsSnapshot | null>(null);
  const [draft, setDraft] = useState<DeviceNotificationSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);

  const refresh = useCallback(async (showLoading = false) => {
    if (showLoading) setLoading(true);
    setFeedback(null);
    try {
      const [nextSnapshot, nextSettings] = await loadConsistentSnapshots();
      setSnapshot(nextSnapshot);
      setSettingsSnapshot(nextSettings);
      setDraft(copySettings(nextSettings.settings));
      return true;
    } catch {
      setFeedback({ kind: "alert", text: "无法加载设备通知设置。请检查 Server 状态后重试。" });
      return false;
    } finally {
      if (showLoading) setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(true); }, [refresh]);

  const generation = snapshot?.generation ?? 0;
  const available = Boolean(snapshot?.deviceIntegration.available && settingsSnapshot?.deviceIntegration.available);
  const controlsDisabled = !available || busy !== null;

  const handleConflict = useCallback(async () => {
    const refreshed = await refresh(false);
    setFeedback({
      kind: "alert",
      text: refreshed
        ? "设置已在其他页面更新，已载入最新状态。请确认后重试。"
        : "设置已在其他页面更新，但无法载入最新状态。请检查 Server 后重试。",
    });
  }, [refresh]);

  const saveSettings = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!draft || controlsDisabled) return;
    setBusy("settings");
    setFeedback(null);
    try {
      const updated = await updateDeviceNotificationSettings(generation, draft);
      setSettingsSnapshot((current) => current ? { ...current, ...updated } : current);
      setDraft(copySettings(updated.settings));
      setSnapshot((current) => current ? { ...current, generation: updated.generation } : current);
      setFeedback({ kind: "status", text: "显示设置已保存。" });
    } catch (error) {
      if (isDeviceNotificationGenerationConflict(error)) await handleConflict();
      else setFeedback({ kind: "alert", text: "无法保存显示设置。请稍后重试。" });
    } finally {
      setBusy(null);
    }
  };

  const mutateSource = async (source: DeviceNotificationSource, enable: boolean) => {
    if (controlsDisabled) return;
    setBusy(source.id);
    setFeedback(null);
    try {
      const result = enable
        ? await enableDeviceNotificationSource(source, generation)
        : await disableDeviceNotificationSource(source.id, generation);
      setSnapshot((current) => current ? {
        ...current,
        generation: result.generation,
        sources: current.sources.map((item) => item.id === result.source.id ? result.source : item),
      } : current);
      setSettingsSnapshot((current) => current ? { ...current, generation: result.generation } : current);
      setFeedback({ kind: "status", text: enable ? "通知来源已启用。" : "通知来源已停用。" });
    } catch (error) {
      if (isDeviceNotificationGenerationConflict(error)) await handleConflict();
      else setFeedback({ kind: "alert", text: "无法更新通知来源。请稍后重试。" });
    } finally {
      setBusy(null);
    }
  };

  const enableLocal = async () => {
    if (controlsDisabled) return;
    setBusy("local");
    setFeedback(null);
    try {
      const result = await enableLocalDeviceNotificationSource(generation);
      setSnapshot((current) => current ? {
        ...current,
        generation: result.generation,
        sources: [...current.sources.filter((item) => item.id !== result.source.id), result.source],
      } : current);
      setSettingsSnapshot((current) => current ? { ...current, generation: result.generation } : current);
      setFeedback({ kind: "status", text: "此 Server 通知来源已启用。" });
    } catch (error) {
      if (isDeviceNotificationGenerationConflict(error)) await handleConflict();
      else setFeedback({ kind: "alert", text: "无法启用此 Server 通知来源。请稍后重试。" });
    } finally {
      setBusy(null);
    }
  };

  const sendTest = async () => {
    if (controlsDisabled) return;
    setBusy("test");
    setFeedback(null);
    try {
      const result = await sendDeviceNotificationTest(generation);
      setSnapshot((current) => current ? { ...current, generation: result.generation } : current);
      setSettingsSnapshot((current) => current ? { ...current, generation: result.generation, lastTest: result.test } : current);
      setFeedback({ kind: "status", text: "测试通知请求已提交。" });
    } catch (error) {
      if (isDeviceNotificationGenerationConflict(error)) await handleConflict();
      else setFeedback({ kind: "alert", text: "无法发送测试通知。请稍后重试。" });
    } finally {
      setBusy(null);
    }
  };

  if (loading) {
    return <p role="status" aria-live="polite" className="text-sm text-muted-foreground">正在加载设备通知设置…</p>;
  }

  if (!snapshot || !settingsSnapshot || !draft) {
    return (
      <div className="space-y-4">
        <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          {feedback?.text ?? "无法加载设备通知设置。"}
        </p>
        <Button type="button" variant="outline" onClick={() => void refresh(true)}>重试</Button>
      </div>
    );
  }

  const hasLocalSource = snapshot.sources.some((source) => source.kind === "local");

  return (
    <div className="max-w-5xl space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold"><BellRing className="size-6" />设备通知</h1>
          <p className="mt-1 text-sm text-muted-foreground">管理当前电脑的通知来源、显示策略和一次性测试。</p>
        </div>
        <Button type="button" variant="outline" size="sm" disabled={busy !== null} onClick={() => void refresh(false)}>
          <RefreshCw />刷新
        </Button>
      </header>

      {feedback ? (
        <p
          role={feedback.kind}
          aria-live={feedback.kind === "alert" ? "assertive" : "polite"}
          className={feedback.kind === "alert"
            ? "rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"
            : "rounded-md border border-emerald-500/40 bg-emerald-500/5 p-3 text-sm"}
        >
          {feedback.text}
        </p>
      ) : null}

      {!available ? (
        <Card className="border-amber-500/40">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><CircleAlert className="size-5" />此 Server 未启用本机设备集成</CardTitle>
            <CardDescription>需要在桌面会话中启动 LocalApp daemon；当前仍可使用 Web 收件箱，下面的本机控制已禁用。</CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><ShieldCheck className="size-5" />本机集成</CardTitle>
          <CardDescription>集成状态、系统权限以及 daemon/native adapter 版本。</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <StatusItem label="集成" value={available ? "可用" : "不可用"} />
          <StatusItem label="系统权限" value={`权限：${permissionLabel(settingsSnapshot.native.permission)}`} />
          <StatusItem label="Daemon" value={`daemon ${safeVersion(settingsSnapshot.native.daemonVersion)}`} />
          <StatusItem label="Native adapter" value={`adapter ${safeVersion(settingsSnapshot.native.adapterVersion)}`} />
          <p className="sm:col-span-2 lg:col-span-4 text-muted-foreground">{permissionHelp(settingsSnapshot.native.permission)}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Server className="size-5" />通知来源</CardTitle>
          <CardDescription>期望状态由这里配置，实际状态和游标由 daemon 回报。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {snapshot.sources.length === 0 ? <p className="text-sm text-muted-foreground">尚未配置通知来源。</p> : null}
          {snapshot.sources.map((source) => (
            <SourceCard
              key={source.id}
              source={source}
              disabled={controlsDisabled}
              busy={busy === source.id}
              onToggle={(enable) => void mutateSource(source, enable)}
            />
          ))}
          {!hasLocalSource ? (
            <Button type="button" variant="outline" disabled={controlsDisabled} onClick={() => void enableLocal()}>
              启用此 Server 来源
            </Button>
          ) : null}
        </CardContent>
      </Card>

      <form onSubmit={saveSettings}>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Clock3 className="size-5" />显示设置</CardTitle>
            <CardDescription>安静时段只抑制本机弹窗；通知仍保留在 Web 收件箱。</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <label className="flex items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                checked={draft.quietHours !== null}
                disabled={controlsDisabled}
                onChange={(event) => setDraft((current) => current ? {
                  ...current,
                  quietHours: event.target.checked
                    ? current.quietHours ?? { start: "22:00", end: "07:00", timeZone: defaultTimeZone() }
                    : null,
                } : current)}
              />
              启用安静时段
            </label>
            {draft.quietHours ? (
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="开始时间" id="quiet-start">
                  <Input id="quiet-start" type="time" required disabled={controlsDisabled} value={draft.quietHours.start} onChange={(event) => updateQuietHours(setDraft, { start: event.target.value })} />
                </Field>
                <Field label="结束时间" id="quiet-end">
                  <Input id="quiet-end" type="time" required disabled={controlsDisabled} value={draft.quietHours.end} onChange={(event) => updateQuietHours(setDraft, { end: event.target.value })} />
                </Field>
                <Field label="时区" id="quiet-time-zone">
                  <Input id="quiet-time-zone" required disabled={controlsDisabled} value={draft.quietHours.timeZone} onChange={(event) => updateQuietHours(setDraft, { timeZone: event.target.value })} />
                </Field>
              </div>
            ) : null}
            <div className="space-y-2">
              <Label htmlFor="notification-preview">通知预览</Label>
              <select
                id="notification-preview"
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                value={draft.preview}
                disabled={controlsDisabled}
                onChange={(event) => setDraft((current) => current ? { ...current, preview: event.target.value as "full" | "hidden" } : current)}
              >
                <option value="full">显示标题和正文</option>
                <option value="hidden">隐藏内容预览</option>
              </select>
            </div>
            <Button type="submit" disabled={controlsDisabled}>{busy === "settings" ? "保存中…" : "保存显示设置"}</Button>
          </CardContent>
        </Card>
      </form>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Send className="size-5" />测试通知</CardTitle>
          <CardDescription>只有此显式操作可能触发系统通知权限请求。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {settingsSnapshot.lastTest ? (
            <div className="space-y-1 text-sm">
              <p>测试状态：{safeTestState(settingsSnapshot.lastTest.state)}</p>
              {settingsSnapshot.lastTest.result ? <p>测试结果：{safeTestResult(settingsSnapshot.lastTest.result)}</p> : null}
            </div>
          ) : <p className="text-sm text-muted-foreground">尚未发送测试通知。</p>}
          <Button type="button" disabled={controlsDisabled} onClick={() => void sendTest()}>{busy === "test" ? "提交中…" : "发送测试通知"}</Button>
        </CardContent>
      </Card>
    </div>
  );
}

function SourceCard({ source, disabled, busy, onToggle }: {
  source: DeviceNotificationSource;
  disabled: boolean;
  busy: boolean;
  onToggle: (enable: boolean) => void;
}) {
  const actual = CONNECTION_LABELS[source.connectionState] ?? "未知";
  const safeDate = source.lastEventAt && /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(source.lastEventAt) ? source.lastEventAt : "无";
  const sourceError = source.error ? SOURCE_ERROR_HELP[source.error.code] ?? "来源连接出现错误，请检查 Server 状态。" : null;
  const missingPeerId = source.kind === "peer" && !source.desiredEnabled && !source.peerId;
  return (
    <article aria-label={`通知来源 ${source.sourceLabel}`} className="rounded-lg border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-medium">{source.sourceLabel}</h3>
          <p className="text-xs text-muted-foreground">{source.kind === "local" ? "本地" : "对端"} · {source.accountLabel}</p>
        </div>
        <Button
          type="button"
          size="sm"
          variant={source.desiredEnabled ? "outline" : "default"}
          disabled={disabled || busy || !source.capability.available || missingPeerId}
          onClick={() => onToggle(!source.desiredEnabled)}
        >
          {source.desiredEnabled ? `停用 ${source.sourceLabel}` : `启用 ${source.sourceLabel}`}
        </Button>
      </div>
      <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <StatusItem label="期望" value={`期望：${source.desiredEnabled ? "启用" : "停用"}`} />
        <StatusItem label="实际" value={`实际：${actual}`} />
        <StatusItem label="游标" value={`游标：${source.cursor ?? "无"}`} />
        <StatusItem label="最近事件" value={`最近事件：${safeDate}`} />
      </dl>
      <p className="mt-2 text-xs text-muted-foreground">来源能力：{source.capability.available ? "可用" : "不可用"}</p>
      {missingPeerId ? <p className="mt-2 text-xs text-muted-foreground">此公开来源未提供对端标识，需要从“对端连接”重新启用。</p> : null}
      {sourceError ? <p className="mt-2 text-sm text-destructive">{sourceError}</p> : null}
    </article>
  );
}

function StatusItem({ label, value }: { label: string; value: string }) {
  return <div><dt className="sr-only">{label}</dt><dd>{value}</dd></div>;
}

function Field({ label, id, children }: { label: string; id: string; children: React.ReactNode }) {
  return <div className="space-y-2"><Label htmlFor={id}>{label}</Label>{children}</div>;
}

function permissionLabel(permission: string): string {
  return PERMISSION_LABELS[permission] ?? "未知";
}

function permissionHelp(permission: string): string {
  if (permission === "denied") return "请在系统设置中允许通知，然后返回此页发送测试通知。";
  if (permission === "not-determined") return "系统只会在你点击“发送测试通知”时请求权限。";
  if (permission === "unsupported") return "当前系统或桌面会话不支持原生通知；通知仍保留在 Web 收件箱。";
  if (permission === "granted") return "系统通知权限已允许。";
  return "暂时无法确定系统通知权限；可刷新后重试。";
}

function safeVersion(value: string | null): string {
  return value && /^[A-Za-z0-9._+-]{1,64}$/.test(value) ? value : "不可用";
}

function safeTestState(value: string): string {
  return /^(pending|claimed|completed)$/.test(value) ? value : "unknown";
}

function safeTestResult(value: string): string {
  const labels: Record<string, string> = {
    shown: "已显示",
    denied: "权限已拒绝",
    unsupported: "当前系统不支持",
    failed: "显示失败",
  };
  return labels[value] ?? "未知";
}

function copySettings(settings: DeviceNotificationSettings): DeviceNotificationSettings {
  return {
    preview: settings.preview,
    quietHours: settings.quietHours ? { ...settings.quietHours } : null,
  };
}

async function loadConsistentSnapshots(): Promise<[
  DeviceNotificationsSnapshot,
  DeviceNotificationSettingsSnapshot,
]> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const pair = await Promise.all([
      getDeviceNotifications(),
      getDeviceNotificationSettings(),
    ] as const);
    if (pair[0].generation === pair[1].generation) return pair;
  }
  throw new Error("DEVICE_NOTIFICATION_SNAPSHOT_GENERATION_MISMATCH");
}

function defaultTimeZone(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch { return "UTC"; }
}

function updateQuietHours(
  setDraft: React.Dispatch<React.SetStateAction<DeviceNotificationSettings | null>>,
  update: Partial<NonNullable<DeviceNotificationSettings["quietHours"]>>,
) {
  setDraft((current) => current?.quietHours ? {
    ...current,
    quietHours: { ...current.quietHours, ...update },
  } : current);
}
