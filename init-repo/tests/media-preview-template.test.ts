import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "..");

describe("media preview foundations", () => {
  it("pins the PDF worker to the exact PDF.js version consumed by react-pdf", () => {
    const template = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
    const reactPdf = JSON.parse(fs.readFileSync(path.join(root, "node_modules/react-pdf/package.json"), "utf8"));
    expect(template.dependencies["react-pdf"]).toBe("10.4.1");
    expect(template.dependencies["pdfjs-dist"]).toBe(reactPdf.dependencies["pdfjs-dist"]);
    expect(template.dependencies["pdfjs-dist"]).toBe("5.4.296");
    expect(template.dependencies["yet-another-react-lightbox"]).toBe("3.32.1");
  });

  it("hoists the PDF.js worker package for pnpm projects", () => {
    expect(fs.readFileSync(path.join(root, ".npmrc"), "utf8"))
      .toContain("public-hoist-pattern[]=pdfjs-dist");
  });
});
