"use client";

import { type FormEvent, useEffect, useState } from "react";
import { LogIn, X } from "lucide-react";
import { useAuthModals } from "./auth-provider";
import { resolveAuthReturnTo } from "./auth-return";

export function LoginDialog() {
  const { loginOpen, loginReturnTo, closeLogin, openChangePassword, setPendingOldPassword } = useAuthModals();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!loginOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeLogin();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [loginOpen, closeLogin]);

  if (!loginOpen) return null;

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setLoading(true);

    const form = new FormData(event.currentTarget);
    const username = String(form.get("username") || "");
    const password = String(form.get("password") || "");

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
        credentials: "include",
      });
      const body = await response.json();
      if (!body.success) {
        if (body.code === "MUST_CHANGE_PASSWORD") {
          setPendingOldPassword(password);
          closeLogin();
          openChangePassword({ mode: "force", userId: username });
          return;
        }
        setError(body.error || "登录失败");
        return;
      }
      window.location.href = resolveAuthReturnTo(loginReturnTo);
    } catch {
      setError("网络错误，请重试。");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 px-4 py-6 backdrop-blur-md">
      <div className="w-full max-w-md overflow-hidden rounded-xl border border-black/10 bg-white text-black shadow-[0_30px_90px_rgba(17,17,17,0.22)]">
        <div className="flex items-center justify-between border-b border-black/10 px-5 py-4">
          <div>
            <p className="text-xl font-black">欢迎回来</p>
            <p className="mt-1 text-sm text-black/52">登录后进入平台，管理应用、密钥和发布记录</p>
          </div>
          <button
            type="button"
            onClick={closeLogin}
            className="flex h-8 w-8 items-center justify-center rounded-md text-black/50 hover:bg-black/5 hover:text-black"
            aria-label="关闭登录"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4 p-5">
          <div className="space-y-2">
            <label htmlFor="auth-login-username" className="text-sm font-semibold text-black/68">
              用户名或邮箱
            </label>
            <input
              id="auth-login-username"
              name="username"
              autoComplete="username"
              required
              className="h-11 w-full rounded-md border border-black/12 bg-white px-3 text-sm outline-none ring-[#c00000]/20 placeholder:text-black/32 focus:border-[#c00000]/60 focus:ring-2"
              placeholder="请输入用户名或邮箱"
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="auth-login-password" className="text-sm font-semibold text-black/68">
              密码
            </label>
            <input
              id="auth-login-password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              className="h-11 w-full rounded-md border border-black/12 bg-white px-3 text-sm outline-none ring-[#c00000]/20 placeholder:text-black/32 focus:border-[#c00000]/60 focus:ring-2"
              placeholder="••••••••"
            />
          </div>
          {error && <p className="text-sm text-[#c00000]">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-md bg-[#c00000] text-sm font-bold text-white hover:bg-[#a30000] disabled:opacity-60"
          >
            <LogIn className="h-4 w-4" />
            {loading ? "登录中..." : "登录"}
          </button>
        </form>
      </div>
    </div>
  );
}
