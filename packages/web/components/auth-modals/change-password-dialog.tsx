"use client";

import { type FormEvent, useState } from "react";
import { X } from "lucide-react";
import { useAuthModals } from "./auth-provider";
import { resolveAuthReturnTo } from "./auth-return";

const MIN_PASSWORD_LENGTH = 6;

export function ChangePasswordDialog() {
  const {
    changePasswordOpen,
    changePasswordMode,
    changePasswordUserId,
    pendingOldPassword,
    loginReturnTo,
    closeChangePassword,
  } = useAuthModals();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  if (!changePasswordOpen) return null;

  const isForce = changePasswordMode === "force";
  const subtitle = isForce ? "首次登录请先设置新的登录密码" : "请输入当前密码并设置新的登录密码";

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");

    const form = new FormData(event.currentTarget);
    const oldPassword = isForce
      ? pendingOldPassword ?? ""
      : String(form.get("oldPassword") || "");
    const newPassword = String(form.get("newPassword") || "");
    const confirmPassword = String(form.get("confirmPassword") || "");

    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      setError(`密码至少 ${MIN_PASSWORD_LENGTH} 个字符`);
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("两次密码不一致");
      return;
    }

    setLoading(true);
    try {
      const url = isForce ? "/api/auth/force-change-password" : "/api/me/password";
      const method = isForce ? "POST" : "PUT";
      const payload = isForce
        ? { userId: changePasswordUserId, oldPassword, newPassword }
        : { oldPassword, newPassword };
      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        credentials: "include",
      });
      const body = await response.json();
      if (!body.success) {
        setError(body.error || "修改密码失败");
        return;
      }
      closeChangePassword();
      if (isForce) {
        window.location.href = resolveAuthReturnTo(loginReturnTo);
      }
    } catch {
      setError("网络错误，请重试。");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 px-4 py-6 backdrop-blur-md"
      onClick={(e) => {
        if (e.target === e.currentTarget) closeChangePassword();
      }}
    >
      <div className="w-full max-w-md overflow-hidden rounded-xl border border-black/10 bg-white text-black shadow-[0_30px_90px_rgba(17,17,17,0.22)]">
        <div className="flex items-center justify-between border-b border-black/10 px-5 py-4">
          <div>
            <p className="text-xl font-black">修改密码</p>
            <p className="mt-1 text-sm text-black/52">{subtitle}</p>
          </div>
          <button
            type="button"
            onClick={closeChangePassword}
            className="flex h-8 w-8 items-center justify-center rounded-md text-black/50 hover:bg-black/5 hover:text-black"
            aria-label="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4 p-5">
          {!isForce && (
            <div className="space-y-2">
              <label htmlFor="auth-cp-old" className="text-sm font-semibold text-black/68">
                当前密码
              </label>
              <input
                id="auth-cp-old"
                name="oldPassword"
                type="password"
                autoComplete="current-password"
                aria-label="当前密码"
                required
                className="h-11 w-full rounded-md border border-black/12 bg-white px-3 text-sm outline-none ring-[#c00000]/20 placeholder:text-black/32 focus:border-[#c00000]/60 focus:ring-2"
                placeholder="••••••••"
              />
            </div>
          )}
          <div className="space-y-2">
            <label htmlFor="auth-cp-new" className="text-sm font-semibold text-black/68">
              新密码
            </label>
            <input
              id="auth-cp-new"
              name="newPassword"
              type="password"
              autoComplete="new-password"
              aria-label="新密码"
              required
              className="h-11 w-full rounded-md border border-black/12 bg-white px-3 text-sm outline-none ring-[#c00000]/20 placeholder:text-black/32 focus:border-[#c00000]/60 focus:ring-2"
              placeholder="至少 6 个字符"
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="auth-cp-confirm" className="text-sm font-semibold text-black/68">
              确认新密码
            </label>
            <input
              id="auth-cp-confirm"
              name="confirmPassword"
              type="password"
              autoComplete="new-password"
              aria-label="确认新密码"
              required
              className="h-11 w-full rounded-md border border-black/12 bg-white px-3 text-sm outline-none ring-[#c00000]/20 placeholder:text-black/32 focus:border-[#c00000]/60 focus:ring-2"
              placeholder="再次输入新密码"
            />
          </div>
          {error && <p className="text-sm text-[#c00000]">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="inline-flex h-11 w-full items-center justify-center rounded-md bg-[#c00000] text-sm font-bold text-white hover:bg-[#a30000] disabled:opacity-60"
          >
            {loading ? "修改中..." : isForce ? "修改密码并登录" : "修改密码"}
          </button>
        </form>
      </div>
    </div>
  );
}
