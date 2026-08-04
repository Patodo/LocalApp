import { describe, expect, it } from "vitest";
import { resolveNativeAppResourceBase, resolveNativeAppUrl } from "../../web/components/shell/app-resource-base";

describe("PlatformShell native app resource base", () => {
  it("uses internal /serve raw resource base from the production shell entry", () => {
    expect(resolveNativeAppResourceBase("test-owner/team-workload", "http://localhost:3000/test-owner/team-workload/"))
      .toBe("/serve/test-owner/team-workload/");
  });

  it("uses the internal raw proxy in the Next dev shell preview", () => {
    expect(resolveNativeAppResourceBase("test-owner/team-workload", "http://localhost:3001/platform-shell/test-owner/team-workload"))
      .toBe("/_localapp/raw/test-owner/team-workload/");
  });

  it("resolves uploaded app assets relative to the selected resource base", () => {
    expect(resolveNativeAppUrl("/_localapp/raw/test-owner/team-workload/", "./assets/index.js"))
      .toBe("/_localapp/raw/test-owner/team-workload/assets/index.js");
    expect(resolveNativeAppUrl("/serve/test-owner/team-workload/", "/assets/index.css"))
      .toBe("/serve/test-owner/team-workload/assets/index.css");
  });
});
