"use client";

import { useEffect, useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { useAuthModals } from "@/components/auth-modals/auth-provider";

interface UserData { id: string; name: string; role: string; displayName?: string | null; avatarUrl?: string | null; bio?: string | null; }

export default function ProfileInfo() {
  const { openChangePassword } = useAuthModals();
  const [user, setUser] = useState<UserData | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/me", { credentials: "include" })
      .then((r) => r.json())
      .then((b) => {
        if (b.success && b.data) {
          setUser(b.data);
          setDisplayName(b.data.displayName ?? "");
          setBio(b.data.bio ?? "");
          setAvatarUrl(b.data.avatarUrl ?? null);
        }
      });
  }, []);

  const handleSaveProfile = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/me/profile", {
        method: "PUT", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName, bio }),
      });
      const body = await res.json();
      if (!body.success) throw new Error(body.error);
      setUser((prev) => prev ? { ...prev, displayName: body.data.displayName, bio: body.data.bio } : prev);
      toast.success("个人资料已保存");
    } catch (e) { toast.error((e as Error).message); }
    finally { setLoading(false); }
  };

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { toast.error("头像文件不能超过 2MB"); return; }
    setLoading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/me/avatar", { method: "POST", credentials: "include", body: formData });
      const body = await res.json();
      if (!body.success) throw new Error(body.error);
      setAvatarUrl(body.data.avatarUrl);
      setUser((prev) => prev ? { ...prev, avatarUrl: body.data.avatarUrl } : prev);
      toast.success("头像已更新");
    } catch (e) { toast.error((e as Error).message); }
    finally { setLoading(false); if (fileInputRef.current) fileInputRef.current.value = ""; }
  };

  if (!user) return <p className="text-muted-foreground">加载中...</p>;
  const initial = (user.displayName || user.name).charAt(0).toUpperCase();

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">个人资料</h1>

      <div className="flex items-center gap-4 mb-8">
        <div className="relative cursor-pointer" onClick={() => fileInputRef.current?.click()}>
          {avatarUrl ? (
            <img src={avatarUrl} alt="头像" className="h-16 w-16 rounded-full object-cover" />
          ) : (
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 text-xl font-bold">{initial}</div>
          )}
        </div>
        <div className="text-sm text-muted-foreground">
          <p>点击头像更换</p>
          <p>JPG / PNG / WebP，最大 2MB</p>
        </div>
        <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={handleAvatarChange} />
      </div>

      <div className="mb-8 space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <Label>用户名</Label>
            <div className="rounded-md border bg-muted px-3 py-2 text-sm text-muted-foreground">{user.name}</div>
          </div>
          <div className="space-y-1">
            <Label>角色</Label>
            <div className="rounded-md border bg-muted px-3 py-2 text-sm text-muted-foreground">{user.role}</div>
          </div>
        </div>
        <div className="space-y-1">
          <Label htmlFor="dn">显示名称</Label>
          <Input id="dn" value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={32} placeholder="设置显示名称" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="bio">简介</Label>
          <Textarea id="bio" value={bio} onChange={(e) => setBio(e.target.value)} rows={3} placeholder="介绍一下自己..." />
        </div>
        <Button onClick={handleSaveProfile} disabled={loading} className="w-full">保存资料</Button>
      </div>

      <hr className="my-8" />
      <h2 className="text-lg font-semibold mb-4">修改密码</h2>
      <Button variant="outline" onClick={() => openChangePassword({ mode: "profile" })} className="w-full">修改密码</Button>
    </div>
  );
}
