import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "..");

function readTemplateFile(relativePath: string) {
  return fs.readFileSync(path.join(root, relativePath), "utf-8");
}

describe("main.tsx 模板纯净性", () => {
  it("main.tsx 不引用 DevShell", () => {
    const mainTsx = readTemplateFile("src/main.tsx");
    expect(mainTsx).not.toContain("DevShell");
    expect(mainTsx).not.toContain("@localapp/app-kit/dev-shell");
  });

  it("main.tsx 渲染 <App />", () => {
    const mainTsx = readTemplateFile("src/main.tsx");
    expect(mainTsx).toContain("import App");
    expect(mainTsx).toContain("<App />");
  });

  it("main.tsx 保留 index.css 导入", () => {
    const mainTsx = readTemplateFile("src/main.tsx");
    expect(mainTsx).toContain('import "./index.css"');
  });
});
