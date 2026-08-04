import { describe, expect, it } from "vitest";
import { rewriteNativeAppCssUrls, scopeNativeAppCss } from "../../web/components/shell/app-css-scope";

describe("native app CSS scoping", () => {
  it("scopes app selectors to the app root so they cannot target the platform shell", () => {
    const css = [
      "body { margin: 0; }",
      ".localapp-navbar, button.primary { color: red; }",
      "@media (min-width: 700px) { html.dark .card { display: block; } }",
      "@keyframes spin { from { opacity: 0; } to { opacity: 1; } }",
    ].join("\n");

    const scoped = scopeNativeAppCss(css);

    expect(scoped).toContain(":where([data-localapp-app-root]) { margin: 0; }");
    expect(scoped).toContain(":where([data-localapp-app-root]) .localapp-navbar");
    expect(scoped).toContain(":where([data-localapp-app-root]) button.primary");
    expect(scoped).toContain("@media (min-width: 700px) { :where([data-localapp-app-root]).dark .card");
    expect(scoped).toContain("@keyframes spin { from { opacity: 0; } to { opacity: 1; } }");
  });

  it("rewrites relative asset urls before injecting CSS text", () => {
    const rewritten = rewriteNativeAppCssUrls(
      ".icon { background: url(../icons/a.svg); } .data { background: url(data:image/png;base64,abc); }",
      "http://localhost:3000/serve/test-owner/app/assets/main.css",
    );

    expect(rewritten).toContain("url(http://localhost:3000/serve/test-owner/app/icons/a.svg)");
    expect(rewritten).toContain("url(data:image/png;base64,abc)");
  });
});
