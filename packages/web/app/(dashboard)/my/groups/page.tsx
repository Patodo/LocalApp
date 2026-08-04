"use client";

import { useEffect, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "sonner";

interface GroupInfo { id: string; name: string; description: string | null; system: boolean; isCreator: boolean; memberCount: number; createdAt: string; }
interface MemberInfo { id: string; name: string; displayName: string | null; }
interface GroupDetail extends GroupInfo { creatorId: string; members: MemberInfo[]; }
interface UserInfo { id: string; name: string; displayName?: string | null; }

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...options, credentials: "include" });
  if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error(b.error || `HTTP ${res.status}`); }
  return res.json();
}

export default function ProfileGroups() {
  const [groups, setGroups] = useState<GroupInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<GroupDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [showCreate, setShowCreate] = useState(false);
  const [createName, setCreateName] = useState(""); const [createDesc, setCreateDesc] = useState("");

  const [showEdit, setShowEdit] = useState(false);
  const [editName, setEditName] = useState(""); const [editDesc, setEditDesc] = useState("");

  const [showAddMembers, setShowAddMembers] = useState(false);
  const [allUsers, setAllUsers] = useState<UserInfo[]>([]);
  const [selectedUserIds, setSelectedUserIds] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [confirmRemoveMember, setConfirmRemoveMember] = useState<{ groupId: string; userId: string; userName: string } | null>(null);

  const loadGroups = useCallback(async () => {
    try {
      const r = await fetchJson<{ success: boolean; data: GroupInfo[] }>("/api/groups");
      setGroups(r.data);
    } catch { toast.error("加载群组失败"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadGroups(); }, [loadGroups]);

  const handleSelectGroup = async (id: string) => {
    if (selectedId === id) { setSelectedId(null); setDetail(null); return; }
    setSelectedId(id); setDetailLoading(true);
    try {
      const r = await fetchJson<{ success: boolean; data: GroupDetail }>(`/api/groups/${id}`);
      setDetail(r.data);
    } catch { toast.error("加载群组详情失败"); }
    finally { setDetailLoading(false); }
  };

  const handleCreate = async () => {
    if (!createName.trim()) return;
    try {
      const r = await fetchJson<{ success: boolean; data: GroupInfo }>("/api/groups", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: createName.trim(), description: createDesc.trim() || undefined }),
      });
      setGroups((prev) => [...prev, r.data]);
      setShowCreate(false); setCreateName(""); setCreateDesc("");
      toast.success("群组已创建");
    } catch (e) { toast.error((e as Error).message); }
  };

  const handleEdit = async () => {
    if (!detail || !editName.trim()) return;
    try {
      await fetchJson(`/api/groups/${detail.id}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: editName.trim(), description: editDesc.trim() || undefined }),
      });
      setShowEdit(false);
      const updated = await fetchJson<{ success: boolean; data: GroupDetail }>(`/api/groups/${detail.id}`);
      setDetail(updated.data);
      setGroups((prev) => prev.map((g) => g.id === updated.data.id ? { ...g, name: updated.data.name, description: updated.data.description } : g));
      toast.success("群组已更新");
    } catch (e) { toast.error((e as Error).message); }
  };

  const handleDelete = async (id: string) => {
    try {
      await fetchJson(`/api/groups/${id}`, { method: "DELETE" });
      setGroups((prev) => prev.filter((g) => g.id !== id));
      if (selectedId === id) { setSelectedId(null); setDetail(null); }
      toast.success("群组已删除");
    } catch (e) { toast.error((e as Error).message); }
    setConfirmDelete(null);
  };

  const openAddMembers = async () => {
    if (!detail) return;
    try {
      const r = await fetchJson<{ success: boolean; data: UserInfo[] }>("/api/users");
      setAllUsers(r.data);
      setSelectedUserIds(new Set());
      setShowAddMembers(true);
    } catch { toast.error("加载用户列表失败"); }
  };

  const handleAddMembers = async () => {
    if (!detail || selectedUserIds.size === 0) return;
    try {
      await fetchJson(`/api/groups/${detail.id}/members`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userIds: Array.from(selectedUserIds) }),
      });
      setShowAddMembers(false);
      const updated = await fetchJson<{ success: boolean; data: GroupDetail }>(`/api/groups/${detail.id}`);
      setDetail(updated.data);
      setGroups((prev) => prev.map((g) => g.id === updated.data.id ? { ...g, memberCount: updated.data.memberCount } : g));
      toast.success("成员已添加");
    } catch (e) { toast.error((e as Error).message); }
  };

  const handleRemoveMember = async (groupId: string, userId: string) => {
    try {
      await fetchJson(`/api/groups/${groupId}/members/remove`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userIds: [userId] }),
      });
      const updated = await fetchJson<{ success: boolean; data: GroupDetail }>(`/api/groups/${groupId}`);
      setDetail(updated.data);
      setGroups((prev) => prev.map((g) => g.id === updated.data.id ? { ...g, memberCount: updated.data.memberCount } : g));
      toast.success("成员已移除");
    } catch (e) { toast.error((e as Error).message); }
    setConfirmRemoveMember(null);
  };

  if (loading) return <p className="text-muted-foreground">加载中...</p>;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">群组</h1>
        <Button size="sm" onClick={() => setShowCreate(true)}>创建群组</Button>
      </div>
      {groups.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center py-12 text-center">
            <p className="text-lg font-medium">暂无群组</p>
            <p className="text-sm text-muted-foreground mt-1">群组用于管理用户和权限</p>
            <Button size="sm" onClick={() => setShowCreate(true)} className="mt-4">创建第一个群组</Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {groups.map((group) => (
            <Card key={group.id}>
              <div className="flex cursor-pointer items-center justify-between p-4" onClick={() => handleSelectGroup(group.id)}>
                <div className="flex items-center gap-3 min-w-0">
                  <span className="text-xs text-muted-foreground">{selectedId === group.id ? "▼" : "▶"}</span>
                  <span className="font-medium truncate">{group.name}</span>
                  {group.system && <span className="inline-flex items-center rounded-full bg-yellow-100 px-2 py-0.5 text-xs font-medium text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-500">系统</span>}
                  {group.isCreator ? <span className="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">创建者</span> : <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">成员</span>}
                </div>
                <div className="flex items-center gap-3 ml-4 text-xs text-muted-foreground">
                  <span>{group.memberCount} 名成员</span>
                  <span>{new Date(group.createdAt).toLocaleDateString()}</span>
                </div>
              </div>
              {selectedId === group.id && (
                <CardContent className="border-t">
                  {detailLoading ? <p className="text-sm text-muted-foreground">加载中...</p> : detail ? (
                    <div className="space-y-4">
                      {detail.description && <p className="text-sm text-muted-foreground">{detail.description}</p>}
                      {detail.isCreator && !detail.system && (
                        <div className="flex gap-2">
                          <Button size="sm" variant="outline" onClick={() => { setEditName(detail.name); setEditDesc(detail.description || ""); setShowEdit(true); }}>编辑</Button>
                          <Button size="sm" variant="outline" onClick={openAddMembers}>添加成员</Button>
                          <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setConfirmDelete(detail.id)}>删除</Button>
                        </div>
                      )}
                      <div>
                        <span className="text-sm text-muted-foreground">成员（{detail.members.length}）</span>
                        <div className="mt-2 space-y-1">
                          {detail.members.map((member) => (
                            <div key={member.id} className="flex items-center justify-between rounded bg-muted/50 px-3 py-1.5">
                              <div className="flex items-center gap-2 text-sm">
                                <span>{member.displayName || member.name}</span>
                                {member.id === detail.creatorId && <span className="text-xs text-primary">创建者</span>}
                                {member.displayName && <span className="text-xs text-muted-foreground">@{member.name}</span>}
                              </div>
                              {detail.isCreator && !detail.system && member.id !== detail.creatorId && (
                                <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setConfirmRemoveMember({ groupId: detail.id, userId: member.id, userName: member.displayName || member.name })}>移除</Button>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  ) : null}
                </CardContent>
              )}
            </Card>
          ))}
        </div>
      )}
      {/* Dialog: Create */}
      {showCreate && <Dialog title="创建群组" onClose={() => { setShowCreate(false); setCreateName(""); setCreateDesc(""); }}>
        <div className="space-y-4">
          <div className="space-y-1"><Label>名称 *</Label><Input value={createName} onChange={(e) => setCreateName(e.target.value)} placeholder="群组名称" autoFocus /></div>
          <div className="space-y-1"><Label>描述</Label><Textarea value={createDesc} onChange={(e) => setCreateDesc(e.target.value)} placeholder="可选" rows={3} /></div>
          <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => { setShowCreate(false); setCreateName(""); setCreateDesc(""); }}>取消</Button><Button onClick={handleCreate} disabled={!createName.trim()}>创建</Button></div>
        </div>
      </Dialog>}
      {/* Dialog: Edit */}
      {showEdit && <Dialog title="编辑群组" onClose={() => setShowEdit(false)}>
        <div className="space-y-4">
          <div className="space-y-1"><Label>名称</Label><Input value={editName} onChange={(e) => setEditName(e.target.value)} autoFocus /></div>
          <div className="space-y-1"><Label>描述</Label><Textarea value={editDesc} onChange={(e) => setEditDesc(e.target.value)} rows={3} /></div>
          <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setShowEdit(false)}>取消</Button><Button onClick={handleEdit} disabled={!editName.trim()}>保存</Button></div>
        </div>
      </Dialog>}
      {/* Dialog: Add Members */}
      {showAddMembers && detail && <Dialog title="添加成员" onClose={() => setShowAddMembers(false)}>
        <div className="space-y-4">
          <div className="max-h-64 space-y-2 overflow-y-auto">
            {allUsers.filter((u) => !detail.members.some((m) => m.id === u.id)).map((user) => (
              <label key={user.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-muted">
                <input type="checkbox" checked={selectedUserIds.has(user.id)} onChange={() => setSelectedUserIds((prev) => { const n = new Set(prev); if (n.has(user.id)) n.delete(user.id); else n.add(user.id); return n; })} />
                <span>{user.displayName || user.name}</span>
                {user.displayName && <span className="text-xs text-muted-foreground">@{user.name}</span>}
              </label>
            ))}
          </div>
          <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setShowAddMembers(false)}>取消</Button><Button onClick={handleAddMembers} disabled={selectedUserIds.size === 0}>添加（{selectedUserIds.size}）</Button></div>
        </div>
      </Dialog>}
      {/* Dialog: Confirm Delete */}
      {confirmDelete && <Dialog title="确认删除" onClose={() => setConfirmDelete(null)}>
        <p className="text-sm text-muted-foreground">确定删除此群组？此操作不可撤销。</p>
        <div className="flex justify-end gap-2 mt-4"><Button variant="ghost" onClick={() => setConfirmDelete(null)}>取消</Button><Button variant="destructive" onClick={() => handleDelete(confirmDelete)}>删除</Button></div>
      </Dialog>}
      {/* Dialog: Confirm Remove Member */}
      {confirmRemoveMember && <Dialog title="移除成员" onClose={() => setConfirmRemoveMember(null)}>
        <p className="text-sm text-muted-foreground">确定将「{confirmRemoveMember.userName}」从群组中移除？</p>
        <div className="flex justify-end gap-2 mt-4"><Button variant="ghost" onClick={() => setConfirmRemoveMember(null)}>取消</Button><Button variant="destructive" onClick={() => handleRemoveMember(confirmRemoveMember.groupId, confirmRemoveMember.userId)}>移除</Button></div>
      </Dialog>}
    </div>
  );
}

function Dialog({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <Card className="w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <CardContent className="pt-6">
          <h3 className="text-lg font-semibold mb-4">{title}</h3>
          {children}
        </CardContent>
      </Card>
    </div>
  );
}
