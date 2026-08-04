"use client";

import { useEffect, useState } from "react";

interface EnvData { TEMPLATE_REPO_URL: string; DATA_DIR: string; MIN_CLI_VERSION: string; }

export default function AdminSettings() {
  const [env, setEnv] = useState<EnvData | null>(null);

  useEffect(() => {
    fetch("/api/admin/stats", { credentials: "include" });
    setEnv({
      TEMPLATE_REPO_URL: window.location.origin,
      DATA_DIR: "./data",
      MIN_CLI_VERSION: "0.1.0",
    });
  }, []);

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">系统配置</h1>
      <div className="rounded-xl border bg-card p-6 space-y-4">
        <Row label="模板仓库 URL" value={env?.TEMPLATE_REPO_URL || "（环境变量）"} />
        <Row label="数据目录" value={env?.DATA_DIR || "./data"} />
        <Row label="最低 CLI 版本" value={env?.MIN_CLI_VERSION || "（未设置）"} />
      </div>
      <p className="mt-4 text-xs text-muted-foreground">只读显示。配置通过环境变量管理。</p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center border-b pb-3 last:border-0 last:pb-0">
      <span className="w-48 text-sm text-muted-foreground">{label}</span>
      <span className="font-mono text-sm">{value}</span>
    </div>
  );
}
