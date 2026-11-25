"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { ChoiceSelect } from "@/components/ui/choice-select";

type Account = { id: string; name: string; displayName?: string | null };

async function read<T>(url: string, method = "GET"): Promise<T> {
  const response = await fetch(url, { method, credentials: "include" });
  const body = await response.json();
  if (!response.ok || !body.success) throw new Error(body.error || "操作失败");
  return body.data;
}

export function CoDevelopers({ appName, owner }: { appName: string; owner: string }) {
  const endpoint = `/api/me/apps/${encodeURIComponent(appName)}/co-developers`;
  const [users, setUsers] = useState<Account[]>([]);
  const [members, setMembers] = useState<string[] | null>(null);
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    Promise.all([read<Account[]>("/api/users"), read<string[]>(endpoint)])
      .then(([accounts, ids]) => { if (active) { setUsers(accounts); setMembers(ids); } })
      .catch(cause => { if (active) setError(cause.message); });
    return () => { active = false; };
  }, [endpoint]);

  async function update(id: string, method: "PUT" | "DELETE") {
    setBusy(true);
    setError("");
    try {
      setMembers(await read<string[]>(`${endpoint}/${encodeURIComponent(id)}`, method));
      setSelected("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "操作失败");
    } finally {
      setBusy(false);
    }
  }

  const candidates = users.filter(user => user.id !== owner && !members?.includes(user.id));
  return <section className="max-w-2xl space-y-4">
    <h2 className="text-lg font-semibold">共同开发者</h2>
    <p className="text-sm text-muted-foreground">共同开发者可从「我的应用」上传新版本。只有所有者可以添加或移除共同开发者。</p>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {!members && !error && <p role="status" className="text-sm text-muted-foreground">正在加载…</p>}
    {members?.length === 0 && <p className="text-sm text-muted-foreground">暂无共同开发者</p>}
    {!!members?.length && <ul className="divide-y rounded-lg border px-4">{members.map(id => {
      const account = users.find(user => user.id === id);
      return <li key={id} className="flex items-center justify-between gap-3 py-2">
        <span className="min-w-0 truncate">{account?.displayName || account?.name || id}</span>
        <Button variant="outline" size="sm" disabled={busy} aria-label={`移除共同开发者 ${account?.name || id}`} onClick={() => void update(id, "DELETE")}>移除</Button>
      </li>;
    })}</ul>}
    {!!members && candidates.length > 0 && <div className="flex flex-wrap items-center gap-2">
      <ChoiceSelect label="选择共同开发者" value={selected} onValueChange={setSelected} options={candidates.map(user => ({
        value: user.id, label: user.displayName ? `${user.displayName}（${user.name}）` : user.name,
      }))} />
      <Button disabled={!selected || busy} onClick={() => void update(selected, "PUT")}>添加共同开发者</Button>
    </div>}
  </section>;
}
