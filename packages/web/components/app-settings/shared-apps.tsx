"use client";

import { useEffect, useRef, useState } from "react";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";

type SharedApp = { owner: string; name: string; version: string };

export function SharedApps() {
  const [apps, setApps] = useState<SharedApp[]>([]);
  const [target, setTarget] = useState<SharedApp | null>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ failed: boolean; text: string }>();
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/me/shared-apps", { credentials: "include", signal: controller.signal })
      .then(async response => {
        const result = await response.json();
        if (!response.ok || !result.success) throw new Error(result.error || "加载共同开发的应用失败");
        setApps(result.data);
      }).catch(error => {
        if (!controller.signal.aborted) setFeedback({ failed: true, text: error.message });
      });
    return () => controller.abort();
  }, []);

  async function upload(app: SharedApp, file: File) {
    setBusy(true);
    setFeedback(undefined);
    try {
      const body = new FormData();
      body.append("package", file);
      const response = await fetch(`/api/me/shared-apps/${encodeURIComponent(app.owner)}/${encodeURIComponent(app.name)}/update`, {
        method: "POST", credentials: "include", body,
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || "更新失败");
      setApps(current => current.map(item => item === app ? { ...item, version: result.data.appVersion } : item));
      setFeedback({ failed: false, text: `${app.name} 已更新至 ${result.data.appVersion}` });
    } catch (error) {
      setFeedback({ failed: true, text: error instanceof Error ? error.message : "更新失败" });
    } finally {
      setBusy(false);
    }
  }

  if (!apps.length && !feedback) return null;
  return <section className="mt-8 space-y-3">
    <h2 className="text-lg font-semibold">共同开发的应用</h2>
    {feedback && <p role={feedback.failed ? "alert" : "status"} className={feedback.failed ? "text-sm text-destructive" : "text-sm"}>{feedback.text}</p>}
    <input ref={input} type="file" accept=".localapp" hidden onChange={event => {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (target && file && !busy) void upload(target, file);
    }} />
    <ul className="divide-y rounded-lg border px-4">{apps.map(app => <li key={`${app.owner}/${app.name}`} className="flex items-center justify-between gap-3 py-3">
      <div className="min-w-0"><div className="truncate font-medium">{app.owner}/{app.name}</div><p className="text-sm text-muted-foreground">{app.version}</p></div>
      <Button variant="outline" size="sm" disabled={busy} onClick={() => { setTarget(app); input.current?.click(); }}><Upload />上传新版本</Button>
    </li>)}</ul>
  </section>;
}
