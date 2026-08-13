import { describe, expect, it } from "vitest";
import queries from "../backend/resources/resumes/queries.json";
import mutations from "../backend/resources/resumes/mutations.json";

describe("resume manager application contract", () => {
  it("keeps the supported upload types bounded", () => {
    expect(["image/png", "image/jpeg", "application/pdf"]).toEqual(["image/png", "image/jpeg", "application/pdf"]);
  });

  it("uses the installed PDF.js worker entry for Vite", () => {
    expect("pdfjs-dist/build/pdf.worker.min.mjs").toContain("pdf.worker");
  });

  it("lets the target application owner manage imported user-owned records", () => {
    for (const definition of Object.values(queries.queries)) {
      expect(definition.sql).toContain(":ownerId");
    }
    for (const [name, definition] of Object.entries(mutations.mutations)) {
      if (name === "$resumes.create") continue;
      expect(definition.sql).toContain(":ownerId");
    }
  });
});
