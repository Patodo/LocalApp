---
name: localapp-device-actions
description: >
  在当前点击应用按钮的电脑上执行受用户确认和最小权限约束的本地操作。
  适用于导出、写入用户明确选择的目录、调用本机工具等通用设备能力；不包含任何特定应用的安装协议。
---

# 通用 Device Actions

Device Action 是统一 Server 提供给应用的受控本机操作能力。应用通过 SDK 的 `device.run()` 发起请求。它不是远程控制，也不选择另一台设备：一次请求永远由当前点击按钮的这台电脑上的本地 Server 执行。

## 设计要求

1. 在执行前展示标题、说明、输入值、目标路径和权限；失败时展示可读错误和可重试入口。
2. `filesystemRead` / `filesystemWrite` 只列出实际需要的绝对目录，优先使用用户刚刚选择的单一目录，不申请家目录或根目录。
3. 默认关闭 `network` 和 `childProcess`。开启 `childProcess` 等于允许当前操作系统用户权限下的任意子进程，必须单独解释风险。
4. 脚本只接收结构化 `input`，校验相对名称、大小和路径边界；输出 JSON 可序列化、有限大小且有稳定类型。
5. Scheme 只负责传递短期激活票据；脚本、依赖、凭据和用户数据留在 Server 端。

## 最小写入示例

下面的示例把用户显式选中的文件写入用户显式选择的目录。应用应在调用前完成 `selectedRoot` 和 `relativeName` 的确认，并把 `selectedRoot` 规范化为绝对路径。

```tsx
import { useDeviceAction } from "@localapp/sdk-react";

type WriteResult = { path: string; bytes: number };

export function ExportButton({ selectedRoot }: { selectedRoot: string }) {
  const { run, loading, error } = useDeviceAction<WriteResult>();

  async function exportFile() {
    const snapshot = await run({
      title: "导出用户选择的文件",
      description: `将结果写入：${selectedRoot}`,
      permissions: { filesystemWrite: [selectedRoot] },
      input: {
        selectedRoot,
        relativeName: "exports/result.json",
        contents: JSON.stringify({ exportedAt: new Date().toISOString() }),
      },
      script: `
        const { mkdir, writeFile } = await import("node:fs/promises");
        const { resolve, relative, dirname } = await import("node:path");
        const root = resolve(input.selectedRoot);
        const output = resolve(root, input.relativeName);
        if (relative(root, output).startsWith("..")) throw new Error("目标路径越界");
        await mkdir(dirname(output), { recursive: true });
        await writeFile(output, input.contents, { encoding: "utf8", flag: "w" });
        return { path: output, bytes: Buffer.byteLength(input.contents, "utf8") };
      `,
    });
    return snapshot.result;
  }

  return <button onClick={exportFile} disabled={loading}>{error ? "重试导出" : "导出"}</button>;
}
```

实际应用应将内容和文件名限制在业务需要的范围内，避免把任意脚本、任意绝对路径或 Server secret 作为输入传给 Action。
