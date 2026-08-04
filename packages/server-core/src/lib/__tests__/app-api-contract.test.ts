import { describe, expect, it } from "vitest";
import { appApiJson, matchAppApiRoute } from "../app-api-contract.js";

describe("app API contract route matching", () => {
  it("builds standard JSON responses without transport-specific objects", () => {
    expect(appApiJson(200, { success: true, data: { ok: true } })).toEqual({
      status: 200,
      body: { success: true, data: { ok: true } },
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  });

  it("matches platform helper routes", () => {
    expect(matchAppApiRoute("GET", "/time")).toEqual({ kind: "time" });
    expect(matchAppApiRoute("GET", "/me")).toEqual({ kind: "me" });
    expect(matchAppApiRoute("GET", "/users")).toEqual({ kind: "users" });
    expect(matchAppApiRoute("GET", "/groups")).toEqual({ kind: "groups" });
    expect(matchAppApiRoute("GET", "/groups/dev-team")).toEqual({ kind: "group-detail", id: "dev-team" });
    expect(matchAppApiRoute("GET", "/platform/users")).toEqual({
      kind: "platform",
      path: "/platform/users",
    });
    expect(matchAppApiRoute("GET", "/_schemas")).toEqual({ kind: "schemas" });
  });

  it("matches content routes", () => {
    expect(matchAppApiRoute("POST", "/content/upload")).toEqual({ kind: "content-upload" });
    expect(matchAppApiRoute("GET", "/content/file-key")).toEqual({ kind: "content-read", key: "file-key" });
  });

  it("matches named SQL routes", () => {
    expect(matchAppApiRoute("POST", "/queries/$work_items.list")).toEqual({
      kind: "named-query",
      name: "$work_items.list",
    });
    expect(matchAppApiRoute("POST", "/mutations/$work_items.create")).toEqual({
      kind: "named-mutation",
      name: "$work_items.create",
    });
    expect(matchAppApiRoute("POST", "/mutations/_transaction")).toEqual({
      kind: "named-mutation-transaction",
    });
  });

  it("matches hosted backend action routes", () => {
    expect(matchAppApiRoute("POST", "/actions/work_items.completeSecure")).toEqual({
      kind: "action",
      name: "work_items.completeSecure",
    });
  });

  it("rejects REST CRUD routes as not-found or invalid", () => {
    expect(matchAppApiRoute("GET", "/work_items")).toEqual({ kind: "not-found" });
    expect(matchAppApiRoute("POST", "/work_items")).toEqual({ kind: "not-found" });
    expect(matchAppApiRoute("GET", "/work_items/42")).toEqual({ kind: "not-found" });
    expect(matchAppApiRoute("PUT", "/work_items/42")).toEqual({ kind: "not-found" });
    expect(matchAppApiRoute("DELETE", "/work_items/42")).toEqual({ kind: "not-found" });
    expect(matchAppApiRoute("GET", "/work_items/count")).toEqual({ kind: "not-found" });
  });

  it("rejects transition routes as not-found", () => {
    expect(matchAppApiRoute("GET", "/work_items/42/transitions")).toEqual({ kind: "not-found" });
    expect(matchAppApiRoute("POST", "/work_items/42/transitions/approve")).toEqual({ kind: "not-found" });
  });

  it("rejects raw SQL and legacy upload routes as not-found", () => {
    expect(matchAppApiRoute("POST", "/db/exec")).toEqual({ kind: "not-found" });
    expect(matchAppApiRoute("POST", "/upload")).toEqual({ kind: "not-found" });
  });
});
