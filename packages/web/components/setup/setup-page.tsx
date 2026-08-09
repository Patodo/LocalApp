"use client";

import { FormEvent, useLayoutEffect, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function SetupPage() {
  const [token, setToken] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [complete, setComplete] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useLayoutEffect(() => {
    const url = new URL(window.location.href);
    const initialToken = url.searchParams.get("token");
    if (!initialToken) return;
    url.searchParams.delete("token");
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    setToken(initialToken);
  }, []);

  const initialize = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!token) {
      setError("初始化链接已失效。请重新从 Server 启动输出中打开一次性链接。");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch("/api/setup/initialize", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, username, password }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !body.success) throw new Error(body.error || `HTTP ${response.status}`);
      setComplete(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "初始化失败");
    } finally {
      setToken("");
      setSubmitting(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <section className="w-full max-w-md rounded-xl border bg-card p-6 shadow-sm">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary"><ShieldCheck className="size-5" /></div>
          <div><h1 className="text-xl font-bold">初始化 LocalApp</h1><p className="text-sm text-muted-foreground">创建第一个管理员账户</p></div>
        </div>
        {complete ? <p className="rounded-md bg-emerald-500/10 p-3 text-sm text-emerald-700">初始化完成。现在可以返回首页登录。</p> : (
          <form className="space-y-4" onSubmit={initialize}>
            <div className="space-y-2"><Label htmlFor="setup-username">管理员用户名</Label><Input id="setup-username" value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" required /></div>
            <div className="space-y-2"><Label htmlFor="setup-password">管理员密码</Label><Input id="setup-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" minLength={6} required /></div>
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <Button className="w-full" type="submit" disabled={submitting}>{submitting ? "初始化中..." : "初始化 LocalApp"}</Button>
          </form>
        )}
      </section>
    </main>
  );
}
