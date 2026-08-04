import { describe, expect, it } from "vitest";
import { parseIssueMentions } from "../src/lib/issue-mentions.js";

describe("parseIssueMentions", () => {
  it("returns unique independent mentions from Markdown text nodes", async () => {
    expect(await parseIssueMentions(`
Hello @alice, @bob and again @alice.

\`@inline-code\`

\`\`\`ts
const owner = "@fenced-code";
\`\`\`

[profile @linked](/users/linked)
https://example.test/@url-user
mail@example.test
not-a-mention x@embedded
(@carol)
`)).toEqual(["alice", "bob", "carol"]);
  });

  it("accepts platform-style ids and rejects partial or overlong tokens", async () => {
    expect(await parseIssueMentions("@a @user-name @user_name @用户 @bad.name @" + "x".repeat(65))).toEqual(["a", "user-name", "user_name"]);
  });
});
