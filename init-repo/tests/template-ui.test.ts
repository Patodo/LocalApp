import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "..");

function readTemplateFile(relativePath: string) {
  return fs.readFileSync(path.join(root, relativePath), "utf-8");
}

describe("shadcn UI template files", () => {
  it("includes shadcn project structure and key component files", () => {
    expect(fs.existsSync(path.join(root, "components.json"))).toBe(true);
    expect(fs.existsSync(path.join(root, "src", "lib", "utils.ts"))).toBe(true);
    expect(fs.existsSync(path.join(root, "src", "components", "ui"))).toBe(true);

    for (const component of [
      "button",
      "input",
      "label",
      "textarea",
      "card",
      "dialog",
      "select",
      "tabs",
      "table",
      "badge",
      "popover",
      "command",
      "calendar",
      "sheet",
      "sidebar",
    ]) {
      expect(fs.existsSync(path.join(root, "src", "components", "ui", `${component}.tsx`))).toBe(true);
    }
  });

  it("configures aliases, cn helper, and shadcn theme variables", () => {
    const tsconfig = readTemplateFile("tsconfig.json");
    expect(tsconfig).toContain('"baseUrl": "."');
    expect(tsconfig).toContain('"@/*"');
    expect(tsconfig).toContain('"src/*"');
    expect(tsconfig).toContain('"extends": "@localapp/app-kit/tsconfig.base"');

    // 别名现在由 CLI 领地的 vite plugin 注入，根 vite.config.ts 极简引用
    const viteConfig = readTemplateFile("vite.config.ts");
    expect(viteConfig).toContain("@localapp/app-kit/vite");
    expect(viteConfig).toContain("localapp()");

    // 真正的 alias/proxy 逻辑在 runtime/vite-plugin.mjs（.mjs 绕过 Node 26 node_modules type stripping 限制）
    const vitePlugin = readTemplateFile("runtime/vite-plugin.mjs");
    expect(vitePlugin).toContain("alias");
    expect(vitePlugin).toContain('"@"');
    expect(vitePlugin).toContain("proxy");

    // 主题变量和 Tailwind 入口在 runtime/styles/preset.css
    const preset = readTemplateFile(path.join("runtime", "styles", "preset.css"));
    expect(preset).toContain('@import "tailwindcss";');
    expect(preset).toContain("--background");
    expect(preset).toContain("--primary");
    expect(preset).toContain("--radius");

    // src/index.css 仅引用 preset，不直接 import tailwind
    const indexCss = readTemplateFile(path.join("src", "index.css"));
    expect(indexCss).toContain("@localapp/app-kit/styles/preset.css");

    // cn 实现在 runtime/lib/utils.ts，src/lib/utils.ts 为重新导出 shim
    const runtimeUtils = readTemplateFile(path.join("runtime", "lib", "utils.ts"));
    expect(runtimeUtils).toContain("export function cn");
    expect(runtimeUtils).toContain("twMerge");

    const shimUtils = readTemplateFile(path.join("src", "lib", "utils.ts"));
    expect(shimUtils).toContain("@localapp/app-kit/lib/utils");
  });

  it("documents shadcn UI guidance for AI agents", () => {
    const claude = readTemplateFile("CLAUDE.md");
    expect(claude).toContain(".claude/skills/localapp-ui");
    expect(claude).toContain("@/components/ui");

    const uiSkillPath = path.join(root, ".claude", "skills", "localapp-ui", "SKILL.md");
    expect(fs.existsSync(uiSkillPath)).toBe(true);
    const uiSkill = fs.readFileSync(uiSkillPath, "utf-8");
    expect(uiSkill).toContain("shadcn/ui");
    expect(uiSkill).toContain("基础组件优先");
    expect(uiSkill).toContain("复杂组件");
    expect(uiSkill).toContain("Command");
    expect(uiSkill).toContain("Sidebar");
  });

  it("documents named SQL-first backend boundaries for AI agents", () => {
    const claude = readTemplateFile("CLAUDE.md");
    expect(claude).toContain("named SQL-first");
    expect(claude).toContain("不要创建 `backend/actions/`");
    expect(claude).toContain("反馈平台补齐原语");
  });

  it("uses shadcn base components in the default SDK example", () => {
    const app = readTemplateFile(path.join("src", "App.tsx"));
    expect(app).toContain("@/components/ui/button");
    expect(app).toContain("@/components/ui/card");
    expect(app).toContain("@/components/ui/input");
    expect(app).toContain("@/components/ui/label");
    expect(app).toContain("useMe");
    expect(app).toContain("useQuery");
    expect(app).toContain("useMutation");
    expect(app).not.toContain("useAction");
    expect(app).toContain("$work_items.complete");
    expect(app).toContain("$work_items.create");
    expect(app).toContain("htmlFor=");
    expect(app).not.toContain("组件陈列");
  });

  it("includes backend contract examples with JSON schema declarations", () => {
    const schema = JSON.parse(readTemplateFile(path.join("backend", "resources", "work_items", "schema.json")));
    const queries = JSON.parse(readTemplateFile(path.join("backend", "resources", "work_items", "queries.json")));
    const mutations = JSON.parse(readTemplateFile(path.join("backend", "resources", "work_items", "mutations.json")));
    const resourceSchema = JSON.parse(readTemplateFile(path.join("backend", "schemas", "resource-schema.schema.json")));
    const queriesSchema = JSON.parse(readTemplateFile(path.join("backend", "schemas", "queries.schema.json")));
    const mutationsSchema = JSON.parse(readTemplateFile(path.join("backend", "schemas", "mutations.schema.json")));

    expect(schema.$schema).toBe("https://localapp.dev/schemas/backend/resource-schema.schema.json");
    expect(schema.name).toBe("work_items");
    expect(schema.fields.created_by.type).toBe("string");
    expect(queries.$schema).toBe("https://localapp.dev/schemas/backend/queries.schema.json");
    expect(queries.queries["$work_items.list"]).toBeDefined();
    expect(queries.queries["$work_items.get"]).toBeDefined();
    expect(queries.queries["$work_items.count"]).toBeDefined();
    expect(queries.queries["$work_items.list"].result.mode).toBe("page");
    expect(queries.queries["$work_items.get"].result.mode).toBe("single");
    expect(queries.queries["$work_items.count"].result.mode).toBe("aggregate");
    expect(queries.queries["work_items.mine"]).toBeDefined();
    expect(queries.queries["work_items.dashboard"]).toBeDefined();
    expect(mutations.$schema).toBe("https://localapp.dev/schemas/backend/mutations.schema.json");
    expect(mutations.mutations["$work_items.create"]).toBeDefined();
    expect(mutations.mutations["$work_items.update"]).toBeDefined();
    expect(mutations.mutations["$work_items.delete"]).toBeDefined();
    expect(resourceSchema.$id).toBe("https://localapp.dev/schemas/backend/resource-schema.schema.json");
    expect(queriesSchema.$id).toBe("https://localapp.dev/schemas/backend/queries.schema.json");
    expect(mutationsSchema.$id).toBe("https://localapp.dev/schemas/backend/mutations.schema.json");
  });
});
