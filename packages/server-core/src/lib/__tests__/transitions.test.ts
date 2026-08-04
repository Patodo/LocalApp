import { describe, expect, it } from "vitest";
import { computeTransitionWrites } from "../transitions.js";
import type { DataSchema, TransitionDef } from "../../types/models.js";

describe("computeTransitionWrites", () => {
  it("uses an injected clock for now transition writes", () => {
    const schema: DataSchema = {
      name: "leaves",
      pageName: "leave-app",
      createdAt: "",
      updatedAt: "",
      fields: {
        id: { type: "auto_increment" },
        status: { type: "string" },
        reviewed_at: { type: "timestamp" },
      },
      business: { statusField: "status" },
    };
    const transition: TransitionDef = {
      name: "approve",
      from: ["submitted"],
      to: "approved",
      set: { reviewed_at: "now" },
    };

    const result = computeTransitionWrites(
      schema,
      transition,
      { id: "bob", name: "Bob" },
      undefined,
      { now: () => "2026-07-01T09:00:00.000Z" },
    );

    expect(result).toEqual({
      ok: true,
      data: { status: "approved", reviewed_at: "2026-07-01T09:00:00.000Z" },
    });
  });
});
