import type { DeviceActionRequest } from "@localapp/sdk";

export const DEFAULT_INSTALL_ROOT = import.meta.env.VITE_LOCALAPP_ACCEPTANCE_ROOT ?? "";
export const FIXTURE_SKILL_NAME = "localapp-device-actions";
export const FIXTURE_SKILL_BODY = `# Fixture Skill

This deterministic fixture proves that an application can deliver a bounded skill file to the computer where the user clicked install.

## Contract

- The installer writes only below the selected target root.
- The action does not start a child process.
- The returned result includes the installed path, byte count, and SHA-256 digest.
`;

export interface SkillInstallResult {
  installedPath: string;
  skillName: string;
  bytes: number;
  digest: string;
}

export function createSkillInstallRequest(
  targetRoot: string,
  skillName = FIXTURE_SKILL_NAME,
  skillBody = FIXTURE_SKILL_BODY,
): DeviceActionRequest {
  const root = targetRoot.trim();
  if (!root || !root.startsWith("/")) throw new Error("请选择绝对路径作为安装目录");
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(skillName)) throw new Error("技能名称格式不合法");
  if (new TextEncoder().encode(skillBody).byteLength > 128 * 1024) throw new Error("技能文件过大");

  return {
    title: `安装 ${skillName}`,
    description: `只写入用户选择的目录：${root}/${skillName}/SKILL.md`,
    permissions: { filesystemWrite: [root], childProcess: false },
    timeoutSeconds: 30,
    input: { targetRoot: root, skillName, skillBody },
    script: `
      const { mkdir, rename, rm, writeFile } = await import("node:fs/promises");
      const { createHash, randomUUID } = await import("node:crypto");
      const { dirname, relative, resolve } = await import("node:path");
      const root = resolve(input.targetRoot);
      const name = String(input.skillName);
      const destination = resolve(root, name, "SKILL.md");
      if (relative(root, destination).startsWith("..")) throw new Error("安装路径越界");
      if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(name)) throw new Error("技能名称格式不合法");
      const body = String(input.skillBody);
      const bytes = Buffer.byteLength(body, "utf8");
      if (bytes > 128 * 1024) throw new Error("技能文件过大");
      await mkdir(dirname(destination), { recursive: true });
      const temporary = destination + ".tmp-" + randomUUID();
      try {
        await writeFile(temporary, body, { encoding: "utf8", flag: "wx", mode: 0o600 });
        await rename(temporary, destination);
      } finally {
        await rm(temporary, { force: true }).catch(() => {});
      }
      return {
        installedPath: destination,
        skillName: name,
        bytes,
        digest: createHash("sha256").update(body, "utf8").digest("hex"),
      };
    `,
  };
}
