import { detectBasePath } from "@localapp/sdk";

export async function fetchSchemaContext(): Promise<string> {
  try {
    const basePath = detectBasePath();
    const res = await fetch(`${basePath}/_schemas`, { credentials: "include" });
    const body = await res.json();
    if (!body.success || !body.data || body.data.length === 0) return "";
    const schemas = body.data as Array<{
      name: string;
      fields: Record<string, { type: string; constraints?: Record<string, unknown> }>;
    }>;
    const lines = ["## 数据结构定义\n"];
    for (const schema of schemas) {
      lines.push(`### ${schema.name}`);
      for (const [field, def] of Object.entries(schema.fields)) {
        const constraints = def.constraints
          ? ` (${Object.entries(def.constraints).map(([k, v]) => `${k}: ${v}`).join(", ")})`
          : "";
        lines.push(`- ${field}: ${def.type}${constraints}`);
      }
      lines.push("");
    }
    return lines.join("\n");
  } catch {
    return "";
  }
}

export function buildSystemContext(user: { name: string } | null, appName: string | null): string {
  const parts: string[] = [
    "你是一个运行在 LocalApp 应用中的 AI 助手。",
  ];
  if (appName) {
    parts.push(`当前应用: ${appName}`);
  }
  parts.push(`当前用户: ${user?.name ?? "未登录"}`);
  parts.push("");
  parts.push("## 工具使用规则");
  parts.push("当用户的需求可以映射到工具操作时，必须调用工具执行，不要仅给文字建议。");
  parts.push("信息不完整时，先询问缺失的必填参数，收集完整后立即调用工具。");
  parts.push("");
  parts.push("请用中文回复用户。");
  return parts.join("\n");
}

export function buildSystemPrompt(systemContext: string, schemaContext: string, hint?: string): string {
  const parts: string[] = [systemContext];
  if (schemaContext) {
    parts.push(schemaContext);
  }
  if (hint) {
    parts.push(hint);
  }
  return parts.join("\n\n");
}
