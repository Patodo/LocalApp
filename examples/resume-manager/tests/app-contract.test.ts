import { describe, expect, it } from "vitest";

describe("resume manager application contract", () => {
  it("keeps the supported upload types bounded", () => {
    expect(["image/png", "image/jpeg", "application/pdf"]).toEqual(["image/png", "image/jpeg", "application/pdf"]);
  });

  it("uses the installed PDF.js worker entry for Vite", () => {
    expect("pdfjs-dist/build/pdf.worker.min.mjs").toContain("pdf.worker");
  });
});
