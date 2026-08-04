"use client";

import { useEffect, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";

interface GroupItem {
  id: string; name: string; description: string | null;
  creatorId: string; system: boolean; createdAt: string;
  memberCount: number; isCreator: boolean;
}
interface GroupMember { id: string; name: string; displayName: string | null; }
interface UserInfo { id: string; name: string; displayName?: string | null; }

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...options, credentials: "include" });
  if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error(b.error || `HTTP ${res.status}`); }
  return res.json();
}

export default function AdminGroups() {
  const [groups, setGroups] = useState<GroupItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState(""); const [newDesc, setNewDesc] = useState("");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(""); const [editDesc, setEditDesc] = useState("");
  const [saving, setSaving] = useState(false);
  const [addingMember, setAddingMember] = useState(false);
  const [removeConfirmId, setRemoveConfirmId] = useState<string | null>(null);
  const [userResults, setUserResults] = useState<UserInfo[]>([]);
  const [userSearch, setUserSearch] = useState("");
  const [showUserPicker, setShowUserPicker] = useState(false);

  const loadGroups = useCallback(() => {
    setLoading(true);
    fetchJson<{ success: boolean; data: GroupItem[] }>("/api/admin/groups")
      .then((r) => setGroups(r.data))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { loadGroups(); }, [loadGroups]);

  const loadMembers = useCallback((groupId: string) => {
    setMembersLoading(true);
    fetch(`/api/groups/${groupId}`, { credentials: "include" })
      .then((r) => r.json())
      .then((r) => setMembers(r.data.members || []))
      .catch(() => setMembers([]))
      .finally(() => setMembersLoading(false));
  }, []);

  useEffect(() => {
    if (selectedId) {
      loadMembers(selectedId);
      const g = groups.find((g) => g.id === selectedId);
      if (g) { setEditName(g.name); setEditDesc(g.description || ""); }
      setEditing(false);
    }
  }, [selectedId, groups, loadMembers]);

  useEffect(() => {
    if (!showUserPicker) return;
    fetchJson<{ success: boolean; data: UserInfo[] }>("/api/admin/users?page=1&limit=50")
      .then((res) => {
        const q = userSearch.trim().toLowerCase();
        setUserResults(q ? res.data.filter((u) => u.id.toLowerCase().includes(q) || u.name.toLowerCase().includes(q)) : res.data);
      }).catch(() => setUserResults([]));
  }, [showUserPicker, userSearch]);

  const handleCreate = async () => {
    if (!newName.trim()) return; setCreating(true);
    try {
      const r = await fetchJson<{ success: boolean; data: GroupItem }>("/api/admin/groups", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim(), description: newDesc.trim() || undefined }),
      });
      setGroups((prev) => [...prev, r.data]);
      setShowCreate(false); setNewName(""); setNewDesc("");
    } catch (e) { toast.error((e as Error).message); }
    finally { setCreating(false); }
  };

  const handleSaveEdit = async () => {
    if (!selectedId) return; setSaving(true);
    try {
      const r = await fetchJson<{ success: boolean; data: GroupItem }>(`/api/admin/groups/${selectedId}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: editName.trim() || undefined, description: editDesc.trim() || undefined }),
      });
      setGroups((prev) => prev.map((g) => g.id === selectedId ? { ...g, ...r.data } : g));
      setEditing(false);
    } catch (e) { toast.error((e as Error).message); }
    finally { setSaving(false); }
  };

  const handleAddMember = async (userId: string) => {
    if (!selectedId) return; setAddingMember(true);
    try {
      const r = await fetchJson<{ success: boolean; data: GroupMember[] }>(`/api/admin/groups/${selectedId}/members`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userIds: [userId] }),
      });
      setMembers(r.data);
      setGroups((prev) => prev.map((g) => g.id === selectedId ? { ...g, memberCount: r.data.length } : g));
      setShowUserPicker(false); setUserSearch("");
    } catch (e) { toast.error((e as Error).message); }
    finally { setAddingMember(false); }
  };

  const handleRemoveMember = async (userId: string) => {
    if (!selectedId) return;
    try {
      const r = await fetchJson<{ success: boolean; data: GroupMember[] }>(`/api/admin/groups/${selectedId}/members/remove`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userIds: [userId] }),
      });
      setMembers(r.data);
      setGroups((prev) => prev.map((g) => g.id === selectedId ? { ...g, memberCount: r.data.length } : g));
      setRemoveConfirmId(null);
    } catch (e) { toast.error((e as Error).message); }
  };

  const selectedGroup = groups.find((g) => g.id === selectedId);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">群组管理</h1>
        <Button size="sm" onClick={() => setShowCreate(true)}>新建群组</Button>
      </div>
      {error && <p className="text-destructive mb-4">{error}</p>}
      {loading && <p className="text-muted-foreground">加载中...</p>}
      {!loading && (
        <div className="flex gap-6">
          <div className={selectedId ? "flex-1" : "flex-1"}>
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="px-4 py-3 text-left">名称</th><th className="px-4 py-3 text-left">描述</th>
                    <th className="px-4 py-3 text-left">成员</th><th className="px-4 py-3 text-left">创建时间</th>
                  </tr>
                </thead>
                <tbody>
                  {groups.map((g) => (
                    <tr key={g.id} onClick={() => setSelectedId(g.id === selectedId ? null : g.id)}
                      className={`border-b last:border-0 cursor-pointer hover:bg-muted/30 ${g.id === selectedId ? "bg-muted/50" : ""}`}>
                      <td className="px-4 py-3 font-medium">{g.name}</td>
                      <td className="px-4 py-3 text-muted-foreground">{g.description || "-"}</td>
                      <td className="px-4 py-3"><span className="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">{g.memberCount}</span></td>
                      <td className="px-4 py-3 text-muted-foreground">{new Date(g.createdAt).toLocaleDateString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          {selectedId && selectedGroup && (
            <Card className="flex-1 self-start">
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-lg">群组详情</CardTitle>
                <Button variant="ghost" size="sm" onClick={() => setSelectedId(null)}>关闭</Button>
              </CardHeader>
              <CardContent className="space-y-4">
                {editing ? (
                  <div className="space-y-3">
                    <div className="space-y-1"><Label>名称</Label><Input value={editName} onChange={(e) => setEditName(e.target.value)} /></div>
                    <div className="space-y-1"><Label>描述</Label><Input value={editDesc} onChange={(e) => setEditDesc(e.target.value)} /></div>
                    <div className="flex gap-2">
                      <Button size="sm" onClick={handleSaveEdit} disabled={saving}>{saving ? "保存中..." : "保存"}</Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>取消</Button>
                    </div>
                  </div>
                ) : (
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{selectedGroup.name}</span>
                      <Button size="sm" variant="ghost" className="text-primary" onClick={() => setEditing(true)}>编辑</Button>
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">{selectedGroup.description || "暂无描述"}</p>
                  </div>
                )}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-sm font-medium">成员（{members.length}）</h3>
                    <Button size="sm" variant="ghost" className="text-primary" onClick={() => setShowUserPicker(true)}>添加成员</Button>
                  </div>
                  {membersLoading ? <p className="text-sm text-muted-foreground">加载中...</p> : (
                    <div className="space-y-1">
                      {members.map((m) => (
                        <div key={m.id} className="flex items-center justify-between rounded-md bg-muted/50 px-3 py-2">
                          <div>
                            <span className="font-medium text-sm">{m.name}</span>
                            {m.displayName && <span className="text-muted-foreground text-xs ml-2">({m.displayName})</span>}
                          </div>
                          {removeConfirmId === m.id ? (
                            <div className="flex gap-1">
                              <Button size="sm" variant="destructive" onClick={() => handleRemoveMember(m.id)}>确认</Button>
                              <Button size="sm" variant="ghost" onClick={() => setRemoveConfirmId(null)}>取消</Button>
                            </div>
                          ) : (
                            <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setRemoveConfirmId(m.id)}>移除</Button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                {showUserPicker && (
                  <div className="rounded-lg border p-3 bg-muted/30">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-medium text-muted-foreground">选择要添加的用户</span>
                      <Button size="sm" variant="ghost" onClick={() => { setShowUserPicker(false); setUserSearch(""); }}>关闭</Button>
                    </div>
                    <Input value={userSearch} onChange={(e) => setUserSearch(e.target.value)} placeholder="搜索用户..." className="mb-2" />
                    <div className="max-h-40 space-y-1 overflow-y-auto">
                      {userResults.filter((u) => !members.some((m) => m.id === u.id)).map((u) => (
                        <div key={u.id} className="flex items-center justify-between rounded px-2 py-1 text-sm">
                          <span>{u.name}<span className="text-muted-foreground text-xs ml-1">{u.id}</span></span>
                          <Button size="sm" variant="ghost" className="text-primary" onClick={() => handleAddMember(u.id)} disabled={addingMember}>添加</Button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      )}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <Card className="w-full max-w-md">
            <CardHeader><CardTitle>新建系统群组</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1"><Label>名称</Label><Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="群组名称" autoFocus /></div>
              <div className="space-y-1"><Label>描述</Label><Input value={newDesc} onChange={(e) => setNewDesc(e.target.value)} placeholder="可选" /></div>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={() => { setShowCreate(false); setNewName(""); setNewDesc(""); }}>取消</Button>
                <Button onClick={handleCreate} disabled={creating || !newName.trim()}>{creating ? "创建中..." : "创建"}</Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
